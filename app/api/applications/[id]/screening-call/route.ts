import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listCallsForApplication, startScreeningCall } from "@/lib/screening/queries";
import { logActivity } from "@/lib/activity/log";

// Placing a call involves a provider round trip.
export const maxDuration = 60;

/** GET — every attempt for this application. Viewable by all roles. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const calls = await listCallsForApplication({
      organizationId: membership.organization.id,
      applicationId: id,
    });

    return NextResponse.json({ data: calls, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST — start a screening call.
 *
 * This is the manual trigger the spec's forward-stub calls for: "Since Module
 * 13's 'When application enters Screening -> Then start Bolna call' automation
 * doesn't exist yet, add a manual 'Start Screening Call' button on the
 * application page as the temporary trigger."
 *
 * Owner/Admin/Recruiter only. A Viewer must never be able to make the product
 * telephone a member of the public.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const result = await startScreeningCall({
      organizationId: membership.organization.id,
      applicationId: id,
      organizationName: membership.organization.name,
      triggeredBy: user.id,
      webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
    });

    if (!result.ok) {
      // 409 for "the rules say not now" (capped, too soon, not connected) —
      // those are states, not malformed requests.
      const status =
        result.code === "capped" || result.code === "too_soon" || result.code === "not_connected"
          ? 409
          : 400;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    // Module 14. Telephoning a member of the public is exactly the kind of act
    // that must be attributable afterwards, so the actor is recorded on the call
    // itself rather than only on the application.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "screening_call",
      entityId: result.callId,
      eventType: "screening_call.started",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { application_id: id, triggered_manually: true },
    });

    return NextResponse.json({ data: { id: result.callId } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
