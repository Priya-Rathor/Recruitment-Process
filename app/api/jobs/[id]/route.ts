import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { parseJobPayload } from "@/lib/jobs/validation";
import { logActivity, logActivityBatch } from "@/lib/activity/log";
import type { Job } from "@/lib/types";
import { JOB_SELECT, replaceQuestions } from "../route";
import { describeDbError } from "@/lib/supabase/errors";

/** GET /api/jobs/:id — with its question sets. Any member may view. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_SELECT)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (error) {
      console.error("[api] job fetch failed:", describeDbError(error));
      return jsonError("Could not load the job.", 400);
    }
    // A job in another organization is reported as not found — never confirm
    // that someone else's id exists.
    if (!data) return jsonError("Job not found.", 404);

    const job = data as unknown as Job;

    const [screening, interview] = await Promise.all([
      supabase
        .from("job_screening_questions")
        .select("id, job_id, question, display_order")
        .eq("job_id", id)
        .order("display_order", { ascending: true }),
      supabase
        .from("job_interview_questions")
        .select("id, job_id, question, display_order")
        .eq("job_id", id)
        .order("display_order", { ascending: true }),
    ]);

    return NextResponse.json({
      data: {
        ...job,
        screening_questions: screening.data ?? [],
        interview_questions: interview.data ?? [],
      },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/jobs/:id — partial update. Owner/Admin/Recruiter (Viewer denied).
 *
 * "Recruiters may close only their own jobs" is checked here for a friendly
 * message AND enforced by a database trigger, because a direct PostgREST update
 * would bypass this handler entirely.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseJobPayload(body, "update");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("jobs")
      .select("id, status, owner_recruiter_id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!existing) return jsonError("Job not found.", 404);

    // Spec section 9: "Close job — Recruiter: Yes (own jobs)".
    if (
      parsed.data.status === "closed" &&
      existing.status !== "closed" &&
      membership.role === "recruiter" &&
      existing.owner_recruiter_id !== membership.user_id
    ) {
      return jsonError("You can only close jobs you own.", 403);
    }

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

    const { data: job, error } = await supabase
      .from("jobs")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select(JOB_SELECT)
      .maybeSingle();

    if (error) {
      // Surface the trigger's rule in the same words as the API check above.
      if (error.message?.includes("only close jobs they own")) {
        return jsonError("You can only close jobs you own.", 403);
      }
      console.error("[api] job update failed:", describeDbError(error));
      return jsonError("Could not update the job.", 400);
    }
    if (!job) return jsonError("Job not found.", 404);

    const questionError = await replaceQuestions({
      supabase,
      organizationId: membership.organization.id,
      jobId: id,
      body,
    });
    if (questionError) return jsonError(questionError, 400);

    // Module 14. A status change is logged as its own event as well as the
    // generic update — "closed this job" is the thing a manager looks for, and
    // it would be invisible inside a list of changed field names.
    await logActivityBatch([
      {
        organizationId: membership.organization.id,
        entityType: "job",
        entityId: id,
        eventType: "job.updated",
        actorId: membership.user_id,
        metadata: { fields: Object.keys(parsed.data) },
      },
      ...(parsed.data.status && parsed.data.status !== existing.status
        ? [
            {
              organizationId: membership.organization.id,
              entityType: "job" as const,
              entityId: id,
              eventType: "job.status_changed" as const,
              actorId: membership.user_id,
              metadata: { from: existing.status, to: parsed.data.status },
            },
          ]
        : []),
    ]);

    return NextResponse.json({ data: job });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/jobs/:id — ARCHIVES the job (spec: "soft-delete/archive where
 * applicable"). Never a hard delete: Applications (Module 5) and Analytics
 * (Module 16) will reference these rows, and destroying one would silently
 * corrupt historical reporting.
 *
 * Owner/Admin only — archiving is more consequential than editing.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("jobs")
      .update({ archived_at: new Date().toISOString(), status: "closed" })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .is("archived_at", null)
      .select("id, status, archived_at")
      .maybeSingle();

    if (error) {
      console.error("[api] job archive failed:", describeDbError(error));
      return jsonError("Could not archive the job.", 400);
    }
    if (!data) return jsonError("Job not found, or already archived.", 404);

    // Module 14.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "job",
      entityId: id,
      eventType: "job.archived",
      actorId: membership.user_id,
      metadata: {},
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
