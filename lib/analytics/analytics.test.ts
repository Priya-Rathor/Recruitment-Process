import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  computeAutomationMetrics,
  computeInterviewMetrics,
  computeScreeningMetrics,
  computeSourcePerformance,
  computeStageDurations,
  computeTimeToHire,
  estimateTimeSaved,
  findBottleneck,
  formatRate,
  rate,
  MIN_SAMPLE_FOR_RATE,
  type FunnelRow,
} from "@/lib/analytics/metrics";
import {
  compare,
  directionFor,
  METRIC_DIRECTIONS,
  trendArrow,
  trendColor,
} from "@/lib/analytics/trends";

function funnelRow(overrides: Partial<FunnelRow> = {}): FunnelRow {
  return {
    application_id: Math.random().toString(36).slice(2),
    source: "manual",
    current_stage: "new",
    assigned_recruiter_id: null,
    job_id: "job-1",
    client_id: null,
    created_at: "2026-08-01T09:00:00.000Z",
    hired_at: null,
    reached_screening: false,
    reached_shortlisted: false,
    reached_client_review: false,
    reached_interview: false,
    reached_offer: false,
    reached_hired: false,
    reached_rejected: false,
    screening_call_attempted: false,
    screening_call_completed: false,
    match_score: null,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Zero-denominator safety — the spec names it directly.
// -----------------------------------------------------------------------------
describe("rate", () => {
  it("returns no_data rather than 0% when there is nothing to divide by", () => {
    // 0/0 rendered as "0%" is a statement that nothing converted. It isn't.
    expect(rate(0, 0)).toEqual({ kind: "no_data" });
    expect(formatRate(rate(0, 0))).toBe("—");
  });

  it("returns insufficient rather than a percentage on a tiny sample", () => {
    // "100% hire rate" from one application will be quoted in a meeting.
    const result = rate(1, 1);
    expect(result.kind).toBe("insufficient");
    expect(formatRate(result)).toBe("1/1");
  });

  it("computes a rate once the sample is big enough", () => {
    const result = rate(3, 10);
    expect(result).toEqual({ kind: "rate", percent: 30, numerator: 3, denominator: 10 });
  });

  it("reports a real zero when the sample supports it", () => {
    // 0 out of 20 IS a finding, unlike 0 out of 0.
    const result = rate(0, 20);
    expect(result.kind).toBe("rate");
    if (result.kind === "rate") expect(result.percent).toBe(0);
  });

  it("refuses a negative or non-finite denominator", () => {
    expect(rate(1, -5)).toEqual({ kind: "no_data" });
    expect(rate(1, Number.NaN)).toEqual({ kind: "no_data" });
  });

  it("honours a lower minimum where n=1 is genuinely meaningful", () => {
    expect(rate(1, 1, 1).kind).toBe("rate");
  });
});

// -----------------------------------------------------------------------------
// Funnel
// -----------------------------------------------------------------------------
describe("buildFunnel", () => {
  it("is empty-safe", () => {
    const funnel = buildFunnel([]);
    expect(funnel.total).toBe(0);
    expect(funnel.steps.every((step) => step.count === 0)).toBe(true);
    // Every conversion must be no_data, never 0%.
    expect(
      funnel.steps.slice(1).every((step) => step.conversionFromPrevious?.kind === "no_data")
    ).toBe(true);
  });

  it("counts ever-reached, not current stage", () => {
    // The bug this catches: a hired candidate counted as never shortlisted,
    // because their current stage is 'hired'. That understates every rate.
    const rows = [
      funnelRow({
        current_stage: "hired",
        reached_shortlisted: true,
        reached_interview: true,
        reached_offer: true,
        reached_hired: true,
        screening_call_attempted: true,
      }),
    ];

    const funnel = buildFunnel(rows);
    expect(funnel.steps.find((step) => step.key === "shortlisted")?.count).toBe(1);
    expect(funnel.steps.find((step) => step.key === "hired")?.count).toBe(1);
  });

  it("never lets a later step exceed an earlier one", () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      funnelRow({
        screening_call_attempted: index < 14,
        reached_shortlisted: index < 9,
        reached_interview: index < 5,
        reached_offer: index < 2,
        reached_hired: index < 1,
      })
    );

    const funnel = buildFunnel(rows);
    for (let i = 1; i < funnel.steps.length; i++) {
      expect(
        funnel.steps[i].count,
        `${funnel.steps[i].key} exceeded ${funnel.steps[i - 1].key}`
      ).toBeLessThanOrEqual(funnel.steps[i - 1].count);
    }
  });

  it("counts a placed call, not arrival in the Screening stage", () => {
    // Reporting stage-arrivals as screenings overstates the product's own
    // contribution — the number most likely to be quoted to a customer.
    const rows = [
      funnelRow({ reached_screening: true, screening_call_attempted: false }),
      funnelRow({ reached_screening: true, screening_call_attempted: true }),
    ];

    expect(buildFunnel(rows).steps.find((step) => step.key === "screened")?.count).toBe(1);
  });

  it("computes conversion from the previous step, not from the total", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      funnelRow({
        screening_call_attempted: index < 6,
        reached_shortlisted: index < 3,
      })
    );

    const funnel = buildFunnel(rows);
    const shortlisted = funnel.steps.find((step) => step.key === "shortlisted");

    // 3 of 6 screened = 50%, not 3 of 10 = 30%.
    expect(shortlisted?.conversionFromPrevious).toMatchObject({ kind: "rate", percent: 50 });
  });
});

// -----------------------------------------------------------------------------
// Time to hire
// -----------------------------------------------------------------------------
describe("computeTimeToHire", () => {
  it("reports nothing when nobody was hired", () => {
    const result = computeTimeToHire([funnelRow()]);
    expect(result.averageDays).toBeNull();
    expect(result.medianDays).toBeNull();
    expect(result.sample).toBe(0);
  });

  it("reports both mean and median, and they can differ sharply", () => {
    // The reason the spec asks for a median: one nine-month requisition drags
    // the mean far above anything a manager would recognise.
    const rows = [
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-11T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-13T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-15T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-10-01T00:00:00Z" }),
    ];

    const result = computeTimeToHire(rows);
    expect(result.medianDays).toBe(13);
    expect(result.averageDays).toBeGreaterThan(60);
    expect(result.sample).toBe(4);
  });

  it("flags a sample too small to read", () => {
    const result = computeTimeToHire([
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-21T00:00:00Z" }),
    ]);
    expect(result.sample).toBe(1);
    expect(result.insufficient).toBe(true);
  });

  it("discards a hire dated before its application", () => {
    // Clock skew or a back-dated import would otherwise pull the average down
    // with a negative duration, and nothing on screen would show why.
    const rows = [
      funnelRow({ created_at: "2026-01-10T00:00:00Z", hired_at: "2026-01-01T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-11T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-11T00:00:00Z" }),
      funnelRow({ created_at: "2026-01-01T00:00:00Z", hired_at: "2026-01-11T00:00:00Z" }),
    ];

    const result = computeTimeToHire(rows);
    expect(result.sample).toBe(3);
    expect(result.averageDays).toBe(10);
  });
});

// -----------------------------------------------------------------------------
// Time in stage
// -----------------------------------------------------------------------------
describe("computeStageDurations", () => {
  const SLA = { screening: 2, client_review: 3 } as const;

  it("returns no figures for a stage with no closed visits", () => {
    const result = computeStageDurations({ rows: [], slaDays: SLA });
    const screening = result.find((entry) => entry.stage === "screening");

    expect(screening?.averageDays).toBeNull();
    expect(screening?.sample).toBe(0);
    expect(screening?.overSla).toBe(false);
  });

  it("flags a stage over its SLA", () => {
    const rows = Array.from({ length: 5 }, () => ({
      stage: "client_review" as const,
      days_in_stage: 6,
    }));

    const result = computeStageDurations({ rows, slaDays: SLA });
    expect(result.find((entry) => entry.stage === "client_review")?.overSla).toBe(true);
  });

  it("does not flag a stage on a sample too small to mean it", () => {
    // One slow application is not a bottleneck, and calling it one sends
    // somebody to chase a problem that doesn't exist.
    const rows = [{ stage: "client_review" as const, days_in_stage: 40 }];

    const result = computeStageDurations({ rows, slaDays: SLA });
    const clientReview = result.find((entry) => entry.stage === "client_review");
    expect(clientReview?.overSla).toBe(false);
    expect(clientReview?.insufficient).toBe(true);
  });

  it("uses the median, so one outlier doesn't invent a bottleneck", () => {
    const rows = [
      { stage: "screening" as const, days_in_stage: 1 },
      { stage: "screening" as const, days_in_stage: 1 },
      { stage: "screening" as const, days_in_stage: 1 },
      { stage: "screening" as const, days_in_stage: 1 },
      { stage: "screening" as const, days_in_stage: 180 },
    ];

    const result = computeStageDurations({ rows, slaDays: SLA });
    const screening = result.find((entry) => entry.stage === "screening");

    expect(screening?.medianDays).toBe(1);
    expect(screening?.averageDays).toBeGreaterThan(30);
    // Median is within the 2-day SLA, so not a bottleneck despite the mean.
    expect(screening?.overSla).toBe(false);
  });

  it("finds no bottleneck when everything is within SLA", () => {
    const rows = Array.from({ length: 5 }, () => ({
      stage: "screening" as const,
      days_in_stage: 1,
    }));

    expect(findBottleneck(computeStageDurations({ rows, slaDays: SLA }))).toBeNull();
  });

  it("picks the stage furthest past its own SLA, not the slowest", () => {
    // screening: 5 days against a 2-day SLA = 3 over.
    // client_review: 7 days against a 3-day SLA = 4 over. Slower AND worse.
    const rows = [
      ...Array.from({ length: 5 }, () => ({ stage: "screening" as const, days_in_stage: 5 })),
      ...Array.from({ length: 5 }, () => ({ stage: "client_review" as const, days_in_stage: 7 })),
    ];

    expect(findBottleneck(computeStageDurations({ rows, slaDays: SLA }))?.stage).toBe(
      "client_review"
    );
  });
});

// -----------------------------------------------------------------------------
// THE SPEC'S NAMED TRAP:
//   "for time-to-hire, lower is better - do not assume all increases are positive"
// -----------------------------------------------------------------------------
describe("trend direction", () => {
  it("calls a rising time-to-hire WORSE", () => {
    // The failure this prevents: a month that got 62% slower rendered in
    // reassuring green because the number went up.
    const result = compare({
      current: 34,
      previous: 21,
      direction: "lower_is_better",
      label: "Time to hire",
      unit: " days",
    });

    expect(result.verdict).toBe("worse");
    expect(trendColor(result.verdict)).toBe("var(--color-error)");
  });

  it("calls a falling time-to-hire BETTER", () => {
    const result = compare({
      current: 18,
      previous: 27,
      direction: "lower_is_better",
      label: "Time to hire",
      unit: " days",
    });

    expect(result.verdict).toBe("better");
    expect(trendColor(result.verdict)).toBe("var(--color-success)");
  });

  it("calls a rising hire count BETTER", () => {
    const result = compare({
      current: 21,
      previous: 14,
      direction: "higher_is_better",
      label: "Hires",
    });
    expect(result.verdict).toBe("better");
  });

  it("gives the identical delta opposite verdicts by metric", () => {
    // The clearest statement of the rule: same numbers, opposite meaning.
    const shared = { current: 30, previous: 20, label: "x" };

    expect(compare({ ...shared, direction: "higher_is_better" }).verdict).toBe("better");
    expect(compare({ ...shared, direction: "lower_is_better" }).verdict).toBe("worse");
  });

  it("refuses to judge a neutral metric", () => {
    // Application volume rising is not good or bad on its own — it depends on
    // capacity, and colouring it invents a judgement the data can't support.
    const result = compare({
      current: 900,
      previous: 600,
      direction: "neutral",
      label: "Applications",
    });

    expect(result.verdict).toBe("flat");
    expect(trendColor(result.verdict)).toBeNull();
  });

  it("shows the arrow following the number, not the verdict", () => {
    // A falling time-to-hire is good news AND a down arrow. Flipping the arrow
    // to match the sentiment would misreport the underlying figure.
    const result = compare({
      current: 18,
      previous: 27,
      direction: "lower_is_better",
      label: "Time to hire",
    });

    expect(result.verdict).toBe("better");
    expect(trendArrow(result)).toBe("down");
  });

  it("treats a tiny movement as flat", () => {
    const result = compare({
      current: 20.1,
      previous: 20,
      direction: "lower_is_better",
      label: "Time to hire",
    });
    expect(result.verdict).toBe("flat");
  });

  it("reports insufficient rather than a percentage with no previous period", () => {
    const result = compare({
      current: 30,
      previous: null,
      direction: "higher_is_better",
      label: "Hires",
    });

    expect(result.verdict).toBe("insufficient");
    expect(result.percentChange).toBeNull();
  });

  it("does not divide by a previous value of zero", () => {
    const result = compare({
      current: 5,
      previous: 0,
      direction: "higher_is_better",
      label: "Hires",
    });

    expect(result.percentChange).toBeNull();
    expect(result.delta).toBe(5);
    expect(result.description).not.toContain("Infinity");
  });

  it("declares a direction for every metric it knows about", () => {
    // A metric added without a direction would silently inherit
    // higher-is-better and reintroduce the exact bug this file exists for.
    for (const [metric, direction] of Object.entries(METRIC_DIRECTIONS)) {
      expect(["higher_is_better", "lower_is_better", "neutral"], metric).toContain(direction);
      expect(directionFor(metric as keyof typeof METRIC_DIRECTIONS)).toBe(direction);
    }
  });

  it("marks every duration and failure metric as lower-is-better", () => {
    expect(directionFor("time_to_hire_days")).toBe("lower_is_better");
    expect(directionFor("median_time_to_hire_days")).toBe("lower_is_better");
    expect(directionFor("days_in_stage")).toBe("lower_is_better");
    expect(directionFor("client_response_days")).toBe("lower_is_better");
    expect(directionFor("automation_failures")).toBe("lower_is_better");
    expect(directionFor("no_show_rate")).toBe("lower_is_better");
  });
});

// -----------------------------------------------------------------------------
// Source, screening, interviews, automations
// -----------------------------------------------------------------------------
describe("computeSourcePerformance", () => {
  it("is empty-safe and groups unknown sources", () => {
    expect(computeSourcePerformance([])).toEqual([]);

    const result = computeSourcePerformance([funnelRow({ source: null })]);
    expect(result[0].source).toBe("unknown");
  });

  it("orders by volume and withholds a rate on a tiny sample", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => funnelRow({ source: "referral", reached_hired: true })),
      funnelRow({ source: "job_board", reached_hired: true }),
    ];

    const result = computeSourcePerformance(rows);
    expect(result[0].source).toBe("referral");
    // One referral hire out of one application would otherwise read "100%".
    expect(result[1].hireRate.kind).toBe("insufficient");
  });
});

describe("computeScreeningMetrics", () => {
  it("is empty-safe", () => {
    const result = computeScreeningMetrics([]);
    expect(result.attempted).toBe(0);
    expect(result.answerRate.kind).toBe("no_data");
  });

  it("counts a consent refusal as answered but not completed", () => {
    // Module 8 maps a refusal to 'cancelled'. The candidate DID answer — they
    // asked for a person — so counting it as a no-answer would understate reach
    // and hide the callback signal.
    const rows = Array.from({ length: 4 }, (_, index) => ({
      call_id: `c${index}`,
      status: index === 0 ? "cancelled" : "completed",
      duration_seconds: 120,
      language: "en",
      consent_confirmed: true,
    }));

    const result = computeScreeningMetrics(rows);
    expect(result.answered).toBe(4);
    expect(result.completed).toBe(3);
    expect(result.callbackRequests).toBe(1);
  });
});

describe("estimateTimeSaved", () => {
  it("counts only completed calls", () => {
    // A no-answer saves nobody anything — a recruiter would also have got no
    // answer, and counting it would inflate the headline claim.
    const result = estimateTimeSaved([
      { call_id: "a", status: "no_answer", duration_seconds: null, language: "en", consent_confirmed: false },
      { call_id: "b", status: "completed", duration_seconds: 300, language: "en", consent_confirmed: true },
    ]);

    expect(result.callsCounted).toBe(1);
    expect(result.minutes).toBe(13); // 5 minutes of call + 8 of overhead
  });

  it("states its assumption out loud", () => {
    expect(estimateTimeSaved([]).assumption).toContain("Estimate");
  });
});

describe("computeInterviewMetrics", () => {
  it("is empty-safe", () => {
    const result = computeInterviewMetrics([]);
    expect(result.completionRate.kind).toBe("no_data");
    expect(result.feedbackRate.kind).toBe("no_data");
  });

  it("measures feedback against completed interviews, not scheduled ones", () => {
    // A cancelled interview has no feedback to give; counting it in the
    // denominator would make a diligent team look negligent.
    const rows = [
      { id: "1", status: "completed", has_feedback: true },
      { id: "2", status: "completed", has_feedback: true },
      { id: "3", status: "completed", has_feedback: true },
      { id: "4", status: "cancelled", has_feedback: false },
    ];

    const result = computeInterviewMetrics(rows);
    expect(result.feedbackRate).toMatchObject({ kind: "rate", percent: 100 });
  });
});

describe("computeAutomationMetrics", () => {
  it("excludes skips from the success rate", () => {
    // A rule whose conditions did not match has not "failed to succeed".
    // Including skips would make a healthy narrow rule look broken.
    const rows = [
      { automation_id: "a", automation_name: "Screen", status: "success" },
      { automation_id: "a", automation_name: "Screen", status: "success" },
      { automation_id: "a", automation_name: "Screen", status: "failed" },
      ...Array.from({ length: 50 }, () => ({
        automation_id: "a",
        automation_name: "Screen",
        status: "skipped",
      })),
    ];

    const result = computeAutomationMetrics(rows);
    expect(result.runs).toBe(53);
    expect(result.successRate).toMatchObject({ kind: "rate" });
    if (result.successRate.kind === "rate") {
      expect(result.successRate.denominator).toBe(3);
    }
  });

  it("lists only automations that actually failed, worst first", () => {
    const rows = [
      { automation_id: "a", automation_name: "Good", status: "success" },
      { automation_id: "b", automation_name: "Bad", status: "failed" },
      { automation_id: "b", automation_name: "Bad", status: "failed" },
      { automation_id: "c", automation_name: "Flaky", status: "failed" },
    ];

    const result = computeAutomationMetrics(rows);
    expect(result.failures.map((entry) => entry.name)).toEqual(["Bad", "Flaky"]);
  });
});

describe("MIN_SAMPLE_FOR_RATE", () => {
  it("is above two, because two points give 0/50/100%", () => {
    expect(MIN_SAMPLE_FOR_RATE).toBeGreaterThan(2);
  });
});
