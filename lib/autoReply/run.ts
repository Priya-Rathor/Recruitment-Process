// =============================================================================
// The auto-reply agent's executor.
//
// The decision is in lib/autoReply/config.ts (precedence) and
// lib/autoReply/escalation.ts (refusal); the drafting is in
// lib/ai/generateAutoReply.ts. This file only does what it is told — the
// decision/executor split AGENTS.md asks for, and the reason the irreversible
// parts are pure functions with tests.
//
// SIX GATES, IN THE ORDER THEY RUN. Every one of them can only ever stop a
// message, never cause one:
//
//   1. THE MASTER SWITCH. Read before anything else, because it is what a
//      recruiter presses when the agent has just said something wrong.
//   2. A CANDIDATE. An unmatched number is never answered: everything the agent
//      would say is grounded in a person's record, and we do not know whose.
//   3. THE HUMAN COOLDOWN. If a colleague replied in the last 30 minutes, the
//      agent stays out of it. Two of them answering the same person is worse
//      than neither.
//   4. CONFIG PRECEDENCE. The job's override, else the organization default;
//      either being off means no reply.
//   5. THE DETERMINISTIC ESCALATION GUARD. Runs BEFORE the model is called, so a
//      salary question never reaches it at all.
//   6. THE MODEL, AND ITS OWN REFUSAL. Any failure, any rejected draft, any
//      "holding" disposition — all land in the same place: the fixed holding
//      message and a flag for a human.
//
// THE FALLBACK IS THE FEATURE, NOT THE ERROR PATH. Every route out of this file
// other than a validated, grounded answer sends the holding message and flags
// the thread. That is why there is no `catch` that silently returns: a candidate
// who wrote in and got nothing is the failure this design exists to prevent,
// and it is also the one nobody would notice.
//
// ONE SEND PATH. Replies go through sendOnChannel(), exactly like a manual reply
// and a templated send. The opt-out gate, the log row, the masked recipient, the
// thread attachment and Meta's 24-hour window are all inherited rather than
// reimplemented.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOnChannel, type CommsClient } from "@/lib/communications/send";
import { generateAutoReply } from "@/lib/ai/generateAutoReply";
import { isAiConfigured } from "@/lib/ai/provider";
import { loadAutoReplyContext } from "@/lib/autoReply/context";
import {
  resolveAutoReply,
  type AutoReplyConfig,
  type AutoReplyDecision,
} from "@/lib/autoReply/config";
import {
  detectEscalationTopics,
  escalationReasonFrom,
  HOLDING_MESSAGE,
} from "@/lib/autoReply/escalation";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * How long a human reply keeps the agent out of the conversation.
 *
 * The spec's number, and the reason is worth keeping: a recruiter who has just
 * typed a reply is mid-conversation, and an AI answering the candidate's next
 * message would be talking over the colleague who is already handling it.
 *
 * Measured from the human's message rather than from the candidate's, so a
 * recruiter who replies and walks away still owns the next exchange.
 */
export const HUMAN_COOLDOWN_MINUTES = 30;

export type AutoReplyOutcome =
  /** A grounded answer reached the provider. */
  | { status: "sent"; messageId: string | null; source: "job" | "organization" }
  /** The holding message went, and the thread is flagged for a person. */
  | { status: "escalated"; reason: string }
  /** Nothing was sent, and that was correct. */
  | { status: "skipped"; reason: string }
  /** Nothing was sent and something is wrong. The thread is flagged. */
  | { status: "failed"; reason: string };

type OrgContext = {
  masterEnabled: boolean;
  organizationName: string;
  timeZone: string;
};

/**
 * Queues an auto-reply for one inbound message, and reports whether it is due
 * now.
 *
 * Called from the webhook. ALWAYS queues, even for 'immediate' — the row is the
 * idempotency key (unique on inbound_message_id, so Meta redelivering cannot
 * produce a second reply) and the backstop if the inline attempt is cut short by
 * Meta's timeout or a frozen function.
 *
 * Never throws. A failure to queue means a message sits in the inbox for a
 * person, which is the pre-0042 behaviour and a safe place to land.
 */
export async function enqueueAutoReply({
  organizationId,
  conversationId,
  inboundMessageId,
  candidateId,
  inboundText,
}: {
  organizationId: string;
  conversationId: string;
  inboundMessageId: string;
  candidateId: string | null;
  inboundText: string;
}): Promise<{
  queued: boolean;
  dueNow: boolean;
  reason: string | null;
  /**
   * The queue row, when one was created.
   *
   * Returned because the inline 'immediate' path MUST process the real row:
   * processAutoReply() marks the row done by id, and a caller that invented an
   * id would leave the row pending — so the next sweep would send the candidate
   * a second reply to the same question. There is no way to unsend either of
   * them.
   */
  queueId: string | null;
}> {
  try {
    const admin = createAdminClient();
    if (!admin) {
      return { queued: false, dueNow: false, reason: "no_admin_client", queueId: null };
    }

    // ---- Gate 1: the master switch -----------------------------------------
    const org = await loadOrgContext({ client: admin, organizationId });
    if (!org || !org.masterEnabled) {
      return { queued: false, dueNow: false, reason: "master_off", queueId: null };
    }

    // ---- Gate 2: a candidate ------------------------------------------------
    if (!candidateId) {
      return { queued: false, dueNow: false, reason: "unmatched_sender", queueId: null };
    }

    // ---- Gate 4 (cheap half): is anything enabled at all? -------------------
    //
    // Resolved before queueing so a disabled organization never accumulates
    // queue rows that the sweep will only ever skip. The full resolution runs
    // again at send time against a possibly-changed config, which is the copy
    // that decides.
    const decision = await resolveForCandidate({
      client: admin,
      organizationId,
      candidateId,
      masterEnabled: org.masterEnabled,
    });

    if (!decision.active) {
      return { queued: false, dueNow: false, reason: decision.reason, queueId: null };
    }

    const dueAt = new Date(Date.now() + decision.delayMinutes * 60_000).toISOString();

    const { data: created, error } = await admin
      .from("auto_reply_queue")
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        inbound_message_id: inboundMessageId,
        due_at: dueAt,
      })
      .select("id")
      .single();

    if (error) {
      /*
        23505 — the unique constraint on inbound_message_id.

        Not an error: Meta redelivered a message we have already queued. The
        whole point of the constraint. Reported as queued-but-not-due so the
        caller does not attempt a second inline send.
      */
      if (error.code === "23505") {
        return { queued: true, dueNow: false, reason: "already_queued", queueId: null };
      }

      console.error(`[autoReply] enqueue failed: ${formatDbError(error)}`);
      return { queued: false, dueNow: false, reason: "enqueue_failed", queueId: null };
    }

    // Logged, not sent to the model — the escalation guard runs again at send
    // time. This is only to make the decision visible in the logs early.
    if (detectEscalationTopics(inboundText).length > 0) {
      console.warn(
        `[autoReply] queued message in ${conversationId} mentions an escalation topic; ` +
          "it will get the holding reply."
      );
    }

    return {
      queued: true,
      dueNow: decision.delayMinutes === 0,
      reason: null,
      queueId: (created as { id: string } | null)?.id ?? null,
    };
  } catch (error) {
    console.error(`[autoReply] enqueue threw: ${formatDbError(error)}`);
    return { queued: false, dueNow: false, reason: "enqueue_threw", queueId: null };
  }
}

type QueueRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  inbound_message_id: string;
  attempts: number;
};

/** Give up after this many sweeps. See the column's comment in migration 0042. */
const MAX_ATTEMPTS = 3;

/**
 * Runs one queued auto-reply.
 *
 * Re-checks EVERY gate rather than trusting what was true when the row was
 * queued, and for a delayed reply that is the whole point: half an hour later
 * the master switch may be off, a colleague may have answered, the candidate may
 * have opted out, or the admin may have disabled the job. A queue that trusted
 * its own past would be a queue that sends messages an organization has already
 * decided against.
 */
export async function processAutoReply({
  client,
  row,
}: {
  client: CommsClient;
  row: QueueRow;
}): Promise<AutoReplyOutcome> {
  const organizationId = row.organization_id;

  const finish = async (
    outcome: AutoReplyOutcome,
    status: "sent" | "skipped" | "failed",
    replyMessageId: string | null
  ): Promise<AutoReplyOutcome> => {
    const detail =
      outcome.status === "sent" ? null : "reason" in outcome ? outcome.reason : null;

    await client
      .from("auto_reply_queue")
      .update({
        status,
        attempts: row.attempts + 1,
        detail,
        reply_message_id: replyMessageId,
        processed_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("organization_id", organizationId);

    return outcome;
  };

  try {
    const org = await loadOrgContext({ client, organizationId });
    if (!org) {
      return await finish(
        { status: "failed", reason: "Could not read the organization's settings." },
        "failed",
        null
      );
    }

    // ---- Gate 1: the master switch, again ----------------------------------
    if (!org.masterEnabled) {
      return await finish(
        { status: "skipped", reason: "Auto-reply was switched off before this reply went out." },
        "skipped",
        null
      );
    }

    const conversation = await loadConversation({ client, organizationId, id: row.conversation_id });
    if (!conversation) {
      return await finish(
        { status: "failed", reason: "The conversation could not be read." },
        "failed",
        null
      );
    }

    // ---- Gate 2: a candidate ------------------------------------------------
    if (!conversation.candidateId) {
      return await finish(
        {
          status: "skipped",
          reason: "Nobody is linked to this number, so there is no record to answer from.",
        },
        "skipped",
        null
      );
    }

    // ---- Gate 3: the human cooldown -----------------------------------------
    const humanReplied = await humanRepliedRecently({
      client,
      organizationId,
      conversationId: row.conversation_id,
    });

    if (humanReplied) {
      return await finish(
        {
          status: "skipped",
          reason: `A colleague replied within the last ${HUMAN_COOLDOWN_MINUTES} minutes, so the agent stayed out of it.`,
        },
        "skipped",
        null
      );
    }

    const inbound = await loadInboundMessage({
      client,
      organizationId,
      id: row.inbound_message_id,
    });

    if (!inbound) {
      return await finish(
        { status: "failed", reason: "The message being answered could not be read." },
        "failed",
        null
      );
    }

    // ---- Gate 4: config precedence, against TODAY's config ------------------
    const decision = await resolveForCandidate({
      client,
      organizationId,
      candidateId: conversation.candidateId,
      masterEnabled: org.masterEnabled,
    });

    if (!decision.active) {
      return await finish({ status: "skipped", reason: decision.reason }, "skipped", null);
    }

    // ---- Gate 5: the deterministic escalation guard --------------------------
    //
    // BEFORE the model. A salary question never reaches it: there is nothing the
    // model could answer that would be safe, so spending a call to be told so is
    // waste, and a model that has seen the question is a model that might answer
    // it.
    const signals = detectEscalationTopics(inbound.body);
    if (signals.length > 0) {
      return await escalate({
        client,
        organizationId,
        conversation,
        reason: escalationReasonFrom(signals),
        finish,
      });
    }

    /*
      No AI configured is a SKIP, not a failure, and not a holding message.

      An organization with the agent switched on but no API key has a
      configuration problem, and sending every candidate a holding message would
      turn that into a stream of content-free texts to real people. The message
      waits in the inbox, which is exactly where it would have waited before this
      feature existed.
    */
    if (!isAiConfigured()) {
      return await finish(
        {
          status: "skipped",
          reason: "No AI provider is configured, so the agent could not draft a reply.",
        },
        "skipped",
        null
      );
    }

    // ---- Gate 6: the model --------------------------------------------------
    const context = await loadAutoReplyContext({
      client,
      organizationId,
      organizationName: org.organizationName,
      timeZone: org.timeZone,
      candidateId: conversation.candidateId,
      inboundMessage: inbound.body,
      conversationId: row.conversation_id,
      toneInstructions: decision.toneInstructions,
      contextInstructions: decision.contextInstructions,
    });

    if (!context) {
      return await escalate({
        client,
        organizationId,
        conversation,
        reason: "The agent could not read enough of this candidate's record to answer safely.",
        finish,
      });
    }

    const draft = await generateAutoReply(context.input);

    if (!draft.ok) {
      /*
        Every AI failure mode lands here: provider down, rate limited, malformed
        output, a fabricated number caught by the numeric guard, a link caught by
        the URL check. All of them mean the same thing operationally — a person
        answers this one — and none of them is allowed to mean silence.
      */
      return await escalate({
        client,
        organizationId,
        conversation,
        reason: `The agent couldn't produce a safe reply (${draft.code}).`,
        finish,
      });
    }

    if (draft.data.disposition === "holding") {
      // The model's own refusal. The reason is its words, kept for the recruiter.
      return await escalate({
        client,
        organizationId,
        conversation,
        reason: draft.data.escalationReason,
        finish,
      });
    }

    // ---- The send -----------------------------------------------------------
    const outcome = await deliver({
      client,
      organizationId,
      conversation,
      body: draft.data.message,
      autoReplied: true,
    });

    if (outcome.status !== "sent") {
      /*
        The provider refused — WhatsApp's 24-hour window, a disconnected
        integration, an opt-out. Flagged rather than swallowed: the candidate
        asked a question and did not get an answer, and only a person can fix
        that now.
      */
      return await escalate({
        client,
        organizationId,
        conversation,
        reason: outcome.detail ?? "The reply could not be delivered.",
        finish,
        // The holding message would hit the same wall, so do not try to send it.
        sendHolding: false,
      });
    }

    return await finish(
      { status: "sent", messageId: outcome.logId, source: decision.source },
      "sent",
      outcome.logId
    );
  } catch (error) {
    console.error(`[autoReply] processing threw: ${formatDbError(error)}`);

    // Flagged even here. An exception is the one case where nothing else in this
    // file has run, so this is the only thing standing between a candidate's
    // question and silence.
    await flagForHuman({
      client,
      organizationId,
      conversationId: row.conversation_id,
      reason: "The agent hit an unexpected error. Please reply to this candidate.",
    });

    return await finish(
      { status: "failed", reason: "The agent hit an unexpected error." },
      "failed",
      null
    );
  }
}

/**
 * The fallback: a holding message to the candidate, a flag for the recruiter.
 *
 * Both halves, always. A flag with no reply leaves the candidate waiting with no
 * acknowledgement; a reply with no flag means nobody knows a person is needed.
 * Neither alone is the behaviour the spec asks for.
 *
 * `sendHolding: false` covers the one case where the reply itself is what
 * failed — there is no point sending a second message down a channel that has
 * just refused one, and the flag is then the whole response.
 */
async function escalate({
  client,
  organizationId,
  conversation,
  reason,
  finish,
  sendHolding = true,
}: {
  client: CommsClient;
  organizationId: string;
  conversation: ConversationRow;
  reason: string;
  /** Closes the queue row. Closes over it, so the row is not a parameter here. */
  finish: (
    outcome: AutoReplyOutcome,
    status: "sent" | "skipped" | "failed",
    replyMessageId: string | null
  ) => Promise<AutoReplyOutcome>;
  sendHolding?: boolean;
}): Promise<AutoReplyOutcome> {
  await flagForHuman({
    client,
    organizationId,
    conversationId: conversation.id,
    reason,
  });

  let replyId: string | null = null;

  if (sendHolding) {
    const outcome = await deliver({
      client,
      organizationId,
      conversation,
      body: HOLDING_MESSAGE,
      autoReplied: true,
    });
    replyId = outcome.logId;
  }

  // 'sent' as the queue status: this row is DONE and must not be retried, and
  // the holding message genuinely did go. The reason is in `detail`, which is
  // what the oversight view reads.
  return await finish({ status: "escalated", reason }, "sent", replyId);
}

type ConversationRow = {
  id: string;
  candidateId: string | null;
  phoneNumber: string;
};

/**
 * Hands the message to the one send path.
 *
 * `sentBy: null` — the agent is NOT a person, and that single field carries two
 * consequences this feature depends on:
 *
 *   - THE OPT-OUT BECOMES ABSOLUTE. sendOnChannel() only honours an override for
 *     a human-initiated send, and it treats an UNREADABLE opt-out as an opt-out
 *     for an automatic one. An unattended sender must never be able to message
 *     somebody who asked it not to, and must fail closed when it cannot check.
 *   - THE OPT-OUT FOOTER IS APPENDED. Accepted deliberately. A conversational
 *     reply carrying "Reply STOP if you'd rather not receive these messages" is
 *     slightly odd to read, and it is the correct trade: this is an unattended
 *     machine messaging a real person, which is precisely the case Meta's
 *     convention and the opt-out rules exist for. The prompt caps the drafted
 *     text at 700 characters so the footer always fits under WhatsApp's 1024.
 *
 * `applicationId: null`, like every other message in a thread — a candidate with
 * three live applications asked one question, and filing the answer under one of
 * them would be a guess recorded as a fact.
 */
async function deliver({
  client,
  organizationId,
  conversation,
  body,
  autoReplied,
}: {
  client: CommsClient;
  organizationId: string;
  conversation: ConversationRow;
  body: string;
  autoReplied: boolean;
}) {
  return await sendOnChannel({
    client,
    target: {
      organizationId,
      candidateId: conversation.candidateId as string,
      applicationId: null,
      candidateEmail: null,
      // The '+' states what the column guarantees: a full international number.
      // normalizeWhatsAppNumber() refuses a plus-less number without a country
      // code, so a bare "919876543210" would be treated as unattributable.
      candidatePhone: `+${conversation.phoneNumber}`,
      countryCode: null,
    },
    channel: "whatsapp",
    subject: null,
    body,
    templateId: null,
    eventKey: null,
    sentBy: null,
    autoReplied,
  });
}

// -----------------------------------------------------------------------------
// The sweep's pass
// -----------------------------------------------------------------------------

export type AutoReplyDrainResult = {
  considered: number;
  sent: number;
  escalated: number;
  skipped: number;
  failed: number;
};

/** One sweep must not spend forever, or on one tenant. */
const MAX_PER_DRAIN = 25;

/**
 * Drains the due queue for one organization.
 *
 * A PASS IN THE EXISTING SWEEP, not a second clock — AGENTS.md: "Do not add a
 * second cron, a worker, or a timer — add a pass to the existing sweep."
 *
 * Called from runCronSweep() rather than from sweepOrganization(), and that is
 * deliberate: sweepOrganization() only runs for organizations with
 * `automations_enabled`, and the auto-reply agent has its own master switch. An
 * organization that had switched automations off would otherwise find its
 * delayed replies silently never firing — the invisible-by-construction failure
 * DEPLOYMENT.md §10 already warns about.
 */
export async function drainDueAutoReplies({
  client,
  organizationId,
  now = new Date(),
}: {
  client: CommsClient;
  organizationId: string;
  now?: Date;
}): Promise<AutoReplyDrainResult> {
  const result: AutoReplyDrainResult = {
    considered: 0,
    sent: 0,
    escalated: 0,
    skipped: 0,
    failed: 0,
  };

  const { data, error } = await client
    .from("auto_reply_queue")
    .select("id, organization_id, conversation_id, inbound_message_id, attempts")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .lte("due_at", now.toISOString())
    // Oldest promise first — the same ordering the `wait_then` queue uses.
    .order("due_at", { ascending: true })
    .limit(MAX_PER_DRAIN);

  if (error) {
    console.error(`[autoReply] drain read failed: ${formatDbError(error)}`);
    return result;
  }

  for (const row of (data ?? []) as QueueRow[]) {
    result.considered += 1;

    /*
      Given up on.

      Three sweeps of failure is a configuration problem a person needs to see,
      not something to keep spending model calls on. Flagged, so the candidate
      is not left waiting on a queue row nobody looks at.
    */
    if (row.attempts >= MAX_ATTEMPTS) {
      await flagForHuman({
        client,
        organizationId,
        conversationId: row.conversation_id,
        reason: "The agent tried several times and could not reply. Please answer this one.",
      });

      await client
        .from("auto_reply_queue")
        .update({
          status: "failed",
          detail: `Gave up after ${MAX_ATTEMPTS} attempts.`,
          processed_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("organization_id", organizationId);

      result.failed += 1;
      continue;
    }

    const outcome = await processAutoReply({ client, row });

    if (outcome.status === "sent") result.sent += 1;
    else if (outcome.status === "escalated") result.escalated += 1;
    else if (outcome.status === "skipped") result.skipped += 1;
    else result.failed += 1;
  }

  return result;
}

// -----------------------------------------------------------------------------
// Reads and small writes
// -----------------------------------------------------------------------------

async function loadOrgContext({
  client,
  organizationId,
}: {
  client: CommsClient;
  organizationId: string;
}): Promise<OrgContext | null> {
  const [settings, organization] = await Promise.all([
    client
      .from("organization_settings")
      .select("auto_reply_master_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    client.from("organizations").select("name, timezone").eq("id", organizationId).maybeSingle(),
  ]);

  if (settings.error || organization.error) {
    console.error(
      `[autoReply] org context read failed: ${formatDbError(settings.error ?? organization.error)}`
    );
    return null;
  }

  const organizationRow = organization.data as { name: string; timezone: string | null } | null;
  if (!organizationRow) return null;

  return {
    /*
      A MISSING SETTINGS ROW MEANS OFF.

      An organization that has never opened Settings has no row, and reading
      that absence as "enabled" would have the agent messaging candidates for an
      organization that never asked for it. `?? false` is the whole safety
      property of this line.
    */
    masterEnabled:
      (settings.data as { auto_reply_master_enabled: boolean } | null)
        ?.auto_reply_master_enabled === true,
    organizationName: organizationRow.name,
    timeZone: organizationRow.timezone ?? "Asia/Kolkata",
  };
}

async function loadConversation({
  client,
  organizationId,
  id,
}: {
  client: CommsClient;
  organizationId: string;
  id: string;
}): Promise<ConversationRow | null> {
  const { data, error } = await client
    .from("whatsapp_conversations")
    .select("id, candidate_id, phone_number")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as { id: string; candidate_id: string | null; phone_number: string };
  return { id: row.id, candidateId: row.candidate_id, phoneNumber: row.phone_number };
}

async function loadInboundMessage({
  client,
  organizationId,
  id,
}: {
  client: CommsClient;
  organizationId: string;
  id: string;
}): Promise<{ body: string } | null> {
  const { data, error } = await client
    .from("message_log")
    .select("body_sent")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("direction", "inbound")
    .maybeSingle();

  if (error || !data) return null;
  return { body: (data as { body_sent: string }).body_sent };
}

/**
 * Has a PERSON replied in this thread recently?
 *
 * `sent_by not null` is what makes somebody a person: the schema uses null for
 * an automatic send, and the agent's own replies are automatic. `auto_replied`
 * is excluded as well, belt and braces — if a future caller ever sends an
 * auto-reply with a user id attached, the agent must still not treat its own
 * voice as a colleague's and go quiet on itself.
 *
 * FAILS TOWARDS SILENCE. An unreadable answer is treated as "a human did
 * reply", so the agent stays out. Two people answering one candidate is the
 * outcome worth avoiding, and a message waiting in the inbox is recoverable.
 */
async function humanRepliedRecently({
  client,
  organizationId,
  conversationId,
}: {
  client: CommsClient;
  organizationId: string;
  conversationId: string;
}): Promise<boolean> {
  const since = new Date(Date.now() - HUMAN_COOLDOWN_MINUTES * 60_000).toISOString();

  const { data, error } = await client
    .from("message_log")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("auto_replied", false)
    .not("sent_by", "is", null)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    console.error(`[autoReply] cooldown check failed; suppressing: ${formatDbError(error)}`);
    return true;
  }

  return (data ?? []).length > 0;
}

/**
 * Resolves precedence for a candidate, reading both scopes in one query.
 *
 * The job scope is the candidate's most recently updated live application — the
 * same choice the inbox makes for its application chip. It selects a
 * CONFIGURATION, never the content of a reply.
 */
async function resolveForCandidate({
  client,
  organizationId,
  candidateId,
  masterEnabled,
}: {
  client: CommsClient;
  organizationId: string;
  candidateId: string;
  masterEnabled: boolean;
}): Promise<AutoReplyDecision> {
  const { data: applicationRow } = await client
    .from("applications")
    .select("job_id")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const jobId = (applicationRow as { job_id: string } | null)?.job_id ?? null;

  const { data, error } = await client
    .from("auto_reply_config")
    .select(
      "id, organization_id, job_id, enabled, response_timing, delay_minutes, " +
        "tone_instructions, context_instructions, created_by, created_at, updated_at"
    )
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[autoReply] config read failed: ${formatDbError(error)}`);
    // Unreadable configuration is not permission to reply.
    return { active: false, reason: "The agent's configuration could not be read." };
  }

  const rows = (data ?? []) as unknown as AutoReplyConfig[];

  return resolveAutoReply({
    masterEnabled,
    orgConfig: rows.find((row) => row.job_id === null) ?? null,
    jobConfig: jobId ? (rows.find((row) => row.job_id === jobId) ?? null) : null,
  });
}

/**
 * Marks a thread as needing a person.
 *
 * Never throws and never reports upward: it is called from the fallback paths,
 * and a failure to flag must not turn "a person needs to answer this" into an
 * exception that loses the holding message too.
 */
export async function flagForHuman({
  client,
  organizationId,
  conversationId,
  reason,
}: {
  client: CommsClient;
  organizationId: string;
  conversationId: string;
  reason: string;
}): Promise<void> {
  const { error } = await client
    .from("whatsapp_conversations")
    .update({
      needs_human: true,
      needs_human_reason: reason.slice(0, 500),
      needs_human_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[autoReply] could not flag for human: ${formatDbError(error)}`);
  }
}

/**
 * Clears the flag. Called when a person replies in the thread.
 *
 * ONLY a human reply clears it. Not the agent, not opening the conversation, not
 * the candidate writing again — the flag means "a person still has to answer
 * this", and nothing but a person answering makes that false.
 */
export async function clearHumanFlag({
  client,
  organizationId,
  conversationId,
}: {
  client: CommsClient;
  organizationId: string;
  conversationId: string;
}): Promise<void> {
  const { error } = await client
    .from("whatsapp_conversations")
    .update({ needs_human: false, needs_human_reason: null, needs_human_at: null })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[autoReply] could not clear the human flag: ${formatDbError(error)}`);
  }
}
