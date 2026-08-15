// =============================================================================
// Dashboard aggregation layer (Module 2).
//
// The Dashboard owns NO tables — it reads from applications, candidates,
// screening_calls, interviews, and automation_runs. In numeric build order none
// of those exist yet, so EVERY metric here must degrade rather than throw. Each
// returns a discriminated result and the UI labels unavailable ones honestly
// instead of rendering a fake zero.
//
// RETROFIT (spec, Module 2): once Modules 4, 5, 8, 11 and 13 ship, re-check
// every query below against the real schema and confirm it reads live data.
// The checklist lives in docs/modules/02-dashboard-retrofit.md.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { dayRangeInZone, daysSince } from "@/lib/time";
import { assessSla, targetDaysFor, type SlaConfig } from "@/lib/pipeline/sla";
import {
  APPLICATION_STAGES,
  PIPELINE_STAGES,
  STAGE_LABELS,
  type ApplicationStage,
} from "@/lib/applications/stages";
import type { OrgRole } from "@/lib/types";

/** Which module will make a currently-unavailable metric work. */
export type SourceModule = 4 | 5 | 8 | 11 | 13;

export type MetricResult =
  | { status: "ok"; value: number }
  /** The backing table doesn't exist yet — the owning module isn't built. */
  | { status: "pending"; module: SourceModule }
  /** The table exists but the query failed; show an error, not a zero. */
  | { status: "error" };

export type MetricKey =
  | "newCandidates"
  | "screeningsCompleted"
  | "interviewsToday"
  | "overdueApplications"
  | "failedCalls"
  | "failedAutomations";

export const METRIC_LABELS: Record<MetricKey, string> = {
  newCandidates: "New candidates",
  screeningsCompleted: "Screenings completed",
  interviewsToday: "Interviews today",
  overdueApplications: "Overdue applications",
  failedCalls: "Failed screening calls",
  failedAutomations: "Failed automations",
};

/** Which module supplies each metric — drives the "pending" hint in the UI. */
export const METRIC_SOURCE: Record<MetricKey, SourceModule> = {
  newCandidates: 4,
  screeningsCompleted: 8,
  interviewsToday: 11,
  overdueApplications: 5,
  failedCalls: 8,
  failedAutomations: 13,
};

/**
 * Attention-queue item: something needing a human decision now. Deliberately
 * source-agnostic so later modules can contribute new kinds without the UI
 * changing.
 */
export type AttentionItem = {
  id: string;
  /** Urgency drives sort order; higher is more urgent. */
  urgency: number;
  title: string;
  detail: string;
  /** Design-token severity, mapped to Warning/Error/Info in the UI. */
  severity: "error" | "warning" | "info";
  href: string | null;
  ageDays: number | null;
};

export type DashboardScope = "organization" | "own";

export type DashboardData = {
  scope: DashboardScope;
  timezone: string;
  /** Half-open [start, end) of "today" in the org's timezone, for display/debug. */
  dayStart: string;
  dayEnd: string;
  metrics: Record<MetricKey, MetricResult>;
  attention: AttentionItem[];
  /**
   * "pending" = the source table doesn't exist yet.
   * "error"   = the query genuinely failed. MUST be distinguished from an empty
   *             queue: telling a recruiter "nothing needs attention" when the
   *             query broke is a false statement, not a degraded one.
   */
  attentionStatus: "ok" | "pending" | "error";
};

/**
 * Role -> data scope. Spec section 9: Recruiters see their own workload only
 * ("configurable" is explicitly Build Later, so it is fixed for now);
 * Owner/Admin/Viewer see the whole organization, Viewer read-only.
 */
export function scopeForRole(role: OrgRole): DashboardScope {
  return role === "recruiter" ? "own" : "organization";
}

export function canViewOrganizationWide(role: OrgRole): boolean {
  return role === "owner" || role === "admin" || role === "viewer";
}

/**
 * PostgREST error codes/messages that mean "this table isn't in the schema yet".
 * Anything else is a genuine failure and must surface as an error, not a zero —
 * silently reporting 0 for a broken query is how a dashboard lies to a manager.
 */
export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (Postgres); PGRST205 = not found in schema cache;
  // PGRST200 = a requested embedded relationship doesn't exist.
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

type CountQuery = {
  table: string;
  module: SourceModule;
  build: (client: SupabaseClient) => PromiseLike<{ count: number | null; error: unknown }>;
};

/** Runs one COUNT, turning a missing table into `pending` instead of a throw. */
async function safeCount(
  client: SupabaseClient,
  { table, module, build }: CountQuery
): Promise<MetricResult> {
  try {
    const { count, error } = await build(client);
    if (error) {
      const typed = error as { code?: string; message?: string };
      if (isMissingRelation(typed)) return { status: "pending", module };
      console.error(`[dashboard] count on ${table} failed:`, typed.message ?? error);
      return { status: "error" };
    }
    return { status: "ok", value: count ?? 0 };
  } catch (thrown) {
    // A network/JS-level failure in one tile must not take down the page.
    console.error(`[dashboard] count on ${table} threw:`, thrown);
    return { status: "error" };
  }
}

/**
 * Fallback threshold, used only when a stage has no SLA at all.
 *
 * RETROFIT DONE (Module 10): the dashboard now reads pipeline_sla_config, so
 * "overdue" means the same thing here as on the pipeline board. This constant
 * survives as the last resort for an unrecognised stage.
 */
export const OVERDUE_DAYS = 3;

/** Raw application row the attention queue is built from. */
export type AttentionSourceRow = {
  id: string;
  stage: string | null;
  updated_at: string;
};

/**
 * Loads the organization's SLA targets, degrading to defaults.
 *
 * pipeline_sla_config is Module 10's table. If it is missing (an older database)
 * the defaults still apply, so the dashboard keeps working rather than showing
 * nothing as overdue — which would be a false "all clear".
 */
async function getSlaConfigSafely(
  client: SupabaseClient,
  organizationId: string
): Promise<SlaConfig> {
  try {
    const { data, error } = await client
      .from("pipeline_sla_config")
      .select("stage, target_days")
      .eq("organization_id", organizationId);

    if (error || !data) return {};

    const config: SlaConfig = {};
    for (const row of data as { stage: string; target_days: number }[]) {
      if ((PIPELINE_STAGES as readonly string[]).includes(row.stage)) {
        config[row.stage as ApplicationStage] = row.target_days;
      }
    }
    return config;
  } catch {
    return {};
  }
}

/**
 * A PostgREST `or` expression matching applications past their stage's SLA.
 *
 * One clause per stage because each has its own cutoff. Terminal stages are
 * omitted entirely — a hired or rejected application is finished, not overdue.
 */
export function buildOverdueClause(config: SlaConfig, now: Date): string {
  return PIPELINE_STAGES.map((stage) => {
    const target = targetDaysFor(stage, config) ?? OVERDUE_DAYS;
    const cutoff = new Date(now.getTime() - target * 24 * 60 * 60 * 1000).toISOString();
    return `and(stage.eq.${stage},updated_at.lt.${cutoff})`;
  }).join(",");
}

/**
 * Pure transform: stalled applications -> attention items, most urgent first.
 *
 * Uses the same per-stage SLA the pipeline board does, so an item flagged here
 * is flagged there too. Urgency is days OVER the target rather than raw age —
 * three days in a Director Round (target 7) is fine, three days in Applied
 * (target 2) is not.
 */
export function buildAttentionItems(
  rows: AttentionSourceRow[],
  now: Date = new Date(),
  config: SlaConfig = {}
): AttentionItem[] {
  return rows
    .map((row) => {
      const ageDays = daysSince(row.updated_at, now);
      const stage = (row.stage ?? "new") as ApplicationStage;
      // ALL stages, not just board columns: rejected/withdrawn are terminal
      // and must reach assessSla so they come back as not_tracked.
      const known = (APPLICATION_STAGES as readonly string[]).includes(stage);

      const sla = known
        ? assessSla({ stage, daysInStage: ageDays, config })
        : // Unrecognised stage: fall back rather than silently exclude it.
          {
            status: ageDays >= OVERDUE_DAYS ? ("breached" as const) : ("ok" as const),
            overdueDays: Math.max(0, ageDays - OVERDUE_DAYS),
            targetDays: OVERDUE_DAYS,
            daysInStage: ageDays,
            label: "",
          };

      const stageLabel = known ? STAGE_LABELS[stage] : (row.stage ?? "New");

      return {
        id: row.id,
        // Days past target, so stages with tight SLAs surface appropriately.
        urgency: sla.overdueDays,
        title: `Application in ${stageLabel}`,
        detail:
          sla.overdueDays === 0
            ? `No movement for ${ageDays} day${ageDays === 1 ? "" : "s"}`
            : `${sla.overdueDays} day${sla.overdueDays === 1 ? "" : "s"} past the ${sla.targetDays}-day target for this stage`,
        severity:
          sla.targetDays !== null && sla.overdueDays >= sla.targetDays
            ? ("error" as const)
            : ("warning" as const),
        href: `/applications/${row.id}`,
        ageDays,
        slaStatus: sla.status,
      };
    })
    // Only genuinely breached items belong in a "needs attention" list.
    .filter((item) => item.slaStatus === "breached")
    .map((item): AttentionItem => ({
      id: item.id,
      urgency: item.urgency,
      title: item.title,
      detail: item.detail,
      severity: item.severity,
      href: item.href,
      ageDays: item.ageDays,
    }))
    .sort((a, b) => b.urgency - a.urgency);
}

/**
 * Builds the whole dashboard payload for the caller's server-resolved tenant.
 *
 * `organizationId`/`role`/`recruiterUserId` come from lib/tenant.ts — never from
 * client input.
 */
export async function getDashboardData({
  organizationId,
  role,
  recruiterUserId,
  timezone,
  now = new Date(),
}: {
  organizationId: string;
  role: OrgRole;
  recruiterUserId: string;
  timezone: string;
  now?: Date;
}): Promise<DashboardData> {
  const client = (await createClient()) as unknown as SupabaseClient;
  const scope = scopeForRole(role);
  const { start, end } = dayRangeInZone(timezone, now);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // Per-stage SLA cutoffs (Module 10). Terminal stages are excluded — a hired
  // or rejected application is finished, not overdue.
  const slaConfig = await getSlaConfigSafely(client, organizationId);
  const overdueClause = buildOverdueClause(slaConfig, now);

  const [
    newCandidates,
    screeningsCompleted,
    interviewsToday,
    overdueApplications,
    failedCalls,
    failedAutomations,
  ] = await Promise.all([
    // Module 4 — candidates created today. Not recruiter-scoped: candidates are
    // organization-wide property, not owned by one recruiter.
    safeCount(client, {
      table: "candidates",
      module: 4,
      build: (c) =>
        c
          .from("candidates")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", startIso)
          .lt("created_at", endIso),
    }),

    // Module 8 — screening calls that completed today.
    safeCount(client, {
      table: "screening_calls",
      module: 8,
      build: (c) =>
        c
          .from("screening_calls")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "completed")
          .gte("ended_at", startIso)
          .lt("ended_at", endIso),
    }),

    // Module 11 — interviews scheduled within today's org-local window.
    //
    // RETROFIT DONE (Module 11): cancelled interviews are excluded. The
    // retrofit checklist flagged this specifically — counting a cancelled
    // interview as happening today would overstate the day's workload.
    safeCount(client, {
      table: "interviews",
      module: 11,
      build: (c) =>
        c
          .from("interviews")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .gte("scheduled_at", startIso)
          .lt("scheduled_at", endIso),
    }),

    // Module 5 — applications past their stage's SLA.
    //
    // RETROFIT DONE (Module 10): this used a single fixed 3-day threshold for
    // every stage. It now uses the organization's configured per-stage target,
    // so "overdue" means the same thing here as on the pipeline board. One OR
    // clause per stage, because each has its own cutoff.
    safeCount(client, {
      table: "applications",
      module: 5,
      build: (c) => {
        let query = c
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .or(overdueClause);
        // Recruiter scope: never count another recruiter's workload.
        if (scope === "own") query = query.eq("assigned_recruiter_id", recruiterUserId);
        return query;
      },
    }),

    // Module 8 — calls that failed or went unanswered today.
    safeCount(client, {
      table: "screening_calls",
      module: 8,
      build: (c) =>
        c
          .from("screening_calls")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("status", ["failed", "no_answer"])
          .gte("created_at", startIso)
          .lt("created_at", endIso),
    }),

    // Module 13 — the forward dependency the spec calls out explicitly.
    safeCount(client, {
      table: "automation_runs",
      module: 13,
      build: (c) =>
        c
          .from("automation_runs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "failed")
          .gte("started_at", startIso)
          .lt("started_at", endIso),
    }),
  ]);

  const metrics: Record<MetricKey, MetricResult> = {
    newCandidates,
    screeningsCompleted,
    interviewsToday,
    overdueApplications,
    failedCalls,
    failedAutomations,
  };

  const attention = await getAttentionQueue({
    client,
    organizationId,
    scope,
    recruiterUserId,
    now,
    config: slaConfig,
  });

  return {
    scope,
    timezone,
    dayStart: startIso,
    dayEnd: endIso,
    metrics,
    attention: attention.items,
    attentionStatus: attention.status,
  };
}

/**
 * The attention queue: applications sitting too long without a decision,
 * sorted most-urgent first. Currently sourced only from Module 5's
 * applications table; Modules 8/9/11/12/13 each add their own item types on
 * retrofit (failed calls needing a retry decision, screening reports pending
 * review, interviews missing feedback, overdue client feedback, failed runs).
 */
async function getAttentionQueue({
  client,
  organizationId,
  scope,
  recruiterUserId,
  now,
  config,
}: {
  client: SupabaseClient;
  organizationId: string;
  scope: DashboardScope;
  recruiterUserId: string;
  now: Date;
  /** Per-stage SLA targets, so this agrees with the pipeline board. */
  config: SlaConfig;
}): Promise<{ items: AttentionItem[]; status: "ok" | "pending" | "error" }> {
  try {
    let query = client
      .from("applications")
      .select("id, stage, updated_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("updated_at", { ascending: true })
      // Bounded: the dashboard answers "what needs me now", not "everything".
      // Keeps the query cheap at 10k+ rows.
      .limit(20);

    if (scope === "own") {
      query = query.eq("assigned_recruiter_id", recruiterUserId);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingRelation(error)) return { items: [], status: "pending" };
      console.error("[dashboard] attention queue failed:", error.message);
      return { items: [], status: "error" };
    }

    const items = buildAttentionItems((data ?? []) as AttentionSourceRow[], now, config);
    return { items, status: "ok" };
  } catch (thrown) {
    console.error("[dashboard] attention queue threw:", thrown);
    return { items: [], status: "error" };
  }
}

/** Metrics that resolved to a real number — the only input the AI brief gets. */
export function availableMetrics(metrics: Record<MetricKey, MetricResult>) {
  return Object.entries(metrics).reduce<Partial<Record<MetricKey, number>>>(
    (accumulator, [key, result]) => {
      if (result.status === "ok") accumulator[key as MetricKey] = result.value;
      return accumulator;
    },
    {}
  );
}
