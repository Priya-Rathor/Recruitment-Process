import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * PATCH /api/notifications/:id — mark one read or unread.
 *
 * The only mutable field. Everything else about a notification is a record of
 * what the system said and when, and editing it after the fact would make the
 * centre a place where alerts can be quietly reworded.
 *
 * The user_id filter matches the RLS policy's WITH CHECK. Without it here, a
 * request for someone else's id would be refused by the database with an opaque
 * error rather than a clean 404.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const read = (body as { read?: unknown })?.read;
    if (typeof read !== "boolean") {
      return jsonError("Specify whether this is read.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: read ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .eq("user_id", user.id)
      .select("id, read_at")
      .maybeSingle();

    if (error) {
      console.error(`[api] notification update failed: ${formatDbError(error)}`);
      return jsonError("Could not update that notification.", 400);
    }
    if (!data) return jsonError("Notification not found.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/notifications/:id — dismiss.
 *
 * A real delete, unlike candidates or applications: a notification is a message
 * to one person, not a record of what happened to someone. The underlying event
 * is in Module 14's activity log, which nobody can delete — so dismissing an
 * alert loses the reminder, never the history.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([requireMembership(), requireCurrentUser()]);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(`[api] notification delete failed: ${formatDbError(error)}`);
      return jsonError("Could not dismiss that notification.", 400);
    }
    if (!data) return jsonError("Notification not found.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
