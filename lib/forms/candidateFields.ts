// =============================================================================
// From answers to a candidate row.
//
// THE HARD PART IS NOT THE COPYING, IT IS DECIDING WHAT WINS.
//
// A submission carries two accounts of the same person: what they TYPED into the
// form, and what the AI PARSED out of the resume they attached. Where both have
// a value, the typed one wins — they told us that number directly, on a page
// where they could see what they were saying, whereas the parsed one is a model's
// reading of a PDF. Where the typed value is absent, the parsed one fills the
// gap, so attaching a CV still enriches the profile.
//
// That rule only applies to a candidate being CREATED. For an existing
// candidate, nothing here writes anything: the disagreement is queued for
// review through Module 6's resume_parse_results, exactly as bulk intake does.
// See lib/forms/submit.ts.
//
// Pure, and unit tested — this is the file that decides what a candidate record
// says about a real person.
// =============================================================================
import { CANDIDATE_COLUMN_BY_KEY, NUMERIC_BOUNDS } from "@/lib/forms/fields";
import type { AnswerValue } from "@/lib/forms/types";
import type { ParsedResume } from "@/lib/ai/parseResume";

/** The candidate columns a form can fill. Nothing else is ever written. */
export type TypedCandidateFields = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  current_company: string | null;
  current_role: string | null;
  total_experience_years: number | null;
  expected_salary: number | null;
  notice_period_days: number | null;
};

const EMPTY: TypedCandidateFields = {
  name: null,
  email: null,
  phone: null,
  location: null,
  current_company: null,
  current_role: null,
  total_experience_years: null,
  expected_salary: null,
  notice_period_days: null,
};

function text(value: AnswerValue | undefined, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function numeric(value: AnswerValue | undefined, key: string): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const bounds = NUMERIC_BOUNDS[key];
  if (bounds && (value < bounds.min || value > bounds.max)) return null;
  return value;
}

/**
 * THE NAME IS JOINED, NOT COPIED.
 *
 * `candidates.name` is ONE column — there is no first/last pair to write into,
 * and the form asks for two because that is what a person expects to be asked.
 * So they are joined here, and the result is checked for being non-blank
 * because the database has `check (length(btrim(name)) > 0)`: a form where
 * somebody typed a surname of only spaces would otherwise fail at the insert
 * with a constraint name instead of a sentence.
 *
 * A standalone form that asks for a whole name in one field is supported too —
 * `name` or `full_name` — since a pre-interview questionnaire has no reason to
 * split it.
 */
export function nameFromAnswers(answers: Record<string, AnswerValue>): string | null {
  const joined = [text(answers.first_name, 100), text(answers.last_name, 100)]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();

  if (joined.length > 0) return joined.slice(0, 200);

  return text(answers.name) ?? text(answers.full_name);
}

/**
 * The candidate columns this submission states, and nothing more.
 *
 * Keys with no candidate column — `current_ctc`, `linkedin_url`, and every
 * custom question — are deliberately absent: they stay in raw_answers and are
 * shown on the application's responses card. Inventing columns for them is a
 * candidate-profile change with its own UI, filters and retention questions.
 */
export function candidateFieldsFromAnswers(
  answers: Record<string, AnswerValue>
): TypedCandidateFields {
  const fields: TypedCandidateFields = { ...EMPTY, name: nameFromAnswers(answers) };

  for (const key of Object.keys(CANDIDATE_COLUMN_BY_KEY)) {
    const value = answers[key];
    switch (key) {
      case "email":
        fields.email = text(value, 320)?.toLowerCase() ?? null;
        break;
      case "phone":
        fields.phone = text(value, 40);
        break;
      case "location":
        fields.location = text(value);
        break;
      case "current_company":
        fields.current_company = text(value);
        break;
      case "current_role":
        fields.current_role = text(value);
        break;
      case "total_experience_years":
        fields.total_experience_years = numeric(value, key);
        break;
      case "expected_salary":
        fields.expected_salary = numeric(value, key);
        break;
      case "notice_period_days":
        fields.notice_period_days = numeric(value, key);
        break;
    }
  }

  return fields;
}

/**
 * What to insert for a BRAND NEW candidate: typed values, with parsed values
 * filling only the gaps.
 *
 * `skills` comes from the resume alone — no default form field asks for it, and
 * a free-text skills box on a public page produces "hardworking, team player"
 * far more often than it produces a matchable list.
 *
 * This is the one place parsed values reach `candidates` without a human
 * review, and it is the same exception createCandidateFromResume() already
 * documents: the record does not exist until this call, so there is nothing a
 * model could overwrite. The full parse result stays attached to the resume and
 * unreviewed, so every value remains inspectable and correctable.
 */
export function mergeWithParsedResume({
  typed,
  parsed,
}: {
  typed: TypedCandidateFields;
  parsed: ParsedResume | null;
}): TypedCandidateFields & { skills: string[] } {
  if (!parsed) return { ...typed, skills: [] };

  const pick = <T>(typedValue: T | null, parsedValue: T | null): T | null =>
    typedValue !== null && typedValue !== undefined ? typedValue : (parsedValue ?? null);

  return {
    name: pick(typed.name, parsed.name),
    email: pick(typed.email, parsed.email ? parsed.email.toLowerCase() : null),
    phone: pick(typed.phone, parsed.phone),
    location: pick(typed.location, parsed.location),
    current_company: pick(typed.current_company, parsed.currentCompany),
    current_role: pick(typed.current_role, parsed.currentRole),
    total_experience_years: pick(typed.total_experience_years, parsed.totalExperienceYears),
    expected_salary: pick(typed.expected_salary, parsed.expectedSalary),
    notice_period_days: pick(typed.notice_period_days, parsed.noticePeriodDays),
    skills: parsed.skills ?? [],
  };
}

/**
 * The fields where what somebody TYPED disagrees with what is already on their
 * profile.
 *
 * Reported, never applied. An existing candidate's record was established by a
 * human, and a public form is an unauthenticated stranger's claim about it —
 * "my expected salary is now 30 lakh" may be true, or may be somebody typing
 * into the wrong form. So the recruiter is told, on the application, and
 * decides.
 *
 * Deliberately narrower than Module 6's buildFieldComparisons(), which compares
 * a PARSED resume against a profile: that comparison already runs on the same
 * submission and its output goes to the existing review screen. This one is
 * about the typed answers, which no existing comparison covers.
 */
export function typedProfileConflicts({
  typed,
  existing,
}: {
  typed: TypedCandidateFields;
  existing: Partial<Record<keyof TypedCandidateFields, string | number | null>>;
}): { field: keyof TypedCandidateFields; submitted: string; onProfile: string }[] {
  const conflicts: { field: keyof TypedCandidateFields; submitted: string; onProfile: string }[] = [];

  for (const key of Object.keys(EMPTY) as (keyof TypedCandidateFields)[]) {
    const submitted = typed[key];
    const current = existing[key] ?? null;

    // Nothing submitted is not a disagreement, and nothing on file is a gap the
    // recruiter can fill from the answers whenever they like — neither needs a
    // decision.
    if (submitted === null || current === null) continue;

    const same =
      typeof submitted === "number" || typeof current === "number"
        ? Number(submitted) === Number(current)
        : String(submitted).trim().toLowerCase() === String(current).trim().toLowerCase();

    if (!same) {
      conflicts.push({
        field: key,
        submitted: String(submitted),
        onProfile: String(current),
      });
    }
  }

  return conflicts;
}
