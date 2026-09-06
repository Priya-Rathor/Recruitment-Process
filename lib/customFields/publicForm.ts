// =============================================================================
// Job custom fields on a PUBLIC application form.
//
// PURE MODULE. The bridge between a custom field definition and the
// PublicField shape Module 23's renderer and validator already understand — so
// a custom question is validated, rendered and error-reported by exactly the
// code that handles a form's own questions, rather than by a second path that
// would have its own bugs.
//
// -----------------------------------------------------------------------------
// THE DEFINITION IS ON THE JOB. THE ANSWER IS ON THE APPLICATION.
//
// This is the distinction the brief singles out, and it is worth being blunt
// about: ONE definition ("Do you need visa sponsorship?") produces ONE answer
// PER APPLICANT. Storing those answers against the job would mean every
// candidate overwriting the last one's, leaving a single value that belongs to
// nobody. So `entity_type` on the value row is 'application' while the
// definition's is 'job' — the one legitimate mismatch, permitted explicitly by
// the integrity trigger in migration 0039 and nowhere else.
//
// -----------------------------------------------------------------------------
// WHY THE KEYS ARE PREFIXED.
//
// A form's own fields and an organization's custom fields are two independent
// key spaces that meet on one page. A form field keyed "region" and a job custom
// field keyed "region" are different questions, and merged unprefixed the second
// would silently overwrite the first's answer in raw_answers. The prefix keeps
// them apart, and stripPrefix() is how the submitter tells which answers to
// route to custom_field_values.
// =============================================================================
import type { FormFieldType } from "@/lib/forms/fields";

/**
 * Double underscore, not single.
 *
 * A form field labelled "Custom region" already generates the key
 * "custom_region". One underscore would collide with a custom field keyed
 * "region"; two cannot be produced by the slugifier, which collapses runs of
 * separators into a single "_".
 */
export const CUSTOM_PREFIX = "custom__";

export function prefixKey(fieldKey: string): string {
  return `${CUSTOM_PREFIX}${fieldKey}`;
}

/** The custom field key inside a prefixed answer key, or null if not one. */
export function stripPrefix(answerKey: string): string | null {
  return answerKey.startsWith(CUSTOM_PREFIX) ? answerKey.slice(CUSTOM_PREFIX.length) : null;
}

export type PublicCustomField = {
  fieldKey: string;
  label: string;
  helpText: string | null;
  fieldType: FormFieldType;
  options: string[];
  required: boolean;
};

export type PublicCustomSource = {
  field_key: string;
  label: string;
  field_type: FormFieldType;
  options: string[];
  required: boolean;
  display_order: number;
};

/**
 * Maps definitions onto the form's field shape, in display order.
 *
 * `existingKeys` are the form's OWN field keys. A collision after prefixing is
 * essentially impossible (see CUSTOM_PREFIX), but it is checked rather than
 * assumed: silently dropping one of two questions with the same key is a far
 * worse outcome than one question missing from a form, and skipping is the only
 * safe direction — the alternative overwrites an answer the form already owns.
 */
export function toPublicFields(
  definitions: readonly PublicCustomSource[],
  existingKeys: readonly string[] = []
): PublicCustomField[] {
  const taken = new Set(existingKeys);

  return [...definitions]
    .sort((a, b) => a.display_order - b.display_order)
    .map((definition) => ({
      fieldKey: prefixKey(definition.field_key),
      label: definition.label,
      // Custom fields have no help_text column. Null rather than an invented
      // string, so the renderer draws nothing instead of an empty hint line.
      helpText: null,
      fieldType: definition.field_type,
      options: definition.options,
      required: definition.required,
    }))
    .filter((field) => !taken.has(field.fieldKey));
}

/** Splits submitted answers into the form's own and the custom ones. */
export function splitAnswers(answers: Record<string, unknown>): {
  formAnswers: Record<string, unknown>;
  customAnswers: Record<string, unknown>;
} {
  const formAnswers: Record<string, unknown> = {};
  const customAnswers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(answers)) {
    const stripped = stripPrefix(key);
    if (stripped === null) formAnswers[key] = value;
    else customAnswers[stripped] = value;
  }

  return { formAnswers, customAnswers };
}
