import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { parseFeedback } from "@/lib/interviews/feedback";
import { dispatch } from "@/lib/automations/engine";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

// Submitting feedback completes the interview, which may run automations.
export const maxDuration = 60;

/**
 * POST /api/interviews/:id/feedback — submit structured feedback.
 *
 * "Submit feedback" is Owner/Admin/Recruiter, with Recruiter scoped to the
 * assigned interviewer. submitted_by comes from the session and RLS requires it
 * to equal the caller, so an assessment cannot be attributed to someone else.
 *
 * A database trigger marks the interview completed, so status and feedback can
 * never disagree — an interview with feedback but still "scheduled" would sit in
 * the missing-feedback queue forever.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const supabase = await createClient();
    const { data: interview } = await supabase
      .from("interviews")
      .select("id, interviewer_id, status, application_id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!interview) return jsonError("Interview not found.", 404);

    const row = interview as unknown as {
      interviewer_id: string | null;
      status: string;
      application_id: string | null;
    };

    // Spec section 9: a Recruiter may submit feedback for interviews they are
    // the assigned interviewer on. Owner/Admin may record it on anyone's behalf.
    if (
      membership.role === "recruiter" &&
      row.interviewer_id !== null &&
      row.interviewer_id !== user.id
    ) {
      return jsonError("Only the assigned interviewer can submit feedback for this one.", 403);
    }

    if (row.status === "cancelled") {
      return jsonError("This interview was cancelled, so there's nothing to give feedback on.", 409);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseFeedback(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const { data, error } = await supabase
      .from("interview_feedback")
      .upsert(
        {
          organization_id: membership.organization.id,
          interview_id: id,
          rating: parsed.data.rating,
          recommendation: parsed.data.recommendation,
          notes: parsed.data.notes,
          submitted_by: user.id,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "interview_id,submitted_by" }
      )
      .select("id, rating, recommendation, submitted_at")
      .single();

    if (error) {
      console.error("[api] feedback submit failed:", describeDbError(error));
      return jsonError("Could not save that feedback.", 400);
    }

    // Module 14. The recommendation is recorded because it is the outcome —
    // the free-text notes are not, for the same reason application notes are not.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "interview",
      entityId: id,
      eventType: "interview.feedback_submitted",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { recommendation: parsed.data.recommendation, rating: parsed.data.rating },
    });

    // Module 13. A database trigger marks the interview completed when feedback
    // lands, so this is the moment "interview completed" is actually true.
    // Wrapped so a failing rule never loses someone's written assessment.
    if (row.application_id) {
      try {
        await dispatch({
          organizationId: membership.organization.id,
          organizationName: membership.organization.name,
          applicationId: row.application_id,
          trigger: "interview_completed",
          triggeredBy: user.id,
          webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
        });
      } catch (automationError) {
        console.error("[api] automations after interview feedback failed:", automationError);
      }
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
