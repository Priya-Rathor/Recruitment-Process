import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { hasRole, requireMembership } from "@/lib/tenant";
import { activityFiltersFromParams, listActivity } from "@/lib/activity/queries";
import { isActivityEntityType } from "@/lib/activity/types";

/**
 * GET /api/activity-events — the activity feed.
 *
 * Filters: ?entity_type= ?entity_id= ?event_type= ?actor_id= ?since= ?sensitive=
 *
 * `sensitive=true` is Owner/Admin only, refused here with a readable 403. RLS
 * would return an empty list anyway, but "you can't see this" is a better answer
 * than a page that looks like nothing ever happened.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const params = request.nextUrl.searchParams;
    const { page, perPage, from } = parsePagination(params);

    const entityType = params.get("entity_type");
    if (entityType && !isActivityEntityType(entityType)) {
      return jsonError("Unknown entity type.", 400);
    }

    const sensitiveParam = params.get("sensitive");
    let sensitiveOnly: boolean | undefined;

    if (sensitiveParam === "true") {
      if (!hasRole(membership.role, ["owner", "admin"])) {
        return jsonError("Only an Owner or Admin can view the security audit log.", 403);
      }
      sensitiveOnly = true;
    } else if (sensitiveParam === "false") {
      sensitiveOnly = false;
    }

    const { events, total, failed } = await listActivity({
      organizationId: membership.organization.id,
      filters: { ...activityFiltersFromParams(params), sensitiveOnly },
      limit: perPage,
      offset: from,
    });

    if (failed) return jsonError("Could not load the activity log.", 500);

    return NextResponse.json({
      data: events,
      pagination: { page, per_page: perPage, total },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * The spec's section 6 also lists POST, PATCH and DELETE for this resource.
 * None of them are implemented, deliberately:
 *
 *   - POST would let a client write its own audit entries — a forged trail is
 *     worse than a missing one. Events are written by the server through
 *     logActivity(), at the point the thing actually happened.
 *   - PATCH and DELETE would make the log editable, which is the one property an
 *     audit log cannot have. The database has no UPDATE or DELETE policy and a
 *     trigger refuses both even for the service role.
 *
 * See docs/modules/14-activity-notes.md.
 */
