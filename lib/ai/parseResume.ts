// =============================================================================
// AI Service Layer function — parseResume().
//
// The spec names this "the FIRST AI Service Layer function in the product" and
// says the propose -> validate -> human-review -> save pattern must be
// established here for every later AI function to copy. In this build the
// pattern was already established in Modules 1-5 (see lib/ai/provider.ts and
// the mergeProposal/mergeCandidateProposal helpers); parseResume follows it
// exactly rather than inventing a variant.
//
// The rule applies most strongly here: AI does NOT overwrite trusted candidate
// data. This function returns a proposal. lib/resumes/review.ts diffs it against
// the stored profile, and only the recruiter's explicit per-field choices are
// ever written.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";

export type ParsedExperience = {
  company: string;
  role: string;
  /** Free text as written on the resume — "Jan 2020 - Present". */
  period: string | null;
};

export type ParsedEducation = {
  institution: string;
  qualification: string | null;
  year: string | null;
};

export type ParsedResume = {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  experience: ParsedExperience[];
  education: ParsedEducation[];
  certifications: string[];
  /** Only when the resume actually states them. */
  expectedSalary: number | null;
  noticePeriodDays: number | null;
  /** The model's own 0-1 confidence. Advisory; never gates anything alone. */
  confidence: number | null;
};

const MAX_LIST = 40;

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

function cleanStringList(value: unknown, maxItems = MAX_LIST): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 120);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function cleanExperience(value: unknown): ParsedExperience[] {
  if (!Array.isArray(value)) return [];
  const output: ParsedExperience[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const company = cleanText(raw.company, 200);
    const role = cleanText(raw.role, 200);
    // An entry with neither company nor role carries no information.
    if (!company && !role) continue;
    output.push({
      company: company ?? "Unknown company",
      role: role ?? "Unknown role",
      period: cleanText(raw.period, 100),
    });
    if (output.length >= 25) break;
  }
  return output;
}

function cleanEducation(value: unknown): ParsedEducation[] {
  if (!Array.isArray(value)) return [];
  const output: ParsedEducation[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const institution = cleanText(raw.institution, 200);
    if (!institution) continue;
    output.push({
      institution,
      qualification: cleanText(raw.qualification, 200),
      year: cleanText(raw.year, 20),
    });
    if (output.length >= 15) break;
  }
  return output;
}

/**
 * Schema validation. The spec's test is that this "rejects malformed AI output
 * BEFORE it reaches the review screen" — so a structurally unusable response
 * returns null and the caller surfaces an error, rather than rendering an empty
 * review screen that looks like the resume contained nothing.
 *
 * Partial output IS accepted: a resume legitimately omits salary and notice, and
 * refusing those would fail the "graceful partial results" requirement.
 */
export function validateParsedResume(value: unknown): ParsedResume | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const parsed: ParsedResume = {
    name: cleanText(raw.name, 200),
    email: cleanText(raw.email, 320)?.toLowerCase() ?? null,
    phone: cleanText(raw.phone, 40),
    location: cleanText(raw.location, 200),
    currentCompany: cleanText(raw.currentCompany, 200),
    currentRole: cleanText(raw.currentRole, 200),
    totalExperienceYears: cleanNumber(raw.totalExperienceYears, 60),
    skills: cleanStringList(raw.skills),
    experience: cleanExperience(raw.experience),
    education: cleanEducation(raw.education),
    certifications: cleanStringList(raw.certifications, 20),
    expectedSalary: cleanNumber(raw.expectedSalary, Number.MAX_SAFE_INTEGER),
    noticePeriodDays: cleanNumber(raw.noticePeriodDays, 365),
    confidence: cleanNumber(raw.confidence, 1),
  };

  // Structurally unusable: nothing identifying at all. Every real resume yields
  // at least one of these.
  const usable =
    parsed.name !== null ||
    parsed.email !== null ||
    parsed.phone !== null ||
    parsed.skills.length > 0 ||
    parsed.experience.length > 0;

  return usable ? parsed : null;
}

const SYSTEM_PROMPT = `You extract structured data from a candidate's resume.

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
  "experience": [{ "company": string, "role": string, "period": string|null }],
  "education": [{ "institution": string, "qualification": string|null, "year": string|null }],
  "certifications": string[],
  "expectedSalary": number|null,
  "noticePeriodDays": number|null,
  "confidence": number
}

Rules:
- Use null or [] for anything the resume does not state. NEVER guess or infer a value, especially email, phone, salary, or notice period.
- currentCompany/currentRole describe the MOST RECENT position only.
- totalExperienceYears in YEARS as a plain number. If the resume does not state a total, estimate it ONLY from explicit employment dates; otherwise null.
- expectedSalary as a plain annual number, digits only, no symbols or words. "20 LPA" (Indian lakhs per annum) is 2000000. Only if the resume states an expectation.
- noticePeriodDays in DAYS. "2 months" is 60. "immediate" is 0. Only if stated.
- skills: short technology or skill names only, never sentences or descriptions.
- experience: most recent first. Keep period text exactly as written.
- confidence: your own 0-1 confidence in this extraction overall. Use a low value when the text is fragmentary or hard to read.
- Return no commentary outside the JSON object.`;

export async function parseResume(resumeText: string): Promise<AiResult<ParsedResume>> {
  const text = resumeText.trim();

  if (text.length < 100) {
    return {
      ok: false,
      code: "invalid_output",
      message: "There isn't enough readable text in that resume to parse.",
    };
  }

  return completeJson<ParsedResume>({
    system: SYSTEM_PROMPT,
    user: text,
    // Extraction, not writing.
    temperature: 0.1,
    // Resumes produce large structured output — experience and education lists
    // are the bulk of it.
    maxOutputTokens: 2500,
    // Parsing a long resume legitimately takes longer than a short completion.
    timeoutMs: 60_000,
    validate: validateParsedResume,
  });
}
