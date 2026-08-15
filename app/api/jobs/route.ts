import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { isJobStatus, type Job } from "@/lib/types";
import { parseJobPayload } from "@/lib/jobs/validation";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/**
 * Columns returned by list/detail. Explicit so a new column is never leaked
 * accidentally, and so the payload stays small.
 *
 * Results are cast to `Job` at the boundary: there are no generated Supabase
 * types in this project yet (that needs a live database to introspect), so the
 * client cannot infer a row shape from the select string. Revisit once
 * `supabase gen types` can be run.
 */
export const JOB_SELECT =
  "id, organization_id, client_id, title, description, experience_min, experience_max, " +
  "required_skills, preferred_skills, location, work_mode, salary_min, salary_max, " +
  "status, owner_recruiter_id, archived_at, created_at, updated_at";

/**
 * GET /api/jobs — organization-scoped list.
 *
 * Filters (spec section 7: "Job list with filters by client, recruiter, status"),
 * all validated server-side: ?status=, ?client_id=, ?recruiter_id=, ?q=,
 * ?include_archived=. Paginated.
 *
 * Viewable by every role including Viewer.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { searchParams } = request.nextUrl;
    const { page, perPage, from, to } = parsePagination(searchParams);

    const supabase = await createClient();
    let query = supabase
      .from("jobs")
      .select(JOB_SELECT, { count: "exact" })
      // Redundant with RLS, but defence in depth: never rely on a single layer
      // for tenant scoping.
      .eq("organization_id", membership.organization.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    const status = searchParams.get("status");
    if (status) {
      if (!isJobStatus(status)) return jsonError("Invalid status filter.", 400);
      query = query.eq("status", status);
    }

    const clientId = searchParams.get("client_id");
    if (clientId) query = query.eq("client_id", clientId);

    const recruiterId = searchParams.get("recruiter_id");
    if (recruiterId) query = query.eq("owner_recruiter_id", recruiterId);

    // Archived jobs are hidden unless explicitly requested.
    if (searchParams.get("include_archived") !== "true") {
      query = query.is("archived_at", null);
    }

    const search = searchParams.get("q")?.trim();
    if (search) {
      // Escape PostgREST's pattern metacharacters so a search for "100%" can't
      // turn into a wildcard.
      const escaped = search.replace(/[%_,()]/g, "");
      if (escaped.length > 0) query = query.ilike("title", `%${escaped}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[api] jobs list failed:", describeDbError(error));
      return jsonError("Could not load jobs.", 400);
    }

    return NextResponse.json({
      data: data ?? [],
      pagination: { page, per_page: perPage, total: count ?? 0 },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/jobs — create a requisition. Owner/Admin/Recruiter (Viewer denied).
 *
 * organization_id is taken from the session; any value in the payload is ignored.
 * Optionally accepts screening_questions / interview_questions arrays so the
 * AI-assisted create flow can save the reviewed question sets in one request.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseJobPayload(body, "create");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    // An owner_recruiter_id from another organization would leak a cross-tenant
    // reference, so verify membership rather than trusting the id.
    if (parsed.data.owner_recruiter_id) {
      const { data: member } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization.id)
        .eq("user_id", parsed.data.owner_recruiter_id)
        .eq("status", "active")
        .maybeSingle();
      if (!member) return jsonError("The assigned recruiter is not a member of this team.", 400);
    }

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        ...parsed.data,
        organization_id: membership.organization.id,
        // Default ownership to the creator so every job has an accountable owner.
        owner_recruiter_id: parsed.data.owner_recruiter_id ?? membership.user_id,
      })
      .select(JOB_SELECT)
      .single();

    if (error) {
      console.error("[api] job create failed:", describeDbError(error));
      return jsonError("Could not create the job.", 400);
    }

    const job = data as unknown as Job;

    const questionError = await replaceQuestions({
      supabase,
      organizationId: membership.organization.id,
      jobId: job.id,
      body,
    });
    if (questionError) return jsonError(questionError, 400);

    // Module 14.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "job",
      entityId: job.id,
      eventType: "job.created",
      actorId: membership.user_id,
      metadata: { title: job.title, status: job.status },
    });

    return NextResponse.json({ data: job }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Replaces a job's screening/interview question sets when the payload includes
 * them. Shared by POST and PATCH. Returns an error message, or null on success.
 *
 * Delete-then-insert (rather than diffing) because these lists are short, order
 * matters, and the recruiter edits them as a whole block.
 */
export async function replaceQuestions({
  supabase,
  organizationId,
  jobId,
  body,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  jobId: string;
  body: unknown;
}): Promise<string | null> {
  const raw = (body ?? {}) as Record<string, unknown>;

  for (const [key, table] of [
    ["screening_questions", "job_screening_questions"],
    ["interview_questions", "job_interview_questions"],
  ] as const) {
    if (!(key in raw)) continue;

    const value = raw[key];
    if (!Array.isArray(value)) return `${key} must be a list of questions.`;

    const questions = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 500)
      .slice(0, 20);

    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq("job_id", jobId)
      .eq("organization_id", organizationId);

    if (deleteError) {
      console.error(`[api] clearing ${table} failed:`, describeDbError(deleteError));
      return "Could not update the job's questions.";
    }

    if (questions.length === 0) continue;

    const { error: insertError } = await supabase.from(table).insert(
      questions.map((question, index) => ({
        organization_id: organizationId,
        job_id: jobId,
        question,
        display_order: index,
      }))
    );

    if (insertError) {
      console.error(`[api] inserting ${table} failed:`, describeDbError(insertError));
      return "Could not save the job's questions.";
    }
  }

  return null;
}
