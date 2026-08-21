import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { cancelSession, getSessionDetail } from "@/lib/coding/queries";
import { describeLastSaved } from "@/lib/coding/session";

/**
 * GET /api/coding-sessions/:id — THE LIVE MONITOR'S POLL.
 *
 * Readable by every role. Deliberately narrow and deliberately cheap: the
 * monitor calls this every few seconds while its tab is visible, so it returns
 * exactly what the monitor draws and nothing else.
 *
 * READ-ONLY BY CONSTRUCTION. There is no interviewer write path to
 * coding_submissions anywhere in this codebase — not here, not in RLS (that
 * table has no INSERT or UPDATE policy at all). An interviewer physically
 * cannot overwrite a candidate's code, which is a stronger guarantee than a
 * disabled textarea.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getSessionDetail({
      organizationId: membership.organization.id,
      sessionId: id,
    });
    // Another tenant's session is a 404, never a 403.
    if (!detail) return jsonError("Coding session not found.", 404);

    return NextResponse.json({
      data: {
        id: detail.id,
        status: detail.status,
        candidate_name: detail.candidate_name,
        job_title: detail.job_title,
        question_title: detail.question_title,
        question_description: detail.question_description,
        instructions: detail.instructions,
        expires_at: detail.expires_at,
        opened_at: detail.opened_at,
        submitted_at: detail.submitted_at,
        cancelled_reason: detail.cancelled_reason,
        language: detail.submission?.programming_language ?? null,
        code: detail.submission?.code ?? null,
        last_saved_at: detail.submission?.last_saved_at ?? null,
        save_count: detail.submission?.save_count ?? 0,
        // Rendered server-side so every viewer of a shared screen reads the same
        // phrase — a client-side "x seconds ago" drifts with each machine's clock.
        last_saved_label: describeLastSaved(detail.submission?.last_saved_at ?? null),
      },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/coding-sessions/:id — cancel a coding round.
 *
 * THIS IS ALSO HOW THE CANDIDATE'S LINK IS REVOKED. The access token is a
 * stateless signature (lib/coding/token.ts), so revocation is expressed on the
 * session: the candidate's next save is refused and their page shows the reason.
 *
 * A reason is REQUIRED, and the database agrees. The candidate is shown it, and
 * "this was cancelled" with no explanation, on a screen they cannot ask a
 * question from, is a dead end.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
    const raw = (body ?? {}) as Record<string, unknown>;

    if (raw.status !== "cancelled") {
      // The only transition this endpoint performs. Every other status change is
      // a consequence of something the candidate did, and letting an interviewer
      // set one by hand would let them mark a round submitted that nobody
      // submitted.
      return jsonError('Send { "status": "cancelled" } with a reason.', 400);
    }

    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    if (reason.length === 0) {
      return jsonError("Say why you're cancelling — the candidate will see this.", 400);
    }
    if (reason.length > 500) {
      return jsonError("Keep the reason under 500 characters.", 400);
    }

    const detail = await getSessionDetail({
      organizationId: membership.organization.id,
      sessionId: id,
    });
    if (!detail) return jsonError("Coding session not found.", 404);

    const result = await cancelSession({
      organizationId: membership.organization.id,
      sessionId: id,
      reason,
    });

    if (!result.ok) return jsonError(result.error, result.status);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "interview",
      entityId: detail.interview_id,
      eventType: "interview.coding_round_cancelled",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { coding_session_id: id, reason },
    });

    return NextResponse.json({ data: { id, status: "cancelled" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
