// =============================================================================
// Which stages exist for THIS application.
//
// An application belongs to one job, and that job switches four of the eight
// stages on or off (job_hiring_stages). So "the pipeline" is not one list — it
// is a list per job, and the stepper, the Evaluation panel and the move-to-stage
// dropdown all have to agree on which one.
//
// Pure. Takes the job's stage flags and the application's own state, returns the
// list. No database, no React — which is what lets the three surfaces share one
// answer instead of each deriving its own and drifting.
//
// TWO RULES DO THE WORK, and the second is the one that protects data:
//
//   1. A configurable stage that is OFF does not appear. Not greyed, not
//      skipped-with-a-gap — absent, so the stepper compresses.
//
//   2. UNLESS this application already has evaluation entries logged in it.
//      Someone switching Written Assessment off after ten candidates sat one
//      must not erase those ten records from view. That stage stays visible and
//      read-only: history is shown, new entries are refused.
// =============================================================================
import {
  CONFIGURABLE_STAGES,
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  isConfigurableStage,
  isTerminalStage,
  type ApplicationStage,
  type ConfigurableStage,
} from "@/lib/applications/stages";

/** `enabled` per configurable stage, from job_hiring_stages. */
export type JobStageFlags = Partial<Record<ConfigurableStage, boolean>>;

/** How many evaluation entries this application has, per configurable stage. */
export type StageEntryCounts = Partial<Record<ConfigurableStage, number>>;

export type StageAvailability = {
  stage: ApplicationStage;
  /** Rendered in the stepper and offered in the move dropdown. */
  visible: boolean;
  /**
   * New entries may be logged here.
   *
   * False for a stage that is only visible because it holds history — the
   * "disabled but has entries" case. The section renders, the add button does
   * not.
   */
  acceptsEntries: boolean;
  /** Why this stage is visible, for the UI to explain itself. */
  reason: "always" | "enabled" | "has_history" | "current_stage";
};

/**
 * The effective stage list for one application.
 *
 * Order always follows PIPELINE_STAGES; nothing here re-orders the board.
 */
export function effectiveStages({
  flags,
  entryCounts = {},
  currentStage,
}: {
  flags: JobStageFlags;
  entryCounts?: StageEntryCounts;
  /**
   * Where the application actually is.
   *
   * A stage holding the application is ALWAYS visible, even if the job later
   * switched it off. Hiding it would render a stepper with no current segment,
   * which reads as a broken page rather than a configuration change — and the
   * application genuinely is there.
   */
  currentStage?: ApplicationStage;
}): StageAvailability[] {
  return PIPELINE_STAGES.map((stage) => {
    if (!isConfigurableStage(stage)) {
      return { stage, visible: true, acceptsEntries: true, reason: "always" as const };
    }

    if (flags[stage] === true) {
      return { stage, visible: true, acceptsEntries: true, reason: "enabled" as const };
    }

    // Off for this job. Two reasons it might still belong on the page.
    if (currentStage === stage) {
      return { stage, visible: true, acceptsEntries: true, reason: "current_stage" as const };
    }

    if ((entryCounts[stage] ?? 0) > 0) {
      // Visible so the history survives; closed so nothing new is added to a
      // stage the job no longer runs.
      return { stage, visible: true, acceptsEntries: false, reason: "has_history" as const };
    }

    return { stage, visible: false, acceptsEntries: false, reason: "enabled" as const };
  });
}

/** Just the stages to render, in order. */
export function visibleStages(availability: StageAvailability[]): ApplicationStage[] {
  return availability.filter((entry) => entry.visible).map((entry) => entry.stage);
}

/** Whether this application may log a new entry against a stage. */
export function acceptsEntries(
  availability: StageAvailability[],
  stage: ApplicationStage
): boolean {
  return availability.find((entry) => entry.stage === stage)?.acceptsEntries ?? false;
}

/**
 * Stages the move dropdown may offer.
 *
 * Narrower than `visibleStages`, and the difference matters. A stage that is
 * visible only because it holds history — switched off on the job, but this
 * application already has entries in it — is shown so the record survives, and
 * must NOT be a move target: sending someone new into a retired stage is
 * creating fresh work there, which is the thing switching it off was meant to
 * stop.
 *
 * The terminal exits are always offered. An application can be rejected or
 * withdrawn from anywhere, whatever the job configured.
 */
export function movableStages(availability: StageAvailability[]): ApplicationStage[] {
  const open = availability
    .filter((entry) => entry.visible && entry.acceptsEntries)
    .map((entry) => entry.stage);

  return [...open, ...TERMINAL_STAGES];
}

/**
 * The stepper's segments for an application, including the rejection ending.
 *
 * A rejected application does not show the stages it never reached greyed out —
 * it shows how far it got, then a red terminus. Cutting the stepper off without
 * that segment would leave "how far did they get?" answered and "what happened?"
 * unanswered.
 */
export type StepperSegment = {
  stage: ApplicationStage;
  label: string;
  state: "complete" | "current" | "upcoming" | "rejected";
};

export function buildStepper({
  availability,
  currentStage,
  rejectedAtStage,
  labels,
}: {
  availability: StageAvailability[];
  currentStage: ApplicationStage;
  /** Where the rejection happened; null unless currentStage is 'rejected'. */
  rejectedAtStage?: ApplicationStage | null;
  labels: Record<ApplicationStage, string>;
}): StepperSegment[] {
  const stages = visibleStages(availability);

  // Withdrawn behaves like rejected for display purposes — it also ends the
  // pipeline from wherever it was, and a stepper that ignored it would show a
  // "current" segment for a stage the application has left.
  const ended = currentStage === "rejected" || currentStage === "withdrawn";

  if (!ended) {
    const currentIndex = stages.indexOf(currentStage);

    return stages.map((stage, index) => ({
      stage,
      label: labels[stage],
      state:
        currentIndex === -1
          ? "upcoming"
          : index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "current"
              : "upcoming",
    }));
  }

  // Ended. Everything up to and including the stage it was in stays complete;
  // the rest is dropped and replaced by the terminus.
  const lastIndex = rejectedAtStage ? stages.indexOf(rejectedAtStage) : -1;

  const reached: StepperSegment[] = stages
    .slice(0, lastIndex >= 0 ? lastIndex + 1 : 0)
    .map((stage) => ({ stage, label: labels[stage], state: "complete" as const }));

  return [
    ...reached,
    { stage: currentStage, label: labels[currentStage], state: "rejected" as const },
  ];
}

/** Reads job_hiring_stages rows into the flags this module takes. */
export function flagsFromRows(
  rows: { stage_key: string; enabled: boolean }[]
): JobStageFlags {
  const flags: JobStageFlags = {};
  for (const row of rows) {
    if ((CONFIGURABLE_STAGES as readonly string[]).includes(row.stage_key)) {
      flags[row.stage_key as ConfigurableStage] = row.enabled;
    }
  }
  return flags;
}

/** Guard for callers that hold a stage string of unknown provenance. */
export { isTerminalStage };
