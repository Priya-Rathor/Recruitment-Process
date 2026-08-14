// =============================================================================
// AI Service Layer function — structure free-text candidate details.
//
// Turns a raw paste ("Rahul Sharma, Software Engineer at Infosys, 5 yrs Java,
// Gurgaon, expects 19 LPA, 30 days notice, rahul@example.com 9876543210") into
// structured profile fields.
//
// Resume FILE parsing is Module 6's job (parseResume) — this handles the
// free-text intake paths: an emailed blurb, a referral note, an agency listing.
//
// The spec's rule for this module: "AI never overwrites an existing verified
// field silently — conflicting extractions are surfaced for recruiter
// confirmation". Enforced by mergeCandidateProposal() below, which fills blanks
// and reports conflicts, exactly as Module 3 does for jobs.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";

export type CandidateProposal = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  expectedSalary: number | null;
  noticePeriodDays: number | null;
};

const MAX_INPUT_LENGTH = 10_000;
const MAX_SKILLS = 30;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function cleanNumber(value: unknown, max: number): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) return null;
  return numeric;
}

function cleanSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const skill = cleanText(item, 60);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(skill);
    if (output.length >= MAX_SKILLS) break;
  }
  return output;
}

function validate(value: unknown): CandidateProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const proposal: CandidateProposal = {
    name: cleanText(raw.name, 200),
    email: cleanText(raw.email, 320)?.toLowerCase() ?? null,
    phone: cleanText(raw.phone, 40),
    location: cleanText(raw.location, 120),
    currentCompany: cleanText(raw.currentCompany, 200),
    currentRole: cleanText(raw.currentRole, 200),
    totalExperienceYears: cleanNumber(raw.totalExperienceYears, 60),
    skills: cleanSkills(raw.skills),
    expectedSalary: cleanNumber(raw.expectedSalary, Number.MAX_SAFE_INTEGER),
    noticePeriodDays: cleanNumber(raw.noticePeriodDays, 365),
  };

  // Structurally unusable — nothing identifying was found. Better to surface an
  // error than to hand the recruiter an empty form that looks like a result.
  const gotSomething =
    proposal.name !== null ||
    proposal.email !== null ||
    proposal.phone !== null ||
    proposal.skills.length > 0 ||
    proposal.currentCompany !== null;

  return gotSomething ? proposal : null;
}

const SYSTEM_PROMPT = `You extract structured candidate details from unstructured recruiter text.

Return ONLY a JSON object with exactly these keys:
{
  "name": string|null,
  "email": string|null,
  "phone": string|null,
  "location": string|null,
  "currentCompany": string|null,
  "currentRole": string|null,
  "totalExperienceYears": number|null,
  "skills": string[],
  "expectedSalary": number|null,
  "noticePeriodDays": number|null
}

Rules:
- Use null or [] for anything the text does not state. NEVER guess or infer a value that is not there — particularly email, phone, and salary.
- phone: keep the digits and any leading + exactly as written; do not reformat.
- totalExperienceYears in YEARS as a plain number. "5.5 yrs" is 5.5.
- expectedSalary as a plain annual number, digits only, no symbols or words. "19 LPA" (Indian lakhs per annum) is 1900000.
- noticePeriodDays in DAYS. "2 months" is 60. "immediate" is 0.
- currentRole is the job title only ("Software Engineer"), currentCompany the employer only ("Infosys").
- skills: short technology or skill names only, never sentences.
- Return no commentary outside the JSON object.`;

export async function structureCandidateText(
  text: string
): Promise<AiResult<CandidateProposal>> {
  const input = text.trim();

  if (input.length < 10) {
    return {
      ok: false,
      code: "invalid_output",
      message: "Paste a bit more detail so we have something to work from.",
    };
  }

  return completeJson<CandidateProposal>({
    system: SYSTEM_PROMPT,
    user: input.slice(0, MAX_INPUT_LENGTH),
    temperature: 0.1,
    maxOutputTokens: 800,
    validate,
  });
}

// =============================================================================
// Merge — "AI never overwrites a verified field silently"
// =============================================================================

export type CandidateFieldConflict = {
  field: string;
  /** The recruiter's existing value. Always kept. */
  existing: string;
  /** What AI read instead. Offered for review, never auto-applied. */
  proposed: string;
};

type MergeableCandidateFields = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  expectedSalary: number | null;
  noticePeriodDays: number | null;
};

const FIELD_LABELS: Record<keyof MergeableCandidateFields, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  currentCompany: "Current company",
  currentRole: "Current role",
  totalExperienceYears: "Total experience",
  expectedSalary: "Expected salary",
  noticePeriodDays: "Notice period",
};

export type CandidateMergeResult<T> = {
  merged: T;
  conflicts: CandidateFieldConflict[];
};

/**
 * Fills only blank fields from the proposal. Where both hold a value and they
 * differ, the EXISTING value is kept and a conflict is reported for the
 * recruiter to resolve.
 *
 * Note `0` counts as a real value (an immediate joiner's notice period is 0),
 * so blankness is tested explicitly rather than by falsiness.
 */
export function mergeCandidateProposal<T extends MergeableCandidateFields>(
  existing: T,
  proposal: CandidateProposal
): CandidateMergeResult<T> {
  const merged = { ...existing };
  const conflicts: CandidateFieldConflict[] = [];

  for (const key of Object.keys(FIELD_LABELS) as (keyof MergeableCandidateFields)[]) {
    const currentValue = existing[key];
    const proposedValue = proposal[key as keyof CandidateProposal] as string | number | null;

    if (proposedValue === null || proposedValue === undefined) continue;

    const isBlank =
      currentValue === null ||
      currentValue === undefined ||
      (typeof currentValue === "string" && currentValue.trim() === "");

    if (isBlank) {
      (merged[key] as unknown) = proposedValue;
      continue;
    }

    if (String(currentValue).trim() !== String(proposedValue).trim()) {
      conflicts.push({
        field: FIELD_LABELS[key],
        existing: String(currentValue),
        proposed: String(proposedValue),
      });
    }
  }

  return { merged, conflicts };
}
