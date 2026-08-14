// =============================================================================
// Organization-timezone date math.
//
// Spec rule, applies to every module: any "today" / "this week" calculation uses
// the ORGANIZATION's configured timezone — never the server's and never the
// browser's. A recruiter in Gurgaon and a server in us-east-1 must agree on
// which applications arrived "today".
//
// Implemented with Intl rather than a date library so there is no dependency to
// keep in sync with the tz database.
// =============================================================================

export const FALLBACK_TIME_ZONE = "UTC";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Falls back to UTC for a missing/garbage timezone rather than throwing — an
 * organization with a bad timezone value should see a slightly-off dashboard,
 * not a crashed one.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone || !isValidTimeZone(timeZone)) return FALLBACK_TIME_ZONE;
  return timeZone;
}

/**
 * Milliseconds to ADD to a UTC instant to get the wall-clock reading in `timeZone`.
 * Positive east of Greenwich (Asia/Kolkata -> +19_800_000).
 */
function zoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // Re-read the wall clock as though it were UTC, then diff against the real
  // instant. Hour is mod 24 because some locales render midnight as "24".
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );

  // Drop sub-second precision from the instant so it matches asIfUtc's 0ms.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the current day began in `timeZone`.
 *
 * Two-pass: the offset is first sampled at `at`, but a DST transition may have
 * occurred between local midnight and now (so midnight's offset differs). The
 * second pass re-samples at the candidate instant and corrects.
 */
export function startOfDayInZone(timeZone: string, at: Date = new Date()): Date {
  const zone = resolveTimeZone(timeZone);

  const firstOffset = zoneOffsetMs(zone, at);
  const wall = new Date(at.getTime() + firstOffset);
  const wallMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());

  // Pass 2 — local midnight was SKIPPED by a DST jump, so its offset differs
  // from the offset sampled at `at`.
  let candidate = new Date(wallMidnight - firstOffset);
  const secondOffset = zoneOffsetMs(zone, candidate);
  if (secondOffset !== firstOffset) {
    candidate = new Date(wallMidnight - secondOffset);
  }

  // Pass 3 — local midnight happened TWICE. A few zones end DST at 01:00 ->
  // 00:00 local (America/Havana, Atlantic/Azores), so there are two instants
  // reading 00:00 and passes 1-2 both land on the LATER one, losing the first
  // hour of the day. Prefer the earliest instant that still reads as this local
  // date. Verified against all Intl zones for 2025-2027.
  const earlierOffset = zoneOffsetMs(zone, new Date(candidate.getTime() - 3 * 60 * 60 * 1000));
  if (earlierOffset !== zoneOffsetMs(zone, candidate)) {
    const earlier = new Date(wallMidnight - earlierOffset);
    if (earlier < candidate && dayKeyInZone(zone, earlier) === dayKeyInZone(zone, candidate)) {
      candidate = earlier;
    }
  }

  return candidate;
}

/**
 * Half-open [start, end) bounds of "today" in `timeZone`, as UTC instants —
 * the shape SQL range filters want (`>= start and < end`).
 */
export function dayRangeInZone(
  timeZone: string,
  at: Date = new Date()
): { start: Date; end: Date } {
  const start = startOfDayInZone(timeZone, at);
  // +26h lands inside the following day even when a DST shift makes today 23h
  // or 25h long; snapping that back to midnight gives the exact boundary.
  const end = startOfDayInZone(timeZone, new Date(start.getTime() + 26 * 60 * 60 * 1000));
  return { start, end };
}

/** ISO date key ("2026-08-13") for the current day in `timeZone`. Cache keys. */
export function dayKeyInZone(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Human-readable day label for the dashboard header. */
export function formatDayInZone(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimeZone(timeZone),
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);
}

/**
 * Whole days elapsed since `since`. Used for aging/overdue thresholds.
 *
 * Tolerates null/undefined/garbage: a single bad timestamp in a result set must
 * not throw, because callers map over rows and one exception would empty the
 * whole list (and, worse, look like "nothing to show").
 */
export function daysSince(
  since: string | Date | null | undefined,
  now: Date = new Date()
): number {
  if (since === null || since === undefined) return 0;
  const then = typeof since === "string" ? new Date(since) : since;
  if (!(then instanceof Date) || Number.isNaN(then.getTime())) return 0;
  return Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}
