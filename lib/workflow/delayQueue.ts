// =============================================================================
// The "Wait, then…" queue. SERVER ONLY.
//
// -----------------------------------------------------------------------------
// THIS IS NOT A SECOND SCHEDULER, AND THE DISTINCTION IS THE WHOLE POINT.
//
// The product has exactly one clock: the cron at /api/automations/sweep, defined
// in vercel.json, draining through lib/automations/sweep.ts. Everything
// time-based already goes through it.
//
// This file adds a PASS to that sweep. It has no cron entry of its own, no
// endpoint of its own, no worker, and no timer. `drainDueActions()` is called
// from sweepOrganization() alongside the stale-stage pass and the approval
// expiry pass, with the client that sweep already resolved, and it records what
// it does in the same automation_runs table every other rule writes to.
//
// The one thing that DID change is the cron's frequency, and it had to:
//
//   The brief's default flow contains a 15-minute pre-call reminder and a
//   30-minute post-call wait. On the previous hourly schedule ("0 * * * *") a
//   30-minute wait would fire somewhere between 30 and 90 minutes later, and a
//   15-minute reminder would routinely arrive after the call it was warning
//   about. vercel.json now runs every five minutes.
//
// Raising a cron's frequency is not a second scheduling system — it is the same
// system, asked more often. The alternative was a per-delay timer, which WOULD
// have been a second system, and one that cannot survive a serverless process
// ending.
//
// -----------------------------------------------------------------------------
// WHAT "CANCELLED" MEANS HERE.
//
// Cancellation is a DATABASE TRIGGER (migration 0038), not something this file
// polls for. When an application's stage changes, every pending wait that
// started in the stage being left is cancelled in the same transaction.
//
// That placement matters. If cancellation lived here, a sweep that began before
// a recruiter's click and finished after it would fire an action against an
// application that had already moved — precisely the stale fire the brief
// forbids. In the trigger, the move and the cancellation are atomic.
//
// This file still re-checks the stage before firing. Belt and braces: the row
// could have been queued against an application that moved through a path the
// trigger does not cover (a direct PostgREST write that somehow skipped it), and
// the cost of the extra read is one column on a row already being loaded.
// =============================================================================
import { formatDbError } from "@/lib/supabase/errors";
import { executeQueuedActions, type EngineClient } from "@/lib/automations/engine";
import { dueAt, delayDedupeKey, validateDelay, type DelayBasis } from "@/lib/workflow/delay";
import type { Action } from "@/lib/automations/catalog";

/**
 * How many due rows one sweep drains per organization.
 *
 * Same reasoning as the sweep's own caps: a serverless function has a wall-clock
 * limit, and a backlog of thousands would otherwise be half-processed with
 * nothing recording where it stopped. Anything left is simply still due and is
 * taken by the next sweep five minutes later.
 */
const MAX_DRAIN_PER_ORGANIZATION = 100;

export type ScheduleResult =
  | { ok: true; runAt: string; duplicate: boolean }
  | { ok: false; reason: string };

/**
 * Queues one wait.
 *
 * Returns a REASON rather than throwing, because the caller is an action handler
 * whose whole contract is to report an outcome. A wait that could not be
 * scheduled is a skipped action with an explanation, not a failed run.
 */
export async function scheduleDelayedAction({
  client,
  organizationId,
  automationId,
  applicationId,
  stageKey,
  branch,
  currentStage,
  actionIndex,
  config,
  anchor,
  now = new Date(),
}: {
  client: EngineClient;
  organizationId: string;
  automationId: string;
  applicationId: string;
  stageKey: string;
  branch: string;
  /** The stage the application is in RIGHT NOW — the cancellation baseline. */
  currentStage: string;
  /** Position in the rule's action list. Part of the dedupe key. */
  actionIndex: number;
  config: Record<string, unknown> | undefined;
  /** The scheduled call/interview time, for a `before_*` basis. */
  anchor?: Date | null;
  now?: Date;
}): Promise<ScheduleResult> {
  const delay = validateDelay(config);
  if (!delay.ok) return { ok: false, reason: delay.error };

  const due = dueAt({ delay: delay.delay, now, anchor: anchor ?? null });

  if (!due) {
    /**
     * A `before_*` wait with no anchor, or one whose due time has already passed
     * the event it was counting down to.
     *
     * SKIPPED, LOUDLY. Firing "you'll be getting a call shortly" at somebody with
     * no call booked — or after the call already happened — is worse than not
     * sending it, and a silent drop would leave a recruiter believing the
     * reminder went out.
     */
    return {
      ok: false,
      reason:
        delay.delay.basis === "after"
          ? "The wait could not be scheduled."
          : "Nothing is scheduled to count down to yet, so no reminder was queued.",
    };
  }

  const nested = Array.isArray(config?.actions) ? (config.actions as Action[]) : [];
  if (nested.length === 0) {
    return { ok: false, reason: "This wait has no actions after it." };
  }

  const { error } = await client.from("automation_delayed_actions").insert({
    organization_id: organizationId,
    automation_id: automationId,
    application_id: applicationId,
    stage_key: stageKey,
    branch,
    stage_at_schedule: currentStage,
    run_at: due.toISOString(),
    actions: nested,
    status: "pending",
    dedupe_key: delayDedupeKey({ stageKey, branch, actionIndex }),
  });

  if (error) {
    /**
     * 23505 is the partial unique index doing its job: this wait is already
     * queued for this application.
     *
     * A SUCCESS, not a failure. The occasion is handled; a re-delivered webhook
     * or an overlapping sweep arriving second must not be reported as an error,
     * and must certainly not retry.
     */
    if ((error as { code?: string }).code === "23505") {
      return { ok: true, runAt: due.toISOString(), duplicate: true };
    }
    return { ok: false, reason: formatDbError(error) };
  }

  return { ok: true, runAt: due.toISOString(), duplicate: false };
}

export type DrainSummary = {
  considered: number;
  fired: number;
  cancelled: number;
  failed: number;
  /** True when the cap was hit and rows were left for the next sweep. */
  truncated: boolean;
};

/**
 * Fires every wait that is due for one organization.
 *
 * Called from sweepOrganization(). See the header for why it lives inside the
 * existing sweep rather than beside it.
 */
export async function drainDueActions({
  client,
  organizationId,
  organizationName,
  webhookUrl,
  now = new Date(),
}: {
  client: EngineClient;
  organizationId: string;
  organizationName: string;
  webhookUrl: string;
  now?: Date;
}): Promise<DrainSummary> {
  const empty: DrainSummary = {
    considered: 0,
    fired: 0,
    cancelled: 0,
    failed: 0,
    truncated: false,
  };

  const { data, error } = await client
    .from("automation_delayed_actions")
    .select("id, automation_id, application_id, stage_key, branch, stage_at_schedule, actions")
    // organization_id explicitly: the sweep holds the SERVICE-ROLE client, so
    // RLS is off and this is the only thing scoping the query to one tenant.
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .lte("run_at", now.toISOString())
    // Oldest first, so a backlog drains in the order the promises were made.
    .order("run_at", { ascending: true })
    .limit(MAX_DRAIN_PER_ORGANIZATION + 1);

  if (error) {
    console.error(`[workflow] draining delayed actions failed: ${formatDbError(error)}`);
    return { ...empty, failed: 1 };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    automation_id: string;
    application_id: string;
    stage_key: string;
    branch: string;
    stage_at_schedule: string;
    actions: Action[];
  }[];

  const truncated = rows.length > MAX_DRAIN_PER_ORGANIZATION;
  const due = rows.slice(0, MAX_DRAIN_PER_ORGANIZATION);

  const summary: DrainSummary = { ...empty, considered: due.length, truncated };

  for (const row of due) {
    /**
     * CLAIM FIRST, EXECUTE SECOND — the same order the engine's run rows use.
     *
     * The `.eq("status", "pending")` makes this a compare-and-set: two
     * overlapping sweeps both see the row, both try to claim it, and exactly one
     * update matches. The loser gets no row back and moves on, so the actions
     * run once rather than twice. Without it, a slow sweep overlapping the next
     * one would send every queued message twice.
     */
    const { data: claimed, error: claimError } = await client
      .from("automation_delayed_actions")
      .update({ status: "fired", resolved_at: now.toISOString() })
      .eq("id", row.id)
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) continue;

    // The live stage. The trigger should already have cancelled anything stale,
    // so this is the second line of defence rather than the first.
    const { data: application } = await client
      .from("applications")
      .select("stage")
      .eq("id", row.application_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const liveStage = (application as { stage: string } | null)?.stage ?? null;

    if (liveStage === null || liveStage !== row.stage_at_schedule) {
      await client
        .from("automation_delayed_actions")
        .update({
          status: "cancelled",
          resolved_at: now.toISOString(),
          detail:
            liveStage === null
              ? "Cancelled — the application no longer exists."
              : `Cancelled — the application moved to ${liveStage} before the wait finished.`,
        })
        .eq("id", row.id)
        .eq("organization_id", organizationId);

      summary.cancelled += 1;
      continue;
    }

    const outcome = await executeQueuedActions({
      client,
      organizationId,
      organizationName,
      applicationId: row.application_id,
      automationId: row.automation_id,
      actions: row.actions ?? [],
      branch: row.branch as "always" | "pass" | "fail",
      webhookUrl,
    });

    if (outcome.status === "failed") {
      summary.failed += 1;
      await client
        .from("automation_delayed_actions")
        .update({ status: "failed", detail: outcome.reason?.slice(0, 500) ?? null })
        .eq("id", row.id)
        .eq("organization_id", organizationId);
    } else {
      summary.fired += 1;
    }
  }

  return summary;
}

/**
 * The scheduled time a `before_*` wait counts down to.
 *
 * Read at SCHEDULE time, not at fire time, because the queue stores an absolute
 * `run_at`. That is a deliberate limitation with an honest consequence: an
 * interview moved after the reminder was queued keeps the old countdown. Making
 * it follow a reschedule would mean re-resolving every pending row on every
 * sweep, which is the window-query design interview reminders already use for
 * exactly that reason — and which is still there, unchanged, for interviews.
 *
 * This primitive is for "a fixed offset from a known time", which is what the
 * brief asks for.
 */
export async function resolveAnchor({
  client,
  organizationId,
  applicationId,
  basis,
}: {
  client: EngineClient;
  organizationId: string;
  applicationId: string;
  basis: DelayBasis;
}): Promise<Date | null> {
  if (basis === "after") return null;

  if (basis === "before_scheduled_call") {
    const { data } = await client
      .from("screening_calls")
      .select("scheduled_for")
      .eq("organization_id", organizationId)
      .eq("application_id", applicationId)
      .not("scheduled_for", "is", null)
      // The most recent booking wins: a call rescheduled twice has three rows,
      // and the countdown belongs to the one that is actually going to happen.
      .order("scheduled_for", { ascending: false })
      .limit(1)
      .maybeSingle();

    const scheduled = (data as { scheduled_for: string | null } | null)?.scheduled_for;
    return scheduled ? new Date(scheduled) : null;
  }

  const { data } = await client
    .from("interviews")
    .select("scheduled_at")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scheduled = (data as { scheduled_at: string | null } | null)?.scheduled_at;
  return scheduled ? new Date(scheduled) : null;
}
