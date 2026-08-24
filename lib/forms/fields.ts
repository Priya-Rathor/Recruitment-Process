// =============================================================================
// The field vocabulary, and the default job application form.
//
// TWO THINGS LIVE HERE AND THEY ARE NOT THE SAME THING:
//
//   1. WHICH FIELD TYPES EXIST — mirrors the form_field_type enum in migration
//      0033. One list, imported by the editor, the public renderer and the
//      server-side validator, because three copies of "is this a dropdown?"
//      would eventually disagree about `options`.
//
//   2. WHERE AN ANSWER LANDS — CANDIDATE_COLUMN_BY_KEY. This is the part that
//      cannot be guessed from the label. The candidates table (migration 0003)
//      has exactly the columns it has: ONE `name`, no first/last; no current
//      salary at all; no LinkedIn, GitHub or portfolio. So some default fields
//      map onto a profile column and some are answers only, and the mapping has
//      to say which explicitly rather than hoping a key matches a column name.
//
// A field whose key is NOT in that map is not lost — it is shown on the
// application's "Application form responses" card, which is exactly where a
// recruiter looks for the things the profile cannot hold.
// =============================================================================

/** Mirrors public.form_field_type. Order is the order the editor offers them. */
export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "dropdown",
  "radio",
  "checkbox",
  "date",
  "url",
  "yes_no",
  "file_upload",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export function isFormFieldType(value: unknown): value is FormFieldType {
  return typeof value === "string" && (FORM_FIELD_TYPES as readonly string[]).includes(value);
}

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Paragraph",
  email: "Email address",
  phone: "Phone number",
  number: "Number",
  dropdown: "Dropdown",
  radio: "Single choice",
  checkbox: "Multiple choice",
  date: "Date",
  url: "Web address",
  yes_no: "Yes / No",
  file_upload: "File upload",
};

/** Types whose `options` array must be non-empty, and is meaningless otherwise. */
export const CHOICE_FIELD_TYPES: readonly FormFieldType[] = ["dropdown", "radio", "checkbox"];

export function needsOptions(type: FormFieldType): boolean {
  return CHOICE_FIELD_TYPES.includes(type);
}

/**
 * The field types a recruiter may add as a custom question.
 *
 * file_upload is ABSENT, deliberately, and this is a real limitation rather
 * than an oversight: the only file this module stores is the resume, into the
 * Module 6 `resumes` bucket, against a candidate id. A second attachment on a
 * job form — or any attachment on a standalone questionnaire, which has no
 * candidate — needs its own bucket, its own storage policies and its own
 * retention answer under Module 22. Offering the type without that would accept
 * a candidate's file and silently drop it, which is worse than not offering it.
 * See the gaps section of docs/modules/23-forms-public-applications.md.
 */
export const CUSTOM_FIELD_TYPES: readonly FormFieldType[] = FORM_FIELD_TYPES.filter(
  (type) => type !== "file_upload"
);

// -----------------------------------------------------------------------------
// The standard keys
// -----------------------------------------------------------------------------

/** The resume upload's key. Load-bearing: migration 0033 protects this row. */
export const RESUME_FIELD_KEY = "resume";
/** Duplicate matching keys on this. Also protected by the migration. */
export const EMAIL_FIELD_KEY = "email";

/** Keys a job application form must always contain. */
export const PROTECTED_FIELD_KEYS: readonly string[] = [EMAIL_FIELD_KEY, RESUME_FIELD_KEY];

/**
 * Which candidate column an answer is written to.
 *
 * `first_name`/`last_name` are absent on purpose — they are joined into
 * `candidates.name` by candidateFieldsFromAnswers(), which is a different
 * operation from copying one value into one column.
 */
export const CANDIDATE_COLUMN_BY_KEY = {
  email: "email",
  phone: "phone",
  location: "location",
  current_company: "current_company",
  current_role: "current_role",
  total_experience_years: "total_experience_years",
  expected_salary: "expected_salary",
  notice_period_days: "notice_period_days",
} as const satisfies Record<string, string>;

export type MappedFieldKey = keyof typeof CANDIDATE_COLUMN_BY_KEY;

export function mapsToCandidateColumn(fieldKey: string): fieldKey is MappedFieldKey {
  return fieldKey in CANDIDATE_COLUMN_BY_KEY;
}

/**
 * Numeric bounds that MIRROR THE DATABASE CHECKS in migration 0003.
 *
 * Not decoration: without these, "61" in Total experience reaches an insert
 * that violates candidates_total_experience_years_check, and the applicant is
 * shown a generic failure for a value the form invited them to type. Validated
 * where the person can still fix it.
 */
export const NUMERIC_BOUNDS: Record<string, { min: number; max: number; unit?: string }> = {
  total_experience_years: { min: 0, max: 60, unit: "years" },
  expected_salary: { min: 0, max: 1_000_000_000 },
  current_ctc: { min: 0, max: 1_000_000_000 },
  notice_period_days: { min: 0, max: 365, unit: "days" },
};

// -----------------------------------------------------------------------------
// The default job application form
// -----------------------------------------------------------------------------

export type DefaultFieldSpec = {
  field_key: string;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  help_text?: string;
};

/**
 * What a job's application form contains the moment the job is created.
 *
 * A recruiter can rename, reorder, make optional and remove any of these except
 * Email and Resume (the migration's trigger enforces that, not just the UI).
 * The order is the order a person expects to be asked: who you are, then what
 * you do, then your CV.
 *
 * `current_ctc` and `linkedin_url` are here even though nothing maps them onto
 * the candidate profile — they are among the first things a recruiter asks, and
 * an answer on the application's responses card is worth far more than a field
 * nobody offers. See CANDIDATE_COLUMN_BY_KEY's note.
 */
export const DEFAULT_APPLICATION_FIELDS: readonly DefaultFieldSpec[] = [
  { field_key: "first_name", label: "First name", field_type: "short_text", required: true },
  { field_key: "last_name", label: "Last name", field_type: "short_text", required: true },
  { field_key: "email", label: "Email address", field_type: "email", required: true },
  { field_key: "phone", label: "Phone number", field_type: "phone", required: true },
  { field_key: "location", label: "Current location", field_type: "short_text", required: false },
  { field_key: "linkedin_url", label: "LinkedIn profile", field_type: "url", required: false },
  { field_key: "current_company", label: "Current company", field_type: "short_text", required: false },
  { field_key: "current_role", label: "Current job title", field_type: "short_text", required: false },
  {
    field_key: "total_experience_years",
    label: "Total years of experience",
    field_type: "number",
    required: false,
  },
  { field_key: "current_ctc", label: "Current annual salary", field_type: "number", required: false },
  {
    field_key: "expected_salary",
    label: "Expected annual salary",
    field_type: "number",
    required: false,
  },
  {
    field_key: "notice_period_days",
    label: "Notice period (days)",
    field_type: "number",
    required: false,
    help_text: "How many days before you could start. Enter 0 if you are available immediately.",
  },
  {
    field_key: RESUME_FIELD_KEY,
    label: "Resume",
    field_type: "file_upload",
    required: true,
    help_text: "PDF or Word document, up to 10 MB.",
  },
];

/** The name a job's application form gets when it is auto-created. */
export function defaultFormName(jobTitle: string): string {
  return `${jobTitle} — application`.slice(0, 200);
}
