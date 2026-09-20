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
import { MessageCircle, Plug, RefreshCw, Search } from "lucide-react";
import { EmptyState } from "@/components/states";
import {
  filterConversations,
  type ConversationSummary,
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
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [staleSince, setStaleSince] = useState<number | null>(null);

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

  const visible = filterConversations(conversations, query);
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
                headline={query ? "No matches" : "No conversations yet"}
                message={
                  query
                    ? "No thread matches that name or number."
                    : "When a candidate replies on WhatsApp, their conversation appears here."
                }
                icon={MessageCircle}
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
