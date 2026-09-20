// =============================================================================
// What happens to a WhatsApp event once it has been verified.
//
// Called only from app/api/webhooks/whatsapp/route.ts, and separated from it for
// the reason AGENTS.md gives: the route decides whether to trust the request,
// this file decides what the request means. Keeping the decision and the
// executor apart is what lets the parsing and the matching be tested without a
// signature, a network or a Meta account.
//
// SERVICE-ROLE THROUGHOUT, BECAUSE THERE IS NO SESSION — a candidate texting a
// business has no login. That means RLS is not behind these queries, so EVERY
// one of them filters organization_id explicitly, and that id always comes from
// findOrganizationByPhoneNumberId() reading OUR integration row. Nothing here
// reads a tenant from the payload.
//
// NOTHING HERE THROWS. Meta retries any non-2xx, so an exception on one message
// in a batch of five would redeliver all five and duplicate the other four. Each
// message is handled independently and failures are returned, not raised.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { maskRecipient } from "@/lib/communications/send";
import { isOptOutReply, previewOf } from "@/lib/messaging/conversations";
import { bumpThread, findOrOpenThread } from "@/lib/messaging/thread";
import type { InboundStatusUpdate, InboundTextMessage } from "@/lib/integrations/whatsapp";
import { formatDbError } from "@/lib/supabase/errors";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

export type InboundOutcome =
  | {
      handled: true;
      conversationId: string;
      duplicate: boolean;
      optedOut: boolean;
      /** 0042 — the row just written, so the auto-reply agent can be queued
       *  against it. Null for a duplicate, which is already queued. */
      messageId: string | null;
      /** Null for an unmatched sender. The agent refuses to answer those. */
      candidateId: string | null;
      /** The text, so the caller need not re-read it to queue a reply. */
      body: string;
    }
  | { handled: false; reason: string };

/**
 * Records one inbound text message.
 *
 * The order matters and is not the obvious one:
 *
 *   1. Dedupe first, so a redelivery costs one indexed SELECT and nothing else.
 *   2. Find or open the conversation, because the message row needs its id.
 *   3. Insert the message — the row whose absence would lose the candidate's
 *      words. Everything after this point is bookkeeping that can be repaired;
 *      this cannot.
 *   4. Bump the thread, honour an opt-out.
 *
 * A failure at 4 still returns handled, because the message IS recorded and a
 * retry would insert it twice (the unique index would refuse, which is the
 * belt to this braces, but a 500 that Meta retries forever is not a good way to
 * discover that).
 */
export async function recordInboundMessage({
  organizationId,
  message,
}: {
  organizationId: string;
  message: InboundTextMessage;
}): Promise<InboundOutcome> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("[whatsapp webhook] service-role client unavailable.");
    return { handled: false, reason: "no_admin_client" };
  }

  if (!/^\d{7,15}$/.test(message.from)) {
    // Not an error worth retrying: a sender we cannot store is a sender we
    // cannot reply to either.
    return { handled: false, reason: "unusable_sender_number" };
  }

  // --- 1. Idempotency -------------------------------------------------------
  const { data: existing, error: existingError } = await admin
    .from("message_log")
    .select("id, conversation_id")
    .eq("organization_id", organizationId)
    .eq("direction", "inbound")
    .eq("provider_message_id", message.providerMessageId)
    .maybeSingle();

  if (existingError) {
    console.error(`[whatsapp webhook] dedupe check failed: ${formatDbError(existingError)}`);
    // Retryable: pretending this is new would duplicate the message, and the
    // unique index would then reject the insert anyway.
    return { handled: false, reason: "dedupe_check_failed" };
  }

  if (existing) {
    const row = existing as { id: string; conversation_id: string | null };
    return {
      handled: true,
      conversationId: row.conversation_id ?? "",
      duplicate: true,
      optedOut: false,
      // Null on purpose: a redelivery must not queue a second auto-reply. The
      // queue's unique index would refuse it anyway; this makes the intent
      // visible rather than relying on the constraint to express it.
      messageId: null,
      candidateId: null,
      body: message.body,
    };
  }

  // --- 2. The conversation --------------------------------------------------
  const conversation = await findOrOpenConversation({
    admin,
    organizationId,
    phoneNumber: message.from,
  });

  if (!conversation) return { handled: false, reason: "conversation_write_failed" };

  // --- 3. The message -------------------------------------------------------
  const { data: inserted, error: insertError } = await admin.from("message_log").insert({
    organization_id: organizationId,
    conversation_id: conversation.id,
    candidate_id: conversation.candidateId,
    // Null on purpose. An inbound message is a reply to a PERSON, not to an
    // application; a candidate with three live applications sent one message,
    // and filing it under one of the three would be a guess presented as a fact.
    // The thread hangs off the candidate, which is where a recruiter looks.
    application_id: null,
    channel: "whatsapp",
    direction: "inbound",
    subject: null,
    // `body_sent` is the outbound column's name, reused rather than duplicated.
    // For an inbound row it is "the body of the message", which is what every
    // reader of this table already assumes it means.
    body_sent: message.body,
    status: "received",
    provider_message_id: message.providerMessageId,
    // The counterparty's number, masked, exactly as an outbound row masks the
    // recipient. The full number is on the conversation; repeating it on every
    // row would spread it across a table read by anyone who can see the org.
    recipient_hint: maskRecipient(message.from, "whatsapp"),
    // NULL is the schema's "not a person on our side" — the same value an
    // automatic send uses. There is no user to credit for a message we received.
    sent_by: null,
    sent_at: message.sentAt,
  })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error(`[whatsapp webhook] inbound insert failed: ${formatDbError(insertError)}`);
    return { handled: false, reason: "message_insert_failed" };
  }

  // --- 4. Bookkeeping -------------------------------------------------------
  //
  // Logged inside bumpThread(), never reported upward. The message is safely
  // recorded by this point; a stale preview or an unread badge one short is
  // worth far less than a redelivery that would try to insert it again.
  await bumpThread({
    client: admin,
    conversationId: conversation.id,
    organizationId,
    preview: previewOf(message.body),
    messageAt: message.sentAt,
    inbound: true,
  });

  const optedOut = isOptOutReply(message.body)
    ? await honourOptOut({ admin, organizationId, candidateId: conversation.candidateId })
    : false;

  return {
    handled: true,
    conversationId: conversation.id,
    duplicate: false,
    optedOut,
    messageId: (inserted as { id: string }).id,
    candidateId: conversation.candidateId,
    body: message.body,
  };
}

/**
 * The thread for this inbound message, with the candidate resolved if we can.
 *
 * The find-or-open half is lib/messaging/thread.ts, shared with the send
 * pipeline. What is specific to inbound — and stays here — is that the sender is
 * a phone number rather than a candidate we already know, so it has to be
 * matched.
 *
 * NEVER CREATES A CANDIDATE. An unmatched number stays unmatched and a human
 * links it: a candidate record conjured from a bare phone number has no name, no
 * source and no consent trail, and it would sit in the pipeline looking like
 * somebody had applied.
 */
async function findOrOpenConversation({
  admin,
  organizationId,
  phoneNumber,
}: {
  admin: Admin;
  organizationId: string;
  phoneNumber: string;
}): Promise<{ id: string; candidateId: string | null } | null> {
  const matched = await matchCandidateByPhone({ admin, organizationId, phoneNumber });

  const thread = await findOrOpenThread({
    client: admin,
    organizationId,
    phoneNumber,
    candidateId: matched,
  });

  if (!thread) return null;

  /*
    An EXISTING thread that is still unmatched may be matchable now — the
    candidate could have been added between their first message and this one.
    Re-checked on every message rather than only at creation, because the
    alternative is a thread that stays labelled "Unknown number" forever after
    the recruiter has added the person it belongs to.
  */
  if (thread.candidateId === null && matched !== null) {
    const { error } = await admin
      .from("whatsapp_conversations")
      .update({ candidate_id: matched })
      .eq("id", thread.id)
      .eq("organization_id", organizationId);

    if (!error) {
      /*
        A STOP sent while we did not know who this was.

        It could not be recorded at the time — the preferences table is keyed by
        candidate and there was none — so it is applied at the moment the
        identity becomes known. The PATCH route does the same thing when a human
        links a thread; both paths exist because a thread can be linked either
        way, and an opt-out that only survives one of them is an opt-out that
        gets lost.
      */
      await applyDeferredOptOut({ admin, organizationId, conversationId: thread.id, candidateId: matched });
      return { id: thread.id, candidateId: matched };
    }
    console.error(`[whatsapp webhook] late candidate link failed: ${formatDbError(error)}`);
  }

  return thread;
}

/** Re-reads a thread for a stop request that predates knowing who sent it. */
async function applyDeferredOptOut({
  admin,
  organizationId,
  conversationId,
  candidateId,
}: {
  admin: Admin;
  organizationId: string;
  conversationId: string;
  candidateId: string;
}): Promise<void> {
  const { data, error } = await admin
    .from("message_log")
    .select("body_sent")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return;

  if ((data as { body_sent: string }[]).some((row) => isOptOutReply(row.body_sent))) {
    await honourOptOut({ admin, organizationId, candidateId });
  }
}

/**
 * The candidate this number belongs to, or null.
 *
 * REUSES candidates.phone_normalized — migration 0003's dedup column, which is
 * already "the last 10 digits" maintained by a trigger and already indexed per
 * organization. Writing a second normalisation here would mean two definitions
 * of "the same phone number" in one codebase, and they would disagree the first
 * time somebody changed one.
 *
 * AMBIGUITY IS NOT A MATCH. Two candidates sharing a number (a shared family
 * phone, a duplicate record nobody has merged) returns null, so the thread stays
 * unmatched and a human picks. Guessing would file a real conversation under the
 * wrong person's history, which is worse than showing "Unknown number".
 */
async function matchCandidateByPhone({
  admin,
  organizationId,
  phoneNumber,
}: {
  admin: Admin;
  organizationId: string;
  phoneNumber: string;
}): Promise<string | null> {
  const normalized = phoneNumber.length >= 10 ? phoneNumber.slice(-10) : phoneNumber;

  const { data, error } = await admin
    .from("candidates")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_normalized", normalized)
    // Two is all we need to know it is ambiguous.
    .limit(2);

  if (error) {
    console.error(`[whatsapp webhook] candidate match failed: ${formatDbError(error)}`);
    return null;
  }

  const rows = (data ?? []) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Records a STOP reply as an opt-out.
 *
 * THE GAP THIS CLOSES: until now the only way a "STOP" took effect was a human
 * reading it and pressing a button. Meta's guidance is that a business honours
 * an opt-out request made in the thread, and an instruction we print on every
 * automatic message ("Reply STOP if you'd rather not receive these messages")
 * that nothing acts on is worse than no instruction at all.
 *
 * An UNMATCHED sender cannot be recorded — the preferences table is keyed by
 * candidate and there is no candidate. That is not a hole: nothing can message an
 * unmatched number either, because every send path starts from a candidate. When
 * a human later links the thread, the link route re-reads the thread for a STOP
 * and applies it then.
 */
async function honourOptOut({
  admin,
  organizationId,
  candidateId,
}: {
  admin: Admin;
  organizationId: string;
  candidateId: string | null;
}): Promise<boolean> {
  if (!candidateId) return false;

  const { error } = await admin.from("candidate_communication_preferences").upsert(
    {
      organization_id: organizationId,
      candidate_id: candidateId,
      whatsapp_opted_out: true,
      opted_out_at: new Date().toISOString(),
      opted_out_reason: "Replied STOP on WhatsApp.",
    },
    // organization_id is in the key because the table's primary key is
    // (organization_id, candidate_id) — naming only candidate_id here would
    // upsert across tenants on a shared candidate id.
    { onConflict: "organization_id,candidate_id" }
  );

  if (error) {
    console.error(`[whatsapp webhook] opt-out write failed: ${formatDbError(error)}`);
    return false;
  }

  return true;
}

// -----------------------------------------------------------------------------
// Delivery and read receipts
// -----------------------------------------------------------------------------

/**
 * How far a message has got, as a number, so a status can only ever move
 * forward.
 *
 * META'S STATUSES ARRIVE OUT OF ORDER. `read` overtaking `delivered` is routine
 * on a phone that was offline, and applying them in arrival order would show a
 * message as merely Delivered after the candidate had already read it. Ranking
 * them makes the update idempotent and order-independent, which also means a
 * redelivered callback is harmless.
 *
 * `failed` sits above the rest because it is terminal and the reason a recruiter
 * needs to see: a message that failed after being accepted is the case where the
 * product would otherwise claim it was sent.
 */
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  skipped: 0,
  received: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  bounced: 4,
  failed: 4,
};

/** Meta's vocabulary → ours. `read` is this schema's `opened`. */
const META_STATUS: Record<InboundStatusUpdate["status"], string> = {
  sent: "sent",
  delivered: "delivered",
  read: "opened",
  failed: "failed",
};

export type StatusOutcome = "updated" | "ignored" | "unmatched" | "failed";

/**
 * Applies one delivery/read receipt to the outbound row it refers to.
 *
 * This is what finally makes `delivered` and `opened` mean something on
 * WhatsApp. Migration 0035 documented `opened` as "email only; WhatsApp gives us
 * no read signal we trust" — accurate while nothing was listening for Meta's
 * status callbacks, and no longer true now that this consumes them.
 */
export async function applyStatusUpdate({
  organizationId,
  update,
}: {
  organizationId: string;
  update: InboundStatusUpdate;
}): Promise<StatusOutcome> {
  const admin = createAdminClient();
  if (!admin) return "failed";

  const next = META_STATUS[update.status];

  const { data, error } = await admin
    .from("message_log")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("direction", "outbound")
    .eq("provider_message_id", update.providerMessageId)
    .maybeSingle();

  if (error) {
    console.error(`[whatsapp webhook] status lookup failed: ${formatDbError(error)}`);
    return "failed";
  }

  // A status for a message we have no record of. Normal rather than alarming:
  // Meta reports on everything sent from that number, including messages sent
  // from the WhatsApp Business app on somebody's phone.
  if (!data) return "unmatched";

  const row = data as { id: string; status: string };
  if ((STATUS_RANK[next] ?? 0) <= (STATUS_RANK[row.status] ?? 0)) return "ignored";

  const { error: updateError } = await admin
    .from("message_log")
    .update({ status: next })
    .eq("id", row.id)
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error(`[whatsapp webhook] status update failed: ${formatDbError(updateError)}`);
    return "failed";
  }

  return "updated";
}
