import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listInterviews, scheduleInterview } from "@/lib/interviews/queries";
import { INTERVIEW_STATUSES, parseSchedulePayload, type InterviewStatus } from "@/lib/interviews/feedback";
import { logActivity } from "@/lib/activity/log";
import { trySendForEvent } from "@/lib/communications/triggers";
import { EVENT_FOR_INTERVIEW_MODE } from "@/lib/communications/events";
import { getInterview } from "@/lib/interviews/queries";

// Scheduling now makes a calendar round trip AND may message the candidate.
export const maxDuration = 60;

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

    /**
     * MODULE 15 — tell the candidate, with the time in it.
     *
     * FIRED HERE RATHER THAN FROM A STAGE MOVE. "Your interview is scheduled for
     * {{interview.time}}" needs a time, and a stage change does not have one — so
     * EVENT_FOR_STAGE deliberately has no entry for the two interview stages and
     * this is where those events live instead.
     *
     * The interview is RE-READ rather than assembled from the payload, and that is
     * the whole reason this is three lines longer than it needs to be: the calendar
     * step writes meeting_url after the row is created, so {{interview.link}} only
     * has a value if we read what was stored. Building the message from the request
     * body would send a video interview with no joining link, and the candidate
     * would have no way to attend.
     *
     * AFTER the response is composed but before it is returned, awaited, and
     * wrapped: a scheduling action must never fail because a message could not go
     * out. The interview exists either way and the log records what happened.
     */
    const eventKey = EVENT_FOR_INTERVIEW_MODE[parsed.data.mode];

    if (eventKey) {
      const stored = await getInterview({
        organizationId: membership.organization.id,
        interviewId: result.interviewId,
      });

      await trySendForEvent({
        organizationId: membership.organization.id,
        applicationId,
        eventKey,
        interview: stored
          ? {
              scheduled_at: stored.interview.scheduled_at,
              mode: stored.interview.mode,
              location: stored.interview.location,
              meeting_url: stored.interview.meeting_url,
            }
          : null,
        origin: request.nextUrl.origin,
      });
    }

    return NextResponse.json(
      { data: { id: result.interviewId }, calendarMessage: result.calendarMessage },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
