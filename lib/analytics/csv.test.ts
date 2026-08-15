import { describe, expect, it } from "vitest";
import { escapeCsvCell, exportFilename, reportToCsv, toCsv } from "@/lib/analytics/csv";
import { resolvePeriods, DEFAULT_FILTERS } from "@/lib/analytics/filters";
import { rate, type Rate } from "@/lib/analytics/metrics";
import type { AnalyticsReport } from "@/lib/analytics/report";

describe("escapeCsvCell", () => {
  it("quotes cells containing a comma, quote or newline", () => {
    expect(escapeCsvCell("Smith, John")).toBe('"Smith, John"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  /**
   * CSV injection. A candidate name or job title beginning with =, +, - or @ is
   * EXECUTED as a formula when the file opens in Excel or Sheets, and these
   * values are user-supplied — an exported report is a plausible delivery route.
   */
  it("neutralises a formula-leading cell", () => {
    // The classic payload. What matters is that the cell no longer BEGINS with
    // '=', so no spreadsheet treats it as a formula.
    const attack = escapeCsvCell("=cmd|'/c calc'!A1");
    expect(attack.startsWith("=")).toBe(false);
    expect(attack.startsWith("'")).toBe(true);

    expect(escapeCsvCell("=SUM(A1:A9)").startsWith("'")).toBe(true);
    expect(escapeCsvCell("+1234").startsWith("'")).toBe(true);
    expect(escapeCsvCell("-1+1").startsWith("'")).toBe(true);
    expect(escapeCsvCell("@import").startsWith("'")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCsvCell("Senior Java Developer")).toBe("Senior Java Developer");
    expect(escapeCsvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty, never as a word", () => {
    // "null" in a spreadsheet cell is worse than an empty one — it gets counted.
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("does not mangle a negative number that is genuinely a number", () => {
    // Guarded, but still legible: the value survives with a quote prefix rather
    // than being dropped or altered.
    expect(escapeCsvCell(-5)).toContain("5");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF, as the format expects", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });
});

function emptyRate(): Rate {
  return rate(0, 0);
}

function stubReport(overrides: Partial<AnalyticsReport> = {}): AnalyticsReport {
  return {
    funnel: {
      total: 10,
      steps: [
        { key: "applications", label: "Applications", count: 10, conversionFromPrevious: null },
        { key: "screened", label: "AI screened", count: 6, conversionFromPrevious: rate(6, 10) },
        { key: "shortlisted", label: "Shortlisted", count: 1, conversionFromPrevious: rate(1, 6) },
        { key: "interviews", label: "Interviews", count: 0, conversionFromPrevious: rate(0, 1) },
        { key: "offers", label: "Offers", count: 0, conversionFromPrevious: emptyRate() },
        { key: "hired", label: "Hired", count: 0, conversionFromPrevious: emptyRate() },
      ],
    },
    timeToHire: { averageDays: null, medianDays: null, sample: 0, insufficient: true },
    stageDurations: [],
    bottleneck: null,
    sources: [],
    screening: {
      attempted: 0,
      answered: 0,
      completed: 0,
      noAnswer: 0,
      failed: 0,
      cancelled: 0,
      answerRate: emptyRate(),
      completionRate: emptyRate(),
      averageDurationSeconds: null,
      callbackRequests: 0,
      byLanguage: [],
    },
    timeSaved: { minutes: 0, callsCounted: 0, assumption: "Estimate: ..." },
    interviews: {
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
      completionRate: emptyRate(),
      feedbackRate: emptyRate(),
    },
    automations: {
      runs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
      successRate: emptyRate(),
      failures: [],
    },
    interviewToOffer: emptyRate(),
    offerToHire: emptyRate(),
    comparisons: null,
    failedSections: [],
    truncatedSections: [],
    ...overrides,
  };
}

const PERIODS = resolvePeriods({
  range: "30d",
  timeZone: "Asia/Kolkata",
  now: new Date("2026-08-15T12:00:00Z"),
});

function render(report: AnalyticsReport) {
  return reportToCsv({
    report,
    filters: DEFAULT_FILTERS,
    periods: PERIODS,
    organizationName: "ACME Recruiting",
    timeZone: "Asia/Kolkata",
    generatedAt: new Date("2026-08-15T12:00:00Z"),
  });
}

describe("reportToCsv", () => {
  it("exports an unavailable rate as an empty cell, never as 0", () => {
    // A 0% in a spreadsheet will be averaged, charted and presented. An empty
    // cell gets questioned, which is the correct outcome for "no data".
    const csv = render(stubReport());

    expect(csv).toContain("Offers,0,,no data");
    expect(csv).not.toContain("Offers,0,0,");
  });

  it("labels an insufficient sample rather than showing a percentage", () => {
    const csv = render(stubReport());
    // 0 of 1 — a real ratio, but not a percentage worth printing.
    expect(csv).toContain("not enough data (0/1)");
  });

  it("carries a failed-section warning into the file", () => {
    // The failure this prevents: a partial export that looks complete, opened
    // by someone who was not there when the screen said otherwise.
    const csv = render(stubReport({ failedSections: ["screening", "automations"] }));

    expect(csv).toContain("WARNING");
    expect(csv).toContain("missing, not zero");
    expect(csv).toContain("screening; automations");
  });

  it("carries a truncation warning into the file", () => {
    const csv = render(stubReport({ truncatedSections: ["funnel"] }));
    expect(csv).toContain("hit the row limit");
  });

  it("records the period, timezone and filters so the file is reproducible", () => {
    const csv = render(stubReport());

    expect(csv).toContain("ACME Recruiting");
    expect(csv).toContain("Asia/Kolkata");
    expect(csv).toContain("Filter: job,all");
  });

  it("is reproducible for the same report and timestamp", () => {
    const report = stubReport();
    expect(render(report)).toBe(render(report));
  });

  it("exports the funnel counts the screen would show", () => {
    // The export-matches-screen guarantee: both render this same object, so the
    // counts cannot diverge.
    const csv = render(stubReport());
    expect(csv).toContain("Applications,10");
    expect(csv).toContain("AI screened,6,60");
  });
});

describe("exportFilename", () => {
  it("carries the period so two exports don't collide", () => {
    const name = exportFilename({ organizationName: "ACME Recruiting", periods: PERIODS });

    expect(name).toMatch(/^acme-recruiting-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("survives an organization name with no usable characters", () => {
    const name = exportFilename({ organizationName: "!!!", periods: PERIODS });
    expect(name.startsWith("analytics-")).toBe(true);
  });
});
