// Automation reads and writes. Tenant-scoped; RLS is the real boundary.
import { createClient } from "@/lib/supabase/server";
import type { Action, Condition, TriggerType } from "@/lib/automations/catalog";
import type { ActionResult } from "@/lib/automations/engine";
import { formatDbError } from "@/lib/supabase/errors";

export type AutomationRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  trigger: TriggerType;
  conditions: Condition[];
  actions: Action[];
  status: "draft" | "active" | "paused";
  required_integrations: string[];
  created_by: string | null;
  activated_by: string | null;
  activated_at: string | null;
  drafted_by_ai: boolean;
  created_at: string;
  updated_at: string;
};

export type AutomationRunRow = {
  id: string;
  automation_id: string;
  application_id: string | null;
  status: "success" | "failed" | "skipped" | "blocked";
  reason: string | null;
  error_message: string | null;
  action_results: ActionResult[];
  dedupe_key: string;
  started_at: string;
  finished_at: string | null;
};

const AUTOMATION_COLUMNS =
  "id, organization_id, name, description, trigger, conditions, actions, status, " +
  "required_integrations, created_by, activated_by, activated_at, drafted_by_ai, " +
  "created_at, updated_at";

const RUN_COLUMNS =
  "id, automation_id, application_id, status, reason, error_message, action_results, " +
  "dedupe_key, started_at, finished_at";

export type AutomationWithStats = AutomationRow & {
  runCount: number;
  failureCount: number;
  lastRunAt: string | null;
};

/**
 * Every rule in the organization, with a small run summary.
 *
 * `failed: true` rather than an empty list on error — the spec's rule that a
 * query failure must never render as "you have no automations", which would read
 * as a fact about the organization rather than about our request.
 */
export async function listAutomations(organizationId: string): Promise<{
  automations: AutomationWithStats[];
  failed: boolean;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("automations")
    .select(AUTOMATION_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[automations] list failed: ${formatDbError(error)}`);
    return { automations: [], failed: true };
  }

  const rows = (data ?? []) as unknown as AutomationRow[];
  if (rows.length === 0) return { automations: [], failed: false };

  const { data: runData } = await supabase
    .from("automation_runs")
    .select("automation_id, status, started_at")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(1000);

  const runs = (runData ?? []) as unknown as {
    automation_id: string;
    status: string;
    started_at: string;
  }[];

  const stats = new Map<string, { runCount: number; failureCount: number; lastRunAt: string | null }>();
  for (const run of runs) {
    const entry = stats.get(run.automation_id) ?? {
      runCount: 0,
      failureCount: 0,
      lastRunAt: null,
    };
    entry.runCount += 1;
    if (run.status === "failed") entry.failureCount += 1;
    // Runs arrive newest-first, so the first one seen is the latest.
    if (!entry.lastRunAt) entry.lastRunAt = run.started_at;
    stats.set(run.automation_id, entry);
  }

  return {
    automations: rows.map((row) => ({
      ...row,
      ...(stats.get(row.id) ?? { runCount: 0, failureCount: 0, lastRunAt: null }),
    })),
    failed: false,
  };
}

export async function getAutomation({
  organizationId,
  automationId,
}: {
  organizationId: string;
  automationId: string;
}): Promise<AutomationRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .select(AUTOMATION_COLUMNS)
    .eq("id", automationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as AutomationRow;
}

export type RunHistoryRow = AutomationRunRow & {
  automation_name: string;
  candidate_name: string | null;
  job_title: string | null;
};

/**
 * Run history, newest first.
 *
 * Every role may read it — the permissions table says Yes for all four — but a
 * Recruiter gets "own scope". `viewerId` narrows to applications assigned to
 * them (or unassigned, matching the pipeline board's rule); pass it only for a
 * Recruiter. The join is `!inner` so the filter removes top-level run rows
 * rather than merely blanking the embedded application.
 */
export async function listRuns({
  organizationId,
  automationId,
  status,
  viewerId,
  limit = 100,
}: {
  organizationId: string;
  automationId?: string | null;
  status?: string | null;
  /** Set for a Recruiter; undefined for Owner/Admin/Viewer, who see everything. */
  viewerId?: string | null;
  limit?: number;
}): Promise<{ runs: RunHistoryRow[]; failed: boolean }> {
  const supabase = await createClient();

  const applicationJoin = viewerId
    ? "application:applications!inner(assigned_recruiter_id, candidate:candidates(name), job:jobs(title))"
    : "application:applications(assigned_recruiter_id, candidate:candidates(name), job:jobs(title))";

  let query = supabase
    .from("automation_runs")
    .select(`${RUN_COLUMNS}, automation:automations(name), ${applicationJoin}`)
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (automationId) query = query.eq("automation_id", automationId);
  if (status) query = query.eq("status", status);
  if (viewerId) {
    query = query.or(
      `assigned_recruiter_id.eq.${viewerId},assigned_recruiter_id.is.null`,
      { referencedTable: "application" }
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[automations] run history failed: ${formatDbError(error)}`);
    return { runs: [], failed: true };
  }

  const rows = (data ?? []) as unknown as (AutomationRunRow & {
    automation: { name: string } | null;
    application: {
      assigned_recruiter_id: string | null;
      candidate: { name: string } | null;
      job: { title: string } | null;
    } | null;
  })[];

  return {
    runs: rows.map((row) => ({
      ...row,
      automation_name: row.automation?.name ?? "Deleted automation",
      candidate_name: row.application?.candidate?.name ?? null,
      job_title: row.application?.job?.title ?? null,
    })),
    failed: false,
  };
}

/** Failed runs in the last 24h — Module 2's tile. */
export async function countRecentFailures(organizationId: string): Promise<number | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const { count, error } = await supabase
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "failed")
    .gte("started_at", since);

  // null, not 0 — a failed count must never render as "nothing went wrong".
  if (error) return null;
  return count ?? 0;
}
