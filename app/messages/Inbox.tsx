"use client";

// =============================================================================
// The two-pane inbox.
//
// Left: every thread, newest first, filtered in the browser. Right: the
// selected thread and its composer.
//
// WHY POLLING RATHER THAN A SUBSCRIPTION. Supabase Realtime would push, but it
// opens a websocket authenticated by the browser's own PostgREST client against
// message_log — a table whose whole design is that no browser may write it and
// that it is read through narrow, scoped queries. A 15-second poll of a route
// that already applies the recruiter scope reuses the boundary that exists
// instead of opening a second one, and "near-real-time" for a WhatsApp reply is
// measured in seconds of patience, not milliseconds.
//
// The poll pauses when the tab is hidden. A laptop left open on this page for a
// weekend would otherwise make 11,000 authenticated requests to show nobody
// anything.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, MessageCircle, Plug, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Toggle } from "@/components/ui/Toggle";
import {
  applyInboxFilter,
  countNeedsHuman,
  filterConversations,
  INBOX_FILTER_LABELS,
  type ConversationSummary,
  type InboxFilter,
} from "@/lib/messaging/conversations";
import { ConversationRow } from "./ConversationRow";
import { Thread } from "./Thread";

const POLL_MS = 15_000;

export function Inbox({
  initialConversations,
  metaTemplateConfigured,
  canReply,
  timeZone,
  webhookUnverifiable,
  canManageIntegration,
  initialConversationId,
  autoReplyEnabled,
  canToggleAutoReply,
  aiConfigured,
}: {
  initialConversations: ConversationSummary[];
  /** The org named a Meta-approved template, so out-of-window replies can go. */
  metaTemplateConfigured: boolean;
  /** False for a Viewer, who reads threads and cannot answer them. */
  canReply: boolean;
  /** The ORGANIZATION's timezone, so server and browser agree on every stamp. */
  timeZone: string;
  webhookUnverifiable: boolean;
  canManageIntegration: boolean;
  /** From ?c=, so a link from a candidate page opens that thread. */
  initialConversationId: string | null;
  /** 0042 — the organization-wide master switch's current state. */
  autoReplyEnabled: boolean;
  /** Owner/Admin. A Recruiter sees the state and cannot change it. */
  canToggleAutoReply: boolean;
  /** False means the agent can never run, whatever the switch says. */
  aiConfigured: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [autoReply, setAutoReply] = useState(autoReplyEnabled);
  const [autoReplyBusy, setAutoReplyBusy] = useState(false);
  const [autoReplyError, setAutoReplyError] = useState<string | null>(null);

  // Monotonic request id: a slow earlier poll landing after a fast later one
  // would replace fresh data with stale. Same guard CandidatePicker uses.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const response = await fetch("/api/messages/conversations", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));

      const payload = (await response.json()) as {
        conversations: ConversationSummary[];
        failed: boolean;
      };

      if (id !== requestId.current) return;

      /*
        A failed READ never empties the list.

        The route reports `failed` rather than returning [], precisely so this
        cannot happen: replacing a visible inbox with "no conversations" because
        one poll failed would tell a recruiter that four people stopped waiting
        for them.
      */
      if (payload.failed) {
        setStaleSince((current) => current ?? Date.now());
        return;
      }

      setConversations(payload.conversations);
      setStaleSince(null);
    } catch {
      if (id !== requestId.current) return;
      setStaleSince((current) => current ?? Date.now());
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(refresh, POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Refresh immediately on return: somebody coming back to the tab wants
        // what arrived while they were away, not a wait of up to 15 seconds.
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  /**
   * The master kill switch.
   *
   * OPTIMISTIC, and deliberately so. Somebody pressing this OFF is reacting to
   * something the agent just said to a candidate; a spinner between the decision
   * and the effect is the wrong experience for a control whose whole purpose is
   * to stop something immediately. It reverts on failure and says why.
   *
   * The switch itself is only a hint until the server agrees — every gate in
   * lib/autoReply/run.ts re-reads the real value from organization_settings
   * before sending, including for a reply that was queued minutes ago. Turning
   * it off therefore stops queued replies too, not just future ones.
   */
  async function toggleAutoReply(next: boolean) {
    setAutoReplyBusy(true);
    setAutoReplyError(null);
    setAutoReply(next);

    try {
      const response = await fetch("/api/settings/auto-reply", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_enabled: next }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setAutoReplyError(payload.error ?? "Couldn't change that setting.");
        setAutoReply(!next);
      }
    } catch {
      setAutoReplyError("Couldn't reach the server. The setting was not changed.");
      setAutoReply(!next);
    } finally {
      setAutoReplyBusy(false);
    }
  }

  async function manualRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  /** Applied locally so a reply appears instantly rather than after the poll. */
  const patchConversation = useCallback(
    (id: string, patch: Partial<ConversationSummary>) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...conversation, ...patch } : conversation
        )
      );
    },
    []
  );

  const visible = applyInboxFilter(filterConversations(conversations, query), filter);
  const needsHuman = countNeedsHuman(conversations);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  /*
    Deep-linked to a thread the list does not contain.

    Reachable two ways: the list is capped at 200 and a very old conversation
    falls off the end, or a Recruiter followed a link to somebody else's
    candidate. Saying so beats rendering "nothing selected", which would look
    like the link was broken rather than like the thread is out of reach.
  */
  const missingSelection = selectedId !== null && selected === null;

  return (
    <>
      {webhookUnverifiable && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14, margin: 0 }}>
            <strong>Incoming messages can&apos;t be verified yet.</strong> Sending works, but
            replies from candidates are rejected without a Meta app secret, so this inbox will stay
            empty.{" "}
            {canManageIntegration ? (
              <Link className="text-link" href="/settings/integrations#integration-whatsapp">
                <Plug size={14} aria-hidden="true" /> Finish the WhatsApp setup
              </Link>
            ) : (
              "An Owner or Admin can finish the WhatsApp setup in Settings."
            )}
          </p>
        </div>
      )}

      {staleSince !== null && (
        <div className="card mb-4" style={{ borderColor: "var(--color-error)" }}>
          <p style={{ fontSize: 14, margin: 0, color: "var(--color-error)" }}>
            Couldn&apos;t check for new messages. What you see below is what loaded earlier — treat
            it as possibly out of date rather than as nothing new having arrived.
          </p>
        </div>
      )}

      {/* ---- The agent's master switch and the oversight filters -------- */}
      <div className="card mb-4 inbox__agentbar">
        <div className="inbox__agentbar-switch">
          <Bot size={17} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <p className="inbox__agentbar-title">Auto-reply</p>
            <p className="inbox__agentbar-note">
              {!autoReply
                ? "Off — every message waits for a person."
                : aiConfigured
                  ? "On — the agent answers what it can and flags the rest."
                  : "On, but no AI provider is configured, so nothing is being answered."}
            </p>
          </div>

          {canToggleAutoReply ? (
            <Toggle
              checked={autoReply}
              disabled={autoReplyBusy}
              onChange={(next) => void toggleAutoReply(next)}
              label={autoReply ? "On" : "Off"}
            />
          ) : (
            /* A Recruiter sees the state. Configuring it is Owner/Admin (§7),
               and the API enforces that independently of this. */
            <span className="has-text-secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {autoReply ? "On" : "Off"} · set by an admin
            </span>
          )}
        </div>

        {autoReplyError && (
          <p style={{ fontSize: 13, color: "var(--color-error)", margin: 0 }}>{autoReplyError}</p>
        )}

        {/*
          The three views. Tabs rather than a dropdown — the same treatment the
          template library's channel filter uses, and "who is waiting on me" is
          worth one click.
        */}
        <div className="inbox__tabs" role="tablist" aria-label="Filter conversations">
          {(["all", "needs_human", "auto_replied"] as InboxFilter[]).map((option) => {
            const selected = filter === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`inbox__tab${selected ? " is-active" : ""}`}
                onClick={() => setFilter(option)}
              >
                {option === "needs_human" && <TriangleAlert size={13} aria-hidden="true" />}
                {option === "auto_replied" && <Bot size={13} aria-hidden="true" />}
                {INBOX_FILTER_LABELS[option]}
                {option === "needs_human" && needsHuman > 0 && (
                  <span className="inbox__tab-count">{needsHuman}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="inbox">
        {/* ---- Left pane ------------------------------------------------- */}
        <aside className="inbox__list card" aria-label="Conversations">
          <div className="inbox__search">
            <Search size={15} aria-hidden="true" className="inbox__search-icon" />
            <input
              type="search"
              className="input"
              placeholder="Search name or number"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search conversations"
            />
            <button
              type="button"
              className="inbox__refresh"
              onClick={manualRefresh}
              disabled={refreshing}
              aria-label="Check for new messages"
              title="Check for new messages"
            >
              <RefreshCw
                size={15}
                aria-hidden="true"
                className={refreshing ? "inbox__refresh-spin" : undefined}
              />
            </button>
          </div>

          <div className="inbox__rows">
            {visible.length === 0 ? (
              <EmptyState
                compact
                headline={
                  query
                    ? "No matches"
                    : filter === "needs_human"
                      ? "Nothing waiting"
                      : filter === "auto_replied"
                        ? "No auto-replies yet"
                        : "No conversations yet"
                }
                message={
                  query
                    ? "No thread matches that name or number."
                    : filter === "needs_human"
                      ? "No conversation is waiting on a person right now."
                      : filter === "auto_replied"
                        ? "The agent hasn't answered anybody yet. Everything here was sent by a person."
                        : "When a candidate replies on WhatsApp, their conversation appears here."
                }
                icon={filter === "all" ? MessageCircle : Bot}
              />
            ) : (
              visible.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  timeZone={timeZone}
                  onSelect={() => setSelectedId(conversation.id)}
                />
              ))
            )}
          </div>
        </aside>

        {/* ---- Right pane ------------------------------------------------ */}
        <section className="inbox__thread card" aria-label="Conversation">
          {selected === null ? (
            <EmptyState
              headline={missingSelection ? "Conversation not available" : "Nothing selected"}
              message={
                missingSelection
                  ? "That conversation isn't in your inbox — it may belong to a candidate assigned to someone else, or be older than the last 200 threads."
                  : "Choose a conversation on the left to read it and reply."
              }
              icon={MessageCircle}
            />
          ) : (
            <Thread
              // Remounts on selection, so no thread can briefly show another's
              // messages while the new one loads.
              key={selected.id}
              conversation={selected}
              metaTemplateConfigured={metaTemplateConfigured}
              canReply={canReply}
              timeZone={timeZone}
              onRead={() => patchConversation(selected.id, { unread_count: 0 })}
              onChanged={refresh}
            />
          )}
        </section>
      </div>
    </>
  );
}
