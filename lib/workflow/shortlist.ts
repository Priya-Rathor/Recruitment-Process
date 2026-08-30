// =============================================================================
// AI Resume Shortlisting.
//
// The one genuinely new capability in Module 25: score a resume the moment the
// application exists, compare it against the job's passing mark, and branch.
//
// -----------------------------------------------------------------------------
// WHAT THIS REUSES, AND WHY IT WOULD HAVE BEEN A MISTAKE TO REBUILD ANY OF IT.
//
//   - The SCORE comes from calculateAndStoreMatch() (Module 7). That function
//     already runs a deterministic pass first and degrades gracefully when the
//     LLM is unavailable, already reads this job's own scoring configuration,
//     and already writes application_matches. A second scorer would have
//     produced a second number for "how good is this resume", and the day the
//     two disagreed nobody could have said which one the pipeline acted on.
//
//   - The COMPARISON is statusFor() (lib/evaluation/verdict.ts), unchanged. It
//     already encodes the two rules that matter: `>=` passes, and a MISSING
//     score or threshold is "needs review" rather than a fail. That second rule
//     is load-bearing here — see below.
//
//   - The THRESHOLD is job_hiring_stages' `resume_score` row, the same number
//     the Resume Scoring card on the job page displays and the same one
//     lib/evaluation/sources.ts reads. The rule may override it, but it does not
//     store its own copy by default.
//
// -----------------------------------------------------------------------------
// "NEEDS REVIEW" IS NOT A FAIL, AND THIS IS THE MOST IMPORTANT LINE IN THE FILE.
//
// A job with no passing mark configured has not decided anything. Treating that
// as a fail would flag every applicant to every unconfigured job as Not
// Shortlisted — silently, automatically, and at the exact moment somebody was
// still setting the job up. A missing score (the matcher failed, the candidate
// has no resume) is the same class of nothing.
//
// So a `needs_review` verdict takes NEITHER branch. It leaves the application
// exactly where it is, unflagged, and says why in the run log.
//
// -----------------------------------------------------------------------------
// NOT SHORTLISTED IS NOT A REJECTION, AND IS NEVER FINAL.
//
// On a fail the application KEEPS ITS STAGE. It stays on the pipeline board, in
// the Applied column, carrying a flag and the two numbers that produced it. It
// is not moved to `rejected`, it is not archived, and it does not leave any list
// it was in.
//
// The brief's constraint — "must remain visible and reversible by a human, never
// a hard rejection with no way back" — is met structurally rather than by
// policy: there is no stage transition to reverse and no history to unpick, so
// clearing the flag is one UPDATE to NULL. See clearNotShortlisted().
// =============================================================================
import { calculateAndStoreMatch } from "@/lib/matching/queries";
import { statusFor, type EvaluationStatus } from "@/lib/evaluation/verdict";
import { formatDbError } from "@/lib/supabase/errors";
import { THRESHOLD_STAGE_KEY } from "@/lib/workflow/stages";

/** The narrow client shape this needs. Matches the engine's EngineClient. */
type ShortlistClient = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (values: Record<string, unknown>) => any;
  };
};

export type ShortlistOutcome = {
  /** pass | fail | needs_review. Drives which branch the engine dispatches. */
  verdict: EvaluationStatus;
  score: number | null;
  threshold: number | null;
  /** True when the application was moved to Shortlisted as a result. */
  advanced: boolean;
  /** True when the Not Shortlisted flag was set. */
  flagged: boolean;
  /** Always safe to show a recruiter. */
  detail: string;
};

/**
 * The pure decision.
 *
 * Separated from the effects so the branching rule is testable without a
 * database — the same reason lib/pipeline/sla.ts is a pure function. The
 * spec's test ("the On Pass branch fires only when the step actually passes")
 * is a test of this function plus one assertion about what the engine does with
 * its result.
 */
export function shortlistVerdict({
  score,
  threshold,
}: {
  score: number | null;
  threshold: number | null;
}): { verdict: EvaluationStatus; reason: string } {
  const verdict = statusFor({ score, threshold });

  if (verdict === "needs_review") {
    // Two different causes, two different fixes, so they are not collapsed into
    // one message. A recruiter reading "no passing mark is configured" knows to
    // open the job; one reading "the resume could not be scored" does not.
    const reason =
      score === null
        ? "The resume could not be scored, so no shortlisting decision was made."
        : "This job has no Resume Score passing mark set, so no shortlisting decision was made.";
    return { verdict, reason };
  }

  return {
    verdict,
    reason:
      verdict === "pass"
        ? `Scored ${score} against a passing mark of ${threshold}.`
        : `Scored ${score}, below the passing mark of ${threshold}.`,
  };
}

/**
 * Reads the job's configured Resume Score passing mark.
 *
 * Returns null both when there is no row and when the read fails, and the two
 * are NOT equivalent — a failed read that returned 0 would fail every candidate,
 * and one that returned a real number would act on a guess. Null routes to
 * `needs_review`, which does nothing and says so. That is the honest answer to
 * "we could not find out".
 */
async function loadConfiguredThreshold({
  client,
  organizationId,
  jobId,
}: {
  client: ShortlistClient;
  organizationId: string;
  jobId: string;
}): Promise<number | null> {
  const stageKey = THRESHOLD_STAGE_KEY.applied;

  const { data, error } = await client
    .from("job_hiring_stages")
    .select("config")
    // organization_id explicitly: this can run under the service-role client,
    // which bypasses RLS. The standing rule in AGENTS.md.
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("stage_key", stageKey)
    .maybeSingle();

  if (error) {
    console.error(`[workflow] resume threshold read failed: ${formatDbError(error)}`);
    return null;
  }

  const config = (data as { config?: { passingScore?: number | null } } | null)?.config;
  const passing = config?.passingScore;

  return typeof passing === "number" && Number.isFinite(passing) ? passing : null;
}

/**
 * Scores the resume, decides, and applies the consequence.
 *
 * SESSION CLIENT ONLY — calculateAndStoreMatch() builds its own session-bound
 * Supabase client internally and would be denied by RLS under the service role.
 * The catalogue enforces this (ACTION_MODES.ai_resume_shortlist is ["session"]),
 * so a rule that could not run is refused at activation rather than discovered
 * as one that silently never fires.
 */
export async function runResumeShortlist({
  client,
  organizationId,
  applicationId,
  passingScoreOverride,
  advanceOnPass,
}: {
  client: ShortlistClient;
  organizationId: string;
  applicationId: string;
  /** null = use the job's configured Resume Score passing mark. */
  passingScoreOverride: number | null;
  advanceOnPass: boolean;
}): Promise<ShortlistOutcome> {
  const { data: appData, error: appError } = await client
    .from("applications")
    .select("id, job_id, stage, match_score")
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (appError || !appData) {
    return {
      verdict: "needs_review",
      score: null,
      threshold: null,
      advanced: false,
      flagged: false,
      detail: "The application could not be read, so no shortlisting decision was made.",
    };
  }

  const application = appData as { job_id: string; stage: string; match_score: number | null };

  /**
   * SCORE FIRST, ALWAYS.
   *
   * The action fires on `application_created`, so match_score is normally null
   * at this point and there is nothing to compare. Calling the matcher rather
   * than reading the column is also what makes the decision current: a resume
   * replaced since the last scoring run is scored again rather than judged on a
   * stale number.
   *
   * A matcher failure is NOT a fail verdict — it is a missing score, which
   * shortlistVerdict() routes to needs_review. Rejecting somebody because our
   * LLM provider had an outage is exactly the silent-harm case this module is
   * built to avoid.
   */
  const calculated = await calculateAndStoreMatch({ organizationId, applicationId });
  const score = calculated.ok ? calculated.match.overallScore : application.match_score;

  const threshold =
    passingScoreOverride ??
    (await loadConfiguredThreshold({
      client,
      organizationId,
      jobId: application.job_id,
    }));

  const { verdict, reason } = shortlistVerdict({ score: score ?? null, threshold });

  if (verdict === "needs_review") {
    return { verdict, score: score ?? null, threshold, advanced: false, flagged: false, detail: reason };
  }

  if (verdict === "pass") {
    if (!advanceOnPass) {
      return { verdict, score: score ?? null, threshold, advanced: false, flagged: false, detail: `${reason} Left in place — this workflow only scores.` };
    }

    /**
     * The stage change is a plain UPDATE, which is what makes the audit trail
     * correct for free: trg_applications_stage_history closes the open Applied
     * row and opens a Shortlisted one, exactly as it does for a recruiter's
     * click. Writing history here by hand would produce a second, competing
     * account of the same move.
     *
     * The `.eq("stage", ...)` guard makes this a compare-and-set. Two dispatches
     * racing — a bulk import and a manual create for the same person — would
     * otherwise both move the application, and the second would write a
     * Shortlisted→Shortlisted transition into the history.
     */
    const { data: moved, error: moveError } = await client
      .from("applications")
      .update({ stage: "shortlisted", not_shortlisted_at: null })
      .eq("id", applicationId)
      .eq("organization_id", organizationId)
      .eq("stage", application.stage)
      .select("id")
      .maybeSingle();

    if (moveError) {
      return {
        verdict,
        score: score ?? null,
        threshold,
        advanced: false,
        flagged: false,
        detail: `${reason} The application could not be moved to Shortlisted: ${formatDbError(moveError)}`,
      };
    }

    return {
      verdict,
      score: score ?? null,
      threshold,
      advanced: moved !== null,
      flagged: false,
      detail: moved
        ? `${reason} Moved to Shortlisted.`
        : `${reason} Already moved on by something else, so left alone.`,
    };
  }

  // --- Fail ----------------------------------------------------------------
  //
  // The stage is NOT touched. See the header: this is a flag on an application
  // that stays exactly where it is.
  const { error: flagError } = await client
    .from("applications")
    .update({
      not_shortlisted_at: new Date().toISOString(),
      // Frozen at the moment of the decision. match_score is recalculated by
      // other paths, and a later recalculation must not rewrite the history of a
      // decision made on the old number.
      not_shortlisted_score: score ?? null,
      not_shortlisted_threshold: threshold,
      not_shortlisted_reason: reason.slice(0, 500),
    })
    .eq("id", applicationId)
    .eq("organization_id", organizationId);

  if (flagError) {
    return {
      verdict,
      score: score ?? null,
      threshold,
      advanced: false,
      flagged: false,
      detail: `${reason} The Not Shortlisted flag could not be saved: ${formatDbError(flagError)}`,
    };
  }

  return {
    verdict,
    score: score ?? null,
    threshold,
    advanced: false,
    flagged: true,
    detail: `${reason} Flagged Not Shortlisted — still on the board, and reversible.`,
  };
}

/**
 * Reverses an automatic screen-out.
 *
 * One UPDATE to NULL, and that is the whole operation. Because the fail path
 * never moved the application, there is no stage to restore, no history entry to
 * unpick, and no archived row to bring back — which is what makes "reversible"
 * a property of the design rather than a feature that has to keep working.
 *
 * Caller logs the activity (Module 14) so the timeline records who un-flagged it
 * and when. This function deliberately does not: it has no notion of an actor,
 * and inventing one here would put "System" against a human's decision.
 */
export async function clearNotShortlisted({
  client,
  organizationId,
  applicationId,
}: {
  client: ShortlistClient;
  organizationId: string;
  applicationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from("applications")
    .update({
      not_shortlisted_at: null,
      not_shortlisted_score: null,
      not_shortlisted_threshold: null,
      not_shortlisted_reason: null,
    })
    .eq("id", applicationId)
    .eq("organization_id", organizationId);

  if (error) return { ok: false, error: formatDbError(error) };
  return { ok: true };
}
