// =============================================================================
// Per-stage timing for one application.
//
// application_stage_history already records entered_at/exited_at for every
// transition (a trigger writes it — see migration 0004). What it does not do is
// answer the question a recruiter actually asks in front of a stage: "when did
// this reach here, and how long did it sit?" The Timeline card answers it
// chronologically, one event at a time, which means reconstructing a stage's
// story from rows scattered down a list.
//
// This folds the history into one record PER STAGE, so each stage section can
// state its own dates beside its own scores.
//
// Pure, and tolerant of a history that revisits a stage: an application moved
// back for a re-review has two rows for the same stage, and both count. Days are
// summed across every visit rather than taken from the latest, because "8 days
// in Phone Interview" is the fact a stalled-pipeline conversation needs — the
// last visit alone understates it.
// =============================================================================
import { APPLICATION_STAGES, isApplicationStage, type ApplicationStage } from "@/lib/applications/stages";
import { durationInDays, type StageHistoryRow } from "@/lib/applications/timeline";

export type StageTiming = {
  stage: ApplicationStage;
  /** When the application first reached this stage. Null if it never has. */
  firstEnteredAt: string | null;
  /** Most recent arrival — differs from the first only after a move back. */
  lastEnteredAt: string | null;
  /** When it last left. Null while it is still here, or was never here. */
  lastExitedAt: string | null;
  /** How many separate times this stage has held the application. */
  visits: number;
  /** Whole days summed across every visit. Null until first entered. */
  days: number | null;
  /** True while the application is sitting in this stage right now. */
  open: boolean;
};

/** Where a stage stands, which is what decides the sentence the UI writes. */
export type StageTimingPhase = "not_reached" | "in_progress" | "completed";

export function stageTimingPhase(timing: StageTiming): StageTimingPhase {
  if (timing.firstEnteredAt === null) return "not_reached";
  return timing.open ? "in_progress" : "completed";
}

function emptyTiming(stage: ApplicationStage): StageTiming {
  return {
    stage,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastExitedAt: null,
    visits: 0,
    days: null,
    open: false,
  };
}

/**
 * Folds a stage history into one timing per stage.
 *
 * `now` closes the open visit for the day count. That is the same reading
 * `daysInCurrentStage()` already takes for the header, so the two cannot
 * disagree — and it is why this is a parameter rather than a `new Date()`
 * buried in the loop.
 *
 * Rows arrive newest-first from the query; they are re-sorted here so "first"
 * and "last" mean what they say whatever order the caller passes.
 */
export function buildStageTimings(
  rows: StageHistoryRow[],
  now: Date = new Date()
): Record<ApplicationStage, StageTiming> {
  const timings = Object.fromEntries(
    APPLICATION_STAGES.map((stage) => [stage, emptyTiming(stage)])
  ) as Record<ApplicationStage, StageTiming>;

  const ordered = [...rows]
    // A stage removed from the enum by a future migration would otherwise
    // write an undefined key and take the page down with it.
    .filter((row) => isApplicationStage(row.stage))
    .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime());

  const nowIso = now.toISOString();

  for (const row of ordered) {
    const timing = timings[row.stage];

    timing.visits += 1;
    if (timing.firstEnteredAt === null) timing.firstEnteredAt = row.entered_at;
    timing.lastEnteredAt = row.entered_at;

    if (row.exited_at === null) {
      timing.open = true;
      timing.lastExitedAt = null;
    } else {
      timing.lastExitedAt = row.exited_at;
    }

    const spent = durationInDays(row.entered_at, row.exited_at ?? nowIso);
    if (spent !== null) timing.days = (timing.days ?? 0) + spent;
  }

  return timings;
}
