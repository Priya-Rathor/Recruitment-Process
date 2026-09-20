// =============================================================================
// Reads for the WhatsApp inbox.
//
// Session-bound (lib/supabase/server.ts), so RLS is the tenant boundary and
// organization_id is a filter for index selectivity rather than for safety. The
// service-role paths are in lib/messaging/inbound.ts, where the explicit
// organization_id filter IS the boundary. Same split as lib/communications.
//
// THE RECRUITER SCOPE HERE IS A SCOPE, NOT A BOUNDARY — and saying so plainly
// matters more than the code. A Recruiter sees the threads of candidates on
// applications assigned to them, exactly as getBoard() narrows the pipeline
// board, because showing one recruiter another's conversations makes a shared
// inbox unusable. It is applied in the query, not in RLS, and it is not
// pretending to be security: message_log and whatsapp_conversations both grant
// SELECT to every member of the organization, so a Recruiter with PostgREST can
// read any row in their own tenant. The ORGANIZATION is the boundary. Adding a
// convincing-looking filter here while leaving that open would be the worst of
// both — a rule people trust and an opening nobody remembers.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/types";
import type { ConversationSummary, ConversationMessage } from "@/lib/messaging/conversations";
import { formatDbError } from "@/lib/supabase/errors";

/** Enough for a busy shared inbox; the search box filters within it. */
const CONVERSATION_LIMIT = 200;
/** One thread. Long enough to be the whole history for almost every candidate. */
const MESSAGE_LIMIT = 300;

type ConversationRow = {
  id: string;
  candidate_id: string | null;
  phone_number: string;
  last_message_at: string;
  last_inbound_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  candidate: { name: string } | null;
};

const CONVERSATION_COLUMNS =
  "id, candidate_id, phone_number, last_message_at, last_inbound_at, " +
  "last_message_preview, unread_count, candidate:candidates(name)";

function flatten(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    candidate_name: row.candidate?.name ?? null,
    phone_number: row.phone_number,
    last_message_at: row.last_message_at,
    last_inbound_at: row.last_inbound_at,
    last_message_preview: row.last_message_preview,
    unread_count: row.unread_count,
  };
}

/**
 * The candidate ids a Recruiter may see threads for.
 *
 * "Assigned to me, or assigned to nobody" — the same rule getBoard() applies, so
 * a recruiter's inbox and their board agree about whose work is whose. An
 * unassigned application is included for the same reason it is on the board:
 * somebody has to pick it up.
 *
 * Narrowed to the candidates actually in front of us rather than loading every
 * application in the organization: a filter over 200 ids is an index lookup, and
 * the alternative grows with the tenant instead of with the page.
 */
async function visibleCandidateIds({
  organizationId,
  viewerId,
  candidateIds,
}: {
  organizationId: string;
  viewerId: string;
  candidateIds: string[];
}): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select("candidate_id")
    .eq("organization_id", organizationId)
    .in("candidate_id", candidateIds)
    .or(`assigned_recruiter_id.eq.${viewerId},assigned_recruiter_id.is.null`);

  if (error) {
    // Fails towards SHOWING NOTHING rather than showing everything. A read we
    // could not complete must not widen what somebody sees.
    console.error(`[messaging] recruiter scope read failed: ${formatDbError(error)}`);
    return new Set();
  }

  return new Set(((data ?? []) as { candidate_id: string }[]).map((row) => row.candidate_id));
}

export type ConversationListResult = {
  conversations: ConversationSummary[];
  /** True when the read failed — never rendered as "no conversations". */
  failed: boolean;
};

/**
 * Every thread this viewer may see, most recent first.
 *
 * UNMATCHED THREADS ARE SHOWN TO RECRUITERS TOO, and that is a decision rather
 * than an oversight. A thread with no candidate is by definition assigned to
 * nobody, so the scoping rule has nothing to say about it — and hiding it from
 * everyone but an Admin means the people most likely to recognise the number
 * never see it, and it is never linked to anyone.
 */
export async function listConversations({
  organizationId,
  viewerRole,
  viewerId,
}: {
  organizationId: string;
  viewerRole: OrgRole;
  viewerId: string;
}): Promise<ConversationListResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false })
    .limit(CONVERSATION_LIMIT);

  if (error) {
    console.error(`[messaging] conversation list failed: ${formatDbError(error)}`);
    return { conversations: [], failed: true };
  }

  const rows = ((data ?? []) as unknown as ConversationRow[]).map(flatten);

  if (viewerRole !== "recruiter") return { conversations: rows, failed: false };

  const visible = await visibleCandidateIds({
    organizationId,
    viewerId,
    candidateIds: rows
      .map((row) => row.candidate_id)
      .filter((id): id is string => id !== null),
  });

  return {
    conversations: rows.filter(
      (row) => row.candidate_id === null || visible.has(row.candidate_id)
    ),
    failed: false,
  };
}

export type ThreadView = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  /** The candidate's most recent live application, for the header chip. */
  application: { id: string; job_title: string | null } | null;
  optedOut: boolean;
  /** True when the opt-out read failed. Never rendered as "not opted out". */
  optOutUnknown: boolean;
};

/**
 * One thread: the conversation, its whole timeline, and what a reply must know.
 *
 * Returns null for a thread in another tenant AND for one this Recruiter is not
 * scoped to, so a guessed id is indistinguishable from a missing one — the same
 * shape every id-addressed read in this product uses.
 */
export async function getConversation({
  organizationId,
  conversationId,
  viewerRole,
  viewerId,
}: {
  organizationId: string;
  conversationId: string;
  viewerRole: OrgRole;
  viewerId: string;
}): Promise<ThreadView | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    console.error(`[messaging] conversation read failed: ${formatDbError(error)}`);
    return null;
  }
  if (!data) return null;

  const conversation = flatten(data as unknown as ConversationRow);

  if (viewerRole === "recruiter" && conversation.candidate_id !== null) {
    const visible = await visibleCandidateIds({
      organizationId,
      viewerId,
      candidateIds: [conversation.candidate_id],
    });
    if (!visible.has(conversation.candidate_id)) return null;
  }

  const [messages, application, optOut] = await Promise.all([
    listConversationMessages({ organizationId, conversationId }),
    conversation.candidate_id
      ? latestApplication({ organizationId, candidateId: conversation.candidate_id })
      : Promise.resolve(null),
    conversation.candidate_id
      ? readOptOut({ organizationId, candidateId: conversation.candidate_id })
      : Promise.resolve({ optedOut: false, unknown: false }),
  ]);

  return {
    conversation,
    messages,
    application,
    optedOut: optOut.optedOut,
    optOutUnknown: optOut.unknown,
  };
}

/**
 * The timeline, OLDEST FIRST.
 *
 * The opposite order to CommunicationLog's, and deliberately so: that is a log,
 * read newest-first like an audit trail, and this is a conversation, read the
 * way a chat is read. Same table, same rows, different question.
 */
export async function listConversationMessages({
  organizationId,
  conversationId,
}: {
  organizationId: string;
  conversationId: string;
}): Promise<ConversationMessage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_log")
    .select(
      "id, direction, body_sent, status, error_message, created_at, sent_at, " +
        "sender:users!message_log_sent_by_fkey(name, email)"
    )
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MESSAGE_LIMIT);

  if (error) {
    console.error(`[messaging] thread read failed: ${formatDbError(error)}`);
    return [];
  }

  type Row = {
    id: string;
    direction: "outbound" | "inbound";
    body_sent: string;
    status: string;
    error_message: string | null;
    created_at: string;
    sent_at: string | null;
    sender: { name: string | null; email: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    direction: row.direction,
    body: row.body_sent,
    status: row.status,
    error_message: row.error_message,
    // Null on an automatic send is the schema's own meaning, and the bubble
    // renders it as "Automatic" rather than as a missing name.
    sender_name: row.sender ? row.sender.name ?? row.sender.email : null,
    created_at: row.created_at,
    sent_at: row.sent_at,
  }));
}

async function latestApplication({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<{ id: string; job_title: string | null } | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("applications")
    .select("id, job:jobs(title)")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    // Archived applications are not "live", and a chip pointing at one would
    // send a recruiter to a closed record as if it were the current one.
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as { id: string; job: { title: string } | null };
  return { id: row.id, job_title: row.job?.title ?? null };
}

async function readOptOut({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<{ optedOut: boolean; unknown: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("candidate_communication_preferences")
    .select("whatsapp_opted_out")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (error) {
    console.error(`[messaging] opt-out read failed: ${formatDbError(error)}`);
    return { optedOut: false, unknown: true };
  }

  return {
    optedOut: (data as { whatsapp_opted_out: boolean } | null)?.whatsapp_opted_out === true,
    unknown: false,
  };
}

/**
 * Threads with unread inbound messages, for the nav badge.
 *
 * Counts THREADS, not messages — the same thing an email client's badge counts,
 * and the number a recruiter can act on ("four people are waiting" rather than
 * "eleven messages are waiting").
 *
 * Returns null on failure, never 0. A badge silently reading zero because the
 * query broke is the fake zero AGENTS.md forbids, and it would hide exactly the
 * candidate who is waiting for an answer.
 *
 * Scoped for a Recruiter like the list itself, so the badge cannot promise
 * threads the inbox will not show. Cheap despite the second query: only unread
 * threads are considered, and a shared inbox with hundreds of those has a
 * problem the badge is not going to solve.
 */
export async function countUnreadConversations({
  organizationId,
  viewerRole,
  viewerId,
}: {
  organizationId: string;
  viewerRole: OrgRole;
  viewerId: string;
}): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, candidate_id")
    .eq("organization_id", organizationId)
    .gt("unread_count", 0)
    .limit(CONVERSATION_LIMIT);

  if (error) {
    console.error(`[messaging] unread count failed: ${formatDbError(error)}`);
    return null;
  }

  const rows = (data ?? []) as { id: string; candidate_id: string | null }[];
  if (viewerRole !== "recruiter") return rows.length;

  const visible = await visibleCandidateIds({
    organizationId,
    viewerId,
    candidateIds: rows
      .map((row) => row.candidate_id)
      .filter((id): id is string => id !== null),
  });

  return rows.filter((row) => row.candidate_id === null || visible.has(row.candidate_id)).length;
}

/**
 * Does this candidate have a WhatsApp thread, and which one?
 *
 * Used by the Candidate and Application pages to decide whether to offer "View
 * full conversation" — the link is only shown when there is something to open.
 */
export async function findConversationForCandidate({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // A missing link is a smaller failure than a broken page, so this one is
    // swallowed rather than surfaced.
    console.error(`[messaging] conversation lookup failed: ${formatDbError(error)}`);
    return null;
  }

  return (data as { id: string } | null)?.id ?? null;
}
