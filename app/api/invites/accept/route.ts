import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { ACTIVE_ORG_COOKIE, requireCurrentUser } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * POST /api/invites/accept
 *
 * Accepts an invite by token. All validation (token exists, still pending, not
 * expired) happens inside the accept_invite RPC, which is the only path that
 * can write an organization_members row — organization_members has no
 * client-facing INSERT policy. A bad or expired token is rejected there, so
 * this handler cannot be tricked into joining an org by guessing ids.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const token = (body as Record<string, unknown> | null)?.token;
    if (typeof token !== "string" || token.length === 0) {
      return jsonError("Invite token is required.", 400);
    }

    const supabase = await createClient();
    const { data: organizationId, error } = await supabase.rpc("accept_invite", {
      p_token: token,
    });

    if (error || !organizationId) {
      // Deliberately generic: do not reveal whether the token exists, is
      // expired, or was already used.
      console.error(`[api] accept_invite failed: ${formatDbError(error)}`);
      return jsonError("This invite link is no longer valid. Ask for a new invite.", 400);
    }

    // Module 14. Logged AFTER the RPC succeeds, so the row only exists if the
    // membership does — and the actor is the person who joined, which is the
    // only actor here that is true.
    await logActivity({
      organizationId: organizationId as string,
      entityType: "member",
      entityId: user.id,
      eventType: "member.invite_accepted",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { email: user.email },
    });

    const response = NextResponse.json({ data: { organization_id: organizationId } });

    // Drop the joiner straight into the org they just accepted.
    response.cookies.set(ACTIVE_ORG_COOKIE, organizationId as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
