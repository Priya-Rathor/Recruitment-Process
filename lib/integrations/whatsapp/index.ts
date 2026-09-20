// =============================================================================
// WhatsApp Business adapter.
//
// The same shape as bolna / calendar / email / llm / n8n:
// connect / test / getStatus / disconnect, plus a send. Credentials are AES-GCM
// encrypted through lib/integrations/store.ts and only reachable with the
// service-role client, exactly like every other provider's.
//
// FAILS CLOSED, because this contacts a real person. AGENTS.md: "Anything that
// contacts a real person (calls, emails, SMS) fails closed: disconnected by
// default, explicit confirmation in the UI, a hard attempt cap, and a consent
// disclosure that cannot be disabled." So:
//
//   - there is no default provider and no fallback; not configured means not
//     sent, reported as `skipped` rather than silently dropped;
//   - sendMessage() refuses unless the integration is explicitly connected;
//   - it never throws, because a failed WhatsApp must not take down the email
//     that accompanies it or the stage change that triggered both;
//   - every automatic message carries the opt-out line, appended by
//     lib/communications/optout.ts and not removable from a template.
//
// TWO PROVIDER FACTS THAT SHAPE THE CODE, NOT JUST THE COMMENTS.
//
// 1. THE 24-HOUR WINDOW. Meta only allows free-form text to a user who has
//    messaged the business within the last 24 hours. Outside that window a
//    business must send a pre-approved *WhatsApp template* (a Meta-side object,
//    unrelated to this product's message_templates). A recruitment pipeline is
//    almost always outside the window, so `messagingTemplate` is part of connect:
//    an organization names the Meta template it had approved, and we send that,
//    passing the resolved body as its single body parameter. Left blank, free-form
//    text is attempted and Meta's own error is surfaced verbatim-in-substance
//    rather than dressed up as our bug.
//
// 2. OPT-OUT IS "REPLY STOP", AND SOMETHING IS LISTENING NOW.
//    Meta's own guidance is that a business honours an opt-out request in the
//    message thread. Until migration 0041 this product had no inbound webhook, so
//    a candidate replying STOP was only honoured if a human happened to read it
//    and record it by hand. app/api/webhooks/whatsapp/route.ts now receives those
//    replies and sets the opt-out itself. The manual control on the candidate
//    page stays — a candidate who says "please don't text me again" in words we
//    do not match is still a recruiter's job to record.
// =============================================================================
import {
  baseStatusFrom,
  clearCredentials,
  loadIntegration,
  maskCredential,
  readCredentials,
  recordTestResult,
  saveCredentials,
  type BaseStatus,
  type IntegrationStatus,
} from "@/lib/integrations/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDbError } from "@/lib/supabase/errors";

export const WHATSAPP_PROVIDER = "whatsapp" as const;

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Meta's Graph API. Overridable so a test or a proxy can point elsewhere. */
const GRAPH_BASE = process.env.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0";

export type WhatsAppStatus = BaseStatus & {
  /** The business phone number id messages are sent from. Not a secret. */
  phoneNumberId: string | null;
  /** The display number, so the card can show what a candidate will see. */
  displayNumber: string | null;
  /** The Meta-approved template name used outside the 24-hour window. */
  messagingTemplate: string | null;
  /** Language code the Meta template was approved in. */
  messagingTemplateLanguage: string | null;
  /**
   * Whether inbound webhook events can be verified for this organization —
   * either an app secret of its own or the platform-wide one. False means the
   * inbox will stay empty, and the settings card says so rather than leaving an
   * admin to conclude no candidate has ever replied.
   */
  webhookVerifiable: boolean;
};

type WhatsAppCredentials = {
  accessToken: string;
  /**
   * The Meta App Secret, used to verify inbound webhook signatures.
   *
   * OPTIONAL, and the fallback is the platform-wide WHATSAPP_APP_SECRET. Which
   * one is right depends on how the organization onboarded:
   *
   *   - One Meta app for the whole deployment (the Tech Provider model, where
   *     customers' numbers are onboarded onto our app): every tenant's events
   *     arrive signed with the same secret, so it belongs in the environment and
   *     this field stays blank.
   *   - The organization brought its own Meta app: its events are signed with
   *     ITS secret, and no environment variable can cover the second tenant to
   *     do that. So it is stored here, encrypted beside the access token — both
   *     are credentials of the same Meta app, and keeping one in the vault and
   *     the other in the environment would be an odd place to draw the line.
   */
  appSecret?: string;
};

export async function getStatus(organizationId: string): Promise<WhatsAppStatus> {
  const integration = await loadIntegration(organizationId, WHATSAPP_PROVIDER);
  const base = baseStatusFrom(WHATSAPP_PROVIDER, integration);

  const text = (key: string): string | null =>
    typeof base.settings[key] === "string" && (base.settings[key] as string).length > 0
      ? (base.settings[key] as string)
      : null;

  return {
    ...base,
    phoneNumberId: text("phoneNumberId"),
    displayNumber: text("displayNumber"),
    messagingTemplate: text("messagingTemplate"),
    messagingTemplateLanguage: text("messagingTemplateLanguage"),
    webhookVerifiable:
      base.settings.appSecretConfigured === true || platformAppSecret() !== null,
  };
}

export async function connect({
  organizationId,
  accessToken,
  phoneNumberId,
  displayNumber,
  messagingTemplate,
  messagingTemplateLanguage,
  appSecret,
  connectedBy,
}: {
  organizationId: string;
  accessToken: string;
  phoneNumberId: string;
  displayNumber?: string;
  messagingTemplate?: string;
  messagingTemplateLanguage?: string;
  /** Blank to fall back to WHATSAPP_APP_SECRET. See WhatsAppCredentials. */
  appSecret?: string;
  connectedBy?: string | null;
}): Promise<AdapterResult<{ credentialHint: string }>> {
  const token = accessToken.trim();
  const numberId = phoneNumberId.trim();

  if (token.length < 20) {
    return { ok: false, error: "That access token looks too short." };
  }
  // Meta phone number ids are numeric. Checked because a wrong value here is a
  // 404 from Graph at send time, which reads as "WhatsApp is broken".
  if (!/^\d{5,}$/.test(numberId)) {
    return { ok: false, error: "The phone number ID is the numeric ID from Meta, not the number itself." };
  }

  const templateName = messagingTemplate?.trim() ?? "";
  if (templateName && !/^[a-z0-9_]{1,512}$/.test(templateName)) {
    return {
      ok: false,
      error: "A Meta template name is lower-case letters, numbers and underscores only.",
    };
  }

  const secret = appSecret?.trim() ?? "";
  // A Meta app secret is a 32-character hex string. Checked because the failure
  // it prevents is invisible: a mistyped secret rejects every inbound message as
  // a forgery, and the endpoint's whole job is to look unremarkable to a
  // forger — so there would be nothing to see but an inbox that stays empty.
  if (secret && !/^[a-f0-9]{32}$/i.test(secret)) {
    return {
      ok: false,
      error: "The app secret is the 32-character value from your Meta app's Basic Settings.",
    };
  }

  const saved = await saveCredentials({
    organizationId,
    provider: WHATSAPP_PROVIDER,
    credentials: {
      accessToken: token,
      ...(secret ? { appSecret: secret } : {}),
    } satisfies WhatsAppCredentials,
    credentialHint: maskCredential(token),
    // None of these is a secret — the number is printed on every message — so
    // they live in settings where the UI can show them without a decrypt.
    settings: {
      phoneNumberId: numberId,
      displayNumber: displayNumber?.trim() || null,
      messagingTemplate: templateName || null,
      messagingTemplateLanguage: messagingTemplateLanguage?.trim() || "en",
      // A marker, not the secret. Lets the settings card and the inbox say
      // whether inbound messages can be verified without decrypting anything on
      // a page load — getStatus() is read on every settings render and by
      // lib/communications/channels.ts on every application page.
      appSecretConfigured: secret.length > 0,
    },
    connectedBy,
  });

  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, data: { credentialHint: maskCredential(token) } };
}

/**
 * Health check against the phone number's own metadata endpoint.
 *
 * Deliberately NOT a test send. A "test" that WhatsApps a real person is not a
 * test — the same rule the email adapter follows, and it matters more here
 * because a WhatsApp arrives on somebody's personal phone.
 */
export async function test(
  organizationId: string
): Promise<AdapterResult<{ status: IntegrationStatus }>> {
  const integration = await loadIntegration(organizationId, WHATSAPP_PROVIDER);
  const credentials = await readCredentials<WhatsAppCredentials>(integration);
  const phoneNumberId = integration?.settings?.phoneNumberId as string | undefined;

  if (!credentials || !phoneNumberId) {
    return { ok: false, error: "WhatsApp isn't connected yet." };
  }

  try {
    const response = await fetch(
      `${GRAPH_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      const invalid = response.status === 401 || response.status === 403;
      const message = invalid
        ? "Meta rejected that access token."
        : response.status === 404
          ? "Meta doesn't recognise that phone number ID."
          : `Meta returned an error (${response.status}).`;

      await recordTestResult({
        organizationId,
        provider: WHATSAPP_PROVIDER,
        status: invalid ? "error" : "needs_attention",
        errorCode: invalid ? "invalid_credentials" : "provider_error",
        errorMessage: message,
      });

      return { ok: false, error: message };
    }

    await recordTestResult({
      organizationId,
      provider: WHATSAPP_PROVIDER,
      status: "connected",
    });

    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error(`[whatsapp] test failed: ${formatDbError(error)}`);
    await recordTestResult({
      organizationId,
      provider: WHATSAPP_PROVIDER,
      status: "error",
      errorCode: "provider_unreachable",
      errorMessage: "Could not reach Meta's WhatsApp API.",
    });

    return { ok: false, error: "Could not reach Meta's WhatsApp API. Try again shortly." };
  }
}

export async function disconnect(organizationId: string): Promise<AdapterResult<null>> {
  const result = await clearCredentials({ organizationId, provider: WHATSAPP_PROVIDER });
  if (!result.ok) return { ok: false, error: result.error ?? "Could not disconnect WhatsApp." };
  return { ok: true, data: null };
}

export type SendWhatsAppResult =
  | { ok: true; providerMessageId: string }
  /** Not connected, or no number on file. A state, not a failure. */
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

/**
 * Normalises a phone number to what Meta expects: digits only, country code
 * included, no plus and no punctuation.
 *
 * Returns null rather than guessing when there is no country code. An Indian
 * ten-digit number sent without one is either rejected or, worse, delivered to
 * whoever holds that number in the United States — so a number we cannot be sure
 * about is not messaged at all. `defaultCountryCode` exists because a database
 * full of local numbers is the normal state of a recruitment product, and the
 * organization knows which country it recruits in even when the number does not
 * say.
 */
export function normalizeWhatsAppNumber(
  raw: string | null | undefined,
  defaultCountryCode?: string | null
): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 7) return null;

  // An explicit + means the number carries its own country code. Trust it.
  if (hadPlus) return digits.length <= 15 ? digits : null;

  // 00 is the other written form of +.
  if (digits.startsWith("00")) {
    const stripped = digits.slice(2);
    return stripped.length >= 7 && stripped.length <= 15 ? stripped : null;
  }

  const code = (defaultCountryCode ?? "").replace(/\D/g, "");
  if (!code) return null;

  // Already prefixed with the org's own country code and long enough to be a
  // full international number — leave it alone rather than doubling the code.
  if (digits.startsWith(code) && digits.length >= code.length + 7) {
    return digits.length <= 15 ? digits : null;
  }

  const combined = `${code}${digits}`;
  return combined.length <= 15 ? combined : null;
}

/**
 * Sends one WhatsApp message.
 *
 * NEVER THROWS, for the same reason sendEmail() does not: the caller has already
 * written the log row and may have already sent an email, and an exception here
 * would unwind work that genuinely succeeded.
 */
export async function sendWhatsApp({
  organizationId,
  to,
  body,
  defaultCountryCode,
}: {
  organizationId: string;
  /** The candidate's number, in whatever form the database holds it. */
  to: string;
  body: string;
  defaultCountryCode?: string | null;
}): Promise<SendWhatsAppResult> {
  try {
    const number = normalizeWhatsAppNumber(to, defaultCountryCode);
    if (!number) {
      return {
        ok: false,
        skipped: true,
        reason:
          "That phone number has no country code, so WhatsApp couldn't be sure who it belongs to. " +
          "Nothing was sent.",
      };
    }

    const integration = await loadIntegration(organizationId, WHATSAPP_PROVIDER);

    if (!integration || integration.status !== "connected") {
      return {
        ok: false,
        skipped: true,
        reason: "WhatsApp isn't connected, so nothing was sent on that channel.",
      };
    }

    const credentials = await readCredentials<WhatsAppCredentials>(integration);
    const phoneNumberId = integration.settings?.phoneNumberId as string | undefined;

    if (!credentials || !phoneNumberId) {
      return { ok: false, skipped: true, reason: "WhatsApp isn't fully configured." };
    }

    const metaTemplate = integration.settings?.messagingTemplate as string | undefined;
    const metaLanguage =
      (integration.settings?.messagingTemplateLanguage as string | undefined) ?? "en";

    // See fact 1 in the header: a Meta-approved template outside the 24-hour
    // window, free-form text only when the organization has not named one.
    const payload = metaTemplate
      ? {
          messaging_product: "whatsapp",
          to: number,
          type: "template",
          template: {
            name: metaTemplate,
            language: { code: metaLanguage },
            components: [
              { type: "body", parameters: [{ type: "text", text: body }] },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: number,
          type: "text",
          text: { preview_url: false, body },
        };

    const response = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      // The raw body is logged, never returned — it can carry account identifiers.
      const detail = await response.text().catch(() => "");
      console.error("[whatsapp] send rejected:", response.status, detail);

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          skipped: false,
          error: "Meta rejected the access token. Reconnect WhatsApp in Settings → Integrations.",
        };
      }

      // 470 / 131047 is the 24-hour window. Named explicitly because the remedy
      // is specific and an admin will never guess it from "could not send".
      if (detail.includes("131047") || detail.includes("re-engagement")) {
        return {
          ok: false,
          skipped: false,
          error:
            "WhatsApp refused the message because the candidate hasn't messaged you in the last " +
            "24 hours. Configure an approved WhatsApp template name on the integration to send " +
            "outside that window.",
        };
      }

      return { ok: false, skipped: false, error: "WhatsApp could not send that message." };
    }

    const result = (await response.json()) as { messages?: { id?: string }[] };
    return { ok: true, providerMessageId: result.messages?.[0]?.id ?? "unknown" };
  } catch (error) {
    console.error(`[whatsapp] send failed: ${formatDbError(error)}`);
    return { ok: false, skipped: false, error: "Could not reach Meta's WhatsApp API." };
  }
}

// =============================================================================
// INBOUND — the webhook's side of this adapter.
//
// app/api/webhooks/whatsapp/route.ts is a public, unauthenticated endpoint by
// necessity: Meta calls it directly and has no session. Everything that makes
// that safe lives here, because it is all Meta-specific knowledge and the route
// should not be re-deriving it.
// =============================================================================

/** The deployment-wide Meta app secret, when there is one. */
function platformAppSecret(): string | null {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

/**
 * The string Meta echoes during the GET verification handshake.
 *
 * PLATFORM-WIDE, not per organization, and that is forced rather than chosen:
 * the handshake carries no phone number, no WABA id and no body — only
 * `hub.verify_token` — so there is nothing in the request to resolve a tenant
 * from. Every Meta app pointed at this deployment's callback URL therefore
 * configures the same verify token. It is a handshake string, not an
 * authorisation: it proves nothing about later events, which is why every POST
 * is signature-checked independently.
 */
export function webhookVerifyToken(): string | null {
  const token = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

export type InboundOrganization = {
  organizationId: string;
  /** Echoed back by Meta on every event; our own settings row, not the payload. */
  phoneNumberId: string;
};

/**
 * Which tenant a webhook event belongs to.
 *
 * THE ONE PLACE THIS PRODUCT RESOLVES A TENANT FROM SOMETHING IN A PAYLOAD, and
 * it is a lookup rather than a claim. `phoneNumberId` is not trusted as an
 * identity: it is used as a key into organization_integrations, a table only we
 * write, and the organization_id comes off OUR row. A forged or unknown id finds
 * nothing and the event is dropped — the same shape the Bolna webhook uses when
 * it looks up a screening_call by the id we generated.
 *
 * Requires the integration to be CONNECTED. A disconnected one has had its
 * credentials cleared, so we could neither verify the event with its own secret
 * nor ever reply; accepting messages into an inbox that cannot answer them would
 * be worse than declining them visibly in the settings card.
 */
export async function findOrganizationByPhoneNumberId(
  phoneNumberId: string
): Promise<InboundOrganization | null> {
  if (!/^\d{5,}$/.test(phoneNumberId)) return null;

  const admin = createAdminClient();
  if (!admin) {
    console.error("[whatsapp webhook] service-role client unavailable.");
    return null;
  }

  const { data, error } = await admin
    .from("organization_integrations")
    .select("organization_id, status")
    .eq("provider", WHATSAPP_PROVIDER)
    .eq("status", "connected")
    .eq("settings->>phoneNumberId", phoneNumberId)
    .maybeSingle();

  if (error) {
    console.error(`[whatsapp webhook] tenant lookup failed: ${formatDbError(error)}`);
    return null;
  }
  if (!data) return null;

  return {
    organizationId: (data as { organization_id: string }).organization_id,
    phoneNumberId,
  };
}

/**
 * Verifies Meta's X-Hub-Signature-256 over the RAW request body.
 *
 * Three things this gets right that a casual implementation gets wrong:
 *
 *   1. It hashes the raw bytes. A parsed-and-reserialised body differs from what
 *      Meta signed by whitespace and key order alone, so the check would fail
 *      for every legitimate event and the only way to "fix" it would be to
 *      disable it.
 *   2. It compares in constant time, so the endpoint cannot be used as an oracle
 *      to discover a valid signature byte by byte.
 *   3. NO SECRET MEANS NO EVENT IS ACCEPTED. Not a warning, not a pass-through.
 *      An unsigned endpoint that writes messages into a recruiter's inbox is a
 *      way to forge a candidate's words, and a forged "STOP" would silently
 *      switch off a real candidate's messages.
 *
 * The organization's own app secret wins over the platform one — see
 * WhatsAppCredentials for why both exist.
 */
export async function verifyWebhookSignature({
  organizationId,
  rawBody,
  header,
}: {
  organizationId: string;
  rawBody: string;
  /** The X-Hub-Signature-256 header, verbatim. */
  header: string | null;
}): Promise<boolean> {
  if (!header) return false;

  const integration = await loadIntegration(organizationId, WHATSAPP_PROVIDER);
  const credentials = await readCredentials<WhatsAppCredentials>(integration);
  const secret = credentials?.appSecret?.trim() || platformAppSecret();

  if (!secret) {
    console.error(
      `[whatsapp webhook] no app secret for organization ${organizationId}; rejecting. ` +
        "Set WHATSAPP_APP_SECRET, or store one on the integration."
    );
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const provided = header.replace(/^sha256=/i, "").trim().toLowerCase();
    if (provided.length !== expected.length) return false;

    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) {
      mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
    }
    return mismatch === 0;
  } catch (error) {
    console.error(`[whatsapp webhook] signature check failed: ${formatDbError(error)}`);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Payload parsing.
//
// PURE, and exported so it can be tested against real Meta payloads without a
// database, a secret or a network. Everything below treats the payload as what
// it is: JSON from the internet that happens to have arrived with a valid
// signature. A signature proves who sent it, not that its shape is what the
// documentation says.
// -----------------------------------------------------------------------------

export type InboundTextMessage = {
  /** Meta's message id (`wamid.…`). The idempotency key. */
  providerMessageId: string;
  /** The sender, digits only. Meta already sends it normalised. */
  from: string;
  body: string;
  /** Meta's own timestamp, seconds since epoch, as an ISO string. */
  sentAt: string;
};

export type InboundStatusUpdate = {
  /** The id of a message WE sent. */
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
};

export type ParsedWebhook = {
  /** The business number the events arrived on. Resolves the tenant. */
  phoneNumberId: string;
  messages: InboundTextMessage[];
  statuses: InboundStatusUpdate[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Turns one webhook body into the events we act on, grouped by business number.
 *
 * Meta batches: one POST carries entry[] → changes[] → value, and a single value
 * can hold several messages and several statuses. Returns one entry per business
 * number so the caller resolves each tenant once.
 *
 * NON-TEXT MESSAGES ARE DROPPED ON PURPOSE. An image, a location or a button
 * reply has no body this inbox can render and no reply path that would make
 * sense, and storing an empty row would put a blank bubble in a thread with no
 * way to see what was actually sent. They are counted so the handler can log
 * that something arrived it could not show — silence would look like the webhook
 * had failed.
 */
export function parseWebhookPayload(payload: unknown): {
  entries: ParsedWebhook[];
  unsupportedMessages: number;
} {
  const entries: ParsedWebhook[] = [];
  let unsupportedMessages = 0;

  for (const entry of asArray(asRecord(payload).entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);

      // Only messages. Meta sends account, template and quality updates through
      // the same webhook, and none of them belongs in a candidate's thread.
      if (asRecord(change).field !== "messages") continue;

      const phoneNumberId = asRecord(value.metadata).phone_number_id;
      if (typeof phoneNumberId !== "string" || phoneNumberId.length === 0) continue;

      const messages: InboundTextMessage[] = [];
      const statuses: InboundStatusUpdate[] = [];

      for (const raw of asArray(value.messages)) {
        const message = asRecord(raw);
        const id = message.id;
        const from = message.from;

        if (typeof id !== "string" || typeof from !== "string") continue;

        const body = asRecord(message.text).body;
        if (message.type !== "text" || typeof body !== "string" || body.trim().length === 0) {
          unsupportedMessages += 1;
          continue;
        }

        messages.push({
          providerMessageId: id,
          // Meta sends digits with the country code and no '+'. Stripped anyway,
          // because the column's CHECK constraint accepts nothing else and a
          // provider changing its mind should not become a 500.
          from: from.replace(/\D/g, ""),
          // Capped at the outbound limit. A 40 KB paste is not a chat message,
          // and the column is the same one every outbound row uses.
          body: body.slice(0, 4096),
          sentAt: metaTimestampToIso(message.timestamp),
        });
      }

      for (const raw of asArray(value.statuses)) {
        const update = asRecord(raw);
        const id = update.id;
        const status = update.status;

        if (typeof id !== "string") continue;
        if (
          status !== "sent" &&
          status !== "delivered" &&
          status !== "read" &&
          status !== "failed"
        ) {
          continue;
        }

        statuses.push({ providerMessageId: id, status });
      }

      if (messages.length > 0 || statuses.length > 0) {
        entries.push({ phoneNumberId, messages, statuses });
      }
    }
  }

  return { entries, unsupportedMessages };
}

/**
 * Meta's timestamp is seconds-since-epoch as a STRING. Falls back to now()
 * rather than throwing: a message that arrived is a fact, and losing it over an
 * unparseable timestamp would be the wrong trade.
 */
function metaTimestampToIso(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
