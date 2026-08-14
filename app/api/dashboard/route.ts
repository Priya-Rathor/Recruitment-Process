import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { getDashboardData } from "@/lib/dashboard/metrics";
import { resolveTimeZone } from "@/lib/time";

/**
 * GET /api/dashboard — the current KPI snapshot + attention queue for the
 * caller's server-resolved organization, scoped by their role.
 *
 * Note on spec section 6: that section lists a generic CRUD set
 * (POST/PATCH/DELETE /api/dashboard, /api/dashboard/:id) which is boilerplate
 * repeated for every module. It contradicts section 5 for this module — "No new
 * tables ... dashboard is a read/aggregation layer, not a source of truth" —
 * so there is no dashboard entity to create, fetch by id, update, or delete.
 * Implemented instead: this read endpoint and the ai-action endpoint the spec
 * genuinely requires. No pagination either: this is a fixed-size snapshot, not
 * a list, and the attention queue is capped in the aggregation layer.
 */
export async function GET() {
  try {
    // Every role may view a dashboard; the ROLE decides the scope, not access.
    const membership = await requireMembership();

    const data = await getDashboardData({
      organizationId: membership.organization.id,
      role: membership.role,
      recruiterUserId: membership.user_id,
      timezone: resolveTimeZone(membership.organization.timezone),
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
