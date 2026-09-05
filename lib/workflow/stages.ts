// =============================================================================
// Which pipeline stages have a pass/fail concept, and which do not.
//
// PURE and client-safe — imported by the builder UI.
//
// -----------------------------------------------------------------------------
// THE 8-STAGE STRUCTURE IS NOT TOUCHED HERE.
//
// This file adds no stage, renames none, and reorders none. PIPELINE_STAGES in
// lib/applications/stages.ts remains the single definition of what the pipeline
// IS, and everything below is derived from it — including the exhaustiveness
// test, so adding a ninth stage there would fail this module's tests rather than
// silently leaving it unclassified.
//
// The brief rules custom stage names and ordering out of scope explicitly, and
// the reason it gives is correct: Analytics funnels, pipeline_sla_config and
// job_hiring_stages all key off these eight strings.
//
// -----------------------------------------------------------------------------
// WHAT "BRANCHING" MEANS, AND WHY ONLY THREE STAGES HAVE IT.
//
// A branch needs a verdict, and a verdict needs a score and a threshold to
// compare it against. Three stages have both:
//
//   shortlisted        — the resume score, against the job's Resume Score
//                        passing mark (job_hiring_stages.config.passingScore).
//                        Scored by the AI Resume Shortlisting action, which sits
//                        on Applied — see BRANCHING_STAGES for why the branches
//                        are filed one stage further along than the action.
//   ai_screening_call  — the screening round's score, same shape.
//   written_assessment — the assessment score, same shape.
//
// Phone Interview, Video Interview and Director Round produce a recruiter's
// written impression, not a number, so there is nothing for the engine to
// compare. Offering an "On Fail" list there would be a branch that could never
// fire — the silent-failure class this codebase keeps designing out — so those
// stages get one flat action list and the UI says why.
//
// Hired is terminal: there is nothing after it to branch into.
// =============================================================================

import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  isTerminalStage,
  type ApplicationStage,
} from "@/lib/applications/stages";

export const WORKFLOW_BRANCHES = ["always", "pass", "fail"] as const;
export type WorkflowBranch = (typeof WORKFLOW_BRANCHES)[number];

export function isWorkflowBranch(value: unknown): value is WorkflowBranch {
  return typeof value === "string" && (WORKFLOW_BRANCHES as readonly string[]).includes(value);
}

export const BRANCH_LABELS: Record<WorkflowBranch, string> = {
  always: "On entering this stage",
  pass: "On pass",
  fail: "On fail",
};

/**
 * Stages whose action list splits into On Pass / On Fail.
 *
 * `shortlisted` IS HERE AND `applied` IS NOT, which looks backwards until you
 * read what the branches are FOR.
 *
 * The brief is explicit, twice: on a pass the application "advances to
 * Shortlisted, and triggers whatever actions are configured under Shortlisted's
 * 'On Pass' branch", and on a fail it "triggers whatever actions are configured
 * under Shortlisted's 'On Fail' branch". So the branch lists belong to the stage
 * the decision is ABOUT, not the stage the scoring action sits on.
 *
 * That reads oddly for one line and then reads correctly forever: "Shortlisted —
 * On Fail" is where you configure the polite auto-rejection, and a recruiter
 * looking for "what happens when somebody is not shortlisted" looks under
 * Shortlisted. Under Applied it would be filed by mechanism rather than by
 * meaning.
 *
 * The consequence for the engine is that a FAILED screen dispatches Shortlisted's
 * branch while the application is still sitting in Applied — which is why
 * dispatch() takes an explicit `branchStage` rather than reading the
 * application's current stage. See DispatchInput.branchStage.
 *
 * AI Screening Call and Written Assessment carry their own branches, because
 * their score is about that round rather than about entry into the next one.
 */
export const BRANCHING_STAGES: ApplicationStage[] = [
  "shortlisted",
  "ai_screening_call",
  "written_assessment",
];

/**
 * The stage whose branch lists a given scored stage's verdict fires.
 *
 * Only the resume screen redirects: its action lives on Applied and its branches
 * live on Shortlisted. Everything else decides about itself.
 */
export const BRANCH_TARGET_STAGE: Partial<Record<ApplicationStage, ApplicationStage>> = {
  applied: "shortlisted",
};

export function stageBranches(stage: ApplicationStage): boolean {
  return BRANCHING_STAGES.includes(stage);
}

/**
 * The branches a stage's builder offers.
 *
 * A branching stage still gets `always`: "email the candidate that we received
 * their application" has to fire on entry, before any verdict exists. Dropping
 * it would force that message into both branches, and the day somebody edited
 * one copy the two would disagree.
 */
export function branchesFor(stage: ApplicationStage): WorkflowBranch[] {
  return stageBranches(stage) ? ["always", "pass", "fail"] : ["always"];
}

/** Stages the builder renders. Terminal exits are outcomes, not steps to configure. */
export const CONFIGURABLE_WORKFLOW_STAGES: ApplicationStage[] = PIPELINE_STAGES.filter(
  (stage) => !isTerminalStage(stage) && stage !== "hired"
);

/**
 * Why a stage does not branch — shown on the row instead of an absent control.
 *
 * An empty space where another stage has two lists reads as a bug. A sentence
 * reads as a decision.
 */
export const NO_BRANCH_NOTE =
  "This stage records a written verdict rather than a score, so there is nothing " +
  "for the engine to compare against a passing mark. Actions here fire on entry.";

/**
 * Where each branching stage's score comes from.
 *
 * Named in one place so the builder can tell the truth on the row ("measured
 * against this job's Resume Score passing mark") and the engine can read the
 * same threshold. Two copies of this mapping would be two answers to "what did
 * it compare against?".
 */
export const BRANCH_SCORE_SOURCE: Partial<Record<ApplicationStage, string>> = {
  shortlisted: "the resume match score, against this job's Resume Score passing mark",
  ai_screening_call: "the screening round's score, against this job's AI Screening Call passing mark",
  written_assessment:
    "the assessment score, against this job's Written Assessment passing mark",
};

/**
 * The job_hiring_stages key holding a stage's passing mark, where there is one.
 *
 * `applied` maps to `resume_score` — the two names differ because they name
 * different things: `applied` is where the application SITS when the AI Resume
 * Shortlisting action runs, `resume_score` is the configuration that judges it.
 * The mapping is here so nothing else has to know that.
 */
export const THRESHOLD_STAGE_KEY: Partial<Record<ApplicationStage, string>> = {
  applied: "resume_score",
  ai_screening_call: "ai_screening_call",
  written_assessment: "written_assessment",
};

export type WorkflowStageDefinition = {
  stage: ApplicationStage;
  label: string;
  branches: WorkflowBranch[];
  scoreSource: string | null;
};

export function workflowStages(): WorkflowStageDefinition[] {
  return CONFIGURABLE_WORKFLOW_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    branches: branchesFor(stage),
    scoreSource: BRANCH_SCORE_SOURCE[stage] ?? null,
  }));
}

/**
 * The generated name for a workflow's automations row.
 *
 * It appears verbatim in the Module 13 Automations list, so it has to read as a
 * sentence there, where the reader has no idea which job page it came from. The
 * job title is therefore part of the name rather than left to the job_id column.
 */
export function workflowRuleName({
  jobTitle,
  stage,
  branch,
}: {
  jobTitle: string;
  stage: ApplicationStage;
  branch: WorkflowBranch;
}): string {
  const suffix = branch === "always" ? "" : ` — ${BRANCH_LABELS[branch]}`;
  const name = `${jobTitle} · ${STAGE_LABELS[stage]}${suffix}`;
  // The column caps at 120. Truncating the job title rather than the stage keeps
  // the part that distinguishes two rows on the same job.
  if (name.length <= 120) return name;
  const room = 120 - (name.length - jobTitle.length) - 1;
  return `${jobTitle.slice(0, Math.max(room, 1))}… · ${STAGE_LABELS[stage]}${suffix}`;
}
