// =============================================================================
// The suggested next step.
//
// A SUGGESTION. It renders as a labelled chip with a button the recruiter must
// click, and clicking goes through the same confirmation the move-to-stage
// control already uses. Nothing here moves a stage, rejects anyone, or writes
// a row — the product's rule is propose, then confirm, and an automated
// pipeline advance is the single most consequential thing this codebase could
// do by itself.
//
// Pure: it takes the effective stage list, the current stage, and the most
// recent round's status, and returns a recommendation. No database, so the
// Application page, a future digest email and a test all reach the same answer.
// =============================================================================
import { STAGE_LABELS, isTerminalStage, type ApplicationStage } from "@/lib/applications/stages";
import type { EvaluationStatus } from "@/lib/evaluation/verdict";

export type NextActionKind =
  /** The last round failed. Suggest ending it. */
  | "stop"
  /** Passed, and this job has a further stage. */
  | "proceed"
  /** Passed the last configured round. */
  | "hire"
  /** Nothing judged yet. */
  | "awaiting"
  /** Already hired, rejected or withdrawn — nothing to suggest. */
  | "none";

export type NextAction = {
  kind: NextActionKind;
  /** The sentence shown on the chip. */
  label: string;
  /** The button's words, or null when there is nothing to click. */
  actionLabel: string | null;
  /** The stage the button would move to, when it moves one. */
  targetStage: ApplicationStage | null;
  /** Why this is being suggested, in one line. */
  reason: string;
};

/**
 * Works out what to suggest.
 *
 * `visibleStages` is the application's EFFECTIVE list — the shared
 * effectiveStages() result, so a job that switched Video Interview off never
 * gets "Proceed to Video Interview" suggested. The next stage is the next one
 * in THAT list, not in the global eight.
 */
export function suggestNextAction({
  currentStage,
  visibleStages,
  lastRoundStatus,
}: {
  currentStage: ApplicationStage;
  visibleStages: ApplicationStage[];
  /**
   * Status of the most recently COMPLETED round, or null when none has been.
   *
   * "needs_review" counts as not-yet-judged on purpose: it means a score or a
   * threshold is missing, and suggesting a direction on the strength of a blank
   * field is exactly the kind of confident wrongness this product avoids.
   */
  lastRoundStatus: EvaluationStatus | null;
}): NextAction {
  // Finished. Nothing to suggest, and a suggestion here would invite reopening
  // an application that the funnel already counts as closed.
  if (isTerminalStage(currentStage)) {
    return {
      kind: "none",
      label: `This application is ${STAGE_LABELS[currentStage].toLowerCase()}.`,
      actionLabel: null,
      targetStage: null,
      reason: "The pipeline has ended for this candidate.",
    };
  }

  if (lastRoundStatus === "fail") {
    return {
      kind: "stop",
      label: "Stop process",
      actionLabel: "Stop process",
      targetStage: "rejected",
      reason: "The most recent round scored below its passing threshold.",
    };
  }

  if (lastRoundStatus === "pass") {
    const next = stageAfter(currentStage, visibleStages);

    if (next === null) {
      return {
        kind: "hire",
        label: "Move to Hired",
        actionLabel: "Move to Hired",
        targetStage: "hired",
        reason: "Every round this job runs has been passed.",
      };
    }

    return {
      kind: "proceed",
      label: `Proceed to ${STAGE_LABELS[next]}`,
      actionLabel: `Move to ${STAGE_LABELS[next]}`,
      targetStage: next,
      reason: "The most recent round passed its threshold.",
    };
  }

  // Nothing judged yet — either no round has run, or the last one has no score
  // or no configured threshold.
  const awaiting = awaitingStage(currentStage, visibleStages);

  return {
    kind: "awaiting",
    label: awaiting ? `Awaiting ${STAGE_LABELS[awaiting]}` : "Awaiting the first round",
    actionLabel: null,
    targetStage: null,
    reason:
      lastRoundStatus === "needs_review"
        ? "The most recent round has no score, or its stage has no passing threshold set."
        : "No round has been completed yet.",
  };
}

/**
 * The stage after this one in the application's own list.
 *
 * Null when the current stage is the last, or is not in the list at all — the
 * second happens when a job switched off the stage an application is sitting
 * in, and inventing a "next" from a list that does not contain the present
 * would be guessing.
 */
export function stageAfter(
  currentStage: ApplicationStage,
  visibleStages: ApplicationStage[]
): ApplicationStage | null {
  const index = visibleStages.indexOf(currentStage);
  if (index === -1) return null;

  // 'hired' is the list's own terminus; "proceed to Hired" is the hire
  // suggestion, which the caller phrases differently.
  const next = visibleStages[index + 1] ?? null;
  return next === "hired" ? null : next;
}

/** The stage whose result is being waited on — the current one, if it runs a round. */
function awaitingStage(
  currentStage: ApplicationStage,
  visibleStages: ApplicationStage[]
): ApplicationStage | null {
  if (visibleStages.includes(currentStage)) return currentStage;
  return visibleStages[0] ?? null;
}

export const NEXT_ACTION_TONE: Record<NextActionKind, "success" | "error" | "info" | "neutral"> = {
  stop: "error",
  proceed: "info",
  hire: "success",
  awaiting: "neutral",
  none: "neutral",
};
