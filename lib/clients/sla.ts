// =============================================================================
// Client feedback turnaround.
//
// The spec's test: "Feedback turnaround calculation matches
// requested_at/responded_at exactly." So this is a pure function of those two
// timestamps, with no clock of its own for closed events.
//
// Module 16 reports "Average Client Feedback Time" from the same computation.
// =============================================================================

export type FeedbackEvent = {
  id: string;
  requestedAt: string;
  /** NULL means still waiting — the case the SLA is actually about. */
  respondedAt: string | null;
};

export type TurnaroundStatus = "responded_on_time" | "responded_late" | "waiting" | "overdue";

export type Turnaround = {
  status: TurnaroundStatus;
  /** Hours from request to response, or to now while waiting. */
  hours: number;
  days: number;
  /** Days past the SLA; 0 when within it. */
  overdueDays: number;
};

const HOURS_PER_DAY = 24;

/**
 * Turnaround for one feedback event.
 *
 * For a CLOSED event the answer depends only on the two timestamps — `now` is
 * irrelevant, which is what makes the calculation reproducible and auditable.
 * `now` is used only to measure how long an open request has been waiting.
 */
export function computeTurnaround({
  event,
  slaDays,
  now = new Date(),
}: {
  event: FeedbackEvent;
  slaDays: number;
  now?: Date;
}): Turnaround {
  const requested = new Date(event.requestedAt);
  if (Number.isNaN(requested.getTime())) {
    return { status: "waiting", hours: 0, days: 0, overdueDays: 0 };
  }

  const end = event.respondedAt ? new Date(event.respondedAt) : now;
  if (Number.isNaN(end.getTime())) {
    return { status: "waiting", hours: 0, days: 0, overdueDays: 0 };
  }

  // Clamp: a responded_at before requested_at is bad data, not negative time.
  const elapsedMs = Math.max(0, end.getTime() - requested.getTime());
  const hours = elapsedMs / 3_600_000;
  const days = Math.floor(hours / HOURS_PER_DAY);

  const withinSla = days <= slaDays;
  const overdueDays = withinSla ? 0 : days - slaDays;

  if (event.respondedAt) {
    return {
      status: withinSla ? "responded_on_time" : "responded_late",
      hours: round1(hours),
      days,
      overdueDays,
    };
  }

  return {
    status: withinSla ? "waiting" : "overdue",
    hours: round1(hours),
    days,
    overdueDays,
  };
}

export type ClientFeedbackStats = {
  totalSubmissions: number;
  responded: number;
  pending: number;
  overdue: number;
  /** Mean turnaround across RESPONDED events only, in days. */
  averageResponseDays: number | null;
  /** Median, which is less distorted by one client who took three months. */
  medianResponseDays: number | null;
  onTimeRate: number | null;
};

/**
 * Aggregate stats for a client.
 *
 * Averages are computed over responded events only. Including pending ones
 * would mix "took 2 days" with "hasn't answered yet", which is not an average
 * of anything. Rates return null rather than 0 on an empty sample — the spec's
 * insufficient-data rule, since 0% and "no data" mean very different things to
 * an account manager.
 */
export function computeClientStats({
  events,
  slaDays,
  now = new Date(),
}: {
  events: FeedbackEvent[];
  slaDays: number;
  now?: Date;
}): ClientFeedbackStats {
  const turnarounds = events.map((event) => ({
    event,
    turnaround: computeTurnaround({ event, slaDays, now }),
  }));

  const responded = turnarounds.filter((entry) => entry.event.respondedAt !== null);
  const pending = turnarounds.filter((entry) => entry.event.respondedAt === null);
  const overdue = pending.filter((entry) => entry.turnaround.status === "overdue");

  const respondedDays = responded
    .map((entry) => entry.turnaround.hours / HOURS_PER_DAY)
    .sort((a, b) => a - b);

  const averageResponseDays =
    respondedDays.length > 0
      ? round1(respondedDays.reduce((sum, value) => sum + value, 0) / respondedDays.length)
      : null;

  const medianResponseDays =
    respondedDays.length > 0 ? round1(median(respondedDays)) : null;

  const onTime = responded.filter(
    (entry) => entry.turnaround.status === "responded_on_time"
  ).length;

  return {
    totalSubmissions: events.length,
    responded: responded.length,
    pending: pending.length,
    overdue: overdue.length,
    averageResponseDays,
    medianResponseDays,
    onTimeRate: responded.length > 0 ? Math.round((onTime / responded.length) * 100) : null,
  };
}

/** Outstanding requests past SLA, most overdue first. */
export function overdueFeedbackRequests({
  events,
  slaDays,
  now = new Date(),
}: {
  events: FeedbackEvent[];
  slaDays: number;
  now?: Date;
}): { event: FeedbackEvent; overdueDays: number }[] {
  return events
    .map((event) => ({ event, turnaround: computeTurnaround({ event, slaDays, now }) }))
    .filter((entry) => entry.turnaround.status === "overdue")
    .map((entry) => ({ event: entry.event, overdueDays: entry.turnaround.overdueDays }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

/** Human-readable turnaround, for the client detail page. */
export function describeTurnaround(turnaround: Turnaround): string {
  const dayLabel = (days: number) => `${days} day${days === 1 ? "" : "s"}`;

  switch (turnaround.status) {
    case "responded_on_time":
      return turnaround.days === 0
        ? "Responded same day"
        : `Responded in ${dayLabel(turnaround.days)}`;
    case "responded_late":
      return `Responded in ${dayLabel(turnaround.days)} — ${dayLabel(turnaround.overdueDays)} over`;
    case "waiting":
      return turnaround.days === 0
        ? "Awaiting response"
        : `Waiting ${dayLabel(turnaround.days)}`;
    case "overdue":
      return `Waiting ${dayLabel(turnaround.days)} — ${dayLabel(turnaround.overdueDays)} over`;
  }
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
