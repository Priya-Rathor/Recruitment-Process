// =============================================================================
// Application timeline — "everything that has happened on this application".
//
// Merges stage transitions and notes into one chronological list. Pure, so the
// ordering and duration rules are testable without a database, and so later
// modules (screening calls, interviews, client feedback) can contribute event
// types without the UI changing.
// =============================================================================
import { STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

export type StageHistoryRow = {
  id: string;
  stage: ApplicationStage;
  entered_at: string;
  exited_at: string | null;
  changed_by_name?: string | null;
};

export type NoteRow = {
  id: string;
  note: string;
  created_at: string;
  author_name?: string | null;
};

export type TimelineEvent = {
  id: string;
  at: string;
  kind: "stage" | "note";
  title: string;
  detail: string | null;
  actor: string | null;
  /** Time spent in a stage, once it has been exited. */
  durationDays: number | null;
};

/** Whole days between two instants, floored, never negative. */
export function durationInDays(from: string, to: string): number | null {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Builds the timeline, newest first.
 *
 * Stage rows contribute an "entered X" event at entered_at. The duration shown
 * is how long the application sat in that stage, available only once the stage
 * was exited — an open stage has no final duration yet, and inventing one from
 * "now" would make a static page appear to change on reload.
 */
export function buildTimeline({
  stages,
  notes,
}: {
  stages: StageHistoryRow[];
  notes: NoteRow[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const row of stages) {
    events.push({
      id: `stage-${row.id}`,
      at: row.entered_at,
      kind: "stage",
      title: `Moved to ${STAGE_LABELS[row.stage] ?? row.stage}`,
      detail: null,
      actor: row.changed_by_name ?? null,
      durationDays: row.exited_at ? durationInDays(row.entered_at, row.exited_at) : null,
    });
  }

  for (const row of notes) {
    events.push({
      id: `note-${row.id}`,
      at: row.created_at,
      kind: "note",
      title: "Note added",
      detail: row.note,
      actor: row.author_name ?? null,
      durationDays: null,
    });
  }

  return events.sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    // Stable tiebreak: a stage change and its note can share a timestamp, and
    // an unstable sort would make the page reorder between renders.
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/** The currently-open stage row, if any. Exactly one should be open. */
export function currentStageRow(stages: StageHistoryRow[]): StageHistoryRow | null {
  return stages.find((row) => row.exited_at === null) ?? null;
}

/** Days the application has sat in its current stage. */
export function daysInCurrentStage(
  stages: StageHistoryRow[],
  now: Date = new Date()
): number | null {
  const open = currentStageRow(stages);
  if (!open) return null;
  return durationInDays(open.entered_at, now.toISOString());
}
