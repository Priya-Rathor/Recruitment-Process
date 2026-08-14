// =============================================================================
// AI Service Layer function — Module 3's job-description extractor.
//
// Turns a pasted, unstructured job description into structured fields AND drafts
// the screening + interview questions in the SAME pass, so one recruiter action
// prepares the whole downstream workflow (matching, screening, interviewing).
//
// Hard rule from the spec: "AI proposes, it never silently overwrites what the
// recruiter typed." This function therefore returns proposals only — it performs
// no writes, and the caller merges them field-by-field (see mergeProposal below,
// which fills blanks and reports conflicts rather than clobbering input).
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { isWorkMode, type WorkMode } from "@/lib/types";

export type JobProposal = {
  title: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  /** Skills stated as mandatory. */
  requiredSkills: string[];
  /** Skills stated as desirable/bonus — kept separate, per the spec's test. */
  preferredSkills: string[];
  location: string | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  screeningQuestions: string[];
  interviewQuestions: string[];
};

const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_SKILLS = 25;
const MAX_QUESTIONS = 10;
const MAX_EXPERIENCE_YEARS = 60;

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const cleaned = cleanString(item, 120);
    if (!cleaned) continue;
    // Case-insensitive dedupe: models happily emit "AWS" and "aws".
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= maxItems) break;
  }
  return output;
}

/** Non-negative finite number within a sane bound, else null. */
function cleanNumber(value: unknown, max: number): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) return null;
  return numeric;
}

/**
 * Coerces raw model output into a JobProposal. Returns null only when the output
 * is structurally unusable — a description that genuinely lacks a salary should
 * still produce a valid proposal with nulls, not an error.
 */
function validate(value: unknown): JobProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  let experienceMin = cleanNumber(raw.experienceMin, MAX_EXPERIENCE_YEARS);
  let experienceMax = cleanNumber(raw.experienceMax, MAX_EXPERIENCE_YEARS);
  // The DB has a CHECK constraint on this ordering; swap rather than reject, so
  // a transposed range doesn't cost the recruiter their extraction.
  if (experienceMin !== null && experienceMax !== null && experienceMin > experienceMax) {
    [experienceMin, experienceMax] = [experienceMax, experienceMin];
  }

  let salaryMin = cleanNumber(raw.salaryMin, Number.MAX_SAFE_INTEGER);
  let salaryMax = cleanNumber(raw.salaryMax, Number.MAX_SAFE_INTEGER);
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }

  const requiredSkills = cleanStringList(raw.requiredSkills, MAX_SKILLS);
  const preferredRaw = cleanStringList(raw.preferredSkills, MAX_SKILLS);
  // A skill cannot be both mandatory and merely preferred; required wins, so
  // Module 7 never double-counts it.
  const requiredKeys = new Set(requiredSkills.map((skill) => skill.toLowerCase()));
  const preferredSkills = preferredRaw.filter((skill) => !requiredKeys.has(skill.toLowerCase()));

  const workModeRaw = cleanString(raw.workMode, 20)?.toLowerCase();
  const workMode = isWorkMode(workModeRaw) ? workModeRaw : null;

  const proposal: JobProposal = {
    title: cleanString(raw.title, 200),
    experienceMin,
    experienceMax,
    requiredSkills,
    preferredSkills,
    location: cleanString(raw.location, 200),
    workMode,
    salaryMin,
    salaryMax,
    screeningQuestions: cleanStringList(raw.screeningQuestions, MAX_QUESTIONS),
    interviewQuestions: cleanStringList(raw.interviewQuestions, MAX_QUESTIONS),
  };

  // Structurally unusable: nothing at all was extracted. Surface an error so the
  // recruiter can retry or fill the form manually.
  const gotAnything =
    proposal.title !== null ||
    proposal.requiredSkills.length > 0 ||
    proposal.location !== null ||
    proposal.experienceMin !== null ||
    proposal.experienceMax !== null;

  return gotAnything ? proposal : null;
}

const SYSTEM_PROMPT = `You extract structured data from a recruitment job description.

Return ONLY a JSON object with exactly these keys:
{
  "title": string|null,
  "experienceMin": number|null,
  "experienceMax": number|null,
  "requiredSkills": string[],
  "preferredSkills": string[],
  "location": string|null,
  "workMode": "onsite"|"hybrid"|"remote"|null,
  "salaryMin": number|null,
  "salaryMax": number|null,
  "screeningQuestions": string[],
  "interviewQuestions": string[]
}

Extraction rules:
- Use null or [] for anything the description does not state. NEVER invent a value, and never guess a salary.
- requiredSkills: skills the description presents as mandatory ("must have", "required", "strong experience in", or listed as core responsibilities).
- preferredSkills: skills presented as desirable ("nice to have", "preferred", "bonus", "plus", "good to have"). Keep these strictly separate from requiredSkills; never repeat a skill in both.
- Skills must be short technology/skill names ("Spring Boot", "AWS"), not sentences.
- experienceMin/experienceMax in YEARS as plain numbers. "5+ years" means min 5 and max null. "4-7 years" means min 4, max 7.
- salaryMin/salaryMax as plain annual numbers in the currency's base unit, digits only, no symbols, no words. "15-22 LPA" (Indian lakhs per annum) means 1500000 and 2200000.
- workMode: only if clearly stated.

Then draft questions for this specific role:
- screeningQuestions: 5-8 questions for a short automated phone screen. Cover current role, total relevant experience, expected salary, notice period, location/mode fit, and one or two checks on the key required skills. Short and directly answerable on a call.
- interviewQuestions: 5-8 deeper technical/experience questions a human interviewer would ask for this role.

Return no commentary outside the JSON object.`;

export async function extractJobFromDescription(
  description: string
): Promise<AiResult<JobProposal>> {
  const text = description.trim();

  if (text.length < 40) {
    return {
      ok: false,
      code: "invalid_output",
      message: "Paste a longer job description so we have something to work from.",
    };
  }

  return completeJson<JobProposal>({
    system: SYSTEM_PROMPT,
    user: text.slice(0, MAX_DESCRIPTION_LENGTH),
    // Extraction, not creativity — but the questions need a little latitude.
    temperature: 0.2,
    maxOutputTokens: 1600,
    validate,
  });
}

// =============================================================================
// Merge — the "AI never silently overwrites" half of the contract.
// =============================================================================

export type FieldConflict = {
  field: string;
  /** What the recruiter already had. Always kept. */
  existing: string;
  /** What AI proposed instead. Offered for review, never auto-applied. */
  proposed: string;
};

export type MergeResult<T> = {
  /** Recruiter values preserved, blanks filled from the proposal. */
  merged: T;
  /** Fields where both had a value and they differed. */
  conflicts: FieldConflict[];
};

type MergeableJobFields = {
  title: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  location: string | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
};

const MERGE_LABELS: Record<keyof MergeableJobFields, string> = {
  title: "Title",
  experienceMin: "Minimum experience",
  experienceMax: "Maximum experience",
  location: "Location",
  workMode: "Work mode",
  salaryMin: "Minimum salary",
  salaryMax: "Maximum salary",
};

/**
 * Fills only the fields the recruiter left blank. Where both have a value and
 * they differ, the recruiter's value is KEPT and a conflict is reported for them
 * to resolve — the propose-then-review pattern Module 6 will reuse for resumes.
 */
export function mergeProposal<T extends MergeableJobFields>(
  existing: T,
  proposal: JobProposal
): MergeResult<T> {
  const merged = { ...existing };
  const conflicts: FieldConflict[] = [];

  for (const key of Object.keys(MERGE_LABELS) as (keyof MergeableJobFields)[]) {
    const currentValue = existing[key];
    const proposedValue = proposal[key as keyof JobProposal] as string | number | null;

    if (proposedValue === null || proposedValue === undefined) continue;

    const isBlank =
      currentValue === null ||
      currentValue === undefined ||
      (typeof currentValue === "string" && currentValue.trim() === "");

    if (isBlank) {
      // Safe: nothing of the recruiter's is being discarded.
      (merged[key] as unknown) = proposedValue;
      continue;
    }

    if (String(currentValue) !== String(proposedValue)) {
      conflicts.push({
        field: MERGE_LABELS[key],
        existing: String(currentValue),
        proposed: String(proposedValue),
      });
    }
  }

  return { merged, conflicts };
}
