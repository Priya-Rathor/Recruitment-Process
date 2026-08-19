// =============================================================================
// THE SCHEDULER.
//
// Until now nothing in this product ran on a clock. The comment on
// /api/notifications/reminders says it plainly: "THIS EXISTS BECAUSE THERE IS NO
// SCHEDULER... a button is honest about that; pretending reminders go out at 9am
// when nothing runs at 9am would not be."
//
// This is the thing that makes the button unnecessary. It also makes time a
// trigger: `days_in_stage` used to be readable only at the instant some other
// event fired, so "chase anyone sitting in Screening for three days" was
// inexpressible however it was written.
//
// -----------------------------------------------------------------------------
// WHY THIS IS SAFE TO RUN EVERY HOUR
//
// Because the dedupe key does not contain the time. It is
// `time_elapsed_in_stage:<stage>:<stage_entered_at>`, and every sweep computes
// the same string for the same stale application — so the first sweep claims the
// run and every later one is rejected by migration 0012's unique index. One
// action per stage-entry, not one per sweep.
//
// That is also why there is no "last reminded at" column anywhere here. Such a
// column would need its own read-then-write, which races two overlapping sweeps
// — and the thing being raced is whether a candidate is emailed twice.
//
// -----------------------------------------------------------------------------
// WHAT IT REFUSES TO DO
//
// It never invents a reason to act. The scan is bounded by the smallest
// `days_in_stage` threshold across an organization's own scheduled rules, and
// every match is still put through `evaluateConditions`. A sweep that finds
// nothing writes a row saying it found nothing, which is how the UI can tell
// "the scheduler ran and there was nothing to do" apart from "the scheduler has
// never run" — two states that look identical from an empty run history and mean
// completely different things.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  minimumStageAgeDays,
  normalizeConditions,
  type Action,
  type ConditionGroup,
} from "@/lib/automations/catalog";
import { dispatch, type EngineClient, type RunOutcome } from "@/lib/automations/engine";
import { expireStaleApprovals } from "@/lib/automations/approvals";
import { TERMINAL_STAGES } from "@/lib/applications/stages";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * How many applications one organization's sweep will look at.
 *
 * A bound is necessary — a serverless function has a wall-clock limit and an
 * organization with 50,000 open applications would hit it mid-scan, leaving some
 * rules run and others not, with nothing recording which.
 *
 * The bound is REPORTED, never silent: `truncated` reaches the UI and says how
 * many were left. A cap that quietly trims coverage reads as "everything was
 * checked" when it was not.
 */
const MAX_APPLICATIONS_PER_ORGANIZATION = 250;

/** How many organizations one cron invocation handles. Same reasoning. */
const MAX_ORGANIZATIONS_PER_SWEEP = 50;

export type SweepResult = {
  organizationId: string;
  organizationName: string;
  rulesConsidered: number;
  applicationsScanned: number;
  runsCreated: number;
  /** True when the application cap cut the scan short. Surfaced, not hidden. */
  truncated: boolean;
  applicationsRemaining: number;
  error: string | null;
};

type ScheduledRule = {
  id: string;
  conditions: ConditionGroup[];
  actions: Action[];
};

/**
 * Sweeps one organization.
 *
 * Takes the client rather than building one, so the cron path (service role) and
 * the manual-button path (the pressing user's session) share every line of this
 * logic. A separate manual implementation would drift, and the button exists
 * precisely to prove the cron's behaviour before anyone trusts it.
 */
export async function sweepOrganization({
  client,
  organizationId,
  organizationName,
  timeZone,
  source,
  triggeredBy,
}: {
  client: EngineClient;
  organizationId: string;
  organizationName: string;
  timeZone: string;
  source: "cron" | "manual";
  triggeredBy: string | null;
}): Promise<SweepResult> {
  const result: SweepResult = {
    organizationId,
    organizationName,
    rulesConsidered: 0,
    applicationsScanned: 0,
    runsCreated: 0,
    truncated: false,
    applicationsRemaining: 0,
    error: null,
  };

  // The sweep record is opened FIRST, so a crash halfway leaves evidence that a
  // sweep started and never finished — visible as a row with no finished_at.
  // Silence would be indistinguishable from "the cron never fired".
  const { data: sweepRow } = await client
    .from("automation_sweeps")
    .insert({
      organization_id: organizationId,
      source,
      triggered_by: triggeredBy,
    })
    .select("id")
    .single();

  const sweepId = (sweepRow as { id: string } | null)?.id ?? null;

  const closeSweep = async (error: string | null) => {
    if (!sweepId) return;
    await client
      .from("automation_sweeps")
      .update({
        finished_at: new Date().toISOString(),
        rules_considered: result.rulesConsidered,
        applications_scanned: result.applicationsScanned,
        runs_created: result.runsCreated,
        error_message: error,
      })
      .eq("id", sweepId)
      .eq("organization_id", organizationId);
  };

  try {
    /**
     * Lapsed proposals are cleared first, before any new one is created.
     *
     * The sweep is the only thing in the product that runs on a clock, so it is
     * the only place expiry can happen without a person triggering it. Doing it
     * first means a rule cannot see a week-old proposal still sitting pending and
     * be blocked by its own dedupe key from proposing again.
     */
    const expiry = await expireStaleApprovals({ client, organizationId });
    if (expiry.failed) {
      console.error(`[automation] could not expire stale approvals for ${organizationId}`);
    }

    const { data: ruleData, error: ruleError } = await client
      .from("automations")
      .select("id, conditions, actions")
      .eq("organization_id", organizationId)
      .eq("trigger", "time_elapsed_in_stage")
      .eq("status", "active");

    if (ruleError) {
      result.error = "Could not read this organization's scheduled rules.";
      await closeSweep(result.error);
      return result;
    }

    const rules = ((ruleData ?? []) as unknown as ScheduledRule[]).map((rule) => ({
      ...rule,
      conditions: normalizeConditions(rule.conditions),
    }));

    result.rulesConsidered = rules.length;
    if (rules.length === 0) {
      await closeSweep(null);
      return result;
    }

    // The smallest threshold any rule waits for. An application younger than
    // this in its current stage cannot match anything, so it is not fetched.
    const thresholds = rules
      .map((rule) => minimumStageAgeDays(rule.conditions))
      .filter((value): value is number => value !== null);

    if (thresholds.length === 0) {
      // Every scheduled rule lacks a threshold. validateRule forbids that on
      // write, so these are rules stored before the check existed. Scanning on
      // their behalf would mean matching every open application at once, so the
      // sweep declines and says why rather than doing it.
      result.error =
        "Every scheduled rule is missing a “days in current stage” condition, so nothing was scanned. Edit those rules to add one.";
      await closeSweep(result.error);
      return result;
    }

    const minDays = Math.min(...thresholds);
    const cutoff = new Date(Date.now() - minDays * 86_400_000).toISOString();

    /**
     * The scan.
     *
     * Driven from application_stage_history, not from applications.updated_at.
     * `updated_at` changes when anything about the row changes — a note, a
     * match score — so a candidate genuinely stuck for a week would look fresh.
     * `entered_at` on the open history row is the only column that means "has
     * been in this stage since", and a database trigger writes it, so nobody can
     * nudge it.
     */
    const { data: stale, error: staleError, count } = await client
      .from("application_stage_history")
      .select("application_id, application:applications!inner(id, stage)", { count: "exact" })
      .eq("organization_id", organizationId)
      .is("exited_at", null)
      .lte("entered_at", cutoff)
      // Terminal stages are exits, not places to be stuck. Chasing a rejected
      // candidate for sitting in Rejected would be a genuinely bad outcome.
      .not("application.stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .order("entered_at", { ascending: true })
      .limit(MAX_APPLICATIONS_PER_ORGANIZATION);

    if (staleError) {
      result.error = "Could not read which applications have been waiting.";
      await closeSweep(result.error);
      return result;
    }

    const rows = (stale ?? []) as unknown as { application_id: string }[];
    // Oldest first, so if the cap bites it bites the least-stale applications —
    // the ones with the most time left before anyone would notice.
    const applicationIds = [...new Set(rows.map((row) => row.application_id))];

    result.applicationsScanned = applicationIds.length;
    const total = count ?? applicationIds.length;
    if (total > applicationIds.length) {
      result.truncated = true;
      result.applicationsRemaining = total - applicationIds.length;
    }

    // Sequential. Same reasoning as dispatch()'s own loop: two rules can move
    // the same application's stage, and concurrency would make the outcome
    // depend on timing. It also keeps the load on a shared database predictable.
    for (const applicationId of applicationIds) {
      const outcomes: RunOutcome[] = await dispatch({
        organizationId,
        organizationName,
        applicationId,
        trigger: "time_elapsed_in_stage",
        // Nobody caused this. Recorded as such rather than attributed to whoever
        // happened to configure the cron.
        triggeredBy: null,
        webhookUrl: "",
        mode: "service",
        client,
        timeZone,
        scheduled: true,
      });

      // 'deduped' is the common case on every sweep after the first and is not a
      // run. Counting it would make the sweep look busy while doing nothing.
      result.runsCreated += outcomes.filter((outcome) => outcome.status !== "deduped").length;
    }

    await closeSweep(null);
    return result;
  } catch (error) {
    console.error(`[automation] sweep failed for ${organizationId}: ${formatDbError(error)}`);
    result.error = "The sweep failed partway through.";
    await closeSweep(result.error);
    return result;
  }
}

export type CronSweepResult = {
  organizations: SweepResult[];
  /** True when more organizations were eligible than one invocation handles. */
  truncated: boolean;
  configured: boolean;
};

/**
 * The cron entry point — every organization with the engine switched on.
 *
 * Uses the service-role client, which BYPASSES RLS, so every query in here and
 * in everything it calls filters organization_id explicitly. That is the standing
 * rule for this client and it is the whole reason the engine takes the client as
 * a parameter rather than reaching for one.
 *
 * `configured: false` when there is no service-role key. Reported rather than
 * treated as "no organizations had anything to do" — a missing key means the
 * scheduler cannot run at all, and that must not read as a quiet success.
 */
export async function runCronSweep(): Promise<CronSweepResult> {
  const client = createAdminClient();
  if (!client) {
    console.error("[automation] sweep skipped: no service-role key configured");
    return { organizations: [], truncated: false, configured: false };
  }

  const { data, error } = await client
    .from("organizations")
    .select("id, name, timezone")
    // The kill switch, applied before a single rule is read.
    .eq("automations_enabled", true)
    .limit(MAX_ORGANIZATIONS_PER_SWEEP + 1);

  if (error) {
    console.error(`[automation] sweep could not list organizations: ${formatDbError(error)}`);
    return { organizations: [], truncated: false, configured: true };
  }

  const rows = (data ?? []) as { id: string; name: string; timezone: string | null }[];
  const truncated = rows.length > MAX_ORGANIZATIONS_PER_SWEEP;
  const organizations = rows.slice(0, MAX_ORGANIZATIONS_PER_SWEEP);

  const results: SweepResult[] = [];
  for (const organization of organizations) {
    results.push(
      await sweepOrganization({
        client,
        organizationId: organization.id,
        organizationName: organization.name,
        timeZone: organization.timezone ?? "Asia/Kolkata",
        source: "cron",
        triggeredBy: null,
      })
    );
  }

  return { organizations: results, truncated, configured: true };
}

/**
 * The manual button's entry point — this organization only.
 *
 * Runs on the pressing user's session, so RLS applies normally and an
 * organization can only ever sweep itself. Same `sweepOrganization` underneath,
 * which is the point: pressing the button is a genuine rehearsal of what the
 * cron does, not a lookalike.
 */
export async function runManualSweep({
  organizationId,
  organizationName,
  timeZone,
  triggeredBy,
}: {
  organizationId: string;
  organizationName: string;
  timeZone: string;
  triggeredBy: string;
}): Promise<SweepResult> {
  const client = await createClient();

  return sweepOrganization({
    client,
    organizationId,
    organizationName,
    timeZone,
    source: "manual",
    triggeredBy,
  });
}

export type LatestSweep = {
  startedAt: string;
  finishedAt: string | null;
  source: "cron" | "manual";
  runsCreated: number;
  applicationsScanned: number;
  errorMessage: string | null;
};

/**
 * The most recent sweep, for the "is the scheduler actually running?" card.
 *
 * `null` means it has NEVER run — which the UI must say in those words. A
 * time-based rule sitting active while no cron is configured does nothing at
 * all, and an empty run history looks exactly like a quiet week.
 */
export async function getLatestSweep(
  organizationId: string
): Promise<{ sweep: LatestSweep | null; failed: boolean }> {
  const client = await createClient();

  const { data, error } = await client
    .from("automation_sweeps")
    .select("started_at, finished_at, source, runs_created, applications_scanned, error_message")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[automation] latest sweep read failed: ${formatDbError(error)}`);
    return { sweep: null, failed: true };
  }

  if (!data) return { sweep: null, failed: false };

  const row = data as {
    started_at: string;
    finished_at: string | null;
    source: "cron" | "manual";
    runs_created: number;
    applications_scanned: number;
    error_message: string | null;
  };

  return {
    sweep: {
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      source: row.source,
      runsCreated: row.runs_created,
      applicationsScanned: row.applications_scanned,
      errorMessage: row.error_message,
    },
    failed: false,
  };
}
