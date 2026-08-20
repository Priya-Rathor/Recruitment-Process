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
// 2. OPT-OUT IS "REPLY STOP", AND NOBODY IS LISTENING YET. Meta's own guidance
//    is that a business honours an opt-out request in the message thread. This
//    product has no inbound WhatsApp webhook, so a candidate replying STOP is
//    read by a human, who records it on the candidate page. That is a real
//    limitation and it is stated in the settings copy rather than implied away —
//    the alternative is an opt-out instruction that goes nowhere.
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
};

type WhatsAppCredentials = { accessToken: string };

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
  };
}

export async function connect({
  organizationId,
  accessToken,
  phoneNumberId,
  displayNumber,
  messagingTemplate,
  messagingTemplateLanguage,
  connectedBy,
}: {
  organizationId: string;
  accessToken: string;
  phoneNumberId: string;
  displayNumber?: string;
  messagingTemplate?: string;
  messagingTemplateLanguage?: string;
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

  const saved = await saveCredentials({
    organizationId,
    provider: WHATSAPP_PROVIDER,
    credentials: { accessToken: token } satisfies WhatsAppCredentials,
    credentialHint: maskCredential(token),
    // None of these is a secret — the number is printed on every message — so
    // they live in settings where the UI can show them without a decrypt.
    settings: {
      phoneNumberId: numberId,
      displayNumber: displayNumber?.trim() || null,
      messagingTemplate: templateName || null,
      messagingTemplateLanguage: messagingTemplateLanguage?.trim() || "en",
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
