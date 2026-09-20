// =============================================================================
// The inbox's vocabulary and its rules. Pure — no database, no provider, no
// `next/headers`, so the two-pane client UI can import it directly.
//
// The server halves live next door: lib/messaging/queries.ts reads, and
// lib/messaging/inbound.ts is the webhook's write path. Split that way for the
// reason AGENTS.md gives — a client component importing a formatter must not
// drag lib/supabase/admin.ts into the browser bundle, and
// app/settings/clientBoundary.test.ts fails the build if it does.
// =============================================================================

/** Digits only, country code included, no '+'. What Meta and the schema store. */
export type ConversationSummary = {
  id: string;
  candidate_id: string | null;
  /** Null when the number matches no candidate. The inbox says so out loud. */
  candidate_name: string | null;
  phone_number: string;
  last_message_at: string;
  /** Null when the candidate has never written to us. Drives the 24h window. */
  last_inbound_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  /** 0042 — the agent answered the newest message in this thread. */
  last_message_auto_replied: boolean;
  /** 0042 — the agent declined and a person has to answer. */
  needs_human: boolean;
  /** Why, in words a recruiter can act on. Never shown to the candidate. */
  needs_human_reason: string | null;
};

export type ConversationMessage = {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  status: string;
  error_message: string | null;
  /** Null for an automatic send and for every inbound message. */
  sender_name: string | null;
  /**
   * 0042 — drafted by the auto-reply agent.
   *
   * The bubble renders an explicit "Auto-replied" label from this. An agent
   * message must never be presentable as something a person typed, which is why
   * it is a column on the row rather than anything inferred at render time.
   */
  auto_replied: boolean;
  created_at: string;
  sent_at: string | null;
};

// -----------------------------------------------------------------------------
// The 24-hour window
// -----------------------------------------------------------------------------

/**
 * Meta's customer service window.
 *
 * Free-form text is permitted only within 24 hours of the candidate's last
 * INBOUND message. Outside it, a business may only send a template Meta has
 * pre-approved. See fact 1 in lib/integrations/whatsapp/index.ts — this constant
 * is the UI's half of the same fact.
 */
export const SERVICE_WINDOW_HOURS = 24;

export function isWithinServiceWindow(
  lastInboundAt: string | null,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  const last = new Date(lastInboundAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < SERVICE_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Whole hours left in the window, or 0 once it has closed. For the UI's copy. */
export function hoursLeftInWindow(
  lastInboundAt: string | null,
  now: Date = new Date()
): number {
  if (!isWithinServiceWindow(lastInboundAt, now)) return 0;
  const elapsed = now.getTime() - new Date(lastInboundAt as string).getTime();
  return Math.max(0, Math.floor(SERVICE_WINDOW_HOURS - elapsed / 3_600_000));
}

export type ReplyCapability =
  | { canReply: true; mode: "freeform" | "template"; note: string | null }
  | { canReply: false; reason: string };

/**
 * Whether this thread can be replied to right now, and how.
 *
 * ONE FUNCTION, TWO CALLERS, AND ONLY ONE OF THEM IS A BOUNDARY.
 *
 * The composer uses it to disable itself with a reason. The reply route uses it
 * for the two rules that are OURS — the channel being connected and the
 * candidate's opt-out — and enforces those server-side, because a disabled
 * textarea stops nobody holding curl.
 *
 * It does NOT let the route refuse on the 24-hour window, and that is deliberate.
 * The window is Meta's rule, judged from our own `last_inbound_at` bookkeeping,
 * and that bookkeeping can be wrong in the direction that matters: a webhook
 * delivery we dropped leaves a thread looking closed when Meta considers it open.
 * Refusing locally would turn our bug into the recruiter's dead end. So the
 * attempt goes through and the adapter surfaces Meta's own answer — the same wall
 * every other send in this product hits, which is what the spec asks for.
 */
export function replyCapability({
  lastInboundAt,
  metaTemplateConfigured,
  whatsappConnected,
  optedOut,
  now = new Date(),
}: {
  lastInboundAt: string | null;
  /** The org named a Meta-approved template on the integration. */
  metaTemplateConfigured: boolean;
  whatsappConnected: boolean;
  optedOut: boolean;
  now?: Date;
}): ReplyCapability {
  if (!whatsappConnected) {
    return {
      canReply: false,
      reason: "WhatsApp isn't connected, so nothing can be sent from here.",
    };
  }

  if (optedOut) {
    return {
      canReply: false,
      reason: "This candidate has opted out of WhatsApp messages.",
    };
  }

  if (isWithinServiceWindow(lastInboundAt, now)) {
    const hours = hoursLeftInWindow(lastInboundAt, now);
    return {
      canReply: true,
      mode: "freeform",
      note:
        hours <= 2
          ? `Meta's 24-hour reply window closes in under ${Math.max(hours, 1)} hour${hours === 1 ? "" : "s"}.`
          : null,
    };
  }

  if (metaTemplateConfigured) {
    return {
      canReply: true,
      mode: "template",
      // Said plainly, because what arrives on the candidate's phone is the
      // approved template wrapping this text, not the text alone.
      note:
        "Outside Meta's 24-hour window, so this goes out inside your approved " +
        "WhatsApp template rather than as a plain message.",
    };
  }

  return {
    canReply: false,
    // The same remedy sendWhatsApp() gives on a 131047, said before the attempt
    // rather than after it. One wording, so a recruiter who hits it in both
    // places does not think they are two different problems.
    reason:
      "This candidate hasn't messaged you in the last 24 hours, so WhatsApp won't accept a " +
      "plain reply. Configure an approved WhatsApp template name on the integration to send " +
      "outside that window.",
  };
}

// -----------------------------------------------------------------------------
// Opt-out replies
// -----------------------------------------------------------------------------

/**
 * The words that mean "stop messaging me".
 *
 * DELIBERATELY SHORTER THAN THE INDUSTRY LIST. The conventional set also carries
 * CANCEL, END and QUIT, and all three are ordinary things to say in a
 * recruitment thread: "cancel" is a plausible reply to "shall I book you in for
 * Thursday?", and acting on it would silently switch off every future message to
 * a candidate who was answering a question about an interview.
 *
 * An opt-out is effectively irreversible by the candidate — the unsubscribe token
 * cannot re-subscribe anyone (see lib/communications/optout.ts), so opting
 * somebody out by accident needs a recruiter to notice and undo it. Missing a
 * genuine "quit" costs one more message, which the candidate can stop with the
 * word we do honour.
 */
const OPT_OUT_WORDS = ["stop", "stopall", "stop all", "unsubscribe", "optout", "opt out"];

/**
 * True when an inbound message is a request to stop.
 *
 * MATCHES THE WHOLE MESSAGE, NEVER A SUBSTRING. "Please stop by the office at 3"
 * contains "stop" and is not an opt-out; "STOP." and "Stop" are. Punctuation and
 * surrounding whitespace are stripped, because a phone keyboard adds a full stop
 * and nobody typing STOP means it as a sentence.
 */
export function isOptOutReply(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    // Punctuation and emoji off both ends; the inner space of "opt out" survives.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");

  return OPT_OUT_WORDS.includes(normalized);
}

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------

export const MAX_PREVIEW_LENGTH = 120;

/**
 * The one line the conversation list shows.
 *
 * Truncated at WRITE time and stored, so listing 200 threads does not mean
 * reading 200 message bodies to show 200 single lines of them.
 */
export function previewOf(body: string): string {
  const line = body
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);

  if (!line) return "";
  return line.length <= MAX_PREVIEW_LENGTH ? line : `${line.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}

/**
 * The number as a human reads it: "+91 98765 43210".
 *
 * Presentation only — never stored, never sent. The stored form stays exactly
 * what Meta accepts, so a display change can never alter who gets messaged.
 */
export function formatPhoneForDisplay(digits: string): string {
  if (!/^\d{7,15}$/.test(digits)) return digits;

  // India's own grouping, because that is this product's default market and the
  // generic 3-3-4 grouping makes a ten-digit Indian number unreadable.
  if (digits.startsWith("91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }

  /*
    Everything else: even groups of four, and NO attempt to split off a country
    code. Working out where the code ends needs a real numbering-plan database,
    and this project deliberately carries no libphonenumber — so a guess would
    print "+141 5555 2671" for a US number and look like a fact. Arbitrary
    grouping reads as what it is: spacing, to make a number scannable against
    one written on a CV.
  */
  return `+${digits.replace(/(\d{4})(?=\d)/g, "$1 ")}`;
}

/** The thread's title. "Unknown number" is stated, never left blank. */
export function conversationTitle(conversation: ConversationSummary): string {
  return conversation.candidate_name ?? "Unknown number";
}

/** True when nobody has told us who this number belongs to. */
export function isUnmatched(conversation: ConversationSummary): boolean {
  return conversation.candidate_id === null;
}

/**
 * Filters the list by name or number.
 *
 * Runs over the loaded page rather than round-tripping to the server: a shared
 * WhatsApp inbox is hundreds of threads, not millions, and a filter that responds
 * on keypress is worth more here than one that can page through an archive. The
 * digits are compared with punctuation removed, so "+91 98765" finds "919876…".
 */
export function filterConversations(
  conversations: ConversationSummary[],
  query: string
): ConversationSummary[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return conversations;

  const digits = trimmed.replace(/\D/g, "");

  return conversations.filter((conversation) => {
    const name = conversation.candidate_name?.toLowerCase() ?? "";
    if (name.includes(trimmed)) return true;
    return digits.length > 0 && conversation.phone_number.includes(digits);
  });
}

// -----------------------------------------------------------------------------
// 0042 — the inbox's view of the agent
// -----------------------------------------------------------------------------

export type InboxFilter =
  /** Everything, newest first — but with flagged threads lifted to the top. */
  | "all"
  /** Only threads the agent declined. The queue a person has to work through. */
  | "needs_human"
  /** Only threads the agent answered. The spot-check view. */
  | "auto_replied";

export function isInboxFilter(value: unknown): value is InboxFilter {
  return value === "all" || value === "needs_human" || value === "auto_replied";
}

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  needs_human: "Needs human reply",
  auto_replied: "Recent auto-replies",
};

/**
 * Applies the inbox filter, then the ordering.
 *
 * FLAGGED THREADS SORT TO THE TOP of the "All" view, ahead of newer unflagged
 * ones. The same choice the pipeline board makes with most-overdue-first, and
 * for the same reason: a list ordered purely by recency buries the thing
 * somebody has to act on under the things that handled themselves. A candidate
 * the agent declined to answer is waiting on a person, and every auto-replied
 * thread that arrives after them would otherwise push them further down.
 *
 * Within each group the order is unchanged — most recent first, as the server
 * returned it — so the ordering is stable and a thread does not move while
 * somebody is reading it.
 */
export function applyInboxFilter(
  conversations: ConversationSummary[],
  filter: InboxFilter
): ConversationSummary[] {
  if (filter === "needs_human") {
    return conversations.filter((conversation) => conversation.needs_human);
  }

  if (filter === "auto_replied") {
    return conversations.filter((conversation) => conversation.last_message_auto_replied);
  }

  const flagged = conversations.filter((conversation) => conversation.needs_human);
  const rest = conversations.filter((conversation) => !conversation.needs_human);
  return [...flagged, ...rest];
}

/** How many threads are waiting on a person. For the filter's own count. */
export function countNeedsHuman(conversations: ConversationSummary[]): number {
  return conversations.filter((conversation) => conversation.needs_human).length;
}
