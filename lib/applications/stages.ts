// =============================================================================
// Application pipeline stages.
//
//   Applied -> Shortlisted -> AI Screening Call -> Phone Interview
//   -> Video Interview -> Written Assessment -> Director Round -> Hired
//
// FOUR OF THESE KEYS ARE SHARED WITH job_hiring_stages, deliberately and
// exactly: ai_screening_call, phone_interview, video_interview,
// written_assessment. The Job Hiring Stages feature toggles the same four steps
// per job, and a translation table between "assessment" and "written_assessment"
// would break the first time someone added a stage to one list and not the
// other. Identical keys make "is this stage enabled for this job?" a lookup.
//
// LABELS: where the two features disagreed, the Job Hiring Stages wording wins
// — "Video Interview" not "Video/Zoom Interview" (Zoom is one vendor of
// several, and the label would be wrong for a team on Meet), and "Written
// Assessment" not "Assessment" (more precise, and it is what the job
// configuration screen already says).
//
// 'rejected' and 'withdrawn' are terminal exits reachable from ANY stage, not
// board columns. Module 10 renders them as a separate lane.
// =============================================================================

/** The ordered board, left to right. */
export const PIPELINE_STAGES = [
  "applied",
  "shortlisted",
  "ai_screening_call",
  "phone_interview",
  "video_interview",
  "written_assessment",
  "director_round",
  "hired",
] as const;

export const TERMINAL_STAGES = ["rejected", "withdrawn"] as const;

export const APPLICATION_STAGES = [...PIPELINE_STAGES, ...TERMINAL_STAGES] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export function isApplicationStage(value: unknown): value is ApplicationStage {
  return typeof value === "string" && (APPLICATION_STAGES as readonly string[]).includes(value);
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  ai_screening_call: "AI Screening Call",
  phone_interview: "Phone Interview",
  video_interview: "Video Interview",
  written_assessment: "Written Assessment",
  director_round: "Director Round",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/**
 * The four stages a job can switch on or off (job_hiring_stages).
 *
 * The other four — Applied, Shortlisted, Director Round, Hired — are structural:
 * every application is applied to something, someone decides whether to look
 * closer, someone decides finally, and it either ends in a hire or it does not.
 * None of those is a step a job can opt out of, which is why they are not
 * toggleable.
 */
export const CONFIGURABLE_STAGES = [
  "ai_screening_call",
  "phone_interview",
  "video_interview",
  "written_assessment",
] as const;

export type ConfigurableStage = (typeof CONFIGURABLE_STAGES)[number];

export function isConfigurableStage(stage: ApplicationStage): stage is ConfigurableStage {
  return (CONFIGURABLE_STAGES as readonly string[]).includes(stage);
}

/** True once no further movement is expected. */
export function isTerminalStage(stage: ApplicationStage): boolean {
  return stage === "hired" || (TERMINAL_STAGES as readonly string[]).includes(stage);
}

/** Position on the board; -1 for terminal exits, which sit off the board. */
export function stageIndex(stage: ApplicationStage): number {
  return (PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

/**
 * Sort key placing every stage in pipeline order, with the exits last.
 *
 * The Applications list sorts by this rather than by updated_at, because a
 * recruiter reading the list is asking "where is everyone?", and answering that
 * with "whoever I touched most recently" makes them reconstruct the pipeline in
 * their head.
 */
export function stageSortKey(stage: ApplicationStage): number {
  const index = stageIndex(stage);
  if (index >= 0) return index;
  // rejected then withdrawn, after every board stage.
  return PIPELINE_STAGES.length + (TERMINAL_STAGES as readonly string[]).indexOf(stage);
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
 *
 * `allowed` narrows the list to the stages that exist for THIS application's job
 * — see lib/applications/effectiveStages.ts. Passing it is how the move
 * dropdown stops offering a stage the job switched off. Omitted, every stage is
 * offered, which is the right default for callers that have no job context.
 */
export function availableTransitions(
  from: ApplicationStage,
  allowed?: readonly ApplicationStage[]
): ApplicationStage[] {
  if (isTerminalStage(from)) return [];

  const permitted = allowed ? new Set(allowed) : null;

  return APPLICATION_STAGES.filter((stage) => {
    if (stage === from) return false;
    // Terminal exits are always reachable: an application can be rejected or
    // withdrawn from anywhere, whatever the job configured.
    if (isTerminalStage(stage)) return true;
    return permitted === null || permitted.has(stage);
  });
}
