// Server-side job queries shared by the Jobs pages. Kept out of the route
// handlers so pages can load data directly (no client fetch waterfall) while
// still going through one tenant-scoped place.
import { createClient } from "@/lib/supabase/server";
import { evaluateJobHealth, type JobHealth } from "@/lib/jobs/health";
import type { Job, JobQuestion, JobStatus } from "@/lib/types";

export const JOB_COLUMNS =
  "id, organization_id, client_id, title, description, experience_min, experience_max, " +
  "required_skills, preferred_skills, location, work_mode, salary_min, salary_max, " +
  "status, owner_recruiter_id, archived_at, created_at, updated_at";

export type JobWithHealth = Job & {
  health: JobHealth;
  screeningQuestionCount: number;
  ownerName: string | null;
  /** Module 12 retrofit: resolved from jobs.client_id. */
  clientName: string | null;
};

export type JobListFilters = {
  status?: JobStatus;
  recruiterId?: string;
  /** Module 12 retrofit: filtering by client is now possible. */
  clientId?: string;
  search?: string;
  includeArchived?: boolean;
};

/**
 * Lists jobs for an organization with health computed.
 *
 * Screening-question counts are fetched in ONE grouped query rather than per job
 * — an N+1 here would show up immediately on a list of a few hundred jobs.
 */
export async function listJobsWithHealth({
  organizationId,
  filters = {},
  limit = 50,
}: {
  organizationId: string;
  filters?: JobListFilters;
  limit?: number;
}): Promise<{ jobs: JobWithHealth[]; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.recruiterId) query = query.eq("owner_recruiter_id", filters.recruiterId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (!filters.includeArchived) query = query.is("archived_at", null);
  if (filters.search) {
    const escaped = filters.search.replace(/[%_,()]/g, "").trim();
    if (escaped) query = query.ilike("title", `%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[jobs] list failed:", error);
    return { jobs: [], failed: true };
  }

  const jobs = (data ?? []) as unknown as Job[];
  if (jobs.length === 0) return { jobs: [], failed: false };

  const jobIds = jobs.map((job) => job.id);

  const [questionRows, ownerRows, clientRows] = await Promise.all([
    supabase
      .from("job_screening_questions")
      .select("job_id")
      .in("job_id", jobIds),
    // Owner names for display. RLS already limits users to org peers.
    supabase
      .from("users")
      .select("id, name, email")
      .in(
        "id",
        jobs.map((job) => job.owner_recruiter_id).filter((id): id is string => Boolean(id))
      ),
    // Module 12 retrofit: resolve client names in one query rather than per job.
    supabase
      .from("clients")
      .select("id, name")
      .in(
        "id",
        jobs.map((job) => job.client_id).filter((id): id is string => Boolean(id))
      ),
  ]);

  const questionCounts = new Map<string, number>();
  for (const row of (questionRows.data ?? []) as { job_id: string }[]) {
    questionCounts.set(row.job_id, (questionCounts.get(row.job_id) ?? 0) + 1);
  }

  const owners = new Map<string, string>();
  for (const row of (ownerRows.data ?? []) as { id: string; name: string | null; email: string }[]) {
    owners.set(row.id, row.name ?? row.email);
  }

  const clientNames = new Map<string, string>();
  for (const row of (clientRows.data ?? []) as { id: string; name: string }[]) {
    clientNames.set(row.id, row.name);
  }

  return {
    jobs: jobs.map((job) => {
      const screeningQuestionCount = questionCounts.get(job.id) ?? 0;
      return {
        ...job,
        screeningQuestionCount,
        ownerName: job.owner_recruiter_id ? owners.get(job.owner_recruiter_id) ?? null : null,
        clientName: job.client_id ? clientNames.get(job.client_id) ?? null : null,
        health: evaluateJobHealth({
          status: job.status,
          createdAt: job.created_at,
          requiredSkills: job.required_skills ?? [],
          experienceMin: job.experience_min,
          experienceMax: job.experience_max,
          salaryMin: job.salary_min,
          salaryMax: job.salary_max,
          screeningQuestionCount,
          // applicationCount intentionally omitted until Module 5 exists —
          // see docs/modules/03-job-health-rules.md.
        }),
      };
    }),
    failed: false,
  };
}

export type JobDetail = JobWithHealth & {
  screeningQuestions: JobQuestion[];
  interviewQuestions: JobQuestion[];
};

/** Single job with its question sets. Returns null when not in this tenant. */
export async function getJobDetail({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<JobDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  const job = data as unknown as Job;

  const [screening, interview, owner, client] = await Promise.all([
    supabase
      .from("job_screening_questions")
      .select("id, job_id, question, display_order")
      .eq("job_id", jobId)
      .order("display_order", { ascending: true }),
    supabase
      .from("job_interview_questions")
      .select("id, job_id, question, display_order")
      .eq("job_id", jobId)
      .order("display_order", { ascending: true }),
    job.owner_recruiter_id
      ? supabase
          .from("users")
          .select("id, name, email")
          .eq("id", job.owner_recruiter_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.client_id
      ? supabase.from("clients").select("id, name").eq("id", job.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const screeningQuestions = (screening.data ?? []) as unknown as JobQuestion[];
  const ownerRow = owner.data as { name: string | null; email: string } | null;

  return {
    ...job,
    screeningQuestions,
    interviewQuestions: (interview.data ?? []) as unknown as JobQuestion[],
    screeningQuestionCount: screeningQuestions.length,
    ownerName: ownerRow ? ownerRow.name ?? ownerRow.email : null,
    clientName: (client.data as { name: string } | null)?.name ?? null,
    health: evaluateJobHealth({
      status: job.status,
      createdAt: job.created_at,
      requiredSkills: job.required_skills ?? [],
      experienceMin: job.experience_min,
      experienceMax: job.experience_max,
      salaryMin: job.salary_min,
      salaryMax: job.salary_max,
      screeningQuestionCount: screeningQuestions.length,
    }),
  };
}

/** Active members, for the recruiter filter and the owner picker. */
export async function listTeamMembers(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organization_members")
    // Explicit FK: organization_members has two references to users
    // (user_id and invited_by), so an unqualified embed is ambiguous.
    .select("user_id, role, user:users!organization_members_user_id_fkey(id, name, email)")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  return ((data ?? []) as unknown as {
    user_id: string;
    role: string;
    user: { id: string; name: string | null; email: string } | null;
  }[])
    .filter((row) => row.user)
    .map((row) => ({
      id: row.user_id,
      name: row.user!.name ?? row.user!.email,
      role: row.role,
    }));
}
