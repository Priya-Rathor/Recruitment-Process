// =============================================================================
// AI Service Layer function — the SEMANTIC half of candidate-to-job matching.
//
// Scope is deliberately narrow. Salary, experience, location, notice and literal
// skill overlap are already settled by lib/matching/deterministic.ts, and this
// function is never told them. It answers only the questions code cannot:
//
//   - is a missing required skill actually covered by something the candidate
//     has under a different name? ("Spring" vs "Spring Boot")
//   - how similar is their current role to this job?
//   - does their seniority read as a fit?
//
// It also does NOT produce the overall score. lib/matching/score.ts computes
// that from both halves, which is why the number can never contradict the
// checkable facts shown beside it.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { buildScoringSystemPrompt } from "@/lib/matching/prompt";

export type SemanticMatchInput = {
  jobTitle: string;
  /**
   * This job's own scoring guidance, from its Resume Score configuration.
   *
   * Null when the row is switched off, which is the normal case — the default
   * guidance is used then. It can only ever change HOW the judgement is made:
   * buildScoringSystemPrompt() keeps the JSON contract and the "no inventing
   * equivalences" rule out of its reach, and this function still validates
   * whatever comes back.
   */
  guidance?: string | null;
  /** Required skills with no literal match, from the deterministic pass. */
  unmatchedRequiredSkills: string[];
  candidateSkills: string[];
  candidateCurrentRole: string | null;
};

export type SkillEquivalence = {
  /** The required skill in question. */
  required: string;
  /** The candidate skill the model believes covers it. */
  coveredBy: string;
  /** How confident, 0-1. Below 0.6 is treated as "verify", not "matched". */
  confidence: number;
  reason: string;
};

export type SemanticMatch = {
  /** 0-1: how close the candidate's current role is to this job. */
  roleSimilarity: number;
  /** 0-1: whether their seniority reads as a fit. */
  seniorityFit: number;
  /** Missing skills the model believes are covered by an equivalent. */
  skillEquivalences: SkillEquivalence[];
  /** Short semantic observations worth a recruiter's attention. */
  observations: string[];
  /** Things the model could not settle and a human should check. */
  needsVerification: string[];
};

/** Below this, an equivalence is a suggestion to verify, not a match. */
export const EQUIVALENCE_CONFIDENCE_THRESHOLD = 0.6;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function cleanUnitInterval(value: unknown): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) return null;
  return numeric;
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 300);
    if (text) output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

/**
 * Validates the model's output.
 *
 * The important rule: an equivalence naming a skill that was NOT in the
 * unmatched list is discarded. Otherwise the model could invent a match for a
 * requirement the job never had, or "cover" a skill the deterministic pass had
 * already settled.
 */
export function validateSemanticMatch(
  value: unknown,
  allowedRequiredSkills: string[]
): SemanticMatch | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const roleSimilarity = cleanUnitInterval(raw.roleSimilarity);
  const seniorityFit = cleanUnitInterval(raw.seniorityFit);

  // Both are required: without them there is no semantic signal to blend, and
  // defaulting them would invent one.
  if (roleSimilarity === null || seniorityFit === null) return null;

  const allowed = new Set(allowedRequiredSkills.map((skill) => skill.toLowerCase()));
  const skillEquivalences: SkillEquivalence[] = [];

  if (Array.isArray(raw.skillEquivalences)) {
    for (const item of raw.skillEquivalences) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;

      const required = cleanText(entry.required, 120);
      const coveredBy = cleanText(entry.coveredBy, 120);
      const confidence = cleanUnitInterval(entry.confidence);
      if (!required || !coveredBy || confidence === null) continue;

      // Discard an equivalence for a skill that was never in question.
      if (!allowed.has(required.toLowerCase())) continue;

      skillEquivalences.push({
        required,
        coveredBy,
        confidence,
        reason: cleanText(entry.reason, 300) ?? "",
      });

      if (skillEquivalences.length >= 20) break;
    }
  }

  return {
    roleSimilarity,
    seniorityFit,
    skillEquivalences,
    observations: cleanStringList(raw.observations, 6),
    needsVerification: cleanStringList(raw.needsVerification, 6),
  };
}

export async function matchCandidateToJob(
  input: SemanticMatchInput
): Promise<AiResult<SemanticMatch>> {
  // Nothing semantic to weigh in on.
  if (input.candidateSkills.length === 0 && !input.candidateCurrentRole) {
    return {
      ok: false,
      code: "invalid_output",
      message:
        "This candidate has no skills or current role recorded, so there is nothing to assess semantically.",
    };
  }

  const payload = {
    jobTitle: input.jobTitle,
    unmatchedRequiredSkills: input.unmatchedRequiredSkills,
    candidateSkills: input.candidateSkills,
    candidateCurrentRole: input.candidateCurrentRole,
  };

  return completeJson<SemanticMatch>({
    // Fixed contract + this job's guidance (or the default), never one replacing
    // the other.
    system: buildScoringSystemPrompt(input.guidance),
    user: JSON.stringify(payload, null, 2),
    temperature: 0.2,
    maxOutputTokens: 900,
    validate: (value) => validateSemanticMatch(value, input.unmatchedRequiredSkills),
  });
}
