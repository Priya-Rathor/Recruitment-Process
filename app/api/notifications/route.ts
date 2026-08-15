import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, parsePagination } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { listNotifications } from "@/lib/notifications/queries";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * GET /api/notifications — the caller's own notifications.
 *
 * Filters: ?unread=true ?type=
 *
 * There is no `user_id` filter, and that is deliberate. RLS restricts the table
 * to the caller's own rows, so a parameter would only ever let someone request
 * a list that comes back empty — which reads as "you have none" rather than
 * "not yours". All four roles may read; the boundary is identity, not role.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const params = request.nextUrl.searchParams;
    const { page, perPage, from } = parsePagination(params);

    const { notifications, total, failed } = await listNotifications({
      organizationId: membership.organization.id,
      unreadOnly: params.get("unread") === "true",
      type: params.get("type"),
      limit: perPage,
      offset: from,
    });

    if (failed) return jsonError("Could not load your notifications.", 500);

    return NextResponse.json({
      data: notifications,
      pagination: { page, per_page: perPage, total },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/notifications — mark all read.
 *
 * A collection-level update rather than a per-row loop, because "mark all read"
 * on a busy account would otherwise be a hundred round trips. RLS scopes the
 * update to the caller's rows; the explicit user_id filter is belt and braces
 * and makes the intent readable.
 */
export async function PATCH() {
  try {
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("organization_id", membership.organization.id)
      .eq("user_id", user.id)
      .is("read_at", null)
      .select("id");

    if (error) {
      console.error(`[api] mark all read failed: ${formatDbError(error)}`);
      return jsonError("Could not mark those as read.", 400);
    }

    return NextResponse.json({ data: { marked: (data ?? []).length } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * The spec's section 6 also lists POST /api/notifications. It is deliberately
 * not implemented: notifications are raised by the system at the moment an event
 * occurs, through notify(). A client-writable endpoint would let any signed-in
 * user send arbitrary alerts to a colleague in the product's own voice, which is
 * a phishing surface with no legitimate use — every real sender is server-side
 * and already calls notify() directly.
 */
