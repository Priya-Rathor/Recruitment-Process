// =============================================================================
// AI Service Layer function — natural-language candidate search.
//
// Lets a recruiter type "Show me Java candidates in Gurgaon with 4-7 years
// experience and less than 45 days notice" instead of configuring ten filters.
//
// THE ARCHITECTURAL POINT: this function translates language into a FILTER
// OBJECT. It never sees candidate data and never selects rows — the same
// deterministic applyCandidateFilters() then runs, exactly as it would for
// hand-set filters. That is what makes the spec's test ("natural-language
// search returns results matching literal filter equivalents") hold by
// construction; a model that returned candidate ids could not guarantee it.
//
// It also means AI failure degrades to "use the manual filters", never to
// "wrong people on screen".
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import type { CandidateFilters } from "@/lib/candidates/filters";
import { CANDIDATE_SOURCES } from "@/lib/types";

const MAX_QUERY_LENGTH = 500;
const MAX_SKILLS = 20;
const MAX_EXPERIENCE_YEARS = 60;
const MAX_NOTICE_DAYS = 365;

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

/**
 * Validates the model's output into a CandidateFilters. Returns null only when
 * NOTHING usable was extracted — an unparseable query must surface an error
 * rather than silently running an unfiltered search that returns every
 * candidate in the organization and looks like a successful result.
 */
export function validateSearchFilters(value: unknown): CandidateFilters | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  let experienceMin = cleanNumber(raw.experienceMin, MAX_EXPERIENCE_YEARS);
  let experienceMax = cleanNumber(raw.experienceMax, MAX_EXPERIENCE_YEARS);
  // "7 to 4 years" is a transposition, not a request for an empty set.
  if (experienceMin !== null && experienceMax !== null && experienceMin > experienceMax) {
    [experienceMin, experienceMax] = [experienceMax, experienceMin];
  }

  const sourceRaw = cleanText(raw.source, 40)?.toLowerCase().replace(/\s+/g, "_");
  const source =
    sourceRaw && (CANDIDATE_SOURCES as readonly string[]).includes(sourceRaw) ? sourceRaw : null;

  const filters: CandidateFilters = {
    text: cleanText(raw.text, 200),
    skills: cleanSkills(raw.skills),
    location: cleanText(raw.location, 120),
    experienceMin,
    experienceMax,
    noticePeriodMaxDays: cleanNumber(raw.noticePeriodMaxDays, MAX_NOTICE_DAYS),
    expectedSalaryMax: cleanNumber(raw.expectedSalaryMax, Number.MAX_SAFE_INTEGER),
    source,
  };

  const gotSomething =
    filters.text !== null ||
    (filters.skills?.length ?? 0) > 0 ||
    filters.location !== null ||
    filters.experienceMin !== null ||
    filters.experienceMax !== null ||
    filters.noticePeriodMaxDays !== null ||
    filters.expectedSalaryMax !== null ||
    filters.source !== null;

  return gotSomething ? filters : null;
}

const SYSTEM_PROMPT = `You convert a recruiter's plain-language candidate search into structured filters.

Return ONLY a JSON object with exactly these keys:
{
  "text": string|null,
  "skills": string[],
  "location": string|null,
  "experienceMin": number|null,
  "experienceMax": number|null,
  "noticePeriodMaxDays": number|null,
  "expectedSalaryMax": number|null,
  "source": string|null
}

Rules:
- Use null or [] for anything the query does not mention. Never invent a constraint the recruiter did not ask for.
- skills: technology or skill names only ("Java", "Spring Boot"), never sentences.
- location: the place name only ("Gurgaon"), without words like "in" or "based".
- experienceMin/experienceMax in YEARS. "4-7 years" is min 4 max 7. "at least 5 years" is min 5, max null. "under 3 years" is min null, max 3.
- noticePeriodMaxDays in DAYS. "less than 45 days notice" is 45. "immediate joiners" is 0. "notice under 2 months" is 60.
- expectedSalaryMax as a plain annual number, digits only. "under 20 LPA" (Indian lakhs per annum) is 2000000.
- source must be exactly one of: career_page, resume_upload, email, referral, job_board, agency_database, manual. Otherwise null.
- text: only a name, company, or job-title fragment that does not fit the other fields. Do not repeat a skill or location here.
- Return no commentary outside the JSON object.`;

export async function parseCandidateSearch(query: string): Promise<AiResult<CandidateFilters>> {
  const text = query.trim();

  if (text.length < 3) {
    return {
      ok: false,
      code: "invalid_output",
      message: "Type a longer search, for example “Java developers in Gurgaon with 4-7 years”.",
    };
  }

  return completeJson<CandidateFilters>({
    system: SYSTEM_PROMPT,
    user: text.slice(0, MAX_QUERY_LENGTH),
    // Translation, not invention.
    temperature: 0,
    maxOutputTokens: 400,
    validate: validateSearchFilters,
  });
}
