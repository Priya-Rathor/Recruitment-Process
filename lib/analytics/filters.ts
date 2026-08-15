// =============================================================================
// Analytics filters, and the period arithmetic behind "compare with previous".
//
// Pure. Every date boundary is computed in the ORGANIZATION's timezone via
// lib/time.ts — the spec's timezone test is about exactly this: a "last 30
// days" that starts at the server's midnight puts the same application in
// different buckets for a team in Bangalore and a server in Virginia, and the
// numbers stop reconciling with what people see in the pipeline.
// =============================================================================
import { startOfDayInZone } from "@/lib/time";

export const DATE_RANGES = ["7d", "30d", "90d", "12m"] as const;
export type DateRangeKey = (typeof DATE_RANGES)[number];

export const RANGE_LABELS: Record<DateRangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

const RANGE_DAYS: Record<DateRangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

export function isDateRangeKey(value: unknown): value is DateRangeKey {
  return typeof value === "string" && (DATE_RANGES as readonly string[]).includes(value);
}

export type AnalyticsFilters = {
  range: DateRangeKey;
  jobId: string | null;
  clientId: string | null;
  recruiterId: string | null;
  sourceKey: string | null;
  compare: boolean;
};

export const DEFAULT_FILTERS: AnalyticsFilters = {
  range: "30d",
  jobId: null,
  clientId: null,
  recruiterId: null,
  sourceKey: null,
  compare: false,
};

export function filtersFromParams(params: URLSearchParams): AnalyticsFilters {
  const range = params.get("range");

  return {
    range: isDateRangeKey(range) ? range : DEFAULT_FILTERS.range,
    jobId: params.get("job_id"),
    clientId: params.get("client_id"),
    recruiterId: params.get("recruiter_id"),
    sourceKey: params.get("source"),
    compare: params.get("compare") === "true",
  };
}

/** Round-trips filters into a query string, so links preserve them. */
export function filtersToQuery(filters: AnalyticsFilters): string {
  const params = new URLSearchParams();

  if (filters.range !== DEFAULT_FILTERS.range) params.set("range", filters.range);
  if (filters.jobId) params.set("job_id", filters.jobId);
  if (filters.clientId) params.set("client_id", filters.clientId);
  if (filters.recruiterId) params.set("recruiter_id", filters.recruiterId);
  if (filters.sourceKey) params.set("source", filters.sourceKey);
  if (filters.compare) params.set("compare", "true");

  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export type Period = {
  /** Inclusive. */
  start: Date;
  /** EXCLUSIVE — ranges are half-open [start, end), per lib/time.ts. */
  end: Date;
  startIso: string;
  endIso: string;
};

export type PeriodPair = {
  current: Period;
  /** The immediately preceding window of equal length. */
  previous: Period;
  days: number;
};

/**
 * Resolves a range key into the current window and the one before it.
 *
 * Both windows are half-open [start, end) and END at the start of TOMORROW in
 * the organization's timezone — so "last 30 days" includes everything that has
 * happened today. Ending at the start of today would silently omit the current
 * day's work, which is the first thing anyone checks after doing some.
 *
 * The previous window is the same LENGTH immediately before, not "the same
 * dates last month". Comparing a 31-day January against a 28-day February
 * produces a spurious 10% drop every year.
 */
export function resolvePeriods({
  range,
  timeZone,
  now = new Date(),
}: {
  range: DateRangeKey;
  timeZone: string;
  now?: Date;
}): PeriodPair {
  const days = RANGE_DAYS[range];

  // Start of today in the org's zone, then + 1 day for the exclusive end.
  const todayStart = startOfDayInZone(timeZone, now);
  const end = new Date(todayStart.getTime() + 86_400_000);
  const start = new Date(end.getTime() - days * 86_400_000);

  const previousEnd = start;
  const previousStart = new Date(previousEnd.getTime() - days * 86_400_000);

  return {
    days,
    current: {
      start,
      end,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    },
    previous: {
      start: previousStart,
      end: previousEnd,
      startIso: previousStart.toISOString(),
      endIso: previousEnd.toISOString(),
    },
  };
}

/** Human label for the compared window, so a chart caption can name it. */
export function describePeriod(period: Period, timeZone: string): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    });

  // The stored end is exclusive; the label shows the last INCLUDED day, because
  // "to 1 September" for a range ending at midnight on the 1st reads as though
  // September is included when it is not.
  const lastIncluded = new Date(period.end.getTime() - 86_400_000);
  return `${format(period.start)} – ${format(lastIncluded)}`;
}
