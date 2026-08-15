// =============================================================================
// Period-over-period comparison.
//
// THE TRAP THE SPEC CALLS OUT BY NAME:
//
//   "Positive trend #16A34A, negative trend #DC2626 (note: for time-to-hire,
//    lower is better - do not assume all increases are positive)"
//
// Every dashboard that colours by the sign of the delta gets this wrong. A
// time-to-hire that rose from 21 to 34 days is a bad month rendered in
// reassuring green, and nobody notices because green means good.
//
// So direction is a property of the METRIC, declared once, and the colour is
// derived from it. `direction` is a required field on every comparison — there
// is no default, because a default is exactly how a metric ends up silently
// treated as higher-is-better.
// =============================================================================

/** Which way is good. Required — never inferred from the numbers. */
export type MetricDirection =
  /** More is better: hires, conversion rates, answer rates. */
  | "higher_is_better"
  /** Less is better: time-to-hire, days in stage, failure counts. */
  | "lower_is_better"
  /**
   * Neither. Application volume going up is not good or bad on its own — it
   * depends entirely on capacity, and colouring it invents a judgement the data
   * does not support.
   */
  | "neutral";

export type TrendVerdict = "better" | "worse" | "flat" | "insufficient";

export type Comparison = {
  current: number | null;
  previous: number | null;
  /** Absolute change, current − previous. */
  delta: number | null;
  /** Percentage change relative to the previous period. */
  percentChange: number | null;
  direction: MetricDirection;
  verdict: TrendVerdict;
  /** Sentence for a tooltip or the AI's input. Never invents a judgement. */
  description: string;
};

/**
 * Movements smaller than this are reported as flat.
 *
 * Without a band, a time-to-hire moving 20.0 → 20.1 days renders as a red
 * "worse" arrow. Noise dressed as signal trains people to ignore the arrows,
 * which costs more than the occasional missed small move.
 */
export const FLAT_BAND_PERCENT = 2;

/**
 * Compares two periods for one metric.
 *
 * Returns `insufficient` rather than a percentage when the previous period had
 * no data: "up from nothing" is not a percentage change, and rendering it as
 * +100% or ∞ is worse than saying there is no comparison.
 */
export function compare({
  current,
  previous,
  direction,
  label,
  unit = "",
}: {
  current: number | null;
  previous: number | null;
  direction: MetricDirection;
  label: string;
  /** e.g. " days", "%". Rendered directly after the number. */
  unit?: string;
}): Comparison {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      current,
      previous,
      delta: null,
      percentChange: null,
      direction,
      verdict: "insufficient",
      description: `${label}: no comparable figure for the previous period.`,
    };
  }

  const delta = current - previous;

  // A previous value of zero has no meaningful percentage change. Report the
  // absolute movement and stop, rather than dividing by zero.
  if (previous === 0) {
    return {
      current,
      previous,
      delta,
      percentChange: null,
      direction,
      verdict: delta === 0 ? "flat" : verdictFor(delta, direction),
      description:
        delta === 0
          ? `${label}: unchanged at ${current}${unit}.`
          : `${label}: ${current}${unit}, up from none last period.`,
    };
  }

  const percentChange = Math.round((delta / Math.abs(previous)) * 1000) / 10;
  const verdict =
    Math.abs(percentChange) < FLAT_BAND_PERCENT ? "flat" : verdictFor(delta, direction);

  return {
    current,
    previous,
    delta: Math.round(delta * 10) / 10,
    percentChange,
    direction,
    verdict,
    description: describe({ label, current, previous, percentChange, verdict, unit }),
  };
}

/**
 * The heart of it.
 *
 * A rise is "better" only when the metric says more is better. For a
 * lower-is-better metric the same rise is "worse", and for a neutral one it is
 * neither — reported as flat so it renders in ink rather than in a judgement
 * colour.
 */
function verdictFor(delta: number, direction: MetricDirection): TrendVerdict {
  if (delta === 0) return "flat";
  if (direction === "neutral") return "flat";

  const rose = delta > 0;
  if (direction === "higher_is_better") return rose ? "better" : "worse";
  return rose ? "worse" : "better";
}

function describe({
  label,
  current,
  previous,
  percentChange,
  verdict,
  unit,
}: {
  label: string;
  current: number;
  previous: number;
  percentChange: number;
  verdict: TrendVerdict;
  unit: string;
}): string {
  if (verdict === "flat") {
    return `${label}: ${current}${unit}, broadly unchanged from ${previous}${unit}.`;
  }

  const movement = percentChange > 0 ? "up" : "down";
  const magnitude = Math.abs(percentChange);

  return `${label}: ${current}${unit}, ${movement} ${magnitude}% from ${previous}${unit} — ${verdict}.`;
}

/**
 * The design token for a verdict.
 *
 * Returns null for flat and insufficient, so those render in ordinary text
 * rather than borrowing a status colour. The spec reserves Success and Error
 * for real movement, and a sea of coloured tiles makes the genuinely bad one
 * invisible.
 */
export function trendColor(verdict: TrendVerdict): string | null {
  if (verdict === "better") return "var(--color-success)";
  if (verdict === "worse") return "var(--color-error)";
  return null;
}

/**
 * The arrow to render.
 *
 * Follows the NUMBER, not the verdict — a falling time-to-hire shows a down
 * arrow in green. Showing an up arrow because the news is good would misreport
 * the underlying figure, which is the more confusing error.
 */
export function trendArrow(comparison: Comparison): "up" | "down" | "flat" {
  if (comparison.delta === null || comparison.verdict === "flat") return "flat";
  return comparison.delta > 0 ? "up" : "down";
}

/**
 * The declared direction of every metric this module compares.
 *
 * One table, so a new metric has to make a decision rather than inherit one.
 */
export const METRIC_DIRECTIONS = {
  applications: "neutral",
  hires: "higher_is_better",
  time_to_hire_days: "lower_is_better",
  median_time_to_hire_days: "lower_is_better",
  screening_answer_rate: "higher_is_better",
  screening_completion_rate: "higher_is_better",
  interview_completion_rate: "higher_is_better",
  interview_to_offer_rate: "higher_is_better",
  offer_acceptance_rate: "higher_is_better",
  automation_success_rate: "higher_is_better",
  automation_failures: "lower_is_better",
  client_response_days: "lower_is_better",
  days_in_stage: "lower_is_better",
  callback_requests: "lower_is_better",
  no_show_rate: "lower_is_better",
} as const satisfies Record<string, MetricDirection>;

export type MetricKey = keyof typeof METRIC_DIRECTIONS;

export function directionFor(metric: MetricKey): MetricDirection {
  return METRIC_DIRECTIONS[metric];
}
