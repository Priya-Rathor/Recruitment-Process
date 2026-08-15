// =============================================================================
// Google Calendar adapter.
//
// MODULE 17 RETROFIT — the stub is gone.
//
// Module 11's instruction was: "When Module 17 ships real Calendar OAuth, swap
// the stub createEvent() for the real implementation WITHOUT CHANGING this
// module's calling code." Every exported signature below is unchanged, and
// lib/interviews/queries.ts was not touched.
//
// The two guarantees Module 11 built against still hold, and matter more now
// that the calls are real:
//
//   * `not_connected` is NOT an error. It is the ordinary state when nobody has
//     connected Calendar, and the caller must carry on and save the interview.
//   * A REVOKED grant also degrades to `not_connected`, not to `failed`. The
//     spec requires interview scheduling to "still degrade gracefully if the
//     connection is later revoked", and a revoked token is a connection
//     problem, not a scheduling one.
//
// The OAuth exchange itself lives in ./oauth.ts and carries a prominent warning:
// it is written to Google's documented contract but has never run against
// Google, because no Google Cloud project exists for this product.
// =============================================================================
import {
  baseStatusFrom,
  clearCredentials,
  loadIntegration,
  readCredentials,
  recordTestResult,
  saveCredentials,
  type BaseStatus,
} from "@/lib/integrations/store";
import {
  isExpired,
  isGoogleOAuthConfigured,
  refreshAccessToken,
  revokeToken,
  type GoogleTokens,
} from "@/lib/integrations/calendar/oauth";
import { describeDbError } from "@/lib/supabase/errors";

export const CALENDAR_PROVIDER = "calendar" as const;

export type IntegrationStatus = "disconnected" | "connected" | "needs_attention" | "error";

/** Unchanged from Module 11's contract, with the base fields added alongside. */
export type CalendarStatus = BaseStatus & {
  status: IntegrationStatus;
  accountHint: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
  encryptionUnavailable: boolean;
  /** True when the SERVER has no Google app configured at all. */
  oauthUnavailable: boolean;
};

export type CreateEventInput = {
  organizationId: string;
  title: string;
  description: string;
  startsAt: Date;
  durationMinutes: number;
  /** Email addresses to invite. Empty is valid — a solo hold still helps. */
  attendeeEmails: string[];
  /** Ask the provider for a video link (Google Meet). */
  requestConferencing: boolean;
};

export type CreateEventResult =
  | { ok: true; eventId: string; meetingUrl: string | null }
  | { ok: false; reason: "not_connected"; message: string }
  | { ok: false; reason: "failed"; message: string };

type CalendarCredentials = GoogleTokens & { accountEmail?: string | null };

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Current connection state. Never returns credentials. */
export async function getStatus(organizationId: string): Promise<CalendarStatus> {
  const integration = await loadIntegration(organizationId, CALENDAR_PROVIDER);
  const base = baseStatusFrom(CALENDAR_PROVIDER, integration);

  return {
    ...base,
    accountHint: base.credentialHint,
    oauthUnavailable: !isGoogleOAuthConfigured(),
  };
}

/**
 * Stores the tokens from a completed OAuth exchange.
 *
 * Called by the OAuth callback route, not by a form — which is why it takes
 * tokens rather than a secret the user typed. `connect` is kept as the name so
 * the adapter surface stays uniform across all five providers.
 */
export async function connect({
  organizationId,
  tokens,
  accountEmail,
  connectedBy,
}: {
  organizationId: string;
  tokens: GoogleTokens;
  accountEmail: string | null;
  connectedBy?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const saved = await saveCredentials({
    organizationId,
    provider: CALENDAR_PROVIDER,
    credentials: { ...tokens, accountEmail } satisfies CalendarCredentials,
    // The account email, not a masked token — it is what an admin needs to
    // recognise which Google account is connected, and it is not a secret.
    credentialHint: accountEmail ?? "Google account",
    settings: { scope: tokens.scope },
    connectedBy,
  });

  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true };
}

/**
 * Returns a usable access token, refreshing if needed and persisting the result.
 *
 * Every Calendar call goes through here rather than reading the stored token
 * directly, so expiry is handled in exactly one place. A token refreshed in
 * five call sites is a token that eventually is not refreshed in one of them.
 */
async function getAccessToken(
  organizationId: string
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; revoked: boolean; error: string }
> {
  const integration = await loadIntegration(organizationId, CALENDAR_PROVIDER);
  const credentials = await readCredentials<CalendarCredentials>(integration);

  if (!credentials || integration?.status === "disconnected") {
    return { ok: false, revoked: false, error: "Google Calendar isn't connected." };
  }

  if (!isExpired(credentials.expiresAt)) {
    return { ok: true, accessToken: credentials.accessToken };
  }

  if (!credentials.refreshToken) {
    return {
      ok: false,
      revoked: true,
      error: "The Google Calendar connection expired. Reconnect it in Settings.",
    };
  }

  const refreshed = await refreshAccessToken(credentials.refreshToken);

  if (!refreshed.ok) {
    if (refreshed.revoked) {
      // Mark it needs_attention rather than deleting the row: the settings page
      // must be able to say WHY it stopped working, and an absent row says
      // "never connected".
      await recordTestResult({
        organizationId,
        provider: CALENDAR_PROVIDER,
        status: "needs_attention",
        errorCode: "expired_oauth",
        errorMessage: refreshed.error,
      });
    }
    return { ok: false, revoked: refreshed.revoked, error: refreshed.error };
  }

  // Carry the existing refresh token forward — a refresh response never
  // includes a new one, and writing null would break every later refresh.
  await saveCredentials({
    organizationId,
    provider: CALENDAR_PROVIDER,
    credentials: {
      ...refreshed.tokens,
      refreshToken: credentials.refreshToken,
      accountEmail: credentials.accountEmail,
    } satisfies CalendarCredentials,
    credentialHint: integration?.credential_hint ?? "Google account",
    settings: integration?.settings ?? {},
    connectedBy: integration?.connected_by ?? null,
  });

  return { ok: true, accessToken: refreshed.tokens.accessToken };
}

/**
 * Creates a calendar event for an interview.
 *
 * NEVER THROWS. Module 11 writes the interview row first and calls this
 * afterwards; an exception here would unwind a request that has, in the part
 * that matters, already succeeded.
 */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  try {
    const token = await getAccessToken(input.organizationId);

    if (!token.ok) {
      // Both "never connected" and "revoked" land here as not_connected, so
      // Module 11's graceful degradation covers the revoked case too.
      return {
        ok: false,
        reason: "not_connected",
        message: `${token.error} The interview is still scheduled here.`,
      };
    }

    const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.startsAt.toISOString() },
      end: { dateTime: endsAt.toISOString() },
      attendees: input.attendeeEmails
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        .map((email) => ({ email })),
    };

    if (input.requestConferencing) {
      body.conferenceData = {
        createRequest: {
          // Google requires a caller-supplied idempotency key. Derived from the
          // interview's own start time and title so a retried request reuses
          // the same conference rather than creating a second Meet link.
          requestId: `interview-${input.startsAt.getTime()}-${hash(input.title)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const params = new URLSearchParams({
      conferenceDataVersion: input.requestConferencing ? "1" : "0",
      // Google sends the invitations. Suppressing them would mean an interview
      // scheduled here that no candidate ever hears about.
      sendUpdates: "all",
    });

    const response = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[calendar] createEvent rejected:", response.status, detail);

      // A 401 here means the token died between refresh and use. Connection
      // problem, so it degrades rather than reading as a scheduling failure.
      if (response.status === 401) {
        await recordTestResult({
          organizationId: input.organizationId,
          provider: CALENDAR_PROVIDER,
          status: "needs_attention",
          errorCode: "expired_oauth",
          errorMessage: "Google rejected the stored credentials.",
        });

        return {
          ok: false,
          reason: "not_connected",
          message:
            "The Google Calendar connection needs reconnecting, so no invite was sent. The interview is still scheduled here.",
        };
      }

      return {
        ok: false,
        reason: "failed",
        message: "Google Calendar couldn't create the invite. The interview is still scheduled here.",
      };
    }

    const payload = (await response.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
    };

    if (!payload.id) {
      return {
        ok: false,
        reason: "failed",
        message: "Google Calendar accepted the invite but returned no event id.",
      };
    }

    const meetingUrl =
      payload.hangoutLink ??
      payload.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
      null;

    await recordTestResult({
      organizationId: input.organizationId,
      provider: CALENDAR_PROVIDER,
      status: "connected",
    });

    return { ok: true, eventId: payload.id, meetingUrl };
  } catch (error) {
    console.error("[calendar] createEvent threw:", describeDbError(error));
    return {
      ok: false,
      reason: "failed",
      message: "Couldn't reach Google Calendar. The interview is still scheduled here.",
    };
  }
}

/**
 * Removes a calendar event, e.g. when an interview is cancelled.
 * A failure here is logged, never surfaced as a scheduling error — the
 * cancellation itself has already happened.
 */
export async function deleteEvent({
  organizationId,
  eventId,
}: {
  organizationId: string;
  eventId: string;
}): Promise<{ ok: boolean }> {
  try {
    const token = await getAccessToken(organizationId);
    if (!token.ok) return { ok: false };

    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    // 410 Gone means it was already deleted — the desired end state, so it
    // counts as success rather than as an error nobody can act on.
    return { ok: response.ok || response.status === 410 };
  } catch (error) {
    console.error("[calendar] deleteEvent failed:", describeDbError(error));
    return { ok: false };
  }
}

/**
 * Safe health check: reads the calendar's own metadata.
 *
 * Deliberately NOT a test event — a "test" that puts a phantom interview in a
 * customer's calendar and emails their team is not a test.
 */
export async function test(
  organizationId: string
): Promise<{ ok: true; data: { status: IntegrationStatus } } | { ok: false; error: string }> {
  const token = await getAccessToken(organizationId);

  if (!token.ok) {
    await recordTestResult({
      organizationId,
      provider: CALENDAR_PROVIDER,
      status: token.revoked ? "needs_attention" : "error",
      errorCode: token.revoked ? "expired_oauth" : "provider_unreachable",
      errorMessage: token.error,
    });
    return { ok: false, error: token.error };
  }

  try {
    const response = await fetch(`${CALENDAR_API}/calendars/primary`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const invalid = response.status === 401 || response.status === 403;
      const message = invalid
        ? "Google rejected the stored credentials. Reconnect Google Calendar."
        : `Google Calendar returned an error (${response.status}).`;

      await recordTestResult({
        organizationId,
        provider: CALENDAR_PROVIDER,
        status: invalid ? "needs_attention" : "error",
        errorCode: invalid ? "expired_oauth" : "provider_error",
        errorMessage: message,
      });

      return { ok: false, error: message };
    }

    await recordTestResult({ organizationId, provider: CALENDAR_PROVIDER, status: "connected" });
    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error("[calendar] test failed:", describeDbError(error));
    await recordTestResult({
      organizationId,
      provider: CALENDAR_PROVIDER,
      status: "error",
      errorCode: "provider_unreachable",
      errorMessage: "Could not reach Google Calendar.",
    });
    return { ok: false, error: "Could not reach Google Calendar. Try again shortly." };
  }
}

/**
 * Disconnects, revoking the grant at Google as well as clearing it here.
 *
 * Revoking first, then clearing regardless of the outcome: a revoke that fails
 * must not leave the integration looking connected on our side, and a customer
 * who pressed Disconnect has withdrawn consent whatever Google's API says.
 */
export async function disconnect(
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const integration = await loadIntegration(organizationId, CALENDAR_PROVIDER);
  const credentials = await readCredentials<CalendarCredentials>(integration);

  if (credentials?.refreshToken) {
    await revokeToken(credentials.refreshToken);
  }

  const cleared = await clearCredentials({ organizationId, provider: CALENDAR_PROVIDER });
  if (!cleared.ok) return { ok: false, error: cleared.error ?? "Could not disconnect." };

  return { ok: true };
}

/** Small stable hash, for the conference idempotency key. */
function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i++) {
    result = (result * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(result).toString(36);
}
