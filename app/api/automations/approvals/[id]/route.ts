import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { decideApproval } from "@/lib/automations/approvals";

// An approval can execute a screening call and an AI report in sequence.
export const maxDuration = 60;

/**
 * PATCH /api/automations/approvals/:id — approve or reject a proposal.
 *
 * THIS IS THE INTERVENTION POINT.
 *
 * Approving here is what actually runs the actions, and it runs them under the
 * approver's session — so the Module 7-9 actions the scheduler cannot perform DO
 * work on this path. That is the shape that makes a time-based screening rule
 * possible: propose at 3am with nobody signed in, a person approves at 9am, and
 * the call goes out on their authority.
 *
 * Owner/Admin, matching "create/edit automations" in the spec's permission table.
 * Deciding whether a rule acts on a candidate is the same class of decision as
 * writing the rule, and the RLS policy on automation_approvals says so too.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const decision = payload.decision;

    if (decision !== "approved" && decision !== "rejected") {
      return jsonError('Send a decision of "approved" or "rejected".', 400);
    }

    const result = await decideApproval({
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      approvalId: id,
      decision,
      decidedBy: user.id,
      note: typeof payload.note === "string" ? payload.note : null,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
    });

    if (!result.ok) {
      // 409, not 400: the request was well-formed and the state moved on. A
      // second approver clicking a moment later gets a sentence explaining that,
      // not a validation error.
      return jsonError(result.error, 409);
    }

    return NextResponse.json({
      data: { status: result.status, action_results: result.actionResults },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
