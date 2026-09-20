import { NextResponse, type NextRequest } from "next/server";
import {
  findOrganizationByPhoneNumberId,
  parseWebhookPayload,
  verifyWebhookSignature,
  webhookVerifyToken,
} from "@/lib/integrations/whatsapp";
import { applyStatusUpdate, recordInboundMessage } from "@/lib/messaging/inbound";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * Meta's WhatsApp Cloud API webhook — the inbound half of Module 15.
 *
 * THE SECOND UNAUTHENTICATED ENDPOINT IN THIS PRODUCT, and it is held to the
 * standard AGENTS.md sets for adding one. The Bolna webhook is its sibling and
 * the shape is deliberately the same, because a reader who has understood one
 * should not have to re-derive the other:
 *
 *   1. SIGNATURE. Every POST carries X-Hub-Signature-256, an HMAC-SHA256 over
 *      the RAW body using the Meta app secret, compared in constant time. No
 *      secret configured means nothing is accepted at all. An unsigned endpoint
 *      here is not merely a spam risk — it is a way to put words in a
 *      candidate's mouth, and a forged "STOP" would silently switch off a real
 *      candidate's messages.
 *   2. TENANCY COMES FROM OUR RECORD. `phone_number_id` in the payload is used
 *      as a lookup key into organization_integrations — a table only we write —
 *      and organization_id is read off that row. A forged organization id in the
 *      body is not merely ignored; there is nowhere to put one.
 *   3. IT CANNOT REACH OUTSIDE MESSAGING. It writes message_log,
 *      whatsapp_conversations and an opt-out flag. It cannot create a candidate,
 *      move a stage, or start an automation.
 *
 * WHY THE BODY IS PARSED BEFORE THE SIGNATURE IS CHECKED.
 *
 * The secret may belong to the organization rather than the deployment (see
 * WhatsAppCredentials), and the only thing identifying the organization is
 * `phone_number_id` inside the body. So the body is parsed — JSON.parse and
 * field reads, nothing more — purely to discover which secret to verify against.
 * NOTHING IS WRITTEN, READ FROM A CANDIDATE TABLE, OR ACTED ON until
 * verifyWebhookSignature() has returned true. The only thing an unsigned request
 * can cause is one indexed SELECT against our own integrations table.
 *
 * WHY ALMOST EVERYTHING RETURNS 200.
 *
 * Meta retries any non-2xx with backoff and eventually disables the webhook for
 * the app — which would take every tenant's inbox down, not just the one that
 * sent a malformed event. So an event we cannot use is acknowledged and logged;
 * only a failure a retry could genuinely fix (a database write that did not
 * land) returns 500. A rejected SIGNATURE is the exception: it gets 401, because
 * it is not a delivery problem and Meta will never send that request again.
 */

// One batch of writes per event. Meta's own timeout is short; ours is shorter
// than the platform default so a slow database surfaces as a retry rather than a
// hung function.
export const maxDuration = 30;

/**
 * GET — Meta's verification handshake.
 *
 * Meta calls this once, when the callback URL is saved in the App Dashboard, and
 * again whenever it is re-verified. Echo back `hub.challenge` as PLAIN TEXT (not
 * JSON, not quoted — Meta compares the raw body) if and only if
 * `hub.verify_token` matches.
 *
 * The verify token is deployment-wide rather than per organization because the
 * handshake carries nothing to resolve a tenant from — see webhookVerifyToken().
 * It proves nothing about later events, which is why every POST is signed and
 * checked independently.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = webhookVerifyToken();
  if (!expected) {
    console.error("[whatsapp webhook] WHATSAPP_VERIFY_TOKEN is not set; refusing the handshake.");
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  if (mode !== "subscribe" || !token || !challenge || !constantTimeEquals(token, expected)) {
    // Deliberately vague and identical for every reason, so the endpoint cannot
    // be used to test guesses at the token.
    return NextResponse.json({ error: "Verification failed." }, { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/** POST — message and status delivery. */
export async function POST(request: NextRequest) {
  // Raw bytes. The signature covers exactly what Meta sent, so re-serialising a
  // parsed object would change the whitespace and key order and fail every
  // legitimate event.
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { entries, unsupportedMessages } = parseWebhookPayload(payload);

  if (unsupportedMessages > 0) {
    // Said out loud rather than dropped in silence. An image or a location
    // cannot be rendered in this inbox, and a recruiter whose candidate sent a
    // photo of their degree certificate needs somebody to be able to explain why
    // the thread shows nothing.
    console.warn(
      `[whatsapp webhook] ${unsupportedMessages} non-text message(s) received and not stored.`
    );
  }

  if (entries.length === 0) {
    // Account updates, template status changes, quality ratings — all arrive
    // here and none of them belongs in a candidate's thread.
    return NextResponse.json({ received: true, handled: 0 });
  }

  let handled = 0;
  let duplicates = 0;
  let retryable = false;

  for (const entry of entries) {
    const tenant = await findOrganizationByPhoneNumberId(entry.phoneNumberId);

    if (!tenant) {
      // A number we do not have connected. 200, because retrying will not make
      // us know it, and because saying "unknown number" back to an unverified
      // caller would confirm which numbers this deployment serves.
      continue;
    }

    const signed = await verifyWebhookSignature({
      organizationId: tenant.organizationId,
      rawBody,
      header: request.headers.get("x-hub-signature-256"),
    });

    if (!signed) {
      // 401 and STOP — not "skip this entry and carry on". A body carrying a
      // valid entry and a forged one is a body we cannot trust at all.
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }

    // ---- Verified. Only now does anything get written. ---------------------

    for (const message of entry.messages) {
      try {
        const outcome = await recordInboundMessage({
          organizationId: tenant.organizationId,
          message,
        });

        if (outcome.handled) {
          handled += 1;
          if (outcome.duplicate) duplicates += 1;
        } else {
          // Only a write that did not land is worth a redelivery. A sender
          // number we cannot store never will be.
          retryable ||= outcome.reason !== "unusable_sender_number";
          console.error(`[whatsapp webhook] message not recorded: ${outcome.reason}`);
        }
      } catch (error) {
        // recordInboundMessage() is written not to throw; this is the guard that
        // makes that a guarantee rather than an intention. One bad message must
        // not cost the other four in the batch.
        console.error(`[whatsapp webhook] message handler threw: ${formatDbError(error)}`);
        retryable = true;
      }
    }

    for (const update of entry.statuses) {
      try {
        const outcome = await applyStatusUpdate({
          organizationId: tenant.organizationId,
          update,
        });
        if (outcome === "failed") retryable = true;
      } catch (error) {
        console.error(`[whatsapp webhook] status handler threw: ${formatDbError(error)}`);
        retryable = true;
      }
    }
  }

  if (retryable) {
    // 500 so Meta redelivers. Safe to invite: inbound inserts are deduped on
    // Meta's message id by a unique index, and status updates only ever move a
    // message forward, so a replay of this whole batch changes nothing that
    // already succeeded.
    return NextResponse.json({ error: "Could not record every event." }, { status: 500 });
  }

  return NextResponse.json({ received: true, handled, duplicates });
}

/** Constant time, so the handshake cannot be used to guess the token. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
