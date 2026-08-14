// =============================================================================
// Calendar integration adapter.
//
// FORWARD STUB (spec, Module 11): "Google Calendar OAuth is owned by Module 17,
// which doesn't exist yet. Build the interview scheduling flow against a
// lib/integrations/calendar/createEvent() function that returns a clear
// 'not connected' result for now — the interview record must still save
// correctly with no external calendar event created in that case."
//
// RETROFIT (spec): "When Module 17 ships real Calendar OAuth, swap the stub
// createEvent() for the real implementation WITHOUT CHANGING this module's
// calling code."
//
// So these signatures are the contract. Module 17 fills in the OAuth exchange
// and the Google API call; nothing in Module 11 should need to change.
//
// Same adapter shape as lib/integrations/bolna: connect/test/getStatus/
// disconnect, plus createEvent.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { isEncryptionConfigured } from "@/lib/integrations/crypto";

export const CALENDAR_PROVIDER = "calendar";

export type IntegrationStatus = "disconnected" | "connected" | "needs_attention" | "error";

export type CalendarStatus = {
  status: IntegrationStatus;
  accountHint: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
  encryptionUnavailable: boolean;
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

/**
 * The result of trying to create an event.
 *
 * `not_connected` is deliberately NOT an error: it is the expected state until
 * Module 17 ships, and the caller must treat it as "carry on without a calendar
 * event", not "scheduling failed".
 */
export type CreateEventResult =
  | { ok: true; eventId: string; meetingUrl: string | null }
  | { ok: false; reason: "not_connected"; message: string }
  | { ok: false; reason: "failed"; message: string };

/** Current connection state. Never returns credentials. */
export async function getStatus(organizationId: string): Promise<CalendarStatus> {
  const encryptionUnavailable = !isEncryptionConfigured();
  const admin = createAdminClient();

  if (!admin) {
    return {
      status: "disconnected",
      accountHint: null,
      lastSuccessAt: null,
      errorMessage: null,
      encryptionUnavailable,
    };
  }

  const { data } = await admin
    .from("organization_integrations")
    .select("status, credential_hint, last_success_at, error_message")
    .eq("organization_id", organizationId)
    .eq("provider", CALENDAR_PROVIDER)
    .maybeSingle();

  if (!data) {
    return {
      status: "disconnected",
      accountHint: null,
      lastSuccessAt: null,
      errorMessage: null,
      encryptionUnavailable,
    };
  }

  const row = data as unknown as {
    status: IntegrationStatus;
    credential_hint: string | null;
    last_success_at: string | null;
    error_message: string | null;
  };

  return {
    status: row.status,
    accountHint: row.credential_hint,
    lastSuccessAt: row.last_success_at,
    errorMessage: row.error_message,
    encryptionUnavailable,
  };
}

/**
 * Creates a calendar event for an interview.
 *
 * STUB until Module 17. Returns `not_connected` rather than throwing or
 * pretending to succeed, so the caller can save the interview and say plainly
 * that no invite was sent.
 *
 * When Module 17 implements this for real it must keep returning the same shape,
 * including using `not_connected` when OAuth has been revoked — the spec
 * requires interview scheduling to keep degrading gracefully in that case.
 */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const status = await getStatus(input.organizationId);

  if (status.status !== "connected") {
    return {
      ok: false,
      reason: "not_connected",
      message:
        "Google Calendar isn't connected, so no invite was sent. The interview is still scheduled here.",
    };
  }

  // Module 17 replaces this branch with the real Google Calendar call. Reaching
  // it today would mean an integration row exists without an implementation, so
  // it degrades the same way rather than half-working.
  return {
    ok: false,
    reason: "not_connected",
    message:
      "Calendar sync isn't available yet. The interview is scheduled here, but no invite was sent.",
  };
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
  const status = await getStatus(organizationId);
  if (status.status !== "connected") return { ok: false };

  // Module 17: issue the real delete here.
  console.info(`[calendar] would delete event ${eventId} for org ${organizationId}`);
  return { ok: false };
}

/**
 * Connect / test / disconnect are Module 17's Settings page. Declared here so
 * the adapter surface is complete and callers can be written against it now.
 */
export async function connect(): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: "Connecting Google Calendar arrives with Settings (Module 17).",
  };
}

export async function test(): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: "Testing the calendar connection arrives with Settings (Module 17).",
  };
}

export async function disconnect(organizationId: string): Promise<{ ok: boolean }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false };

  const { error } = await admin
    .from("organization_integrations")
    .update({
      status: "disconnected" as IntegrationStatus,
      encrypted_credentials: null,
      credential_hint: null,
    })
    .eq("organization_id", organizationId)
    .eq("provider", CALENDAR_PROVIDER);

  return { ok: !error };
}
