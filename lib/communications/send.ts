// =============================================================================
// The candidate send pipeline.
//
// Everything that messages a candidate goes through sendOnChannel() — the
// automatic pipeline-event sends, the manual compose screen, and Module 13's
// "Send templated message" action. One path, so the log is complete and the
// opt-out rule is enforced in exactly one place.
//
// FIVE GUARANTEES, IN THE ORDER THE CODE ENFORCES THEM.
//
// 1. NEVER THROWS. Same contract as notify() and logActivity(). A stage change
//    must not fail because an email provider is down, and a recruiter must not
//    lose a note because WhatsApp rate-limited us.
//
// 2. EMAIL AND WHATSAPP ARE INDEPENDENT. A `both` template that fails on
//    WhatsApp still sends the email, and each channel gets its own log row. The
//    spec's test — "WhatsApp being disconnected doesn't block email-only sends"
//    — is this, plus the fact that nothing in this file reads the WhatsApp
//    integration unless a WhatsApp send was actually asked for.
//
// 3. OPT-OUTS BIND AUTOMATIC SENDS ABSOLUTELY, AND HUMANS NEVER SILENTLY.
//    An automatic send to an opted-out channel is refused here, in the pipeline,
//    not in a caller that might forget. A MANUAL send is allowed through with an
//    explicit `overrideOptOut` flag — the API demands the flag and the UI demands
//    a confirmation before setting it. "Never silently block a human-initiated
//    message, but do warn them first" is the spec's wording; the flag is what
//    makes the warning unskippable rather than decorative.
//
// 4. THE LOG RECORDS THE RESOLVED TEXT, AFTER THE FOOTER IS ATTACHED.
//    body_sent is byte-for-byte what the provider was given. A log that stored
//    the pre-footer body would be a log of what we meant to send.
//
// 5. A LOG WRITE FAILURE IS REPORTED, NEVER SWALLOWED.
//    If the message went out and the row did not, the caller is told. Silently
//    losing the record of a message that reached a real person is the worst
//    outcome available here — worse than not sending it.
//
// 6. EVERY WHATSAPP MESSAGE JOINS THE CANDIDATE'S THREAD (0041).
//    Outbound rows carry conversation_id so /messages shows one timeline rather
//    than only the half a candidate wrote. Attached HERE, in the one place every
//    send passes through, so an automatic template, a manual compose and an
//    inbox reply all land in the same thread without any of them knowing the
//    inbox exists. Thread bookkeeping never affects the send: a thread that
//    could not be opened produces a log row with a null conversation_id, which
//    is exactly what every email row already looks like.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/email";
import { normalizeWhatsAppNumber, sendWhatsApp } from "@/lib/integrations/whatsapp";
import { bumpThread, findOrOpenThread } from "@/lib/messaging/thread";
import { previewOf } from "@/lib/messaging/conversations";
import { buildUnsubscribeUrl, withOptOutFooter } from "@/lib/communications/optout";
import type { SendChannel } from "@/lib/communications/templates";
import type { CommunicationEventKey } from "@/lib/communications/events";
import { formatDbError } from "@/lib/supabase/errors";

/** Either Supabase client, as the automation engine defines it. */
export type CommsClient =
  | NonNullable<ReturnType<typeof createAdminClient>>
  | Awaited<ReturnType<typeof createClient>>;

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "failed"
  | "bounced"
  | "skipped";

export type OptOutState = {
  emailOptedOut: boolean;
  whatsappOptedOut: boolean;
  /** True when the read failed. See loadOptOut() for why this matters. */
  unknown: boolean;
};

export const NO_OPT_OUT: OptOutState = {
  emailOptedOut: false,
  whatsappOptedOut: false,
  unknown: false,
};

/**
 * Reads a candidate's opt-out state.
 *
 * A FAILED READ IS `unknown`, NOT "not opted out".
 *
 * The distinction decides the direction we fail in: an automatic send treats
 * unknown as opted out and stays silent, because emailing somebody who asked us
 * not to is a complaint and possibly a fine, while a delayed pipeline update is
 * recoverable. A manual send treats unknown as "warn the recruiter", because a
 * human being told "we couldn't check" can decide for themselves.
 */
export async function loadOptOut({
  client,
  organizationId,
  candidateId,
}: {
  client: CommsClient;
  organizationId: string;
  candidateId: string;
}): Promise<OptOutState> {
  const { data, error } = await client
    .from("candidate_communication_preferences")
    .select("email_opted_out, whatsapp_opted_out")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (error) {
    console.error(`[comms] opt-out read failed: ${formatDbError(error)}`);
    return { emailOptedOut: false, whatsappOptedOut: false, unknown: true };
  }

  // No row means nobody has ever opted out. That is the common case and it is
  // not an error — the row is created the first time somebody opts out.
  if (!data) return NO_OPT_OUT;

  const row = data as { email_opted_out: boolean; whatsapp_opted_out: boolean };
  return {
    emailOptedOut: row.email_opted_out === true,
    whatsappOptedOut: row.whatsapp_opted_out === true,
    unknown: false,
  };
}

export function optedOutOf(state: OptOutState, channel: SendChannel): boolean {
  return channel === "email" ? state.emailOptedOut : state.whatsappOptedOut;
}

/** Masks a recipient for the log — never the full address or number. */
export function maskRecipient(value: string, channel: SendChannel): string {
  const trimmed = value.trim();

  if (channel === "email") {
    const [local, domain] = trimmed.split("@");
    if (!domain) return "•••";
    return `${local.slice(0, 2)}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }

  // Last four digits only. Enough for a recruiter to recognise the number they
  // have in front of them, not enough to be a phone book.
  const digits = trimmed.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export type SendTarget = {
  organizationId: string;
  candidateId: string;
  /** Null only if this product ever grows a candidate-level compose screen. */
  applicationId: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  /** For normalising a local phone number. The organization's country. */
  countryCode?: string | null;
};

export type SendOnChannelInput = {
  client: CommsClient;
  target: SendTarget;
  channel: SendChannel;
  /** Null for WhatsApp. Required for email — validated by the caller. */
  subject: string | null;
  /** Fully resolved. No placeholders left that we know how to resolve. */
  body: string;
  templateId: string | null;
  eventKey: CommunicationEventKey | null;
  /**
   * The sender. NULL MEANS AUTOMATIC, and that is not just a display detail:
   * automatic sends respect opt-outs absolutely and carry the opt-out footer,
   * manual ones can be overridden and do not.
   */
  sentBy: string | null;
  /** Only meaningful for a manual send. Requires an explicit confirmation. */
  overrideOptOut?: boolean;
  /** Request origin, for the unsubscribe link. See lib/communications/optout.ts. */
  origin?: string | null;
  /** Pre-read state, so a `both` send checks once rather than twice. */
  optOut?: OptOutState;
  /**
   * MODULE 25 — send this to a COLLEAGUE instead of the candidate.
   *
   * Set, three things change and nothing else does:
   *
   *   1. The address is this person's, not the candidate's.
   *   2. The candidate opt-out is not consulted. It is a statement about contact
   *      directed at the CANDIDATE; letting it gate a recruiter's own alerts
   *      would mean an applicant could silently switch off their recruiter's
   *      notifications by unsubscribing.
   *   3. No unsubscribe footer. On internal mail it is meaningless, and a
   *      colleague who clicked it would opt the candidate out of everything.
   *
   * What deliberately does NOT change is the RENDERED BODY. An internal message
   * is about a candidate and resolves candidate placeholders exactly as a
   * candidate-facing one does — "{{candidate.name}} just passed with
   * {{application.match_score}}" is the whole point of the feature.
   *
   * The row still records `target.candidateId`, so the message appears on that
   * candidate's communication history where it belongs — it IS part of the story
   * of this application — labelled by `internal_recipient_*`.
   */
  internalRecipient?: {
    email: string;
    name: string | null;
    /** users.id, for the log. Null would mean "we could not say who". */
    userId: string | null;
  } | null;
};

export type SendOutcome = {
  channel: SendChannel;
  status: MessageStatus;
  /** Human-readable and safe to surface. */
  detail: string | null;
  logId: string | null;
  /** True when the message reached the provider. */
  delivered: boolean;
};

/**
 * Sends one message on one channel and records it.
 *
 * Returns what happened rather than throwing, so a caller can say "the email
 * went, WhatsApp isn't connected" — which is true and useful, unlike a bare
 * success or a bare failure.
 */
export async function sendOnChannel(input: SendOnChannelInput): Promise<SendOutcome> {
  const { client, target, channel, templateId, eventKey, sentBy } = input;
  const automatic = sentBy === null;
  const internal = input.internalRecipient ?? null;

  /**
   * WhatsApp to a colleague is refused rather than attempted.
   *
   * `users` has no phone column, so there is no number to send to. Falling back
   * to the CANDIDATE's number — the only one in scope — would deliver an
   * internal message about a candidate to that candidate. Skipping loudly is the
   * only safe direction here.
   */
  if (internal && channel === "whatsapp") {
    const reason =
      "Not sent — internal notifications go by email only; we hold no phone number for colleagues.";
    const logId = await recordMessage({
      client,
      target,
      channel,
      templateId,
      eventKey,
      subject: input.subject,
      bodySent: input.body,
      status: "skipped",
      errorMessage: reason,
      recipientHint: null,
      providerMessageId: null,
      sentBy,
      internalRecipientUserId: internal.userId,
    });
    return { channel, status: "skipped", detail: reason, logId, delivered: false };
  }

  try {
    // Not consulted at all for an internal send — see `internalRecipient`.
    const optOut =
      internal !== null
        ? NO_OPT_OUT
        : (input.optOut ??
          (await loadOptOut({
            client,
            organizationId: target.organizationId,
            candidateId: target.candidateId,
          })));

    // --- The opt-out gate ---------------------------------------------------
    //
    // An automatic send also treats an UNREADABLE opt-out as an opt-out. A manual
    // one does not: the route surfaces "we couldn't check" to the recruiter, who
    // can decide. See loadOptOut() for why the two directions differ.
    const isOptedOut = optedOutOf(optOut, channel) || (automatic && optOut.unknown);

    /**
     * `overrideOptOut` IS ONLY HONOURED FOR A MANUAL SEND — note the `!automatic`.
     *
     * An automation carrying the flag would be a rule that messages people who
     * asked it not to, which is the one thing an opt-out has to be able to stop.
     * A human overriding it is a person taking responsibility, and the API demands
     * an explicit acknowledgement before it ever reaches here.
     */
    if (isOptedOut && !(!automatic && input.overrideOptOut === true)) {
      const reason = optOut.unknown
        ? "Not sent — we couldn't check this candidate's opt-out status, so nothing was sent automatically."
        : channel === "email"
          ? "Not sent — this candidate has opted out of email."
          : "Not sent — this candidate has opted out of WhatsApp.";

      // Recorded, not silent. "We never told them" is a fact the pipeline needs;
      // a missing row would read as "nobody thought to".
      const logId = await recordMessage({
        client,
        target,
        channel,
        templateId,
        eventKey,
        subject: input.subject,
        // The resolved text that WOULD have gone, without the footer — nothing
        // was sent, so there is no footer to record. Stored rather than left
        // blank because "we decided not to say this" is more useful to whoever
        // reads the log than an empty row, and the column cannot be null.
        bodySent: input.body,
        status: "skipped",
        errorMessage: reason,
        recipientHint: null,
        providerMessageId: null,
        sentBy,
        internalRecipientUserId: internal?.userId ?? null,
      });

      return { channel, status: "skipped", detail: reason, logId, delivered: false };
    }

    // --- The recipient ------------------------------------------------------
    const recipient = internal
      ? internal.email.trim()
      : channel === "email"
        ? target.candidateEmail?.trim()
        : target.candidatePhone?.trim();

    if (!recipient) {
      const reason = internal
        ? "Not sent — that colleague has no email address on file."
        : channel === "email"
          ? "Not sent — this candidate has no email address on file."
          : "Not sent — this candidate has no phone number on file.";

      const logId = await recordMessage({
        client,
        target,
        channel,
        templateId,
        eventKey,
        subject: input.subject,
        bodySent: input.body,
        status: "skipped",
        errorMessage: reason,
        recipientHint: null,
        providerMessageId: null,
        sentBy,
        internalRecipientUserId: internal?.userId ?? null,
      });

      return { channel, status: "skipped", detail: reason, logId, delivered: false };
    }

    // --- The footer ---------------------------------------------------------
    // Automatic only, and appended AFTER rendering, so no template can drop it.
    // NEVER on an internal send: the unsubscribe link belongs to the candidate,
    // and a colleague clicking it would opt that candidate out of everything.
    let body = input.body;
    if (automatic && !internal) {
      const unsubscribeUrl = await buildUnsubscribeUrl({
        candidateId: target.candidateId,
        channel,
        origin: input.origin,
      });
      body = withOptOutFooter({ body: input.body, channel, unsubscribeUrl });
    }

    /*
      --- The thread (0041) --------------------------------------------------

      Resolved BEFORE the send so the log row can carry it, and only for a
      WhatsApp message actually being attempted.

      NOT for a skipped one. The earlier returns above — opted out, no number on
      file — record their rows with no conversation_id on purpose: the inbox is
      a record of what passed between us and a person, and "we decided not to
      say this" is not something they can see in their chat. Those rows still
      appear in the communication log, which is where that question is asked.

      Not for an internal send either: sendOnChannel already refuses WhatsApp to
      a colleague, so this only ever runs for the candidate's own number.
    */
    const conversationId =
      channel === "whatsapp"
        ? await resolveThread({
            client,
            organizationId: target.organizationId,
            candidateId: target.candidateId,
            phone: recipient,
            countryCode: target.countryCode ?? null,
          })
        : null;

    // --- The provider -------------------------------------------------------
    const result =
      channel === "email"
        ? await sendEmail({
            organizationId: target.organizationId,
            to: recipient,
            subject: input.subject ?? "",
            body,
          })
        : await sendWhatsApp({
            organizationId: target.organizationId,
            to: recipient,
            body,
            defaultCountryCode: target.countryCode ?? null,
          });

    const status: MessageStatus = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
    const detail = result.ok ? null : result.skipped ? result.reason : result.error;

    const logId = await recordMessage({
      client,
      target,
      channel,
      templateId,
      eventKey,
      subject: input.subject,
      // The body the provider was actually given, footer included.
      bodySent: body,
      status,
      errorMessage: detail,
      recipientHint: maskRecipient(recipient, channel),
      providerMessageId: result.ok ? result.providerMessageId : null,
      sentBy,
      internalRecipientUserId: internal?.userId ?? null,
      conversationId,
    });

    /*
      The thread moves to the top of the inbox only if the message actually
      left. A failed send is in the log with its reason; putting it at the top
      of a recruiter's inbox as the latest thing said to this candidate would be
      a preview of words they never received.

      unread_count is untouched — `inbound: false`. Our own outgoing message is
      not something the team needs to be told about.
    */
    if (conversationId && result.ok) {
      await bumpThread({
        client,
        conversationId,
        organizationId: target.organizationId,
        preview: previewOf(body),
        messageAt: new Date().toISOString(),
        inbound: false,
      });
    }

    return {
      channel,
      status,
      // A successful send that we failed to record is reported as such: the
      // recruiter needs to know the candidate has the message even though the
      // log does not show it, or they will send it again.
      detail:
        result.ok && logId === null
          ? "The message was sent, but it could not be recorded in the communication log."
          : detail,
      logId,
      delivered: result.ok,
    };
  } catch (error) {
    console.error(`[comms] send on ${channel} failed: ${formatDbError(error)}`);
    return {
      channel,
      status: "failed",
      detail: "Something went wrong sending that message.",
      logId: null,
      delivered: false,
    };
  }
}

/**
 * Writes the log row. Returns its id, or null when the write failed.
 *
 * Never throws: a lost log row must not unwind a message that has already left.
 */
async function recordMessage({
  client,
  target,
  channel,
  templateId,
  eventKey,
  subject,
  bodySent,
  status,
  errorMessage,
  recipientHint,
  providerMessageId,
  sentBy,
  conversationId,
  internalRecipientUserId,
}: {
  client: CommsClient;
  target: SendTarget;
  channel: SendChannel;
  templateId: string | null;
  eventKey: CommunicationEventKey | null;
  subject: string | null;
  bodySent: string;
  status: MessageStatus;
  errorMessage: string | null;
  recipientHint: string | null;
  providerMessageId: string | null;
  sentBy: string | null;
  /** 0041 — the WhatsApp thread this row belongs to, if any. Null for email. */
  conversationId?: string | null;
  /**
   * MODULE 25 — set when this row is a message to a COLLEAGUE about the
   * candidate, rather than to the candidate.
   *
   * The row still carries candidate_id, because the message is part of that
   * application's story and the communication history is where somebody looks to
   * find out what happened. This column is what stops it being READ as a message
   * the candidate received — without it, "we told them on the 4th" would be a
   * false statement generated by a true row.
   */
  internalRecipientUserId?: string | null;
}): Promise<string | null> {
  const { data, error } = await client
    .from("message_log")
    .insert({
      organization_id: target.organizationId,
      application_id: target.applicationId,
      candidate_id: target.candidateId,
      channel,
      template_id: templateId,
      event_key: eventKey,
      subject: channel === "email" ? subject : null,
      body_sent: bodySent,
      status,
      provider_message_id: providerMessageId,
      error_message: errorMessage,
      recipient_hint: recipientHint,
      conversation_id: conversationId ?? null,
      internal_recipient_user_id: internalRecipientUserId ?? null,
      sent_by: sentBy,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[comms] recording the message failed: ${formatDbError(error)}`);
    return null;
  }

  return (data as { id: string }).id;
}

/**
 * Has this event already been sent for this application?
 *
 * The auto-send guard. Two things make it necessary rather than defensive:
 *
 *   - A stage move can be re-saved. Moving to Rejected, back, and to Rejected
 *     again would otherwise send the same rejection twice.
 *   - Bulk intake creates an application and then Module 13 may move its stage
 *     in the same request.
 *
 * Fails towards SILENCE, like lib/notifications/reminders.ts: if we cannot tell
 * whether a candidate was already told, telling them again is the worse mistake.
 *
 * Deliberately NOT time-bounded for most events — "you were rejected" should be
 * said once, ever, not once a day. `interview_reminder` is the exception and its
 * caller passes a window, because a rescheduled interview genuinely needs a
 * second reminder.
 */
export async function alreadySentForEvent({
  client,
  organizationId,
  applicationId,
  eventKey,
  sinceIso,
}: {
  client: CommsClient;
  organizationId: string;
  applicationId: string;
  eventKey: CommunicationEventKey;
  sinceIso?: string;
}): Promise<boolean> {
  let query = client
    .from("message_log")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .eq("event_key", eventKey)
    // A skipped or failed attempt does not count as having told them: a
    // disconnected integration must not permanently consume the one chance to
    // send this message.
    .in("status", ["queued", "sent", "delivered", "opened"])
    .limit(1);

  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { data, error } = await query;

  if (error) {
    console.error(`[comms] duplicate check failed; suppressing: ${formatDbError(error)}`);
    return true;
  }

  return (data ?? []).length > 0;
}

/**
 * The WhatsApp thread an outbound message belongs to.
 *
 * Normalises the number the SAME WAY the adapter is about to, so the thread is
 * keyed on exactly the digits Meta will be given. Deriving it twice from one
 * function is the point: a thread keyed on the raw "+91 98765 43210" and an
 * inbound message keyed on "919876543210" would open two threads for one
 * conversation, and neither would look wrong on its own.
 *
 * Returns null rather than throwing on any failure — an unparseable number, a
 * denied insert, a database blip. The send then records a row with no thread,
 * which is what every email row already looks like, instead of failing a
 * message to a real person over inbox bookkeeping.
 */
async function resolveThread({
  client,
  organizationId,
  candidateId,
  phone,
  countryCode,
}: {
  client: CommsClient;
  organizationId: string;
  candidateId: string;
  phone: string;
  countryCode: string | null;
}): Promise<string | null> {
  try {
    const number = normalizeWhatsAppNumber(phone, countryCode);
    if (!number) return null;

    const thread = await findOrOpenThread({
      client,
      organizationId,
      phoneNumber: number,
      candidateId,
    });

    return thread?.id ?? null;
  } catch (error) {
    console.error(`[comms] resolving the WhatsApp thread failed: ${formatDbError(error)}`);
    return null;
  }
}
