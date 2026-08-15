import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { getInterview } from "@/lib/interviews/queries";
import { INTERVIEW_STATUSES } from "@/lib/interviews/feedback";
import { requireCurrentUser } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/** GET /api/interviews/:id — with feedback. Viewable by all roles. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const result = await getInterview({
      organizationId: membership.organization.id,
      interviewId: id,
    });
    if (!result) return jsonError("Interview not found.", 404);

    return NextResponse.json({ data: result, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/interviews/:id — reschedule, reassign, or change status.
 *
 * Cancelling records a reason: a cancelled interview is part of the record of
 * how a candidate was treated, and "why" matters as much as "when".
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

    const raw = (body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ("status" in raw) {
      if (!(INTERVIEW_STATUSES as readonly string[]).includes(raw.status as string)) {
        return jsonError("Invalid status.", 400);
      }
      updates.status = raw.status;
      if (raw.status === "cancelled" && typeof raw.cancelled_reason === "string") {
        updates.cancelled_reason = raw.cancelled_reason.trim().slice(0, 500);
      }
    }

    if ("scheduled_at" in raw) {
      const scheduled = new Date(raw.scheduled_at as string);
      if (Number.isNaN(scheduled.getTime())) return jsonError("That date isn't valid.", 400);
      updates.scheduled_at = scheduled.toISOString();
    }

    if ("interviewer_id" in raw) {
      const interviewerId = raw.interviewer_id;
      if (interviewerId === null) {
        updates.interviewer_id = null;
      } else if (typeof interviewerId === "string") {
        const supabase = await createClient();
        const { data: member } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", membership.organization.id)
          .eq("user_id", interviewerId)
          .eq("status", "active")
          .maybeSingle();
        if (!member) return jsonError("That interviewer is not a member of this team.", 400);
        updates.interviewer_id = interviewerId;
      }
    }

    if ("notes" in raw) {
      updates.notes =
        typeof raw.notes === "string" && raw.notes.trim().length > 0
          ? raw.notes.trim().slice(0, 2000)
          : null;
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No valid fields provided.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("interviews")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, status, scheduled_at")
      .maybeSingle();

    if (error) {
      console.error("[api] interview update failed:", describeDbError(error));
      return jsonError("Could not update that interview.", 400);
    }
    if (!data) return jsonError("Interview not found.", 404);

    // Module 14. Only cancellation gets its own event — the spec names it, and
    // "the interview did not happen" is a fact somebody will later need to
    // explain. Rescheduling is covered by the row's own scheduled_at.
    if (updates.status === "cancelled") {
      const actor = await requireCurrentUser();
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "interview",
        entityId: id,
        eventType: "interview.cancelled",
        actorId: actor.id,
        actorLabel: actor.name ?? actor.email,
        metadata: {},
      });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
