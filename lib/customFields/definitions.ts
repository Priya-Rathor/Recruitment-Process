// =============================================================================
// Custom field definitions — the vocabulary, the keys, and the collision rule.
//
// PURE MODULE. No database, no React, no next/headers. Imported by the settings
// editor (a client component), by the renderers on the job/candidate/application
// forms, and by the server-side validator — which is the whole reason it holds
// no handle to anything. See app/settings/clientBoundary.test.ts.
//
// -----------------------------------------------------------------------------
// THE FIELD TYPES ARE MODULE 23's, MINUS THREE. THEY ARE NOT A NEW LIST.
//
// CUSTOM_FIELD_TYPES below is DERIVED from FORM_FIELD_TYPES in lib/forms/fields.ts
// by filtering, never by retyping. That matters more than it looks: a second
// hand-written list would compile fine on the day it was written and drift the
// first time somebody added a type to the forms engine. Filtering means a new
// forms type shows up here automatically unless it is explicitly excluded, and
// the exclusions are visible in one line.
//
// The database agrees by construction — migration 0039 types the column as
// public.form_field_type, the same enum Module 23 created, with a CHECK for the
// same three exclusions.
// =============================================================================
import {
  FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  needsOptions,
  type FormFieldType,
} from "@/lib/forms/fields";

export const CUSTOM_FIELD_ENTITIES = ["job", "candidate", "application"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

export const ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  job: "Job fields",
  candidate: "Candidate fields",
  application: "Application fields",
};

/**
 * Types a custom field may use.
 *
 * `email` and `phone` are excluded because they are IDENTITY, and identity has
 * exactly one home. A custom "Work email" of type email on a candidate would be
 * a second address that disagrees with candidates.email the moment either is
 * edited — and, worse, would be editable from the Application page, which is
 * precisely what migration 0023 forbids for the real one. Excluding the key is
 * not enough on its own; somebody would call it "contact_address" and get the
 * same problem with a different label.
 *
 * `file_upload` is excluded because there is nowhere to put the file.
 * lib/forms/fields.ts already refuses it for custom questions and explains why:
 * no bucket, no storage policy, no retention answer. Offering it would accept a
 * candidate's document and drop it silently.
 */
const EXCLUDED_TYPES: readonly FormFieldType[] = ["email", "phone", "file_upload"];

export const CUSTOM_FIELD_TYPES: readonly FormFieldType[] = FORM_FIELD_TYPES.filter(
  (type) => !EXCLUDED_TYPES.includes(type)
);

export function isCustomFieldType(value: unknown): value is FormFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

/** Re-exported so consumers need only one import. Same labels as the forms editor. */
export { FIELD_TYPE_LABELS, needsOptions };
export type { FormFieldType };

// -----------------------------------------------------------------------------
// The row
// -----------------------------------------------------------------------------

export type CustomFieldDefinition = {
  id: string;
  organization_id: string;
  entity_type: CustomFieldEntity;
  field_key: string;
  label: string;
  field_type: FormFieldType;
  options: string[];
  required: boolean;
  show_on_public_form: boolean;
  display_order: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// =============================================================================
// field_key generation
// =============================================================================

export const FIELD_KEY_MIN = 2;
export const FIELD_KEY_MAX = 60;

/** Mirrors the CHECK in migration 0039. */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Derives a stable key from a label: "Visa Sponsorship?" -> "visa_sponsorship".
 *
 * GENERATED ONCE, AT CREATION, AND NEVER AGAIN. Renaming a field must not move
 * its key: the key is what stored values point at and what {{custom.*}} tokens
 * in saved message templates resolve against. Regenerating on rename would
 * orphan every value already collected and turn every template that used it
 * into a hole in a sentence sent to a candidate.
 *
 * Returns "" when the label has no usable characters (e.g. "!!!"), which the
 * caller must treat as a validation failure rather than storing an empty key.
 */
export function fieldKeyFromLabel(label: string): string {
  const key = label
    .normalize("NFKD")
    // Strip accents so "Región" and "Region" produce the same key rather than
    // two fields a person cannot tell apart in a picker.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, FIELD_KEY_MAX);

  // A key must start with a letter (the CHECK says so). A label like "2nd
  // interview note" would otherwise yield "2nd_..." and be rejected by the
  // database after the person had already typed everything.
  const safe = /^[0-9]/.test(key) ? `f_${key}`.slice(0, FIELD_KEY_MAX) : key;

  return safe.replace(/_+$/g, "");
}

/**
 * Makes a key unique against those already used for the same entity.
 *
 * Two fields called "Region" is a reasonable thing for a person to do by
 * accident; a unique-violation from the database is not a reasonable way to
 * find out. Appends _2, _3, … the way a filesystem does.
 */
export function uniqueFieldKey(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, FIELD_KEY_MAX - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }

  throw new Error("Could not derive a unique field key");
}

// =============================================================================
// RESERVED KEYS — the collision rule.
//
// THIS LIST IS DUPLICATED IN MIGRATION 0039, DELIBERATELY, AND A TEST KEEPS THE
// TWO IN STEP. The database needs it because the browser holds an authenticated
// PostgREST client and can write directly (AGENTS.md: "RLS is the real
// boundary"); the UI needs it because being told "reserved" while typing is the
// difference between a rename and a 400. definitions.test.ts parses the SQL and
// asserts both lists are identical, so they cannot drift silently.
//
// Over-inclusive on purpose. It carries every real column as of migration 0038
// PLUS the names a person would naturally reach for — "experience", "salary",
// "skills", "recruiter", "status" — which are not columns but ARE what the UI
// calls the fixed fields. A custom "Salary" sitting beside the fixed salary
// range is the exact confusion this module must not create.
// =============================================================================

export const RESERVED_KEYS: Record<CustomFieldEntity, readonly string[]> = {
  job: [
    "id", "organization_id", "client_id", "owner_recruiter_id",
    "title", "description", "location", "work_mode",
    "experience_min", "experience_max", "experience",
    "salary_min", "salary_max", "salary",
    "required_skills", "preferred_skills", "skills",
    "status", "archived_at", "created_at", "updated_at",
    "resume_passing_score", "automations_enabled", "client_name",
  ],
  candidate: [
    "id", "organization_id",
    "name", "first_name", "last_name",
    "email", "email_normalized", "phone", "phone_normalized",
    "location", "current_company", "current_role",
    "total_experience_years", "experience",
    "expected_salary", "salary", "current_ctc",
    "notice_period_days", "notice_period",
    "skills", "source", "resume_url",
    "education", "employment_history",
    "archived_at", "created_at", "updated_at",
  ],
  application: [
    "id", "organization_id", "job_id", "candidate_id",
    "assigned_recruiter_id", "recruiter",
    "stage", "status", "source", "priority", "match_score",
    "not_shortlisted_at", "not_shortlisted_reason",
    "not_shortlisted_score", "not_shortlisted_threshold",
    "rejected_at_stage", "archived_at", "created_at", "updated_at",
  ],
};

export function isReservedKey(entity: CustomFieldEntity, key: string): boolean {
  return RESERVED_KEYS[entity].includes(key);
}

// =============================================================================
// Validation of a definition, before it is written
// =============================================================================

export type DefinitionInput = {
  entity_type: CustomFieldEntity;
  label: string;
  field_type: FormFieldType;
  options: string[];
  required: boolean;
  show_on_public_form: boolean;
};

export type ValidationResult =
  | { ok: true; field_key: string }
  | { ok: false; error: string };

/**
 * Validates a definition and settles its key in one pass.
 *
 * Returns the key rather than only a verdict because the two cannot be
 * separated: whether the definition is valid DEPENDS on the key the label
 * produces, so computing it twice risks the check and the write disagreeing.
 *
 * `takenKeys` is the set already used for this entity in this organization.
 * Pass the CURRENT key when editing so a field does not collide with itself.
 */
export function validateDefinition(
  input: DefinitionInput,
  takenKeys: readonly string[] = []
): ValidationResult {
  const label = input.label.trim();

  if (!label) return { ok: false, error: "Give the field a label." };
  if (label.length > 120) return { ok: false, error: "Label must be 120 characters or fewer." };

  if (!isCustomFieldEntity(input.entity_type)) {
    return { ok: false, error: "Unknown entity type." };
  }

  if (!isCustomFieldType(input.field_type)) {
    // Names the excluded types rather than saying "invalid", because the person
    // choosing "Email address" has a sensible reason and deserves the real one.
    return {
      ok: false,
      error:
        "That field type isn't available for custom fields. Email and phone belong " +
        "on the candidate record, and file uploads aren't supported yet.",
    };
  }

  if (needsOptions(input.field_type)) {
    const cleaned = input.options.map((option) => option.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      return { ok: false, error: "Add at least one option for this field type." };
    }
    if (new Set(cleaned).size !== cleaned.length) {
      return { ok: false, error: "Options must be unique." };
    }
  }

  if (input.show_on_public_form && input.entity_type !== "job") {
    return {
      ok: false,
      error: "Only job fields can appear on a public application form.",
    };
  }

  const base = fieldKeyFromLabel(label);
  if (base.length < FIELD_KEY_MIN) {
    return { ok: false, error: "Use a label with at least two letters or numbers." };
  }

  if (isReservedKey(input.entity_type, base)) {
    return {
      ok: false,
      error:
        `"${label}" matches the built-in ${input.entity_type} field "${base}". ` +
        "Custom fields sit alongside the built-in ones, so pick a different name.",
    };
  }

  return { ok: true, field_key: uniqueFieldKey(base, takenKeys) };
}
