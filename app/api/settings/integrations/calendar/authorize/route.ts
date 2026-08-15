import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { buildAuthorizationUrl, isGoogleOAuthConfigured } from "@/lib/integrations/calendar/oauth";
import {
  calendarRedirectUri,
  isStateSigningConfigured,
  OAUTH_STATE_COOKIE,
  signState,
} from "@/lib/integrations/calendar/state";

/**
 * GET /api/settings/integrations/calendar/authorize — start the OAuth flow.
 *
 * Owner/Admin only, like every other credential action.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);

    if (!isGoogleOAuthConfigured()) {
      return jsonError(
        "This deployment has no Google OAuth application configured, so Calendar can't be connected yet.",
        503
      );
    }

    const nonce = randomBytes(16).toString("hex");
    const state = signState(`${membership.organization.id}:${nonce}`);

    if (!isStateSigningConfigured() || !state) {
      return jsonError(
        "This server can't sign the OAuth request securely. Set WEBHOOK_SECRET before connecting Calendar.",
        503
      );
    }

    const url = buildAuthorizationUrl({
      redirectUri: calendarRedirectUri(request.nextUrl.origin),
      state,
    });

    if (!url) return jsonError("Could not build the Google sign-in link.", 500);

    const response = NextResponse.redirect(url);

    // The nonce, stored where only this browser can return it. Google echoes
    // the state back; matching it against this cookie is what proves the
    // callback belongs to the request this user actually started.
    response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });

    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
