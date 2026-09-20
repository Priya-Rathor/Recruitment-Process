"use client";

// =============================================================================
// The thread pane: a conversation, and the box to answer it.
//
// Loads its own messages rather than receiving them from the list, because the
// list carries 200 previews and a thread carries 300 bodies — sending every
// body to the browser so that one thread can be opened would make the inbox
// slow in proportion to how much it had been used.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Send,
  TriangleAlert,
  UserRoundX,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CandidatePicker, type PickerCandidate } from "@/components/CandidatePicker";
import { FormError, SkeletonRows } from "@/components/states";
import {
  formatPhoneForDisplay,
  replyCapability,
  MAX_PREVIEW_LENGTH,
  type ConversationMessage,
  type ConversationSummary,
} from "@/lib/messaging/conversations";
import { MAX_WHATSAPP_BODY_LENGTH } from "@/lib/communications/templates";
import { formatDateTimeInZone } from "@/lib/time";

const POLL_MS = 15_000;

type ThreadPayload = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  application: { id: string; job_title: string | null } | null;
  optedOut: boolean;
  optOutUnknown: boolean;
};

export function Thread({
  conversation,
  metaTemplateConfigured,
  canReply,
  timeZone,
  onRead,
  onChanged,
}: {
  conversation: ConversationSummary;
  metaTemplateConfigured: boolean;
  canReply: boolean;
  timeZone: string;
  /** Lets the list clear its unread pip without waiting for the next poll. */
  onRead: () => void;
  /** Refreshes the list after something structural changes (a link, a send). */
  onChanged: () => void;
}) {
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const requestId = useRef(0);
  const bottom = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const response = await fetch(`/api/messages/conversations/${conversation.id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));

      const payload = (await response.json()) as ThreadPayload;
      if (id !== requestId.current) return;

      setThread(payload);
      setLoadError(null);
    } catch {
      if (id !== requestId.current) return;
      // Only the FIRST load reports an error. A failed poll on a thread already
      // on screen leaves what is there: replacing a readable conversation with
      // an error because one refresh missed would be a downgrade.
      setThread((current) => {
        if (current === null) setLoadError("Couldn't load this conversation.");
        return current;
      });
    }
  }, [conversation.id]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };

    /*
      The FIRST load goes through a zero-delay timer rather than being called
      here directly.

      Nothing is then set synchronously in this effect body — the same shape
      CandidatePicker uses, and for the same reason: a setState in an effect
      body is a cascading render, and the lint rule that catches it is worth
      keeping sharp rather than silencing for a call that happens to be async.
    */
    const first = setTimeout(load, 0);

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(first);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  /*
    Opening a thread marks it read.

    Only for somebody who can reply. The unread count is shared across the whole
    organization (see migration 0041), so a Viewer browsing threads would
    silently tell three recruiters that four candidates had been dealt with. The
    RLS policy refuses the write independently; this is why we do not attempt it.
  */
  useEffect(() => {
    if (!canReply || conversation.unread_count === 0) return;

    void fetch(`/api/messages/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_read: true }),
    })
      .then(() => onRead())
      // A failed mark-read is not worth an error message: the badge stays up,
      // which is the safe direction, and the next open tries again.
      .catch(() => undefined);
  }, [canReply, conversation.id, conversation.unread_count, onRead]);

  // Pinned to the newest message, the way every chat behaves.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  async function linkCandidate(candidate: PickerCandidate) {
    setLinking(true);
    try {
      const response = await fetch(`/api/messages/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidate.id }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setLoadError(payload.error ?? "Couldn't link that candidate.");
        return;
      }

      await load();
      onChanged();
    } finally {
      setLinking(false);
    }
  }

  if (loadError !== null && thread === null) {
    return <FormError message={loadError} />;
  }

  if (thread === null) return <SkeletonRows rows={5} />;

  const { conversation: current, messages, application, optedOut, optOutUnknown } = thread;
  const unmatched = current.candidate_id === null;

  const capability = replyCapability({
    lastInboundAt: current.last_inbound_at,
    metaTemplateConfigured,
    // The page only renders this component when WhatsApp is connected.
    whatsappConnected: true,
    optedOut,
  });

  return (
    <div className="thread">
      {/* ---- Header ------------------------------------------------------ */}
      <header className="thread__head">
        <div>
          <h2 className="thread__name">
            {current.candidate_name ? (
              // Links OUT to the existing candidate page rather than rebuilding
              // a summary here — one place owns what a candidate looks like.
              <Link className="text-link" href={`/candidates/${current.candidate_id}`}>
                {current.candidate_name}
              </Link>
            ) : (
              <span className="is-flex is-align-items-center" style={{ gap: 6 }}>
                <UserRoundX size={16} aria-hidden="true" />
                Unknown number
              </span>
            )}
          </h2>
          <p className="thread__number">{formatPhoneForDisplay(current.phone_number)}</p>
        </div>

        {application && (
          <Link className="thread__chip" href={`/applications/${application.id}`}>
            <ExternalLink size={13} aria-hidden="true" />
            {application.job_title ?? "Application"}
          </Link>
        )}
      </header>

      {/* ---- Banners ----------------------------------------------------- */}
      {optOutUnknown && (
        <p className="thread__banner is-warning">
          <TriangleAlert size={15} aria-hidden="true" />
          We couldn&apos;t check whether this candidate has opted out. Sending is still possible —
          check with them first.
        </p>
      )}

      {optedOut && (
        <p className="thread__banner is-warning">
          <TriangleAlert size={15} aria-hidden="true" />
          This candidate has opted out of WhatsApp messages.
        </p>
      )}

      {/*
        0042 — the agent declined, and said why.

        The reason is the agent's internal note, shown to the recruiter and never
        to the candidate. It is here rather than only on the list row because it
        is the first thing somebody opening a flagged thread needs: what the
        agent would not touch, so they know what they are picking up.

        Cleared automatically when they reply — see the reply route.
      */}
      {current.needs_human && (
        <p className="thread__banner is-warning">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>Waiting for a person.</strong>{" "}
            {current.needs_human_reason ??
              "The agent didn't answer this one."}{" "}
            Replying below clears the flag.
          </span>
        </p>
      )}

      {unmatched && (
        <div className="thread__banner is-neutral thread__link-block">
          <p style={{ margin: 0 }}>
            <strong>Nobody is linked to this number.</strong> It may be a candidate texting from a
            second phone, or a wrong number. Linking it files this conversation on their record —
            we never create a candidate from a number alone.
          </p>
          <CandidatePicker onPick={linkCandidate} busy={linking} autoFocus={false} />
        </div>
      )}

      <FormError message={loadError} />

      {/* ---- Messages ---------------------------------------------------- */}
      <div className="thread__messages">
        {messages.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            Nothing has been said in this conversation yet.
          </p>
        ) : (
          messages.map((message) => (
            <Bubble key={message.id} message={message} timeZone={timeZone} />
          ))
        )}
        <div ref={bottom} />
      </div>

      {/* ---- Composer ---------------------------------------------------- */}
      <Composer
        conversationId={current.id}
        canReply={canReply && !unmatched}
        unmatched={unmatched}
        capability={capability}
        optedOut={optedOut}
        onSent={async () => {
          await load();
          onChanged();
        }}
      />
    </div>
  );
}

/**
 * One message.
 *
 * Inbound left and neutral, outbound right and primary-tinted — the layout
 * every chat uses, so nobody has to learn which side is which.
 */
function Bubble({
  message,
  timeZone,
}: {
  message: ConversationMessage;
  timeZone: string;
}) {
  const inbound = message.direction === "inbound";

  return (
    <div className={`bubble ${inbound ? "is-inbound" : "is-outbound"}`}>
      <p className="bubble__body">{message.body}</p>

      <p className="bubble__meta">
        {!inbound && (
          <>
            {/*
              WHO SAID THIS, and an auto-reply is NEVER allowed to read as a
              person. Three distinct cases, three distinct labels:

                a name      — a colleague typed it
                "Auto-reply" — the AI agent drafted and sent it (0042)
                "Automatic"  — a configured template fired on a pipeline event

              The label comes from the `auto_replied` column, not from an
              inference at render time, so there is no path that presents an
              agent message as anything else. Spec §8: never disguise one.
            */}
            {message.auto_replied ? (
              <span className="bubble__agent">
                <Bot size={11} aria-hidden="true" /> Auto-reply
              </span>
            ) : (
              <span>{message.sender_name ?? "Automatic"}</span>
            )}
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{formatDateTimeInZone(message.sent_at ?? message.created_at, timeZone)}</span>
        {!inbound && <DeliveryMark status={message.status} />}
      </p>

      {/*
        The reason is shown inline, never on hover. A tooltip is invisible on a
        phone and to a keyboard user, and "why did this not reach them" is the
        most important sentence in the thread.
      */}
      {message.error_message && (
        <p
          className="bubble__error"
          style={{
            color:
              message.status === "skipped"
                ? "var(--color-text-secondary)"
                : "var(--color-error)",
          }}
        >
          {message.error_message}
        </p>
      )}
    </div>
  );
}

/**
 * The tick marks, populated for real by Meta's status webhook since 0041.
 *
 * Before the webhook existed an outbound WhatsApp message could only ever say
 * "Sent" — migration 0035 recorded `opened` as email-only for exactly that
 * reason. These now move: sent → delivered → read, in whatever order Meta
 * reports them.
 */
function DeliveryMark({ status }: { status: string }) {
  switch (status) {
    case "queued":
      return <Clock size={13} aria-label="Queued" />;
    case "sent":
      return <Check size={13} aria-label="Sent" />;
    case "delivered":
      return <CheckCheck size={13} aria-label="Delivered" />;
    case "opened":
      return (
        <CheckCheck size={13} aria-label="Read" style={{ color: "var(--color-primary)" }} />
      );
    case "failed":
    case "bounced":
      return (
        <AlertTriangle size={13} aria-label="Failed" style={{ color: "var(--color-error)" }} />
      );
    case "skipped":
      // Neutral, never red. A message correctly not sent is not an error, and
      // colouring it as one teaches people to ignore the colour.
      return <AlertTriangle size={13} aria-label="Not sent" />;
    default:
      return null;
  }
}

function Composer({
  conversationId,
  canReply,
  unmatched,
  capability,
  optedOut,
  onSent,
}: {
  conversationId: string;
  canReply: boolean;
  unmatched: boolean;
  capability: ReturnType<typeof replyCapability>;
  optedOut: boolean;
  onSent: () => void | Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmingOptOut, setConfirmingOptOut] = useState(false);

  if (!canReply) {
    return (
      <p className="thread__composer-note">
        {unmatched
          ? "Link this number to a candidate to reply."
          : "You have read-only access to conversations."}
      </p>
    );
  }

  // The window / opt-out gate. Guidance, not a boundary — the route and the
  // adapter enforce what is actually enforceable. See replyCapability().
  if (!capability.canReply && !optedOut) {
    return <p className="thread__composer-note">{capability.reason}</p>;
  }

  async function send(acknowledgeOptOut: boolean) {
    const text = body.trim();
    if (text.length === 0) return;

    setSending(true);
    setError(null);
    setOutcome(null);

    try {
      const response = await fetch(`/api/messages/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, acknowledge_opt_out: acknowledgeOptOut }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        status?: string;
        detail?: string | null;
      };

      if (response.status === 409 && payload.code === "opted_out") {
        // Warned, never silently blocked — the spec's wording, and the
        // confirmation is what makes the warning unskippable rather than
        // decorative.
        setConfirmingOptOut(true);
        setError(payload.error ?? null);
        return;
      }

      if (!response.ok) {
        setError(payload.error ?? "Couldn't send that message.");
        return;
      }

      setConfirmingOptOut(false);

      if (payload.status === "sent") {
        setBody("");
      } else {
        // Skipped or failed: the text stays in the box so it is not lost, and
        // the provider's own reason is shown rather than a generic failure.
        setOutcome(payload.detail ?? "That message wasn't sent.");
      }

      await onSent();
    } catch {
      setError("Couldn't reach the server. Nothing was sent.");
    } finally {
      setSending(false);
    }
  }

  const remaining = MAX_WHATSAPP_BODY_LENGTH - body.length;

  return (
    <div className="thread__composer">
      {capability.canReply && capability.note && (
        <p className="thread__composer-note">{capability.note}</p>
      )}

      <FormError message={error} />
      {outcome && <p className="thread__composer-note">{outcome}</p>}

      <div className="thread__composer-row">
        <textarea
          className="textarea"
          rows={2}
          value={body}
          maxLength={MAX_WHATSAPP_BODY_LENGTH}
          placeholder={optedOut ? "This candidate has opted out" : "Write a reply"}
          onChange={(event) => {
            setBody(event.target.value);
            // Any edit retracts the override: a recruiter who rewrites the
            // message after the warning is composing a new one, and carrying a
            // confirmation across it would be consent to something else.
            setConfirmingOptOut(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!confirmingOptOut) void send(false);
            }
          }}
        />

        <Button
          variant={confirmingOptOut ? "danger" : "primary"}
          icon={Send}
          loading={sending}
          disabled={body.trim().length === 0}
          onClick={() => void send(confirmingOptOut)}
        >
          {confirmingOptOut ? "Send anyway" : "Send"}
        </Button>
      </div>

      <p className="thread__composer-foot">
        {remaining < MAX_PREVIEW_LENGTH
          ? `${remaining} characters left`
          : "⌘/Ctrl + Enter to send"}
      </p>
    </div>
  );
}
