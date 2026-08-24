// =============================================================================
// Two validators, one file, because they must agree.
//
//   parseFieldDefinitions() — is this a legal FORM? Runs when a recruiter saves
//                             the field editor.
//   validateAnswers()       — is this a legal SUBMISSION against that form?
//                             Runs on the server, for every public submission.
//
// THE SECOND ONE IS A SECURITY BOUNDARY, not a convenience. The public page
// validates as the applicant types, and that validation is a courtesy that
// anyone can skip with curl: the endpoint is unauthenticated by design. So
// every rule the form states is re-checked here, against the field definitions
// read from the database rather than anything the request supplied.
//
// THE NUMERIC BOUNDS MIRROR THE DATABASE. `total_experience_years` is
// numeric(4,1) with a 0-60 CHECK and `notice_period_days` is 0-365; a form that
// accepted 61 would hand the applicant a generic failure for a value the page
// invited them to type. Checked where the person can still fix it.
//
// Pure — no database handle, no fetch — so both halves are unit tested.
// =============================================================================
import {
  CHOICE_FIELD_TYPES,
  isFormFieldType,
  needsOptions,
  NUMERIC_BOUNDS,
  PROTECTED_FIELD_KEYS,
  RESUME_FIELD_KEY,
  type FormFieldType,
} from "@/lib/forms/fields";
import type { AnswerValue, FormField, FormPurpose } from "@/lib/forms/types";

// Deliberately permissive, and the same pattern lib/candidates/validation.ts
// uses: the point is to catch typos, not to police the RFC.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,58}[a-z0-9]$/;

export const MAX_FIELDS_PER_FORM = 60;
export const MAX_OPTIONS_PER_FIELD = 30;
export const MAX_SHORT_TEXT = 500;
export const MAX_LONG_TEXT = 5000;
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 20;

// -----------------------------------------------------------------------------
// 1. The form itself
// -----------------------------------------------------------------------------

export type FieldDefinition = {
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: FormFieldType;
  options: string[];
  required: boolean;
  is_standard: boolean;
  display_order: number;
};

export type FieldParseResult =
  | { ok: true; fields: FieldDefinition[] }
  | { ok: false; error: string };

/**
 * Turns a label into a stable key.
 *
 * ANSWERS ARE STORED UNDER THE KEY, NEVER THE LABEL, so this runs once when a
 * question is added and the result never changes again — renaming "Current CTC"
 * to "Current package" must not orphan the answers already collected under it.
 * The caller keeps existing keys and only mints one for a genuinely new field.
 */
export function slugifyFieldKey(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);

  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 52) || "question";

  /*
    THREE WAYS THE DATABASE CHECK REJECTS AN OTHERWISE SENSIBLE KEY, and all
    three come from real labels:

      "2026 availability" -> leading digit
      "Shift "            -> trailing underscore left behind by slicing
      "C++"               -> collapses to a single character, and the pattern
                             `^[a-z][a-z0-9_]{0,58}[a-z0-9]$` needs at least two

    The last one is the one nobody predicts, which is why it is tested.
  */
  const withLetter = /^[a-z]/.test(base) ? base : `q_${base}`;
  const trimmed = withLetter.replace(/_+$/, "");
  const safe = trimmed.length >= 2 ? trimmed : `${trimmed}_field`;

  if (!used.has(safe)) return safe;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${safe}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  // Practically unreachable — MAX_FIELDS_PER_FORM is 60.
  return `${safe}_x`;
}

/**
 * Validates the whole field list a recruiter is trying to save.
 *
 * Whole-list rather than per-field because three of the rules are about the set:
 * keys must be unique, a job application form must still contain Email and
 * Resume, and there is a cap on how many questions one form may ask.
 */
export function parseFieldDefinitions(
  value: unknown,
  { purpose }: { purpose: FormPurpose }
): FieldParseResult {
  if (!Array.isArray(value)) return { ok: false, error: "Fields must be a list." };
  if (value.length > MAX_FIELDS_PER_FORM) {
    return {
      ok: false,
      error: `A form can ask at most ${MAX_FIELDS_PER_FORM} questions. Split it into two forms.`,
    };
  }

  const fields: FieldDefinition[] = [];
  const keys = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `Question ${index + 1} is not valid.` };
    }
    const raw = item as Record<string, unknown>;

    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (label.length === 0) {
      return { ok: false, error: `Question ${index + 1} needs a label.` };
    }
    if (label.length > 200) {
      return { ok: false, error: `"${label.slice(0, 30)}…" is too long — 200 characters or fewer.` };
    }

    if (!isFormFieldType(raw.field_type)) {
      return { ok: false, error: `"${label}" has an unknown answer type.` };
    }
    const fieldType = raw.field_type;

    const providedKey = typeof raw.field_key === "string" ? raw.field_key.trim() : "";
    const fieldKey = providedKey.length > 0 ? providedKey : slugifyFieldKey(label, keys);

    if (!FIELD_KEY_PATTERN.test(fieldKey)) {
      return {
        ok: false,
        error: `"${label}" has an invalid field key. Use lowercase letters, numbers and underscores.`,
      };
    }
    if (keys.has(fieldKey)) {
      return { ok: false, error: `Two questions share the key "${fieldKey}".` };
    }
    keys.add(fieldKey);

    /*
      FILE UPLOAD IS THE RESUME, AND ONLY THE RESUME.

      Nothing in this module stores an arbitrary attachment: the one file path
      that exists writes into Module 6's `resumes` bucket against a candidate
      id. Accepting a second file field would take somebody's document and drop
      it. Refused with a sentence that says what to do instead.
    */
    if (fieldType === "file_upload") {
      if (purpose !== "job_application" || fieldKey !== RESUME_FIELD_KEY) {
        return {
          ok: false,
          error:
            "File upload is only available for the Resume field on a job application form. " +
            "Ask for a link instead, or collect documents through Onboarding.",
        };
      }
    }
    if (fieldKey === RESUME_FIELD_KEY && purpose === "job_application" && fieldType !== "file_upload") {
      return { ok: false, error: "The Resume field must stay a file upload." };
    }
    if (fieldKey === "email" && purpose === "job_application" && fieldType !== "email") {
      return { ok: false, error: "The Email field must stay an email address." };
    }

    let options: string[] = [];
    if (needsOptions(fieldType)) {
      if (!Array.isArray(raw.options)) {
        return { ok: false, error: `"${label}" needs a list of choices.` };
      }
      const seen = new Set<string>();
      for (const option of raw.options) {
        if (typeof option !== "string") continue;
        const trimmed = option.trim().slice(0, 120);
        if (trimmed.length === 0 || seen.has(trimmed)) continue;
        seen.add(trimmed);
      }
      options = [...seen];
      if (options.length === 0) {
        return { ok: false, error: `"${label}" needs at least one choice.` };
      }
      if (options.length > MAX_OPTIONS_PER_FIELD) {
        return {
          ok: false,
          error: `"${label}" has more than ${MAX_OPTIONS_PER_FIELD} choices.`,
        };
      }
    } else if (Array.isArray(raw.options) && raw.options.length > 0) {
      // Not an error worth refusing a save over — a type change from Dropdown
      // to Short text leaves stale choices behind in the editor's state.
      options = [];
    }

    const required = raw.required === true;
    const helpText =
      typeof raw.help_text === "string" && raw.help_text.trim().length > 0
        ? raw.help_text.trim().slice(0, 500)
        : null;

    fields.push({
      field_key: fieldKey,
      label,
      help_text: helpText,
      field_type: fieldType,
      options,
      required,
      is_standard: raw.is_standard === true,
      display_order: index,
    });
  }

  /*
    THE TWO FIELDS A JOB APPLICATION FORM CANNOT DO WITHOUT.

    Email is what duplicate matching keys on; the resume is what the parsing
    pipeline needs. A form missing either still looks fine and then quietly
    produces a new, uncontactable candidate record on every submission.

    The database enforces this too (migration 0033's trg_form_fields_protect) —
    this check exists so the recruiter gets a sentence instead of a constraint
    violation.
  */
  if (purpose === "job_application") {
    for (const key of PROTECTED_FIELD_KEYS) {
      const field = fields.find((candidate) => candidate.field_key === key);
      if (!field) {
        return {
          ok: false,
          error:
            key === RESUME_FIELD_KEY
              ? "A job application form must ask for a resume."
              : "A job application form must ask for an email address.",
        };
      }
      if (!field.required) {
        return {
          ok: false,
          error: `"${field.label}" has to stay required — candidate matching and resume parsing depend on it.`,
        };
      }
    }
  }

  return { ok: true, fields };
}

// -----------------------------------------------------------------------------
// 2. A submission against that form
// -----------------------------------------------------------------------------

export type AnswerErrors = Record<string, string>;

export type ValidateAnswersResult =
  | { ok: true; answers: Record<string, AnswerValue> }
  | { ok: false; errors: AnswerErrors };

/**
 * Validates one submission against the form's own field definitions.
 *
 * `uploadedFileKeys` names the file_upload fields a file actually arrived for —
 * the file itself is multipart and never appears in `raw`, so "was the resume
 * attached?" is a question only the route can answer, and it passes the answer
 * in rather than this function guessing from an absent key.
 *
 * Returns EVERY error, not the first. An applicant on a phone should not have
 * to submit six times to discover six problems.
 */
export function validateAnswers({
  fields,
  raw,
  uploadedFileKeys = [],
}: {
  fields: Pick<FormField, "field_key" | "label" | "field_type" | "options" | "required">[];
  raw: Record<string, unknown>;
  uploadedFileKeys?: readonly string[];
}): ValidateAnswersResult {
  const errors: AnswerErrors = {};
  const answers: Record<string, AnswerValue> = {};
  const uploaded = new Set(uploadedFileKeys);

  for (const field of fields) {
    const { field_key: key, label, field_type: type, required } = field;

    if (type === "file_upload") {
      if (required && !uploaded.has(key)) {
        errors[key] = `${label} is required.`;
      }
      continue;
    }

    const value = raw[key];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);

    if (empty) {
      if (required) errors[key] = `${label} is required.`;
      // An unanswered optional question is stored as null rather than omitted,
      // so the response records that it was asked.
      else answers[key] = null;
      continue;
    }

    const parsed = parseAnswer({ type, key, label, options: field.options, value });
    if (!parsed.ok) {
      errors[key] = parsed.error;
      continue;
    }
    answers[key] = parsed.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, answers };
}

type ParseOneResult = { ok: true; value: AnswerValue } | { ok: false; error: string };

function parseAnswer({
  type,
  key,
  label,
  options,
  value,
}: {
  type: FormFieldType;
  key: string;
  label: string;
  options: string[];
  value: unknown;
}): ParseOneResult {
  switch (type) {
    case "short_text":
      return parseText(value, MAX_SHORT_TEXT, label);

    case "long_text":
      return parseText(value, MAX_LONG_TEXT, label);

    case "email": {
      const text = parseText(value, 320, label);
      if (!text.ok) return text;
      const email = String(text.value).toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        return { ok: false, error: "Enter a valid email address." };
      }
      return { ok: true, value: email };
    }

    case "phone": {
      const text = parseText(value, 40, label);
      if (!text.ok) return text;
      const digits = String(text.value).replace(/\D/g, "");
      if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
        return { ok: false, error: "Enter a valid phone number, including the area code." };
      }
      // Stored as typed, not as digits: normalisation for MATCHING is
      // lib/candidates/dedupe.ts's job, and the profile should show the number
      // in the form the person actually gave it.
      return { ok: true, value: String(text.value) };
    }

    case "number": {
      const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(numeric)) {
        return { ok: false, error: `${label} must be a number.` };
      }
      const bounds = NUMERIC_BOUNDS[key];
      if (bounds) {
        if (numeric < bounds.min || numeric > bounds.max) {
          return {
            ok: false,
            error: bounds.unit
              ? `${label} must be between ${bounds.min} and ${bounds.max} ${bounds.unit}.`
              : `${label} must be between ${bounds.min} and ${bounds.max}.`,
          };
        }
      } else if (numeric < -1_000_000_000_000 || numeric > 1_000_000_000_000) {
        return { ok: false, error: `${label} is out of range.` };
      }
      return { ok: true, value: numeric };
    }

    case "dropdown":
    case "radio": {
      const text = parseText(value, 120, label);
      if (!text.ok) return text;
      if (!options.includes(String(text.value))) {
        return { ok: false, error: `Choose one of the options for ${label}.` };
      }
      return { ok: true, value: String(text.value) };
    }

    case "checkbox": {
      const list = Array.isArray(value) ? value : [value];
      const chosen: string[] = [];
      for (const item of list) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        if (trimmed.length === 0) continue;
        if (!options.includes(trimmed)) {
          return { ok: false, error: `Choose from the options for ${label}.` };
        }
        if (!chosen.includes(trimmed)) chosen.push(trimmed);
      }
      if (chosen.length === 0) {
        return { ok: false, error: `Choose at least one option for ${label}.` };
      }
      return { ok: true, value: chosen };
    }

    case "date": {
      const text = parseText(value, 40, label);
      if (!text.ok) return text;
      const raw = String(text.value);
      // Date-only, and validated by round-tripping rather than by regex alone:
      // "2026-02-31" matches any pattern you like and is not a day.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { ok: false, error: `Enter ${label} as a date.` };
      }
      const parsedDate = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || !parsedDate.toISOString().startsWith(raw)) {
        return { ok: false, error: `${raw} isn't a real date.` };
      }
      return { ok: true, value: raw };
    }

    case "url": {
      const text = parseText(value, 500, label);
      if (!text.ok) return text;
      const candidate = String(text.value);
      // A person typing a LinkedIn profile writes "linkedin.com/in/…", not a
      // scheme. Adding https:// beats rejecting the most common way this field
      // is filled in.
      const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
      try {
        const url = new URL(withScheme);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("scheme");
        if (!url.hostname.includes(".")) throw new Error("host");
        return { ok: true, value: url.toString() };
      } catch {
        return { ok: false, error: `Enter a valid web address for ${label}.` };
      }
    }

    case "yes_no": {
      if (typeof value === "boolean") return { ok: true, value };
      const text = String(value).trim().toLowerCase();
      if (["yes", "true", "1"].includes(text)) return { ok: true, value: true };
      if (["no", "false", "0"].includes(text)) return { ok: true, value: false };
      return { ok: false, error: `Answer ${label} with yes or no.` };
    }

    case "file_upload":
      // Handled by the caller — the file is multipart and never reaches here.
      return { ok: true, value: null };
  }
}

function parseText(value: unknown, maxLength: number, label: string): ParseOneResult {
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${label} must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

/** Whether a field type collects one of a fixed set of choices. */
export function isChoiceType(type: FormFieldType): boolean {
  return CHOICE_FIELD_TYPES.includes(type);
}

/**
 * One answer, as a recruiter reads it.
 *
 * Shared by the application detail card and the forms screens so a checkbox
 * answer is never rendered as "a,b" in one place and "a, b" in another.
 */
export function formatAnswer(value: AnswerValue): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "number") return value.toLocaleString("en-IN");
  return value.trim().length === 0 ? "—" : value;
}
