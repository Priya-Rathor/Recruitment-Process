// =============================================================================
// Live coding session — statuses, transitions, and the pure rules.
//
// No database handle, no fetch, no React. Everything here is a function of its
// arguments, which is why the access rule can be tested directly rather than
// through a route that would need a signed token and a service-role client to
// exercise at all.
//
// THE ACCESS RULE IS THE POINT OF THIS FILE.
//
// A candidate arrives with nothing but a link. Whether that link opens an
// editor, a "this has expired" card, or a "you have already submitted" card is
// the single most user-visible decision in the feature, and getting it wrong in
// either direction is expensive: too strict and a candidate mid-interview is
// locked out of work they are being judged on; too loose and a finished
// submission can be edited after the fact.
// =============================================================================

export const CODING_SESSION_STATUSES = [
  "created",
  "in_progress",
  "submitted",
  "expired",
  "cancelled",
] as const;

export type CodingSessionStatus = (typeof CODING_SESSION_STATUSES)[number];

export function isCodingSessionStatus(value: unknown): value is CodingSessionStatus {
  return (
    typeof value === "string" && (CODING_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

export const STATUS_LABELS: Record<CodingSessionStatus, string> = {
  created: "Ready",
  in_progress: "Coding",
  submitted: "Submitted",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * Chip tone per status, using the shared status tokens.
 *
 * `created` is info rather than neutral: a session that is ready and waiting is
 * something happening, not a resting state — the interviewer is about to share
 * the QR code and wants to see that the link is live.
 */
export const STATUS_TONE: Record<
  CodingSessionStatus,
  "success" | "warning" | "error" | "neutral" | "info"
> = {
  created: "info",
  in_progress: "warning",
  submitted: "success",
  expired: "neutral",
  cancelled: "neutral",
};

/**
 * Statuses from which no further candidate activity is expected.
 *
 * `expired` is in here and `created` is not, which is the whole distinction the
 * candidate page renders from.
 */
export function isTerminalStatus(status: CodingSessionStatus): boolean {
  return status === "submitted" || status === "expired" || status === "cancelled";
}

/**
 * Whether a session may still be worked on, and if not, why.
 *
 * Returns the REASON alongside the verdict so the page never has to re-derive
 * it — the same shape completionCheck() uses in the onboarding module, for the
 * same reason: a boolean would force the caller to guess at the message.
 *
 * ORDER MATTERS. Cancelled is checked before expired because a cancelled
 * session that also happens to be past its expiry was cancelled: telling the
 * candidate "this expired" when a person actually called it off is a small lie
 * that makes the next conversation harder.
 */
export type AccessDecision =
  | { open: true; status: CodingSessionStatus }
  | { open: false; status: CodingSessionStatus; code: AccessRefusal; message: string };

export type AccessRefusal = "cancelled" | "submitted" | "expired";

export function checkSessionAccess({
  status,
  expiresAt,
  now = new Date(),
}: {
  status: CodingSessionStatus;
  expiresAt: string | Date;
  now?: Date;
}): AccessDecision {
  if (status === "cancelled") {
    return {
      open: false,
      status,
      code: "cancelled",
      message:
        "This coding round was cancelled by the interviewer. Nothing you write here would be saved — please speak to them on the call.",
    };
  }

  if (status === "submitted") {
    return {
      open: false,
      status,
      code: "submitted",
      message:
        "You have already submitted this coding round. Your answer has been saved and shared with the interviewer.",
    };
  }

  const expiry = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;

  // An unparseable expiry is treated as expired rather than as open. The
  // alternative is a link that works forever because a timestamp was malformed,
  // and failing closed is the right side of that trade.
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
    return {
      open: false,
      status: status === "expired" ? status : "expired",
      code: "expired",
      message:
        "This coding session has expired. Ask your interviewer to start a new coding round if you still need to complete it.",
    };
  }

  if (status === "expired") {
    return {
      open: false,
      status,
      code: "expired",
      message:
        "This coding session has expired. Ask your interviewer to start a new coding round if you still need to complete it.",
    };
  }

  return { open: true, status };
}

/**
 * Whether an interviewer may still start a coding round for this interview.
 *
 * A cancelled interview has nothing to assess, and a completed one has already
 * been judged — starting a round against either would produce a submission with
 * no interview to attach it to in anybody's mind.
 */
export function canStartCodingRound(interviewStatus: string): { ok: true } | { ok: false; reason: string } {
  if (interviewStatus === "cancelled") {
    return { ok: false, reason: "This interview was cancelled, so there's nothing to assess." };
  }
  if (interviewStatus === "no_show") {
    return { ok: false, reason: "This interview is marked as a no-show." };
  }
  return { ok: true };
}

/**
 * The statuses an OPEN session can be reused from.
 *
 * The API reuses an open session rather than creating a second one when an
 * interviewer clicks "Start Coding Round" twice — a second click is almost
 * always "where did that modal go?", and answering it with a fresh session
 * would invalidate the QR code already on screen in Google Meet.
 */
export function isReusable({
  status,
  expiresAt,
  now = new Date(),
}: {
  status: CodingSessionStatus;
  expiresAt: string | Date;
  now?: Date;
}): boolean {
  return checkSessionAccess({ status, expiresAt, now }).open;
}

/** How long a fresh link stays usable. Generous: an interview can overrun. */
export const DEFAULT_EXPIRY_HOURS = 24;

export function defaultExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
}

/** Bounds mirroring the database CHECK, so the message is readable. */
export const MIN_TIME_LIMIT_MINUTES = 5;
export const MAX_TIME_LIMIT_MINUTES = 480;
export const MAX_QUESTION_TITLE = 200;
export const MAX_INSTRUCTIONS = 4000;
export const MAX_CODE_LENGTH = 200_000;

/**
 * A human phrase for how long ago the code last changed.
 *
 * Lives here rather than in the monitor component so the phrasing is one
 * decision and can be tested. "Just now" covers the polling interval, so a
 * monitor that refreshes every five seconds never flickers between "just now"
 * and "5 seconds ago".
 */
export function describeLastSaved(lastSavedAt: string | Date | null, now: Date = new Date()): string {
  if (!lastSavedAt) return "Nothing saved yet";

  const saved = typeof lastSavedAt === "string" ? new Date(lastSavedAt) : lastSavedAt;
  if (Number.isNaN(saved.getTime())) return "Nothing saved yet";

  const seconds = Math.max(0, Math.floor((now.getTime() - saved.getTime()) / 1000));

  if (seconds < 15) return "Just now";
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
