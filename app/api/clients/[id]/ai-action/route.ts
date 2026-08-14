import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { getClient, getClientActivity } from "@/lib/clients/queries";
import { summarizeClientActivity } from "@/lib/ai/generateClientSubmission";

export const maxDuration = 60;

/**
 * POST /api/clients/:id/ai-action — the client activity summary.
 *
 * Internal, for the account manager. "View client activity summary" is Yes for
 * all four roles including Viewer, so this is not role-restricted beyond
 * membership — but every figure is computed server-side and checked against the
 * output, so it cannot report numbers the client's record does not support.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const client = await getClient({ organizationId: membership.organization.id, clientId: id });
    if (!client) return jsonError("Client not found.", 404);

    const activity = await getClientActivity({
      organizationId: membership.organization.id,
      clientId: id,
    });

    const result = await summarizeClientActivity({
      clientName: client.name,
      activeJobs: activity.activeJobs,
      submittedCandidates: activity.submittedCandidates,
      awaitingFeedback: activity.stats.pending,
      overdueFeedback: activity.stats.overdue,
      interviewsScheduled: activity.interviewsScheduled,
      averageResponseDays: activity.stats.averageResponseDays,
      feedbackSlaDays: client.feedback_sla_days,
    });

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events.
    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
