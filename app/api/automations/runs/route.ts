import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { listRuns } from "@/lib/automations/queries";

/**
 * GET /api/automations/runs — run history.
 *
 * Every role, including Viewer: the permissions table grants "View automation
 * run history" to all four. A recruiter needs to see what the system did to
 * their candidates even though they cannot change the rules.
 */
export async function GET(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);
    const params = request.nextUrl.searchParams;

    const { runs, failed } = await listRuns({
      organizationId: membership.organization.id,
      automationId: params.get("automation_id"),
      status: params.get("status"),
      // "Recruiter: Yes (own scope)". Owner/Admin/Viewer see everything.
      viewerId: membership.role === "recruiter" ? user.id : null,
    });

    if (failed) return jsonError("Could not load the run history.", 500);

    return NextResponse.json({ data: runs, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}
