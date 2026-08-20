// =============================================================================
// Opt-out: the token, the link, and the footer.
//
// EVERY AUTOMATIC MESSAGE CARRIES AN OPT-OUT, AND A TEMPLATE CANNOT REMOVE IT.
//
// The footer is appended by the send pipeline after the body is rendered, so it
// is not a field an admin can delete, forget, or edit away — the same structural
// approach Module 8 takes with the call recording disclosure. Automated
// recruitment mail without a working unsubscribe is unlawful under CAN-SPAM,
// PECR and the DPDP Act's notice-and-consent rules, so it is a build constraint,
// not a later compliance task.
//
// THE LINK IS SIGNED, NOT GUESSABLE, AND CARRIES NO SESSION.
//
// A candidate is not a user of this product. They have no login, so the
// unsubscribe endpoint must be reachable unauthenticated — which means the link
// itself is the authorisation. It is an HMAC over (candidate id, channel), so:
//
//   - somebody who has a link can opt that one candidate out of that one
//     channel, which is exactly the power the link is for;
//   - somebody who has a link CANNOT enumerate other candidates, because
//     changing the id invalidates the signature;
//   - the link cannot re-subscribe anyone. Opting back in is a deliberate act
//     recorded by a recruiter, never a URL somebody could be tricked into
//     opening.
//
// WHEN THERE IS NO SIGNING KEY, THE FOOTER CHANGES RATHER THAN DISAPPEARING.
//
// The HMAC key is INTEGRATION_ENCRYPTION_KEY, the same secret the credential
// store already requires. If it is unset — a real state in a fresh checkout —
// there can be no trustworthy link, so the footer says "reply to this message
// and ask to be removed" instead. A dead unsubscribe link is worse than an
// instruction to a human: the candidate believes they have opted out, and
// nothing happened.
// =============================================================================
import type { SendChannel } from "@/lib/communications/templates";

const TOKEN_VERSION = "v1";

function keyMaterial(): string | null {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  return key && key.length >= 32 ? key : null;
}

export function isOptOutSigningConfigured(): boolean {
  return keyMaterial() !== null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(payload: string): Promise<string | null> {
  const material = keyMaterial();
  if (!material) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return toBase64Url(new Uint8Array(signature));
}

/**
 * Builds the opt-out token for one candidate and channel.
 *
 * Returns null when signing is unavailable, so a caller cannot accidentally
 * publish an unverifiable link.
 */
export async function createOptOutToken({
  candidateId,
  channel,
}: {
  candidateId: string;
  channel: SendChannel;
}): Promise<string | null> {
  const payload = `${TOKEN_VERSION}:${candidateId}:${channel}`;
  const signature = await sign(payload);
  if (!signature) return null;

  return `${toBase64Url(new TextEncoder().encode(payload))}.${signature}`;
}

export type VerifiedOptOut = { candidateId: string; channel: SendChannel };

/**
 * Verifies a token.
 *
 * Recomputes the signature and compares in constant time. A mismatch, a missing
 * key, a wrong version and a malformed token all return null — the endpoint says
 * only "this link isn't valid", because distinguishing them for the caller would
 * be a probe into whether a candidate id exists.
 */
export async function verifyOptOutToken(token: string): Promise<VerifiedOptOut | null> {
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const payloadBytes = fromBase64Url(encodedPayload);
  if (!payloadBytes) return null;

  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await sign(payload);
  if (!expected) return null;

  if (!constantTimeEquals(expected, providedSignature)) return null;

  const [version, candidateId, channel] = payload.split(":");
  if (version !== TOKEN_VERSION) return null;
  if (!candidateId || (channel !== "email" && channel !== "whatsapp")) return null;

  return { candidateId, channel };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * The footer appended to an AUTOMATIC message.
 *
 * A manual message gets none: a recruiter replying to a candidate's own question
 * is a conversation, and stapling "click here to unsubscribe" to the end of a
 * personal reply is both odd and, given the recruiter may be replying to
 * somebody who already opted out, actively confusing.
 *
 * Pure, and takes the link rather than building it, so it can be unit tested
 * without a signing key.
 */
export function optOutFooter({
  channel,
  unsubscribeUrl,
}: {
  channel: SendChannel;
  /** Null when signing is unconfigured — the copy changes, see the header. */
  unsubscribeUrl: string | null;
}): string {
  if (channel === "whatsapp") {
    // Meta's own convention. There is no link: a WhatsApp opt-out belongs in the
    // thread the candidate is already reading.
    return "Reply STOP if you'd rather not receive these messages.";
  }

  return unsubscribeUrl
    ? `If you'd rather not receive these updates, you can unsubscribe here: ${unsubscribeUrl}`
    : "If you'd rather not receive these updates, reply to this email and we'll remove you.";
}

/** Appends the footer, separated so it reads as a footer and not as a sentence. */
export function withOptOutFooter({
  body,
  channel,
  unsubscribeUrl,
}: {
  body: string;
  channel: SendChannel;
  unsubscribeUrl: string | null;
}): string {
  const footer = optOutFooter({ channel, unsubscribeUrl });
  return `${body.trimEnd()}\n\n—\n${footer}`;
}

/**
 * The full unsubscribe URL, or null when it cannot be signed or has no origin.
 *
 * `origin` is threaded from the request that caused the send, the same way
 * `webhookUrl` is threaded to the automation engine. A scheduled send has no
 * request, so APP_URL covers it; with neither, the footer degrades rather than
 * emitting a relative link an email client cannot follow.
 */
export async function buildUnsubscribeUrl({
  candidateId,
  channel,
  origin,
}: {
  candidateId: string;
  channel: SendChannel;
  origin?: string | null;
}): Promise<string | null> {
  if (channel === "whatsapp") return null;

  const base = (origin ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;

  const token = await createOptOutToken({ candidateId, channel });
  if (!token) return null;

  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}
