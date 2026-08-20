"use client";

// =============================================================================
// The communication log — one list, two pages.
//
// Rendered on the Application detail page (this application's messages) and on
// the Candidate detail page (the same list rolled up across every application
// that candidate holds). One component, because the two lists answer the same
// question and a second implementation would eventually disagree about what
// "Delivered" looks like.
//
// READ-ONLY FOR EVERY ROLE, INCLUDING OWNER. It is a record of what was said to a
// real person; there is no edit control here and no UPDATE policy behind it
// (migration 0030, decision 3).
//
// WHAT THE STATUS CHIPS MEAN, AND WHY 'skipped' IS NOT RED.
//
//   Sent       — the provider accepted it. Info: it left, nothing has confirmed
//                it arrived.
//   Delivered  — the provider confirmed arrival.
//   Opened     — the recipient opened it. An eye, because "success" alone does
//                not say what happened.
//   Not sent   — a policy or configuration outcome: the candidate opted out, has
//                no address, or the channel isn't connected. NEUTRAL, not red.
//                Rendering a correct decision as an error teaches a team to
//                ignore the colour, and then they ignore the real ones.
//   Failed     — something broke. Red, with the reason expandable.
//   Bounced    — permanently rejected. Red, because the contact detail is wrong
//                and somebody has to fix it.
// =============================================================================
import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, Mail, MessageCircle } from "lucide-react";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/states";
import { formatDateTimeInZone } from "@/lib/time";
import type { MessageLogEntry } from "@/lib/communications/queries";
import { COMMUNICATION_EVENT_DEFINITIONS, isCommunicationEvent } from "@/lib/communications/events";

const STATUS_PRESENTATION: Record<
  MessageLogEntry["status"],
  { tone: ChipTone; label: string; showsError: boolean }
> = {
  queued: { tone: "info", label: "Queued", showsError: false },
  sent: { tone: "info", label: "Sent", showsError: false },
  delivered: { tone: "success", label: "Delivered", showsError: false },
  opened: { tone: "success", label: "Opened", showsError: false },
  skipped: { tone: "neutral", label: "Not sent", showsError: true },
  failed: { tone: "error", label: "Failed", showsError: true },
  bounced: { tone: "error", label: "Bounced", showsError: true },
};

export function CommunicationLog({
  messages,
  timeZone,
  failed,
  /** True on the Candidate page, where one list spans several jobs. */
  showJob = false,
  emptyMessage = "Nothing has been sent to this candidate yet.",
}: {
  messages: MessageLogEntry[];
  timeZone: string;
  failed: boolean;
  showJob?: boolean;
  emptyMessage?: string;
}) {
  /*
    "We couldn't read the log" must never render as "nothing has been sent". A
    recruiter about to tell somebody they were rejected needs to know whether the
    product already did.
  */
  if (failed) {
    return (
      <p style={{ fontSize: 14, color: "var(--color-error)" }}>
        Couldn&apos;t load the communication log. This is not the same as nothing having been
        sent — reload before assuming this candidate hasn&apos;t been contacted.
      </p>
    );
  }

  if (messages.length === 0) {
    return <EmptyState headline="No messages yet" message={emptyMessage} icon={Mail} />;
  }

  return (
    <ul>
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} timeZone={timeZone} showJob={showJob} />
      ))}
    </ul>
  );
}

function MessageRow({
  message,
  timeZone,
  showJob,
}: {
  message: MessageLogEntry;
  timeZone: string;
  showJob: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const presentation = STATUS_PRESENTATION[message.status] ?? STATUS_PRESENTATION.sent;
  const ChannelIcon = message.channel === "whatsapp" ? MessageCircle : Mail;

  const heading =
    message.subject?.trim() ||
    // WhatsApp has no subject, so the first line of the body stands in — the same
    // thing a phone shows in its notification.
    firstLine(message.body_sent) ||
    "(no subject)";

  const eventLabel = isCommunicationEvent(message.event_key)
    ? COMMUNICATION_EVENT_DEFINITIONS[message.event_key].label
    : null;

  return (
    <li className="py-3" style={{ borderTop: "1px solid var(--color-border)" }}>
      <div
        className="is-flex is-justify-content-space-between is-align-items-flex-start"
        style={{ gap: "0.75rem" }}
      >
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            minWidth: 0,
            flex: "1 1 auto",
            color: "inherit",
          }}
        >
          <span
            className="is-flex is-align-items-center"
            style={{ gap: 6, fontSize: 14, fontWeight: 600 }}
          >
            {expanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <ChannelIcon size={14} aria-hidden="true" />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {heading}
            </span>
          </span>

          <span
            className="has-text-secondary is-block mt-1"
            style={{ fontSize: 12 }}
          >
            {/*
              sent_by NULL is the schema's way of saying an automation sent it —
              rendered as "Automatic" rather than a dash, because a dash reads as
              missing data rather than as a fact.
            */}
            {message.sender_name ?? "Automatic"}
            {eventLabel && ` · ${eventLabel}`}
            {showJob && message.job_title && ` · ${message.job_title}`}
            {message.recipient_hint && ` · ${message.recipient_hint}`}
          </span>
        </button>

        <div
          className="is-flex is-align-items-center"
          style={{ gap: "0.5rem", flexShrink: 0 }}
        >
          <StatusChip
            tone={presentation.tone}
            label={presentation.label}
            icon={message.status === "opened" ? Eye : undefined}
          />
          <span className="has-text-secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            {/* The ORGANIZATION's timezone, so the server and browser agree. */}
            {formatDateTimeInZone(message.sent_at ?? message.created_at, timeZone)}
          </span>
        </div>
      </div>

      {/*
        The reason is shown WITHOUT expanding, not on hover. A hover tooltip is
        invisible on a phone and to a keyboard user, and "why did this not reach
        the candidate" is the most important sentence on the row.
      */}
      {presentation.showsError && message.error_message && (
        <p
          className="mt-2"
          style={{
            fontSize: 13,
            color:
              message.status === "skipped"
                ? "var(--color-secondary-text)"
                : "var(--color-error)",
          }}
        >
          {message.error_message}
        </p>
      )}

      {expanded && (
        <div
          className="mt-2"
          style={{
            background: "var(--color-background)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          {/*
            THE EXACT TEXT THAT WAS SENT, placeholders already resolved, footer
            included — not the template it came from. That is the whole reason
            body_sent exists: editing or deleting a template cannot change what
            this row says the candidate was told.
          */}
          <p className="has-text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>
            Exactly as sent
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 14,
              background: "none",
              padding: 0,
            }}
          >
            {message.body_sent}
          </pre>
        </div>
      )}
    </li>
  );
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.trim().slice(0, 90);
}
