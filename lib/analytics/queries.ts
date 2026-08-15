// =============================================================================
// Analytics data access.
//
// Reads the analytics_* views, applies filters and role scoping, and hands rows
// to the pure calculators in metrics.ts. Nothing here computes a rate — that
// separation is what lets the CSV export and the screen share one source of
// truth.
//
// TENANT ISOLATION IS DOUBLE-LOCKED. The views declare `security_invoker = true`
// so the caller's RLS applies, AND every query below filters organization_id
// explicitly. Either alone would be enough; both together mean a mistake in one
// layer is not a leak.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/types";
import type { AnalyticsFilters, Period } from "@/lib/analytics/filters";
import type {
  AutomationRunRow,
  FunnelRow,
  InterviewRow,
  ScreeningCallRow,
  StageDurationRow,
} from "@/lib/analytics/metrics";

/**
 * Row cap per query.
 *
 * The spec's large-dataset case. Aggregates over an unbounded fetch would both
 * time out and silently truncate at PostgREST's own default, so the cap is
 * explicit and — crucially — the caller is TOLD when it bit. A total that
 * quietly stops at 1000 is a wrong number presented as a right one.
 */
export const ROW_CAP = 10_000;

export type Scoped<T> = {
  rows: T[];
  /** True when the query failed — never reported as an empty result. */
  failed: boolean;
  /** True when ROW_CAP was hit and the figures are therefore partial. */
  truncated: boolean;
};

const EMPTY = { rows: [], failed: false, truncated: false } as const;

/**
 * A Recruiter sees only their own work unless they are Owner/Admin.
 *
 * Section 9: "Company-wide recruiter comparisons | Recruiter: Restricted (MVP
 * default) | Viewer: Restricted". A Viewer is read-only across the org, so they
 * keep org-wide figures; a Recruiter is scoped to applications assigned to them.
 */
export function shouldScopeToSelf(role: OrgRole): boolean {
  return role === "recruiter";
}

/** Whether this caller may see per-recruiter comparisons at all. */
export function canCompareRecruiters(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/** Whether this caller may export. "CSV export | Viewer: No". */
export function canExport(role: OrgRole): boolean {
  return role !== "viewer";
}

type BaseArgs = {
  organizationId: string;
  period: Period;
  filters: AnalyticsFilters;
  role: OrgRole;
  viewerId: string;
};

export async function fetchFunnelRows({
  organizationId,
  period,
  filters,
  role,
  viewerId,
}: BaseArgs): Promise<Scoped<FunnelRow>> {
  const supabase = await createClient();

  let query = supabase
    .from("analytics_application_funnel")
    .select(
      "application_id, source, current_stage, rejected_at_stage, assigned_recruiter_id, " +
        "job_id, client_id, created_at, hired_at, " +
        // One ever-reached flag per board stage. Renamed with the pipeline in
        // migration 0021 — the old names would select nothing and every funnel
        // step would read zero without erroring.
        "reached_shortlisted, reached_ai_screening_call, reached_phone_interview, " +
        "reached_video_interview, reached_written_assessment, reached_director_round, " +
        "reached_hired, reached_rejected, " +
        "screening_call_attempted, screening_call_completed, match_score"
    )
    .eq("organization_id", organizationId)
    .gte("created_at", period.startIso)
    .lt("created_at", period.endIso)
    .limit(ROW_CAP);

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.sourceKey) query = query.eq("source", filters.sourceKey);

  // An explicit recruiter filter wins for Owner/Admin; a Recruiter is pinned to
  // themselves regardless of what the query string asks for.
  if (shouldScopeToSelf(role)) {
    query = query.eq("assigned_recruiter_id", viewerId);
  } else if (filters.recruiterId) {
    query = query.eq("assigned_recruiter_id", filters.recruiterId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[analytics] funnel fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  const rows = (data ?? []) as unknown as FunnelRow[];
  return { rows, failed: false, truncated: rows.length >= ROW_CAP };
}

export async function fetchStageDurations({
  organizationId,
  period,
  filters,
  role,
  viewerId,
}: BaseArgs): Promise<Scoped<StageDurationRow>> {
  const supabase = await createClient();

  let query = supabase
    .from("analytics_stage_durations")
    .select("stage, days_in_stage, assigned_recruiter_id, job_id, client_id")
    .eq("organization_id", organizationId)
    // Filtered on EXIT, not entry: a stage visit belongs to the period in which
    // it finished, which is when its duration became a fact.
    .gte("exited_at", period.startIso)
    .lt("exited_at", period.endIso)
    .limit(ROW_CAP);

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);

  if (shouldScopeToSelf(role)) {
    query = query.eq("assigned_recruiter_id", viewerId);
  } else if (filters.recruiterId) {
    query = query.eq("assigned_recruiter_id", filters.recruiterId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[analytics] stage durations fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  const rows = (data ?? []) as unknown as StageDurationRow[];
  return { rows, failed: false, truncated: rows.length >= ROW_CAP };
}

export async function fetchScreeningRows({
  organizationId,
  period,
  filters,
  role,
  viewerId,
}: BaseArgs): Promise<Scoped<ScreeningCallRow>> {
  const supabase = await createClient();

  let query = supabase
    .from("analytics_screening_metrics")
    .select(
      "call_id, status, duration_seconds, language, consent_confirmed, assigned_recruiter_id, job_id, client_id"
    )
    .eq("organization_id", organizationId)
    .gte("created_at", period.startIso)
    .lt("created_at", period.endIso)
    .limit(ROW_CAP);

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);

  if (shouldScopeToSelf(role)) {
    query = query.eq("assigned_recruiter_id", viewerId);
  } else if (filters.recruiterId) {
    query = query.eq("assigned_recruiter_id", filters.recruiterId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[analytics] screening fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  const rows = (data ?? []) as unknown as ScreeningCallRow[];
  return { rows, failed: false, truncated: rows.length >= ROW_CAP };
}

export async function fetchInterviewRows({
  organizationId,
  period,
}: BaseArgs): Promise<Scoped<InterviewRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interviews")
    .select("id, status, feedback:interview_feedback(id)")
    .eq("organization_id", organizationId)
    .gte("scheduled_at", period.startIso)
    .lt("scheduled_at", period.endIso)
    .limit(ROW_CAP);

  if (error) {
    console.error("[analytics] interview fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  const raw = (data ?? []) as unknown as {
    id: string;
    status: string;
    feedback: { id: string }[] | null;
  }[];

  const rows = raw.map((row) => ({
    id: row.id,
    status: row.status,
    has_feedback: (row.feedback?.length ?? 0) > 0,
  }));

  return { rows, failed: false, truncated: rows.length >= ROW_CAP };
}

export async function fetchAutomationRuns({
  organizationId,
  period,
}: BaseArgs): Promise<Scoped<AutomationRunRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("automation_runs")
    .select("automation_id, status, automation:automations(name)")
    .eq("organization_id", organizationId)
    .gte("started_at", period.startIso)
    .lt("started_at", period.endIso)
    .limit(ROW_CAP);

  if (error) {
    // Distinct from an empty result: Module 13's table exists, so an error here
    // is a real problem rather than a not-built-yet state.
    console.error("[analytics] automation runs fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  const raw = (data ?? []) as unknown as {
    automation_id: string;
    status: string;
    automation: { name: string } | null;
  }[];

  const rows = raw.map((row) => ({
    automation_id: row.automation_id,
    automation_name: row.automation?.name ?? "Deleted automation",
    status: row.status,
  }));

  return { rows, failed: false, truncated: rows.length >= ROW_CAP };
}

export type RecruiterPerformanceRow = {
  recruiter_id: string;
  recruiter_name: string | null;
  recruiter_email: string;
  applications: number;
  active_applications: number;
  hires: number;
  rejected: number;
};

/**
 * Per-recruiter figures.
 *
 * Returns EMPTY for a caller who may not see comparisons, rather than throwing.
 * The tab is hidden from them anyway; this is the second lock, and an empty
 * result with the tab hidden is a cleaner failure than an exception.
 */
export async function fetchRecruiterPerformance({
  organizationId,
  role,
}: {
  organizationId: string;
  role: OrgRole;
}): Promise<Scoped<RecruiterPerformanceRow>> {
  if (!canCompareRecruiters(role)) return { ...EMPTY, rows: [] };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("analytics_recruiter_performance")
    .select(
      "recruiter_id, recruiter_name, recruiter_email, applications, active_applications, hires, rejected"
    )
    .eq("organization_id", organizationId)
    .limit(500);

  if (error) {
    console.error("[analytics] recruiter performance fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  return {
    rows: (data ?? []) as unknown as RecruiterPerformanceRow[],
    failed: false,
    truncated: false,
  };
}

export type ClientPerformanceRow = {
  client_id: string;
  client_name: string;
  feedback_sla_days: number;
  submissions: number;
  responses: number;
  awaiting_response: number;
  average_response_days: number | null;
  responded_within_sla: number;
};

export async function fetchClientPerformance({
  organizationId,
}: {
  organizationId: string;
}): Promise<Scoped<ClientPerformanceRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("analytics_client_performance")
    .select(
      "client_id, client_name, feedback_sla_days, submissions, responses, awaiting_response, average_response_days, responded_within_sla"
    )
    .eq("organization_id", organizationId)
    .limit(500);

  if (error) {
    console.error("[analytics] client performance fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  return {
    rows: (data ?? []) as unknown as ClientPerformanceRow[],
    failed: false,
    truncated: false,
  };
}

export type JobPerformanceRow = {
  job_id: string;
  title: string;
  status: string;
  applications: number;
  hires: number;
  reached_interview_or_beyond: number;
  average_match_score: number | null;
  screening_question_count: number;
  created_at: string;
  archived_at: string | null;
};

export async function fetchJobPerformance({
  organizationId,
  filters,
}: {
  organizationId: string;
  filters: AnalyticsFilters;
}): Promise<Scoped<JobPerformanceRow>> {
  const supabase = await createClient();

  let query = supabase
    .from("analytics_job_performance")
    .select(
      "job_id, title, status, applications, hires, reached_interview_or_beyond, " +
        "average_match_score, screening_question_count, created_at, archived_at"
    )
    .eq("organization_id", organizationId)
    .order("applications", { ascending: false })
    .limit(500);

  if (filters.clientId) query = query.eq("client_id", filters.clientId);

  const { data, error } = await query;

  if (error) {
    console.error("[analytics] job performance fetch failed:", error);
    return { rows: [], failed: true, truncated: false };
  }

  return {
    rows: (data ?? []) as unknown as JobPerformanceRow[],
    failed: false,
    truncated: false,
  };
}
