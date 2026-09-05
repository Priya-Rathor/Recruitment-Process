// =============================================================================
// The "Wait, then…" primitive.
//
// PURE and client-safe — the builder UI imports it. The queue reads and writes
// live in lib/workflow/delayQueue.ts (server).
//
// -----------------------------------------------------------------------------
// TWO KINDS OF WAIT, AND THE DIFFERENCE MATTERS.
//
//   after  — "wait 30 minutes, then send the thank-you". Measured from the
//            moment the wait was scheduled.
//
//   before — "send the reminder 15 minutes before the call". Measured BACKWARDS
//            from a scheduled time that already exists on another row.
//
// The brief's test names the second explicitly: the pre-call reminder must fire
// "at the configured offset before the actual scheduled time (not a fixed clock
// time)". A single `after` primitive cannot express that — the offset would have
// to be computed by whoever configured the rule, against a call that had not
// been scheduled yet, and it would be wrong the moment anybody rescheduled.
//
// So `before` resolves its due time from the row at SCHEDULE time, and a
// reschedule that lands after the due time simply means the reminder already
// went — which is the honest outcome and is recorded as such, rather than a
// second reminder for a call that moved.
//
// -----------------------------------------------------------------------------
// WHY THE UNIT IS MINUTES ALL THE WAY DOWN.
//
// The UI offers minutes and hours; both are stored as minutes. Two units in the
// database would mean every reader has to normalise, and the first one that
// forgot would produce a wait sixty times too long or too short.
// =============================================================================

export const DELAY_BASES = ["after", "before_scheduled_call", "before_interview"] as const;
export type DelayBasis = (typeof DELAY_BASES)[number];

export function isDelayBasis(value: unknown): value is DelayBasis {
  return typeof value === "string" && (DELAY_BASES as readonly string[]).includes(value);
}

export const DELAY_BASIS_LABELS: Record<DelayBasis, string> = {
  after: "After this stage's other actions",
  before_scheduled_call: "Before the scheduled screening call",
  before_interview: "Before the scheduled interview",
};

/**
 * The longest wait this will accept: 30 days.
 *
 * Not arbitrary. A pending row is cancelled when the application moves stage, so
 * a wait longer than an application realistically sits in one stage would be a
 * row that can only ever be cancelled — a queue full of things that will never
 * fire, which makes the queue useless as a thing to look at. Thirty days is
 * comfortably longer than any stage in this pipeline and short enough that the
 * table stays readable.
 */
export const MAX_DELAY_MINUTES = 30 * 24 * 60;

/** Below a minute is not a wait, it is a race with the action before it. */
export const MIN_DELAY_MINUTES = 1;

export type DelayConfig = {
  minutes: number;
  basis: DelayBasis;
};

export type DelayValidation =
  | { ok: true; delay: DelayConfig }
  | { ok: false; error: string };

export function validateDelay(config: Record<string, unknown> | undefined): DelayValidation {
  const raw = config?.delay_minutes;
  const minutes = Number(raw);

  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return { ok: false, error: "How long should this wait? Give a whole number of minutes." };
  }
  if (minutes < MIN_DELAY_MINUTES) {
    return { ok: false, error: "A wait has to be at least one minute." };
  }
  if (minutes > MAX_DELAY_MINUTES) {
    return { ok: false, error: "A wait can be at most 30 days." };
  }

  const basis = config?.delay_basis;
  if (basis !== undefined && !isDelayBasis(basis)) {
    return { ok: false, error: "That isn't a valid thing to measure the wait from." };
  }

  return { ok: true, delay: { minutes, basis: isDelayBasis(basis) ? basis : "after" } };
}

/**
 * When a wait becomes due.
 *
 * `anchor` is the scheduled time for a `before_*` basis, and is ignored for
 * `after`. A `before_*` wait with NO anchor returns null — the caller must treat
 * that as "cannot schedule", never as "fire now". Firing now would send a
 * "you'll be getting a call shortly" message to somebody with no call booked.
 */
export function dueAt({
  delay,
  now,
  anchor,
}: {
  delay: DelayConfig;
  now: Date;
  /** The scheduled call/interview time, for a `before_*` basis. */
  anchor?: Date | null;
}): Date | null {
  if (delay.basis === "after") {
    return new Date(now.getTime() + delay.minutes * 60_000);
  }

  if (!anchor) return null;

  const due = new Date(anchor.getTime() - delay.minutes * 60_000);

  /**
   * A due time already in the past fires on the next sweep rather than being
   * discarded.
   *
   * The case: a call booked for twenty minutes from now, with a fifteen-minute
   * reminder configured. The reminder's due time is five minutes ago. Discarding
   * it would silently drop a message for a call that is genuinely about to
   * happen; firing it late is what a person would do.
   *
   * The bound is the anchor itself. Past the call there is nothing to remind
   * anybody about, and a "your call is shortly" message arriving after the call
   * is worse than none.
   */
  if (due.getTime() >= anchor.getTime()) return null;

  return due;
}

/** "30 minutes" / "2 hours" / "1 day 4 hours" — for the action card. */
export function describeDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours < 24) {
    const head = `${hours} hour${hours === 1 ? "" : "s"}`;
    return remainder === 0 ? head : `${head} ${remainder} min`;
  }

  const days = Math.floor(hours / 24);
  const spareHours = hours % 24;
  const head = `${days} day${days === 1 ? "" : "s"}`;
  return spareHours === 0 ? head : `${head} ${spareHours} hr`;
}

/**
 * The dedupe key for one wait.
 *
 * Deliberately contains NO timestamp, for the same reason the sweep's
 * `time_elapsed_in_stage` key does not: every attempt to schedule the same wait
 * for the same occasion must compute the same string, so the second one is
 * rejected by the unique index rather than queuing a duplicate message.
 *
 * The occasion is (stage, branch, position in the action list). Position is in
 * there because one stage may legitimately hold two waits — "remind them 15
 * minutes before" and "thank them 30 minutes after" — and those are different
 * promises that must not collapse into one.
 */
export function delayDedupeKey({
  stageKey,
  branch,
  actionIndex,
}: {
  stageKey: string;
  branch: string;
  actionIndex: number;
}): string {
  return `wait:${stageKey}:${branch}:${actionIndex}`;
}
