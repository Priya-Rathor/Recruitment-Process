import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { listConversations, countUnreadConversations } from "@/lib/messaging/queries";

/**
 * GET /api/messages/conversations — the inbox's left pane.
 *
 * Exists so the open inbox can refresh itself without a full page navigation:
 * a candidate replying while a recruiter is reading should appear, and the
 * server component that renders the first paint cannot do that on its own.
 *
 * EVERY ROLE READS, INCLUDING VIEWER. Reading a conversation is reading; the
 * Viewer restriction is on replying, and it lives on the reply route where it
 * can actually be enforced.
 *
 * The recruiter scope is applied inside listConversations(), not here, so this
 * route and the server-rendered page cannot drift into showing different lists.
 */
export async function GET() {
  try {
    const membership = await requireMembership();

    const [{ conversations, failed }, unread] = await Promise.all([
      listConversations({
        organizationId: membership.organization.id,
        viewerRole: membership.role,
        viewerId: membership.user_id,
      }),
      countUnreadConversations({
        organizationId: membership.organization.id,
        viewerRole: membership.role,
        viewerId: membership.user_id,
      }),
    ]);

    /*
      `failed` is returned rather than an empty list with a 200.

      "No conversations" and "we could not read your conversations" must never
      look the same to a recruiter deciding whether anybody is waiting on them —
      the same rule the communication log follows.
    */
    return NextResponse.json({ conversations, failed, unread });
  } catch (error) {
    return handleRouteError(error);
  }
}
