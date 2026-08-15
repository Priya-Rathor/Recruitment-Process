// =============================================================================
// The client-safe half of the application-history rollup.
//
// SEPARATE FROM applicationHistory.ts ON PURPOSE, and it has to stay that way.
// That module reaches for lib/supabase/server, which imports `next/headers` —
// server-only. The rollup is RENDERED by a client component ("use client",
// because the cards expand), so the types, labels, tones and small pure helpers
// it needs live here where a browser bundle can reach them.
//
// The build error this fixes reads: "You're importing a module that depends on
// next/headers".
// =============================================================================
import type { EvaluationEntry } from "@/lib/applications/evaluations";
import type { StageAvailability } from "@/lib/applications/effectiveStages";
import type { ApplicationStage } from "@/lib/applications/stages";
import { groupByStage } from "@/lib/applications/evaluations";

export type ApplicationOutcome =
  | { kind: "in_progress" }
  | { kind: "hired"; at: string | null }
  | { kind: "rejected"; fromStage: ApplicationStage | null }
  | { kind: "withdrawn"; fromStage: ApplicationStage | null };

export type ApplicationHistoryCard = {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  stage: ApplicationStage;
  matchScore: number | null;
  updatedAt: string;
  outcome: ApplicationOutcome;
  /** From the SHARED effectiveStages() rule — this application's job. */
  availability: StageAvailability[];
  visible: ApplicationStage[];
  entriesByStage: ReturnType<typeof groupByStage>;
  totalEntries: number;
};

/**
 * In Progress / Hired / Rejected, plus the stage a rejection came from.
 *
 * `rejected_at_stage` is why this is worth showing: "rejected" alone cannot
 * distinguish someone turned down on their CV from someone turned down after a
 * director round, and those are not the same story about a candidate.
 */
export function outcomeOf(
  stage: ApplicationStage,
  rejectedAtStage: ApplicationStage | null
): ApplicationOutcome {
  if (stage === "hired") return { kind: "hired", at: null };
  if (stage === "rejected") return { kind: "rejected", fromStage: rejectedAtStage };
  if (stage === "withdrawn") return { kind: "withdrawn", fromStage: rejectedAtStage };
  return { kind: "in_progress" };
}

export const OUTCOME_LABELS: Record<ApplicationOutcome["kind"], string> = {
  in_progress: "In Progress",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const OUTCOME_TONE: Record<
  ApplicationOutcome["kind"],
  "info" | "success" | "error" | "neutral"
> = {
  in_progress: "info",
  hired: "success",
  rejected: "error",
  withdrawn: "neutral",
};

/** The newest entry for a stage, which is what a rollup shows. */
export function mostRecent(entries: EvaluationEntry[]): EvaluationEntry | null {
  return entries[0] ?? null;
}
