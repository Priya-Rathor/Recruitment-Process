import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { exchangeCodeForTokens } from "@/lib/integrations/calendar/oauth";
import { connect } from "@/lib/integrations/calendar";
import { logActivity } from "@/lib/activity/log";
import {
  calendarRedirectUri,
  OAUTH_STATE_COOKIE,
  verifyState,
} from "@/lib/integrations/calendar/state";

export const maxDuration = 60;

/**
 * GET /api/settings/integrations/calendar/callback — Google returns here.
 *
 * FOUR CHECKS BEFORE ANY TOKEN IS STORED, in order of what each prevents:
 *
 *   1. The caller is still an Owner/Admin of a session we recognise. Google
 *      redirects a browser; it does not authenticate the user to us.
 *   2. The state's HMAC verifies — so the organization id in it is ours, not a
 *      value an attacker chose.
 *   3. The state's nonce matches the httpOnly cookie — CSRF. Without this,
 *      someone could send a victim a crafted callback URL that connects the
 *      ATTACKER's Google account to the victim's organization, quietly
 *      redirecting every interview invite through an account they control.
 *   4. The organization in the state matches the caller's active organization —
 *      so a valid state from org A cannot be replayed while signed into org B.
 *
 * Redirects rather than returning JSON: a human's browser lands here, and a
 * page of JSON is not an answer to somebody who just clicked "Allow".
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const user = await requireCurrentUser();

    const settingsUrl = new URL("/settings/integrations", request.nextUrl.origin);

    const fail = (message: string) => {
      settingsUrl.searchParams.set("calendar_error", message);
      const response = NextResponse.redirect(settingsUrl);
      response.cookies.delete(OAUTH_STATE_COOKIE);
      return response;
    };

    // Google's own refusal, e.g. the user pressed Cancel. Not an error to
    // report loudly — they chose it.
    const providerError = request.nextUrl.searchParams.get("error");
    if (providerError) {
      return fail(
        providerError === "access_denied"
          ? "Google Calendar wasn't connected — the request was cancelled."
          : "Google declined the connection."
      );
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) return fail("Google's response was incomplete. Try connecting again.");

    // (2) Integrity.
    const payload = verifyState(state);
    if (!payload) return fail("That sign-in couldn't be verified. Start the connection again.");

    const [stateOrganizationId, nonce] = payload.split(":");

    // (3) CSRF.
    const cookieNonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (!cookieNonce || cookieNonce !== nonce) {
      return fail("That sign-in didn't match this browser. Start the connection again.");
    }

    // (4) Replay across organizations.
    if (stateOrganizationId !== membership.organization.id) {
      return fail("That sign-in was started for a different organization.");
    }

    const exchanged = await exchangeCodeForTokens({
      code,
      // Must byte-match the one sent to Google, or the exchange is rejected.
      redirectUri: calendarRedirectUri(request.nextUrl.origin),
    });

    if (!exchanged.ok) return fail(exchanged.error);

    const stored = await connect({
      organizationId: membership.organization.id,
      tokens: exchanged.tokens,
      accountEmail: exchanged.email,
      connectedBy: user.id,
    });

    if (!stored.ok) return fail(stored.error);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "integration",
      entityId: null,
      eventType: "integration.connected",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      // The account email, never a token.
      metadata: { provider: "calendar", account: exchanged.email ?? "unknown" },
    });

    settingsUrl.searchParams.set("calendar_connected", "true");
    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
