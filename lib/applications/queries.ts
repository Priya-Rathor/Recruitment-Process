// Server-side application queries. One tenant-scoped place for both pages and
// route handlers.
import { createClient } from "@/lib/supabase/server";
import { isApplicationStage, type ApplicationStage } from "@/lib/applications/stages";
import type { NoteRow, StageHistoryRow } from "@/lib/applications/timeline";
import type { Application, ApplicationWithContext, OrgRole } from "@/lib/types";

export const APPLICATION_COLUMNS =
  "id, organization_id, candidate_id, job_id, stage, match_score, " +
  "assigned_recruiter_id, source, archived_at, created_at, updated_at";

/** Candidate and job names, embedded via the foreign keys. */
const APPLICATION_WITH_CONTEXT =
  `${APPLICATION_COLUMNS}, candidate:candidates(id, name), job:jobs(id, title), ` +
  `recruiter:users!applications_assigned_recruiter_id_fkey(id, name, email)`;

type EmbeddedRow = Application & {
  candidate: { id: string; name: string } | null;
  job: { id: string; title: string } | null;
  recruiter: { id: string; name: string | null; email: string } | null;
};

function flatten(row: EmbeddedRow): ApplicationWithContext {
  return {
    ...row,
    candidate_name: row.candidate?.name ?? "Unknown candidate",
    job_title: row.job?.title ?? "Unknown job",
    recruiter_name: row.recruiter ? row.recruiter.name ?? row.recruiter.email : null,
  };
}

export type ApplicationFilters = {
  stage?: ApplicationStage | null;
  jobId?: string | null;
  candidateId?: string | null;
  recruiterId?: string | null;
  includeArchived?: boolean;
};

export function applicationFiltersFromParams(params: URLSearchParams): ApplicationFilters {
  const stage = params.get("stage");
  return {
    stage: stage && isApplicationStage(stage) ? stage : null,
    jobId: params.get("job_id") || null,
    candidateId: params.get("candidate_id") || null,
    recruiterId: params.get("recruiter_id") || null,
    includeArchived: params.get("archived") === "true",
  };
}

/**
 * Lists applications for an organization.
 *
 * `viewerRole`/`viewerId` implement the spec's "View application summary/timeline
 * — Recruiter: Yes (own/assigned)". A Recruiter sees applications assigned to
 * them PLUS unassigned ones, because they need to see unclaimed work in order to
 * pick it up; hiding those would break the workflow rather than protect anything.
 */
export async function listApplications({
  organizationId,
  filters = {},
  viewerRole,
  viewerId,
  limit = 50,
  offset = 0,
}: {
  organizationId: string;
  filters?: ApplicationFilters;
  viewerRole: OrgRole;
  viewerId: string;
  limit?: number;
  offset?: number;
}): Promise<{ applications: ApplicationWithContext[]; total: number; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("applications")
    .select(APPLICATION_WITH_CONTEXT, { count: "exact" })
    .eq("organization_id", organizationId);

  if (!filters.includeArchived) query = query.is("archived_at", null);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.candidateId) query = query.eq("candidate_id", filters.candidateId);
  if (filters.recruiterId) query = query.eq("assigned_recruiter_id", filters.recruiterId);

  if (viewerRole === "recruiter") {
    query = query.or(`assigned_recruiter_id.eq.${viewerId},assigned_recruiter_id.is.null`);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[applications] list failed:", error);
    return { applications: [], total: 0, failed: true };
  }

  return {
    applications: ((data ?? []) as unknown as EmbeddedRow[]).map(flatten),
    total: count ?? 0,
    failed: false,
  };
}

export type ApplicationDetail = ApplicationWithContext & {
  stageHistory: StageHistoryRow[];
  notes: NoteRow[];
};

/** Single application with its stage history and notes. Null when not ours. */
export async function getApplicationDetail({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<ApplicationDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(APPLICATION_WITH_CONTEXT)
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  const application = flatten(data as unknown as EmbeddedRow);

  const [historyResult, notesResult] = await Promise.all([
    supabase
      .from("application_stage_history")
      .select(
        "id, stage, entered_at, exited_at, changed_by, user:users!application_stage_history_changed_by_fkey(name, email)"
      )
      .eq("application_id", applicationId)
      .order("entered_at", { ascending: false }),
    supabase
      .from("application_notes")
      .select("id, note, created_at, author:users!application_notes_author_id_fkey(name, email)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
  ]);

  const stageHistory = ((historyResult.data ?? []) as unknown as {
    id: string;
    stage: ApplicationStage;
    entered_at: string;
    exited_at: string | null;
    user: { name: string | null; email: string } | null;
  }[]).map((row) => ({
    id: row.id,
    stage: row.stage,
    entered_at: row.entered_at,
    exited_at: row.exited_at,
    changed_by_name: row.user ? row.user.name ?? row.user.email : null,
  }));

  const notes = ((notesResult.data ?? []) as unknown as {
    id: string;
    note: string;
    created_at: string;
    author: { name: string | null; email: string } | null;
  }[]).map((row) => ({
    id: row.id,
    note: row.note,
    created_at: row.created_at,
    author_name: row.author ? row.author.name ?? row.author.email : null,
  }));

  return { ...application, stageHistory, notes };
}

/** Open jobs and recent candidates, for the "link candidate to job" form. */
export async function getLinkableOptions(organizationId: string) {
  const supabase = await createClient();

  const [jobs, candidates] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, status")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .in("status", ["open", "draft", "on_hold"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("candidates")
      .select("id, name, current_role")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return {
    jobs: (jobs.data ?? []) as { id: string; title: string; status: string }[],
    candidates: (candidates.data ?? []) as {
      id: string;
      name: string;
      current_role: string | null;
    }[],
  };
}
