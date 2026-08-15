// =============================================================================
// Google Calendar OAuth.
//
// =============================================================================
// UNVERIFIED CODE. READ THIS BEFORE TRUSTING IT.
// =============================================================================
//
// This is written against Google's documented OAuth 2.0 and Calendar v3 REST
// contracts and it is the real implementation, not a stub. But NO GOOGLE CLOUD
// PROJECT EXISTS for this product: there is no client ID, no client secret, no
// registered redirect URI, and no consent screen. Not one line below has ever
// executed against Google.
//
// Everything else in this codebase is unproven for the same reason (no Supabase
// project either), but OAuth deserves calling out specifically, because it is
// the one flow where "looks right" and "works" diverge most often — redirect
// URI mismatches, scope grants that need re-consent, refresh tokens that are
// only issued on the FIRST authorization, and clock skew on token expiry all
// fail at runtime and never at compile time.
//
// Treat this as a correct-by-reading implementation that needs an end-to-end
// pass with real credentials before anyone relies on it. That obligation is
// recorded in docs/modules/17-settings-notes.md rather than left implicit.
// =============================================================================

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * Scopes requested.
 *
 * `calendar.events` rather than `calendar`: this product creates and deletes
 * interview events, and never needs to read a customer's whole calendar or
 * manage their calendar list. Asking for less is both easier to get consented
 * and smaller to lose control of.
 */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export type GoogleTokens = {
  accessToken: string;
  /**
   * Google issues this ONLY on the first authorization for a given user+client,
   * unless prompt=consent forces re-issue. Losing it means the connection dies
   * silently in an hour, so the connect flow always asks for consent.
   */
  refreshToken: string | null;
  /** Absolute expiry, not a duration — a duration is meaningless once stored. */
  expiresAt: string;
  scope: string;
};

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Builds the URL to send the admin to.
 *
 * `access_type=offline` + `prompt=consent` together are what guarantee a
 * refresh token. Without `prompt=consent`, a user who has authorized this app
 * before gets an access token and NO refresh token, and the integration works
 * for exactly one hour before dying with no obvious cause.
 *
 * `state` carries the organization id, signed by the caller — this function
 * does not invent it, because a state parameter a server generates from its own
 * session is the CSRF defence.
 */
export function buildAuthorizationUrl({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type TokenExchangeResult =
  | { ok: true; tokens: GoogleTokens; email: string | null }
  | { ok: false; error: string };

/** Exchanges the one-time code for tokens. */
export async function exchangeCodeForTokens({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<TokenExchangeResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: "Google Calendar isn't configured on this server. An operator must set it up first.",
    };
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      // Logged server-side; the user gets a plain message. Google's error
      // bodies routinely echo the redirect URI and client id.
      console.error("[calendar] token exchange failed:", response.status, await response.text());
      return { ok: false, error: "Google rejected the connection. Try connecting again." };
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!payload.access_token) {
      return { ok: false, error: "Google didn't return an access token." };
    }

    if (!payload.refresh_token) {
      // Fail rather than store a connection that dies in an hour with no cause
      // a user could diagnose.
      return {
        ok: false,
        error:
          "Google didn't return a refresh token, so the connection would expire within the hour. Remove this app from your Google account permissions and connect again.",
      };
    }

    const tokens: GoogleTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: expiryFrom(payload.expires_in),
      scope: payload.scope ?? CALENDAR_SCOPES.join(" "),
    };

    return { ok: true, tokens, email: await fetchAccountEmail(payload.access_token) };
  } catch (error) {
    console.error("[calendar] token exchange threw:", error);
    return { ok: false, error: "Could not reach Google. Try again shortly." };
  }
}

export type RefreshResult =
  | { ok: true; tokens: GoogleTokens }
  /** The grant is gone — the user revoked it, or it expired. Needs reconnect. */
  | { ok: false; revoked: true; error: string }
  | { ok: false; revoked: false; error: string };

/**
 * Refreshes an expired access token.
 *
 * Distinguishes REVOKED from a transient failure, because the remedies are
 * different and telling them apart is most of the value: a revoked grant needs
 * a human to reconnect, a network blip needs nothing at all. Treating the
 * second as the first would nag an admin to reconnect a working integration.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { ok: false, revoked: false, error: "Google Calendar isn't configured on this server." };
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[calendar] refresh failed:", response.status, body);

      // Google returns 400 with invalid_grant when the refresh token has been
      // revoked or expired. Anything else is transient.
      const revoked = response.status === 400 && body.includes("invalid_grant");

      return revoked
        ? {
            ok: false,
            revoked: true,
            error: "The Google Calendar connection was revoked. Reconnect it in Settings.",
          }
        : { ok: false, revoked: false, error: "Could not refresh the Google connection." };
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!payload.access_token) {
      return { ok: false, revoked: false, error: "Google didn't return a new access token." };
    }

    return {
      ok: true,
      tokens: {
        accessToken: payload.access_token,
        // A refresh response does NOT include a new refresh token. Carrying the
        // existing one forward is the caller's job; returning null here would
        // erase it on every refresh.
        refreshToken: null,
        expiresAt: expiryFrom(payload.expires_in),
        scope: payload.scope ?? CALENDAR_SCOPES.join(" "),
      },
    };
  } catch (error) {
    console.error("[calendar] refresh threw:", error);
    return { ok: false, revoked: false, error: "Could not reach Google." };
  }
}

/** Revokes the grant at Google, so disconnecting here disconnects there too. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch (error) {
    // Best effort. Our own credentials are cleared regardless — a revoke that
    // fails must not leave the integration looking connected on our side.
    console.error("[calendar] revoke failed:", error);
    return false;
  }
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { email?: string };
    return payload.email ?? null;
  } catch {
    // A missing display email is cosmetic; never fail a connection over it.
    return null;
  }
}

/**
 * Absolute expiry with a safety margin.
 *
 * Sixty seconds early, so a token that is technically valid but about to expire
 * mid-request gets refreshed instead. Without the margin, a call that starts at
 * T-2s arrives at Google expired.
 */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

function expiryFrom(expiresInSeconds: number | undefined): string {
  const seconds = typeof expiresInSeconds === "number" && expiresInSeconds > 0
    ? expiresInSeconds
    : 3600;

  return new Date(Date.now() + seconds * 1000 - EXPIRY_SAFETY_MARGIN_MS).toISOString();
}

export function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const at = new Date(expiresAt).getTime();
  // An unparseable expiry is treated as expired — refreshing unnecessarily is
  // cheap, using a dead token is a failed interview invite.
  return Number.isNaN(at) || at <= Date.now();
}
