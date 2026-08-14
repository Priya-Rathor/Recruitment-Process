import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import {
  APPLICATION_COLUMNS,
  applicationFiltersFromParams,
  listApplications,
} from "@/lib/applications/queries";
import { isApplicationStage } from "@/lib/applications/stages";
import { isCandidateSource, type Application } from "@/lib/types";
import { dispatch } from "@/lib/automations/engine";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Creating an application may now run automations.
export const maxDuration = 60;

/**
 * GET /api/applications — organization-scoped list.
 * Filters: ?stage= ?job_id= ?candidate_id= ?recruiter_id= ?archived=
 * Viewable by every role; a Recruiter sees their own plus unassigned.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { searchParams } = request.nextUrl;
    const { page, perPage, from } = parsePagination(searchParams);

    const { applications, total, failed } = await listApplications({
      organizationId: membership.organization.id,
      filters: applicationFiltersFromParams(searchParams),
      viewerRole: membership.role,
      viewerId: membership.user_id,
      limit: perPage,
      offset: from,
    });

    if (failed) return jsonError("Could not load applications.", 400);

    return NextResponse.json({
      data: applications,
      pagination: { page, per_page: perPage, total },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/applications — link a candidate to a job.
 *
 * Creates at stage 'new' per the spec's flow. The opening stage-history row is
 * written by a database trigger, not here, so the history is complete even for a
 * direct PostgREST insert.
 *
 * organization_id comes from the session. A database trigger additionally
 * verifies the candidate and job belong to that same tenant — foreign keys alone
 * would happily accept another organization's id.
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

    const payload = (body ?? {}) as Record<string, unknown>;
    const candidateId = payload.candidate_id;
    const jobId = payload.job_id;

    if (typeof candidateId !== "string" || !UUID_PATTERN.test(candidateId)) {
      return jsonError("Select a candidate.", 400);
    }
    if (typeof jobId !== "string" || !UUID_PATTERN.test(jobId)) {
      return jsonError("Select a job.", 400);
    }

    // Stage is accepted on create because a candidate can legitimately enter
    // mid-pipeline (a referral going straight to interview).
    const stage = payload.stage;
    if (stage !== undefined && !isApplicationStage(stage)) {
      return jsonError("Invalid stage.", 400);
    }

    const source = payload.source;
    if (source !== undefined && !isCandidateSource(source)) {
      return jsonError("Invalid source.", 400);
    }

    const recruiterId = payload.assigned_recruiter_id;
    if (recruiterId !== undefined && recruiterId !== null) {
      if (typeof recruiterId !== "string" || !UUID_PATTERN.test(recruiterId)) {
        return jsonError("Invalid recruiter.", 400);
      }
    }

    const supabase = await createClient();

    if (typeof recruiterId === "string") {
      const { data: member } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization.id)
        .eq("user_id", recruiterId)
        .eq("status", "active")
        .maybeSingle();
      if (!member) return jsonError("The assigned recruiter is not a member of this team.", 400);
    }

    const { data, error } = await supabase
      .from("applications")
      .insert({
        organization_id: membership.organization.id,
        candidate_id: candidateId,
        job_id: jobId,
        stage: stage ?? "new",
        source: source ?? "manual",
        // Default to the creator so every application has an owner.
        assigned_recruiter_id:
          recruiterId === null ? null : (recruiterId as string) ?? membership.user_id,
      })
      .select(APPLICATION_COLUMNS)
      .single();

    if (error) {
      // The unique (candidate_id, job_id) constraint — this candidate is
      // already in the pipeline for this job.
      if (error.code === "23505") {
        return jsonError("This candidate has already been applied to that job.", 409);
      }
      // The tenant-integrity trigger.
      if (error.message?.includes("does not belong to this organization")) {
        return jsonError("That candidate or job could not be found.", 404);
      }
      console.error("[api] application create failed:", error);
      return jsonError("Could not create the application.", 400);
    }

    const created = data as unknown as Application;

    // Module 13. Wrapped so a failing rule cannot fail the creation — the
    // application exists either way, and a 500 here would make the caller retry
    // and hit the duplicate constraint.
    try {
      await dispatch({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        applicationId: created.id,
        trigger: "application_created",
        triggeredBy: membership.user_id,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
      });
    } catch (automationError) {
      console.error("[api] automations after application create failed:", automationError);
    }

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
