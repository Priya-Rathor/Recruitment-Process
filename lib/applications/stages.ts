// =============================================================================
// Application pipeline stages.
//
// The ordered board comes from Module 10's spec:
//   New -> Screening -> Recruiter Review -> Shortlisted -> Client Review ->
//   Interview -> Offer -> Hired
//
// 'rejected' and 'withdrawn' are terminal exits, not board columns. They are not
// named in the spec's board but are necessary: without them every unsuccessful
// application would sit in an intermediate stage forever, permanently flagged by
// Module 2's overdue queue and permanently inflating Module 16's in-progress
// counts. Module 10 must render them as exits.
// =============================================================================

export const PIPELINE_STAGES = [
  "new",
  "screening",
  "recruiter_review",
  "shortlisted",
  "client_review",
  "interview",
  "offer",
  "hired",
] as const;

export const TERMINAL_STAGES = ["rejected", "withdrawn"] as const;

export const APPLICATION_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export function isApplicationStage(value: unknown): value is ApplicationStage {
  return typeof value === "string" && (APPLICATION_STAGES as readonly string[]).includes(value);
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  new: "New",
  screening: "Screening",
  recruiter_review: "Recruiter Review",
  shortlisted: "Shortlisted",
  client_review: "Client Review",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** True once no further movement is expected. */
export function isTerminalStage(stage: ApplicationStage): boolean {
  return stage === "hired" || (TERMINAL_STAGES as readonly string[]).includes(stage);
}

/** Position on the board; -1 for terminal exits, which sit off the board. */
export function stageIndex(stage: ApplicationStage): number {
  return (PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

/**
 * Whether a stage change is allowed.
 *
 * Deliberately permissive about DIRECTION: recruiters legitimately move an
 * application backwards (a client asks to re-review, an interview is rescheduled
 * into an earlier stage). Forcing strictly forward movement would have people
 * working around the tool.
 *
 * What it does forbid is resurrecting a finished application — reopening a hire
 * or a rejection silently would corrupt the funnel Module 16 reports on. That
 * needs a new application, which is also the honest data model: a re-application
 * is a new attempt.
 */
export function canTransition(
  from: ApplicationStage,
  to: ApplicationStage
): { allowed: true } | { allowed: false; reason: string } {
  if (from === to) return { allowed: true };

  if (isTerminalStage(from)) {
    return {
      allowed: false,
      reason: `This application is already ${STAGE_LABELS[from].toLowerCase()}. Create a new application to consider this candidate again.`,
    };
  }

  return { allowed: true };
}

/**
 * Stages a recruiter can move TO from here, for the UI's stage control.
 * Excludes the current stage; empty once terminal.
 */
export function availableTransitions(from: ApplicationStage): ApplicationStage[] {
  if (isTerminalStage(from)) return [];
  return APPLICATION_STAGES.filter((stage) => stage !== from);
}
