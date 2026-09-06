// =============================================================================
// Custom fields in the {{token}} picker.
//
// PURE MODULE. Turns an organization's definitions into the PlaceholderField
// shape the existing editor, renderer and preview already understand — so a
// custom token is inserted, previewed and substituted by exactly the code that
// handles {{job.title}}. There is no second renderer, which is the same reason
// lib/communications/tokens.ts gives for reusing this vocabulary rather than
// forking it: two renderers mean {{...}} could resolve differently in a message
// than in a screening script, and the difference reaches a candidate.
//
// -----------------------------------------------------------------------------
// THE TOKEN CARRIES THE ENTITY, AND IT HAS TO.
//
// {{custom.job.region}} and {{custom.candidate.region}} are different questions.
// field_key is unique per (organization, entity_type) — NOT globally — so a
// two-part {{custom.region}} would be ambiguous the first time somebody added
// the same label to two entities, and would resolve to whichever the lookup
// happened to hold.
// =============================================================================
import type { PlaceholderField, PlaceholderValues } from "@/lib/hiring-stages/placeholders";
import type { CustomFieldDefinition, CustomFieldEntity } from "@/lib/customFields/definitions";
import { formatValue } from "@/lib/customFields/values";

export function customToken(entity: CustomFieldEntity, fieldKey: string): string {
  return `custom.${entity}.${fieldKey}`;
}

/**
 * A sample for the picker and the preview.
 *
 * Shaped by TYPE rather than left blank, because the preview's job is to show
 * what a sentence will look like — and "You said  about visa" reads as a bug
 * where "You said Yes about visa" reads as a preview.
 */
function sampleFor(definition: CustomFieldDefinition): string {
  switch (definition.field_type) {
    case "yes_no":
      return "Yes";
    case "number":
      return "3";
    case "date":
      return "2026-03-01";
    case "url":
      return "https://example.com";
    case "dropdown":
    case "radio":
      return definition.options[0] ?? "—";
    case "checkbox":
      return definition.options.slice(0, 2).join(", ") || "—";
    default:
      return definition.label;
  }
}

/**
 * The picker entries for a set of definitions.
 *
 * INACTIVE DEFINITIONS ARE EXCLUDED. Offering a retired field would let
 * somebody write a template around a question nothing asks any more, and the
 * token would render as nothing at send time — a hole in a sentence, discovered
 * by the candidate who received it.
 */
export function customPlaceholderFields(
  definitions: readonly CustomFieldDefinition[]
): PlaceholderField[] {
  return definitions
    .filter((definition) => definition.active)
    .map((definition) => ({
      token: customToken(definition.entity_type, definition.field_key),
      // The entity is in the label as well as the token: a picker showing two
      // rows both called "Region" is a picker you cannot choose from.
      label: `${definition.label} (${definition.entity_type})`,
      group: "custom" as const,
      sample: sampleFor(definition),
    }));
}

export type CustomValueSource = {
  /** Values keyed by definition id, as valuesForEntity() returns them. */
  job?: Map<string, unknown>;
  candidate?: Map<string, unknown>;
  application?: Map<string, unknown>;
};

/**
 * Resolves every custom token for one job/candidate/application.
 *
 * -----------------------------------------------------------------------------
 * A JOB DEFINITION PREFERS THE APPLICATION'S ANSWER, AND THAT IS THE WHOLE
 * SUBTLETY OF THIS MODULE.
 *
 * A job field marked "show on public application form" has TWO possible values:
 * one on the job (what this role requires) and one per application (what this
 * applicant answered). These messages are written TO a candidate, so their own
 * answer is both the more specific and the more useful of the two — a template
 * saying "you told us you need sponsorship" must not print what the job
 * requires instead.
 *
 * The job's own value is the fallback, so a job field that is NOT on the public
 * form still resolves normally.
 */
export function buildCustomValues(
  definitions: readonly CustomFieldDefinition[],
  values: CustomValueSource
): PlaceholderValues {
  const resolved: PlaceholderValues = {};

  for (const definition of definitions) {
    if (!definition.active) continue;

    const own = values[definition.entity_type]?.get(definition.id);

    const preferred =
      definition.entity_type === "job" && definition.show_on_public_form
        ? (values.application?.get(definition.id) ?? own)
        : own;

    resolved[customToken(definition.entity_type, definition.field_key)] = formatValue(
      definition.field_type,
      preferred ?? null
    );
  }

  return resolved;
}
