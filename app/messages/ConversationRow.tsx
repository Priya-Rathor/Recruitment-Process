"use client";

// =============================================================================
// One row in the conversation list.
//
// Its own file because the list re-renders on every poll and on every keystroke
// in the search box; a row that is its own component is the unit React can skip.
// =============================================================================

import { Bot, MessageCircle, TriangleAlert, UserRoundX } from "lucide-react";
import {
  conversationTitle,
  formatPhoneForDisplay,
  isUnmatched,
  type ConversationSummary,
} from "@/lib/messaging/conversations";
import { formatDateTimeInZone } from "@/lib/time";

export function ConversationRow({
  conversation,
  selected,
  timeZone,
  onSelect,
}: {
  conversation: ConversationSummary;
  selected: boolean;
  timeZone: string;
  onSelect: () => void;
}) {
  const unmatched = isUnmatched(conversation);
  const unread = conversation.unread_count > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={[
        "inbox__row",
        selected ? "is-selected" : "",
        unmatched ? "is-unmatched" : "",
        unread ? "is-unread" : "",
        // 0042. Listed last so its amber left border wins over the unmatched
        // grey one: a thread that is both unrecognised AND waiting on a person
        // needs the more urgent of the two treatments, not the earlier one.
        conversation.needs_human ? "is-needs-human" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="inbox__row-top">
        <span className="inbox__row-name">
          {/* The channel, confirmed on every row. This inbox is WhatsApp-only
              today, and a row that does not say so would quietly become wrong
              the day a second channel arrives. */}
          <MessageCircle size={14} aria-hidden="true" className="inbox__row-channel" />
          {unmatched && <UserRoundX size={14} aria-hidden="true" />}
          <span className="inbox__row-label">{conversationTitle(conversation)}</span>
          {/*
            0042 — "the AI already handled this".

            The single most useful thing on the row for a recruiter scanning the
            inbox, because it separates "somebody is waiting for me" from "this
            one answered itself". Rendered from the denormalised column the bump
            writes, so no per-row query is needed for 200 threads.
          */}
          {conversation.last_message_auto_replied && !conversation.needs_human && (
            <Bot
              size={13}
              aria-label="The agent answered this"
              className="inbox__row-agent"
            />
          )}
        </span>

        <span className="inbox__row-time">
          {/* The ORGANIZATION's timezone, never the browser's — two recruiters
              in different countries must read the same thread identically. */}
          {formatDateTimeInZone(conversation.last_message_at, timeZone)}
        </span>
      </span>

      <span className="inbox__row-preview">
        {conversation.last_message_preview?.trim() || "No messages yet"}
      </span>

      <span className="inbox__row-foot">
        <span className="inbox__row-number">
          {formatPhoneForDisplay(conversation.phone_number)}
        </span>

        {/*
          The flag, as a badge rather than only a border. A colour alone is not
          an accessible signal and does not survive a screenshot pasted into a
          chat, which is how a recruiter actually escalates one of these.
        */}
        {conversation.needs_human && (
          <span className="inbox__row-flag">
            <TriangleAlert size={11} aria-hidden="true" />
            Needs human reply
          </span>
        )}
        {unread && (
          <span className="inbox__row-dot" aria-label={`${conversation.unread_count} unread`}>
            {conversation.unread_count > 9 ? "9+" : conversation.unread_count}
          </span>
        )}
      </span>
    </button>
  );
}
