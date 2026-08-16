// =============================================================================
// Job health indicator — Healthy / Needs Attention.
//
// The spec's testing checklist says "Job health indicator matches the documented
// rule set", but the document never states the rules. They are defined here and
// documented in docs/modules/03-job-health-rules.md; that file and this one must
// stay in sync.
//
// DELIBERATELY RULE-BASED, NOT AI. The spec lists "AI-based (non-rule-based)
// health scoring" under Build Later, and the platform principle is that
// checkable facts stay in code. Every verdict below is reproducible and
// explainable without a model call.
// =============================================================================
import type { JobStatus } from "@/lib/types";

export type JobHealth = {
  status: "healthy" | "needs_attention";
  /** Plain-language reasons, shown verbatim in the UI. Empty when healthy. */
  reasons: string[];
};

/** A requisition open this long without being filled is going stale. */
export const STALE_OPEN_JOB_DAYS = 30;

/** Only what the rules actually read — keeps this pure and easy to test. */
export type JobHealthInput = {
  status: JobStatus;
  createdAt: string | Date;
  requiredSkills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  screeningQuestionCount: number;
  /**
   * RETROFIT (Module 5): once applications exist, pass the count so the
   * "open with no candidates" rule below activates. Left undefined until then,
   * and the rule is skipped rather than guessed at.
   */
  applicationCount?: number;
};

/**
 * Evaluates job health. Order of reasons is stable so the UI and tests agree.
 *
 * Only 'open' jobs are assessed for staleness/emptiness — a draft is not
 * unhealthy for being incomplete, and a closed job is simply done.
 */
export function evaluateJobHealth(input: JobHealthInput, now: Date = new Date()): JobHealth {
  const reasons: string[] = [];

  // Rule 1 — a paused requisition always needs a decision.
  if (input.status === "on_hold") {
    reasons.push("On hold — needs a decision to resume or close");
  }

  if (input.status === "open") {
    // Rule 2 — Module 8 cannot run an AI screening call without questions, so an
    // open job with none silently blocks the downstream workflow.
    if (input.screeningQuestionCount === 0) {
      // Names WHERE to fix it. The standalone editor on the job form is gone;
      // the only place these are managed now is the AI Screening Call stage's
      // configuration, and a warning with no route to the fix is a dead end.
      reasons.push(
        "No screening questions — add them in the AI Screening Call stage to enable screening"
      );
    }

    // Rule 3 — Module 7's deterministic matching needs an experience range.
    if (input.experienceMin === null && input.experienceMax === null) {
      reasons.push("No experience range — candidate matching will be less accurate");
    }

    // Rule 4 — likewise for the salary band.
    if (input.salaryMin === null && input.salaryMax === null) {
      reasons.push("No salary band — candidate matching will be less accurate");
    }

    // Rule 5 — a job with no required skills cannot be matched meaningfully.
    if (input.requiredSkills.length === 0) {
      reasons.push("No required skills listed");
    }

    // Rule 6 — stale requisition.
    const ageDays = ageInDays(input.createdAt, now);
    if (ageDays > STALE_OPEN_JOB_DAYS) {
      reasons.push(`Open for ${ageDays} days without being filled`);
    }

    // Rule 7 — open but attracting nobody. Skipped entirely until Module 5
    // supplies the count, rather than assuming zero.
    if (input.applicationCount !== undefined && input.applicationCount === 0 && ageDays >= 7) {
      reasons.push(`No candidates after ${ageDays} days`);
    }
  }

  return {
    status: reasons.length === 0 ? "healthy" : "needs_attention",
    reasons,
  };
}

function ageInDays(createdAt: string | Date, now: Date): number {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(created.getTime())) return 0;
  return Math.floor((now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));
}
