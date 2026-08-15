// =============================================================================
// Bulk intake — statuses, and the summary sentence.
//
// Pure. The summary is the one line a recruiter actually reads after dropping
// thirty files in, so it is built and tested here rather than assembled inline
// in JSX where nothing checks it.
// =============================================================================

export const INTAKE_STATUSES = [
  "queued",
  "processing",
  "candidate_created",
  "candidate_matched",
  "already_applied",
  "match_conflict",
  "failed",
] as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export function isIntakeStatus(value: unknown): value is IntakeStatus {
  return typeof value === "string" && (INTAKE_STATUSES as readonly string[]).includes(value);
}

/** Statuses that will not change again without a human doing something. */
export function isTerminal(status: IntakeStatus): boolean {
  return status !== "queued" && status !== "processing";
}

/**
 * Which chip tone a row wears.
 *
 * `already_applied` is deliberately neutral, not a warning: nothing went wrong,
 * the candidate is simply already in this pipeline, which is the correct and
 * desired outcome of uploading the same resume twice.
 */
export type ChipTone = "neutral" | "success" | "info" | "warning" | "error";

export const INTAKE_TONE: Record<IntakeStatus, ChipTone> = {
  queued: "neutral",
  processing: "neutral",
  candidate_created: "success",
  candidate_matched: "info",
  already_applied: "neutral",
  match_conflict: "warning",
  failed: "error",
};

export type IntakeSummary = {
  processed: number;
  created: number;
  matched: number;
  alreadyApplied: number;
  conflicts: number;
  failed: number;
  pending: number;
};

export function summarize(statuses: IntakeStatus[]): IntakeSummary {
  const summary: IntakeSummary = {
    processed: 0,
    created: 0,
    matched: 0,
    alreadyApplied: 0,
    conflicts: 0,
    failed: 0,
    pending: 0,
  };

  for (const status of statuses) {
    if (!isTerminal(status)) {
      summary.pending += 1;
      continue;
    }
    summary.processed += 1;
    if (status === "candidate_created") summary.created += 1;
    else if (status === "candidate_matched") summary.matched += 1;
    else if (status === "already_applied") summary.alreadyApplied += 1;
    else if (status === "match_conflict") summary.conflicts += 1;
    else if (status === "failed") summary.failed += 1;
  }

  return summary;
}

function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

/**
 * The summary line: "12 processed — 8 new candidates, 3 matched to existing
 * candidates, 1 failed."
 *
 * Zero-valued clauses are dropped. A run with nothing to report reads "12
 * processed" and stops, rather than "12 processed — 0 new candidates, 0
 * matched, 0 failed", which makes a clean run look like a broken one.
 *
 * Returns null while nothing has finished yet; the caller shows progress
 * instead. A summary claiming "0 processed" during a run would be read as a
 * result, and it is not one.
 */
export function summaryLine(summary: IntakeSummary): string | null {
  if (summary.processed === 0) return null;

  const clauses: string[] = [];
  if (summary.created > 0) clauses.push(plural(summary.created, "new candidate"));
  if (summary.matched > 0) {
    clauses.push(
      `${summary.matched} matched to ${summary.matched === 1 ? "an existing candidate" : "existing candidates"}`
    );
  }
  if (summary.alreadyApplied > 0) clauses.push(`${summary.alreadyApplied} already applied`);
  if (summary.conflicts > 0) clauses.push(plural(summary.conflicts, "needs review", "need review"));
  if (summary.failed > 0) clauses.push(`${summary.failed} failed`);

  const head = `${summary.processed} processed`;
  return clauses.length === 0 ? `${head}.` : `${head} — ${clauses.join(", ")}.`;
}
