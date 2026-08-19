import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { listApprovals, type ApprovalStatus } from "@/lib/automations/approvals";

const STATUSES: (ApprovalStatus | "all")[] = ["pending", "approved", "rejected", "expired", "all"];

/**
 * GET /api/automations/approvals — the oversight queue.
 *
 * Every role may read it. An automation waiting to act on your candidate should
 * not be invisible to you, and the RLS policy says the same thing. Deciding is
 * Owner/Admin, and that is enforced on the decision route and in the policy.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();

    const requested = request.nextUrl.searchParams.get("status") ?? "pending";
    if (!STATUSES.includes(requested as ApprovalStatus | "all")) {
      return jsonError("Unknown status filter.", 400);
    }

    const { approvals, failed } = await listApprovals({
      organizationId: membership.organization.id,
      status: requested as ApprovalStatus | "all",
    });

    if (failed) return jsonError("Could not load the approval queue.", 500);

    return NextResponse.json({ data: approvals, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}
