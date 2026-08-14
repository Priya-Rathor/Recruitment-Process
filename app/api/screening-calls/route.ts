import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { listCalls } from "@/lib/screening/queries";
import type { CallStatus } from "@/lib/screening/retry";

const VALID_STATUSES = [
  "queued",
  "dialing",
  "answered",
  "completed",
  "no_answer",
  "busy",
  "callback_requested",
  "failed",
  "cancelled",
];

/**
 * GET /api/screening-calls — organization-scoped list. Viewable by every role,
 * including Viewer ("Trigger/view screening calls — Viewer: Yes (read-only)").
 *
 * Note there is deliberately no POST here. Spec section 6's generic template
 * lists one, but a screening call is not a record you author — it is placed
 * against a specific application, with consent, retry and integration checks
 * that only make sense in that context. Creating one is
 * POST /api/applications/:id/screening-call.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const statusParam = request.nextUrl.searchParams.get("status");

    if (statusParam && !VALID_STATUSES.includes(statusParam)) {
      return jsonError("Invalid status filter.", 400);
    }

    const { calls, failed } = await listCalls({
      organizationId: membership.organization.id,
      status: (statusParam as CallStatus) ?? null,
    });

    if (failed) return jsonError("Could not load screening calls.", 400);

    return NextResponse.json({ data: calls, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}
