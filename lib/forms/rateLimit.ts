// =============================================================================
// Rate limiting a PUBLIC, UNAUTHENTICATED endpoint that reaches an AI provider.
//
// WHY THIS IS IN THE DATABASE AND NOT IN A Map.
//
// This app runs serverless. An in-process counter is per-instance and resets on
// every cold start, so it is not a limit — it is a suggestion that happens to
// work on a warm machine. The ledger is a table (form_submission_attempts) for
// the same reason the coding session's state is: the only thing two concurrent
// invocations share is Postgres.
//
// WHY A HASH AND NOT AN IP ADDRESS.
//
// The limiter's whole question is "same source as before?", which a hash
// answers completely. An IP address is personal data under GDPR, and Module 22
// exists precisely so this product does not collect things casually. So the raw
// value is never stored — not here, not on the response row.
//
// The hash is an HMAC keyed on INTEGRATION_ENCRYPTION_KEY, not a bare SHA-256:
// there are only about four billion IPv4 addresses, so an unkeyed digest of one
// is reversible by anybody with a laptop and an afternoon.
//
// WHAT AN ATTACKER CAN STILL DO, STATED PLAINLY.
//
// x-forwarded-for is a header. Behind Vercel it is set by the platform, but a
// forged value would put a submission in a different bucket — so the per-IP cap
// alone is evadable, and there is a SECOND, per-form cap that no header can
// dodge. It is set high enough that a real hiring campaign never meets it and
// low enough that a script cannot run the parsing pipeline a thousand times.
//
// THE WINDOW IS A ROLLING HOUR, NOT A CALENDAR ONE, so lib/time.ts's
// organization-timezone day ranges do not apply: "three in the last sixty
// minutes" is the same fact in every timezone. Half-open all the same —
// [now - 1h, now] — so an attempt exactly on the boundary belongs to one window
// and not to both.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDbError } from "@/lib/supabase/errors";

/** Per hashed source, per form. Three is a real person's worst day. */
export const MAX_ATTEMPTS_PER_SOURCE = 3;

/**
 * Per form, per hour, across every source — the backstop for a forged
 * x-forwarded-for and for sources this deployment cannot see at all.
 *
 * Sized against the real workload: a job advertised on LinkedIn might take a
 * few dozen applications in a good hour, and a script trying to burn AI credit
 * takes thousands.
 */
export const MAX_ATTEMPTS_PER_FORM = 120;

export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** The bucket used when no client address can be determined. */
export const UNKNOWN_SOURCE = "unknown-source";

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "source" | "form"; message: string };

/**
 * Reads the client address from the proxy headers this deployment sets.
 *
 * Next 15 removed `request.ip` (see node_modules/next/dist/docs — the value
 * comes from the hosting provider now), and `@vercel/functions` is not a
 * dependency of this project, so the headers are read directly.
 *
 * x-forwarded-for is a comma-separated chain appended to by each hop; the
 * ORIGINAL client is the first entry.
 */
export function clientAddressFrom(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
  ];

  for (const value of candidates) {
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first && first.length > 0 && first.length <= 64) return first;
  }
  return null;
}

/**
 * The stored identifier for one source.
 *
 * Returns UNKNOWN_SOURCE when there is no address or no signing key, rather
 * than throwing: a missing header must not stop somebody applying for a job.
 * Those submissions all share one bucket and are governed by the per-form cap.
 */
export async function hashAddress(address: string | null): Promise<string> {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!address || !key || key.length < 32) return UNKNOWN_SOURCE;

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    material,
    new TextEncoder().encode(`form-submitter:${address}`)
  );

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 64);
}

/**
 * The decision, as pure arithmetic over the rows in the window.
 *
 * Separated from the query so it can be unit tested without a database — the
 * off-by-one that matters here ("is the third attempt allowed or refused?") is
 * exactly the kind that silently locks a real applicant out.
 */
export function evaluateAttempts({
  attempts,
  ipHash,
  now,
}: {
  /** Every attempt against this form inside the window. */
  attempts: { ip_hash: string; attempted_at: string }[];
  ipHash: string;
  now: Date;
}): RateVerdict {
  const windowStart = now.getTime() - RATE_WINDOW_MS;

  const inWindow = attempts.filter((attempt) => {
    const at = new Date(attempt.attempted_at).getTime();
    // Half-open: [windowStart, now]. An unparseable timestamp is ignored rather
    // than counted, so a bad row cannot lock a form.
    return Number.isFinite(at) && at >= windowStart;
  });

  if (inWindow.length >= MAX_ATTEMPTS_PER_FORM) {
    return {
      allowed: false,
      reason: "form",
      message:
        "This form has taken a lot of applications in the last hour and is pausing briefly. " +
        "Please try again shortly.",
    };
  }

  // The unknown bucket is shared by everybody whose address could not be read,
  // so it must not be capped at three — that would refuse real applicants on a
  // deployment with no proxy headers at all. The per-form cap covers it.
  if (ipHash === UNKNOWN_SOURCE) return { allowed: true };

  const fromSource = inWindow.filter((attempt) => attempt.ip_hash === ipHash).length;

  if (fromSource >= MAX_ATTEMPTS_PER_SOURCE) {
    return {
      allowed: false,
      reason: "source",
      message:
        "You have already submitted this application a few times. " +
        "If something went wrong, contact the recruiter directly rather than resubmitting.",
    };
  }

  return { allowed: true };
}

/**
 * Checks the limit and records this attempt.
 *
 * RECORDED WHETHER OR NOT IT IS ALLOWED, and before the expensive work: the
 * point of a limit is to make a flood cheap to refuse, so a refused attempt
 * still counts towards the window that refused it.
 *
 * A database failure here ALLOWS the submission. That is the deliberate
 * direction: the cost of a broken limiter is some spam a recruiter deletes, and
 * the cost of failing closed is a real person unable to apply for a job because
 * of an outage on our side.
 */
export async function checkSubmissionRate({
  admin,
  formId,
  ipHash,
  now = new Date(),
}: {
  admin: SupabaseClient;
  formId: string;
  ipHash: string;
  now?: Date;
}): Promise<RateVerdict> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();

  const { data, error } = await admin
    .from("form_submission_attempts")
    .select("ip_hash, attempted_at")
    .eq("form_id", formId)
    .gte("attempted_at", since)
    .limit(MAX_ATTEMPTS_PER_FORM + 50);

  if (error) {
    console.error(`[forms] rate check failed, allowing: ${formatDbError(error)}`);
    return { allowed: true };
  }

  const verdict = evaluateAttempts({
    attempts: (data ?? []) as { ip_hash: string; attempted_at: string }[],
    ipHash,
    now,
  });

  const { error: recordError } = await admin
    .from("form_submission_attempts")
    .insert({ form_id: formId, ip_hash: ipHash });

  if (recordError) {
    console.error(`[forms] recording attempt failed: ${formatDbError(recordError)}`);
  }

  return verdict;
}

/**
 * Deletes attempt rows older than the window.
 *
 * Called opportunistically from the submission path rather than from a cron: the
 * table is only ever read for the last hour, so anything older is dead weight,
 * and a ledger of hashed sources is not something to keep indefinitely for a
 * feature that has no use for it. Best effort — a failed sweep must never fail
 * a submission.
 */
export async function pruneSubmissionAttempts({
  admin,
  formId,
  now = new Date(),
}: {
  admin: SupabaseClient;
  formId: string;
  now?: Date;
}): Promise<void> {
  const cutoff = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  const { error } = await admin
    .from("form_submission_attempts")
    .delete()
    .eq("form_id", formId)
    .lt("attempted_at", cutoff);

  if (error) console.error(`[forms] pruning attempts failed: ${formatDbError(error)}`);
}
