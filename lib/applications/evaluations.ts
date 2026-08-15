// =============================================================================
// The Evaluation panel's read model.
//
// Five sections, FOUR different underlying sources. The panel renders one
// uniform row shape — date, score, outcome, summary — so this module's job is
// to normalise, not to store:
//
//   AI Screening Call  screening_calls + screening_reports   (Modules 8/9)
//   Phone Interview    interviews mode='phone' + feedback    (Module 11)
//                      + application_evaluations             (calls off-system)
//   Video Interview    interviews mode='video' + feedback    (Module 11)
//                      + application_evaluations
//   Written Assessment application_evaluations               (nothing else exists)
//   Director Round     application_evaluations               (nothing else exists)
//
// Merging rather than copying is the whole point. A second log would be
// invisible to Module 9's report screen and Module 11's scheduler, so a call
// recorded in one place would be missing from the other.
//
// SCORES ARE SCALED TO 1-10 FOR DISPLAY. interview_feedback stores 1-5, this
// module's own table stores 1-10, and screening_reports had no score at all
// until migration 0022. One column of badges has to mean one thing, so the
// scale is normalised here and the native value is kept alongside it.
// =============================================================================
import type { ConfigurableStage } from "@/lib/applications/stages";
import type { EvaluationStatus } from "@/lib/evaluation/verdict";

/** The stages the Evaluation panel has a section for, in board order. */
export const EVALUATION_STAGES = [
  "ai_screening_call",
  "phone_interview",
  "video_interview",
  "written_assessment",
  "director_round",
] as const;

export type EvaluationStage = (typeof EVALUATION_STAGES)[number];

/** Stages that accept a manually logged entry (application_evaluations). */
export const MANUAL_EVALUATION_STAGES = [
  "phone_interview",
  "video_interview",
  "written_assessment",
  "director_round",
] as const;

export function isManualEvaluationStage(value: unknown): value is ConfigurableStage {
  return (
    typeof value === "string" && (MANUAL_EVALUATION_STAGES as readonly string[]).includes(value)
  );
}

export type EvaluationOutcome = "pass" | "fail" | "pending";
export type InterestLevel = "interested" | "not_interested" | "unclear";

export type EvaluationEntry = {
  id: string;
  stage: EvaluationStage;
  /** When the thing happened, not when it was written up. */
  occurredAt: string;
  /** Normalised to 1-10 for the badge; null when never scored. */
  score: number | null;
  /** What the source actually stored, so an editor round-trips correctly. */
  nativeScore: number | null;
  nativeScale: 5 | 10 | null;
  outcome: EvaluationOutcome | null;
  /** Screening only — the spec's Yes / No / Unclear field. */
  interested: InterestLevel | null;
  summary: string | null;
  /** Two to four points in favour. Supplements the summary, never replaces it. */
  strengths: string[];
  /** Two to four points against. */
  concerns: string[];
  /**
   * Pass / Fail / Needs Review against this stage's configured threshold.
   *
   * Computed by the query layer, which is the only place that knows the job's
   * configuration. Needs Review when a score or a threshold is missing — see
   * statusFor() for why that is not the same as a Fail.
   */
  status: EvaluationStatus;
  threshold: number | null;
  loggedByName: string | null;
  /**
   * Where this row lives, which decides whether the panel may edit it here.
   *
   * Module 11 interviews and Module 9 reports are edited on their own screens —
   * offering an inline edit here would mean writing two update paths for one
   * row, and the second would drift.
   */
  source: "screening_report" | "interview" | "manual";
  /** Deep link to the owning screen, for sources this panel does not edit. */
  href: string | null;
  editable: boolean;
};

/** 1-5 -> 1-10, so every badge on the panel is on one scale. */
export function scaleScore(value: number | null, scale: 5 | 10): number | null {
  if (value === null) return null;
  return scale === 10 ? value : Math.round(value * 2);
}

/** Module 11's recommendation vocabulary, mapped to the panel's three outcomes. */
export function outcomeFromRecommendation(recommendation: string | null): EvaluationOutcome {
  switch (recommendation) {
    case "strong_yes":
    case "yes":
      return "pass";
    case "no":
    case "strong_no":
      return "fail";
    default:
      // "maybe", an unknown value, or no feedback at all. Pending is the honest
      // reading: someone still has to decide.
      return "pending";
  }
}

/**
 * A screening call's outcome.
 *
 * Derived from interest, because that IS the outcome of a screening call —
 * there is no separate pass/fail in Module 9, and inventing one in the UI would
 * imply a judgement nobody recorded.
 */
export function outcomeFromInterest(interest: InterestLevel | null): EvaluationOutcome {
  if (interest === "interested") return "pass";
  if (interest === "not_interested") return "fail";
  return "pending";
}

export const OUTCOME_LABELS: Record<EvaluationOutcome, string> = {
  pass: "Pass",
  fail: "Fail",
  pending: "Pending",
};

export const INTEREST_LABELS: Record<InterestLevel, string> = {
  interested: "Yes",
  not_interested: "No",
  unclear: "Unclear",
};

/** Chip tone per outcome, from the shared status tokens. */
export const OUTCOME_TONE: Record<EvaluationOutcome, "success" | "error" | "neutral"> = {
  pass: "success",
  fail: "error",
  pending: "neutral",
};

/** Newest first, which is how a recruiter reads a retry history. */
export function sortEntries(entries: EvaluationEntry[]): EvaluationEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

/** Groups a flat list into the panel's sections. */
export function groupByStage(
  entries: EvaluationEntry[]
): Record<EvaluationStage, EvaluationEntry[]> {
  const grouped = Object.fromEntries(
    EVALUATION_STAGES.map((stage) => [stage, [] as EvaluationEntry[]])
  ) as Record<EvaluationStage, EvaluationEntry[]>;

  for (const entry of entries) {
    grouped[entry.stage]?.push(entry);
  }

  for (const stage of EVALUATION_STAGES) {
    grouped[stage] = sortEntries(grouped[stage]);
  }

  return grouped;
}

/** How many entries each configurable stage holds — drives the visibility rule. */
export function countByStage(entries: EvaluationEntry[]): Partial<Record<ConfigurableStage, number>> {
  const counts: Partial<Record<ConfigurableStage, number>> = {};
  for (const entry of entries) {
    if (entry.stage === "director_round") continue; // not configurable
    counts[entry.stage] = (counts[entry.stage] ?? 0) + 1;
  }
  return counts;
}

/** Truncated for the compact row; the full text lives behind Edit. */
export function previewSummary(summary: string | null, limit = 140): string {
  if (!summary) return "No summary recorded.";
  const text = summary.trim().replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
