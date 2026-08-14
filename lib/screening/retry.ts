// =============================================================================
// Screening call retry policy.
//
// The spec's headline test for this module is "retry policy respects max
// attempts and delay exactly as configured". This is a pure function so that is
// checkable without dialling anyone.
//
// The attempt cap does double duty:
//   - cost. The AI & Calling Cost Model chapter names the Bolna call as "the
//     highest single-event cost" and says the retry cap "doubles as a cost cap".
//   - decency. Every attempt telephones a real person. Three unanswered calls is
//     persistence; ten is harassment, and a runaway automation bug that dialled
//     someone repeatedly would be a serious harm, not just a large bill.
// =============================================================================

export type RetryPolicy = {
  /** Total attempts allowed per application, including the first. */
  maxAttempts: number;
  /** Minimum wait between attempts. */
  delayMinutes: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  delayMinutes: 120,
};

/** Bounds on what an organization may configure, once Module 17 exposes it. */
export const MAX_ALLOWED_ATTEMPTS = 5;
export const MIN_ALLOWED_DELAY_MINUTES = 15;

/** Call outcomes worth trying again. */
export const RETRYABLE_STATUSES = ["no_answer", "busy", "failed"] as const;

/**
 * Outcomes that must NEVER be retried automatically.
 *
 * `callback_requested` is the important one: the candidate asked to be called at
 * a different time, and dialling them again on our schedule ignores what they
 * said. A human decides when.
 */
export const TERMINAL_STATUSES = [
  "completed",
  "answered",
  "cancelled",
  "callback_requested",
] as const;

export type CallStatus = (typeof RETRYABLE_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number] | "queued" | "dialing";

export function normalizeRetryPolicy(raw: unknown): RetryPolicy {
  const settings = (raw ?? {}) as Record<string, unknown>;

  const attemptsRaw = Number(settings.maxAttempts);
  const delayRaw = Number(settings.delayMinutes);

  const maxAttempts =
    Number.isFinite(attemptsRaw) && attemptsRaw >= 1
      ? Math.min(Math.floor(attemptsRaw), MAX_ALLOWED_ATTEMPTS)
      : DEFAULT_RETRY_POLICY.maxAttempts;

  const delayMinutes =
    Number.isFinite(delayRaw) && delayRaw >= MIN_ALLOWED_DELAY_MINUTES
      ? Math.floor(delayRaw)
      : DEFAULT_RETRY_POLICY.delayMinutes;

  return { maxAttempts, delayMinutes };
}

export type RetryDecision =
  | { shouldRetry: true; nextAttemptNumber: number; earliestAt: Date }
  | { shouldRetry: false; reason: string };

export type LastAttempt = {
  attemptNumber: number;
  status: CallStatus;
  /** When the attempt finished, or was created if it never started. */
  endedAt: Date;
};

/**
 * Decides whether another attempt is due.
 *
 * Returns the EARLIEST permitted time rather than scheduling anything: the
 * caller decides when to act, and the decision stays testable.
 */
export function decideRetry({
  lastAttempt,
  policy,
  now = new Date(),
}: {
  lastAttempt: LastAttempt;
  policy: RetryPolicy;
  now?: Date;
}): RetryDecision {
  if ((TERMINAL_STATUSES as readonly string[]).includes(lastAttempt.status)) {
    if (lastAttempt.status === "callback_requested") {
      return {
        shouldRetry: false,
        // Not a failure — a request we are obliged to respect.
        reason: "The candidate asked to be called back at another time. Schedule this manually.",
      };
    }
    return { shouldRetry: false, reason: "This call reached a final outcome." };
  }

  if (lastAttempt.status === "queued" || lastAttempt.status === "dialing") {
    return { shouldRetry: false, reason: "A call is already in progress." };
  }

  if (lastAttempt.attemptNumber >= policy.maxAttempts) {
    return {
      shouldRetry: false,
      reason: `Reached the maximum of ${policy.maxAttempts} attempts.`,
    };
  }

  const earliestAt = new Date(lastAttempt.endedAt.getTime() + policy.delayMinutes * 60_000);

  if (now < earliestAt) {
    const minutesLeft = Math.ceil((earliestAt.getTime() - now.getTime()) / 60_000);
    return {
      shouldRetry: false,
      reason: `Too soon — the next attempt is allowed in ${minutesLeft} minute${
        minutesLeft === 1 ? "" : "s"
      }.`,
    };
  }

  return {
    shouldRetry: true,
    nextAttemptNumber: lastAttempt.attemptNumber + 1,
    earliestAt,
  };
}

/**
 * Whether a first call may be placed at all.
 *
 * Separate from decideRetry because "no attempts yet" is a different question
 * from "should we try again", and conflating them is how an attempt cap gets
 * accidentally bypassed.
 */
export function canPlaceFirstCall({
  existingAttempts,
  policy,
}: {
  existingAttempts: number;
  policy: RetryPolicy;
}): { ok: true } | { ok: false; reason: string } {
  if (existingAttempts === 0) return { ok: true };

  if (existingAttempts >= policy.maxAttempts) {
    return {
      ok: false,
      reason: `This application has already used all ${policy.maxAttempts} screening attempts.`,
    };
  }

  return { ok: true };
}
