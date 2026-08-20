// =============================================================================
// Message templates — the row shape, and the rules a template must satisfy.
//
// Pure: no database, no AI. The validation here is the same gate the database's
// CHECK constraints enforce, said in English so the editor can show a reason
// rather than a Postgres error code.
//
// WHY THE DEFAULT SET IS NOT IN THIS FILE.
//
// The twelve seeded templates live in migration 0030 and only there. Mirroring
// twelve message bodies in TypeScript would create two copies of the words this
// product says to candidates, and the copies would drift — Module 19 has a test
// whose entire job is to catch exactly that drift for its document checklist.
// Here the drift would show up as a candidate receiving wording nobody approved,
// so there is one copy, in the place that actually creates the rows.
// =============================================================================
import { isCommunicationEvent, type CommunicationEventKey } from "@/lib/communications/events";
import { splitMessageTokens } from "@/lib/communications/tokens";

export const TEMPLATE_CHANNELS = ["email", "whatsapp", "both"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export function isTemplateChannel(value: unknown): value is TemplateChannel {
  return typeof value === "string" && (TEMPLATE_CHANNELS as readonly string[]).includes(value);
}

/** A channel a message actually goes out on. `both` is not one of these. */
export const SEND_CHANNELS = ["email", "whatsapp"] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

export function isSendChannel(value: unknown): value is SendChannel {
  return typeof value === "string" && (SEND_CHANNELS as readonly string[]).includes(value);
}

export const CHANNEL_LABELS: Record<TemplateChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  both: "Email + WhatsApp",
};

export type MessageTemplate = {
  id: string;
  organization_id: string;
  name: string;
  event_key: CommunicationEventKey;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  whatsapp_body: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Which channels a template sends on. One list, so no caller re-derives it. */
export function channelsFor(channel: TemplateChannel): SendChannel[] {
  if (channel === "both") return ["email", "whatsapp"];
  return [channel];
}

/**
 * The body to use for a given channel.
 *
 * For a `both` template the WhatsApp half falls back to the email body when it
 * was left blank — a long email arriving as a WhatsApp message is untidy, but
 * silently sending nothing on a channel the template claims to cover would be a
 * lie about what was configured.
 */
export function bodyFor(
  template: Pick<MessageTemplate, "channel" | "body" | "whatsapp_body">,
  channel: SendChannel
): string {
  if (channel === "whatsapp" && template.channel === "both") {
    return template.whatsapp_body?.trim() || template.body;
  }
  return template.body;
}

/** The subject for a channel. WhatsApp has none, whatever the row says. */
export function subjectFor(
  template: Pick<MessageTemplate, "channel" | "subject">,
  channel: SendChannel
): string | null {
  return channel === "email" ? template.subject : null;
}

export const MAX_NAME_LENGTH = 120;
export const MAX_SUBJECT_LENGTH = 300;
/**
 * WhatsApp Business API text messages cap at 4096 characters, and a message
 * that long is not one anybody reads. Email is capped far higher only because
 * there is no reason to refuse a long one.
 */
export const MAX_WHATSAPP_BODY_LENGTH = 1024;
export const MAX_EMAIL_BODY_LENGTH = 20_000;

export type TemplateInput = {
  name: string;
  event_key: CommunicationEventKey;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  whatsapp_body: string | null;
  active: boolean;
};

export type TemplateValidation =
  | { ok: true; data: TemplateInput; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validates a template.
 *
 * UNKNOWN TOKENS ARE A WARNING, NOT AN ERROR — the same call
 * lib/hiring-stages/placeholders.ts makes, for the same reason: refusing to save
 * somebody's work over a typo is worse than showing them the typo. The unknown
 * token is left exactly as written when the message renders, so it is visible in
 * the preview and in the log rather than silently deleted.
 *
 * A MISSING SUBJECT ON AN EMAIL TEMPLATE IS AN ERROR. An email with no subject
 * line reads as spam in most clients, and the send would look successful.
 */
export function validateTemplate(value: unknown): TemplateValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid template." };
  }
  const raw = value as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0) return { ok: false, error: "Give the template a name." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
  }

  if (!isCommunicationEvent(raw.event_key)) {
    return { ok: false, error: "Choose which event this template answers." };
  }

  if (!isTemplateChannel(raw.channel)) {
    return { ok: false, error: "Choose a channel." };
  }

  const channel = raw.channel;
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (body.length === 0) return { ok: false, error: "The message body can't be empty." };

  const emailIncluded = channel === "email" || channel === "both";
  const whatsappOnly = channel === "whatsapp";

  if (body.length > (whatsappOnly ? MAX_WHATSAPP_BODY_LENGTH : MAX_EMAIL_BODY_LENGTH)) {
    return {
      ok: false,
      error: whatsappOnly
        ? `A WhatsApp message has to stay under ${MAX_WHATSAPP_BODY_LENGTH} characters.`
        : `Keep the body under ${MAX_EMAIL_BODY_LENGTH} characters.`,
    };
  }

  let subject: string | null = null;
  if (emailIncluded) {
    subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
    if (subject.length === 0) {
      return { ok: false, error: "An email template needs a subject line." };
    }
    if (subject.length > MAX_SUBJECT_LENGTH) {
      return { ok: false, error: `Keep the subject under ${MAX_SUBJECT_LENGTH} characters.` };
    }
  }

  let whatsappBody: string | null = null;
  if (channel === "both") {
    const candidate = typeof raw.whatsapp_body === "string" ? raw.whatsapp_body.trim() : "";
    whatsappBody = candidate.length > 0 ? candidate : null;
    if (whatsappBody && whatsappBody.length > MAX_WHATSAPP_BODY_LENGTH) {
      return {
        ok: false,
        error: `The WhatsApp version has to stay under ${MAX_WHATSAPP_BODY_LENGTH} characters.`,
      };
    }
  }

  const warnings: string[] = [];
  const bodies = [body, subject ?? "", whatsappBody ?? ""].join("\n");
  const { unknown } = splitMessageTokens(bodies);
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.length === 1 ? "This field isn't recognised" : "These fields aren't recognised"} ` +
        `and will be sent exactly as written: ${unknown.map((token) => `{{${token}}}`).join(", ")}`
    );
  }

  return {
    ok: true,
    data: {
      name,
      event_key: raw.event_key,
      channel,
      subject,
      body,
      whatsapp_body: whatsappBody,
      active: raw.active === true,
    },
    warnings,
  };
}
