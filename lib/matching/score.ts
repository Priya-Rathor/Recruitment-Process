// =============================================================================
// Combining the two halves into one score.
//
// CODE owns the number. The AI layer supplies semantic judgements; this file
// turns them into an overall score. That ordering is what makes the spec's test
// — "AI explanation lists are internally consistent with the overall score" —
// true by construction: the model cannot state a score at all, so it cannot
// state one that disagrees with the facts beside it.
//
// When AI is unavailable the deterministic score stands alone and is labelled as
// such. The spec requires the manual workflow to remain usable, and a match that
// is honest about being partial is far more useful than one that pretends.
// =============================================================================
import type { DeterministicResult, MatchFinding } from "@/lib/matching/deterministic";
import {
  EQUIVALENCE_CONFIDENCE_THRESHOLD,
  type SemanticMatch,
} from "@/lib/ai/matchCandidateToJob";

/**
 * How much the semantic read can move the score.
 *
 * Deliberately the minority share: the deterministic half rests on recorded
 * facts, the semantic half on a model's judgement, and the number should lean on
 * whichever is more trustworthy. A job may override it from its Resume Score
 * configuration; this stays the default for everything that does not.
 */
export const SEMANTIC_WEIGHT = 0.3;
export const DETERMINISTIC_WEIGHT = 1 - SEMANTIC_WEIGHT;

export type CombinedMatch = {
  overallScore: number;
  deterministicScore: number;
  semanticScore: number | null;
  aiUsed: boolean;
  strongMatches: MatchFinding[];
  gaps: MatchFinding[];
  needsVerification: MatchFinding[];
};

/**
 * Turns the semantic judgements into a 0-100 figure.
 *
 * Role similarity and seniority carry it; confident skill equivalences lift it,
 * because "they have the skill under another name" is real evidence of fit.
 */
export function computeSemanticScore(
  semantic: SemanticMatch,
  unmatchedRequiredSkillCount: number
): number {
  const roleComponent = (semantic.roleSimilarity * 0.6 + semantic.seniorityFit * 0.4) * 100;

  if (unmatchedRequiredSkillCount === 0) return round2(roleComponent);

  const confident = semantic.skillEquivalences.filter(
    (equivalence) => equivalence.confidence >= EQUIVALENCE_CONFIDENCE_THRESHOLD
  );
  // Capped at 1: the model cannot claim to cover more skills than were missing.
  const covered = Math.min(1, confident.length / unmatchedRequiredSkillCount);

  return round2(roleComponent * 0.7 + covered * 100 * 0.3);
}

/**
 * Produces the final match.
 *
 * `semantic` is null when AI was unavailable or its output failed validation —
 * in which case the deterministic score IS the overall score, and `aiUsed` is
 * false so the UI can say so.
 */
export function combineMatch({
  deterministic,
  semantic,
  semanticWeight = SEMANTIC_WEIGHT,
}: {
  deterministic: DeterministicResult;
  semantic: SemanticMatch | null;
  /**
   * 0-1 share the semantic read carries, from the job's Resume Score
   * configuration. Clamped, because a weight above 1 would let the AI half
   * subtract from the deterministic one — a number no reading of the form
   * could justify.
   */
  semanticWeight?: number;
}): CombinedMatch {
  const aiShare = Math.min(Math.max(semanticWeight, 0), 1);
  const strongMatches = [...deterministic.strongMatches];
  const gaps = [...deterministic.gaps];
  const needsVerification = [...deterministic.needsVerification];

  if (!semantic) {
    return {
      overallScore: deterministic.score,
      deterministicScore: deterministic.score,
      semanticScore: null,
      aiUsed: false,
      strongMatches,
      gaps,
      needsVerification,
    };
  }

  const semanticScore = computeSemanticScore(
    semantic,
    deterministic.unmatchedRequiredSkills.length
  );

  // Confident equivalences become strengths; uncertain ones become things to
  // verify. A model's hunch is never silently promoted to a fact.
  for (const equivalence of semantic.skillEquivalences) {
    const finding: MatchFinding = {
      key: `skill-equivalence-${equivalence.required.toLowerCase().replace(/\s+/g, "-")}`,
      label: "Skill equivalence",
      detail: `${equivalence.required} may be covered by ${equivalence.coveredBy}${
        equivalence.reason ? ` — ${equivalence.reason}` : ""
      }`,
      source: "ai",
    };

    if (equivalence.confidence >= EQUIVALENCE_CONFIDENCE_THRESHOLD) {
      strongMatches.push(finding);
    } else {
      needsVerification.push({
        ...finding,
        detail: `${finding.detail} (low confidence — worth confirming)`,
      });
    }
  }

  if (semantic.roleSimilarity >= 0.7) {
    strongMatches.push({
      key: "role-similarity",
      label: "Role fit",
      detail: "Their current role is closely related to this job.",
      source: "ai",
    });
  } else if (semantic.roleSimilarity <= 0.3) {
    gaps.push({
      key: "role-similarity",
      label: "Role fit",
      detail: "Their current role is quite different from this job.",
      source: "ai",
    });
  }

  if (semantic.seniorityFit <= 0.4) {
    needsVerification.push({
      key: "seniority-fit",
      label: "Seniority",
      detail: "Their seniority may not line up with this job title — worth confirming.",
      source: "ai",
    });
  }

  for (const [index, observation] of semantic.observations.entries()) {
    strongMatches.push({
      key: `observation-${index}`,
      label: "Observation",
      detail: observation,
      source: "ai",
    });
  }

  for (const [index, item] of semantic.needsVerification.entries()) {
    needsVerification.push({
      key: `ai-verify-${index}`,
      label: "Needs verification",
      detail: item,
      source: "ai",
    });
  }

  const overallScore = round2(
    deterministic.score * (1 - aiShare) + semanticScore * aiShare
  );

  return {
    overallScore,
    deterministicScore: deterministic.score,
    semanticScore,
    aiUsed: true,
    strongMatches,
    gaps,
    needsVerification,
  };
}

/** Banding for display. Thresholds are shared so list and detail agree. */
export function scoreBand(score: number): "strong" | "moderate" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  return "weak";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
