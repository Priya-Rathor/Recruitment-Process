import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { listCallsForApplication, startScreeningCall } from "@/lib/screening/queries";

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

    // TODO(Module 14): log the call trigger to activity_events.
    return NextResponse.json({ data: { id: result.callId } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
