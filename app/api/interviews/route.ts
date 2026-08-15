import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listInterviews, scheduleInterview } from "@/lib/interviews/queries";
import { INTERVIEW_STATUSES, parseSchedulePayload, type InterviewStatus } from "@/lib/interviews/feedback";
import { logActivity } from "@/lib/activity/log";

/** GET /api/interviews — organization-scoped list. Viewable by all roles. */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get("status");
    if (status && !(INTERVIEW_STATUSES as readonly string[]).includes(status)) {
      return jsonError("Invalid status filter.", 400);
    }

    const { interviews, failed } = await listInterviews({
      organizationId: membership.organization.id,
      status: (status as InterviewStatus) ?? null,
      applicationId: searchParams.get("application_id"),
    });

    if (failed) return jsonError("Could not load interviews.", 400);

    return NextResponse.json({ data: interviews, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/interviews — schedule one.
 *
 * "Schedule interview" is Owner/Admin/Recruiter; Viewer denied.
 *
 * A calendar problem is returned as `calendarMessage` alongside a successful
 * response — the interview is scheduled either way, per the spec's rule that
 * calendar failure must not block scheduling.
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const applicationId = payload.application_id;
    if (typeof applicationId !== "string" || applicationId.length === 0) {
      return jsonError("Choose an application.", 400);
    }

    const parsed = parseSchedulePayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const result = await scheduleInterview({
      organizationId: membership.organization.id,
      applicationId,
      createdBy: user.id,
      ...parsed.data,
    });

    if (!result.ok) {
      return jsonError(result.error, result.error.includes("not found") ? 404 : 400);
    }

    // Module 14.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "interview",
      entityId: result.interviewId,
      eventType: "interview.scheduled",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        application_id: applicationId,
        scheduled_at: parsed.data.scheduledAt,
        mode: parsed.data.mode,
      },
    });

    return NextResponse.json(
      { data: { id: result.interviewId }, calendarMessage: result.calendarMessage },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
