// =============================================================================
// CSV export.
//
// Renders the SAME AnalyticsReport object the screen renders. The spec's test —
// "CSV export matches on-screen filtered results exactly" — holds because there
// is one report, not two queries that ought to agree.
//
// The absent cases carry through honestly: a rate with no denominator exports
// as an empty cell, never as 0. A spreadsheet with 0% in it will be averaged,
// charted and presented; an empty cell will be questioned.
// =============================================================================
import { STAGE_LABELS } from "@/lib/applications/stages";
import type { AnalyticsReport } from "@/lib/analytics/report";
import type { Rate } from "@/lib/analytics/metrics";
import type { AnalyticsFilters, PeriodPair } from "@/lib/analytics/filters";

/**
 * Escapes one cell.
 *
 * The leading-character guard is the interesting part: a value beginning with
 * =, +, - or @ is executed as a FORMULA when the file is opened in Excel or
 * Sheets. Candidate names and job titles are user-supplied, so an exported
 * report is a plausible delivery route for one. Prefixing with a single quote
 * neutralises it while still displaying the original text.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** A Rate as a cell: the percentage, or empty when there isn't one. */
function rateCell(value: Rate): string {
  return value.kind === "rate" ? String(value.percent) : "";
}

/** Why a rate is empty, so the CSV explains itself without the UI. */
function rateNote(value: Rate): string {
  switch (value.kind) {
    case "rate":
      return "";
    case "insufficient":
      return `not enough data (${value.numerator}/${value.denominator})`;
    case "no_data":
      return "no data";
  }
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/**
 * The full report as CSV.
 *
 * Sections are stacked with blank-line separators rather than split across
 * files: a recruiter exporting "the numbers" wants one attachment, and a zip of
 * six files is worse than a slightly unusual single sheet.
 *
 * The header block records the filters and the period. Without it an exported
 * file is an anonymous set of numbers that nobody can reproduce or date, which
 * is how a stale export ends up in a board pack.
 */
export function reportToCsv({
  report,
  filters,
  periods,
  organizationName,
  timeZone,
  generatedAt,
}: {
  report: AnalyticsReport;
  filters: AnalyticsFilters;
  periods: PeriodPair;
  organizationName: string;
  timeZone: string;
  /** Passed in rather than read from the clock, so output is reproducible. */
  generatedAt: Date;
}): string {
  const rows: (string | number | null)[][] = [];

  const localDate = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });

  rows.push(["Recruitment OS — analytics export"]);
  rows.push(["Organization", organizationName]);
  rows.push([
    "Period",
    `${localDate(periods.current.start)} to ${localDate(
      new Date(periods.current.end.getTime() - 86_400_000)
    )}`,
  ]);
  rows.push(["Timezone", timeZone]);
  rows.push(["Generated", generatedAt.toISOString()]);
  rows.push(["Filter: job", filters.jobId ?? "all"]);
  rows.push(["Filter: client", filters.clientId ?? "all"]);
  rows.push(["Filter: recruiter", filters.recruiterId ?? "all"]);
  rows.push(["Filter: source", filters.sourceKey ?? "all"]);

  // Caveats travel WITH the data. A partial export that looks complete is the
  // failure worth preventing here.
  if (report.failedSections.length > 0) {
    rows.push([
      "WARNING",
      `These sections could not be loaded and are missing, not zero: ${report.failedSections.join("; ")}`,
    ]);
  }
  if (report.truncatedSections.length > 0) {
    rows.push([
      "WARNING",
      `These sections hit the row limit and are partial: ${report.truncatedSections.join("; ")}`,
    ]);
  }

  rows.push([]);
  rows.push(["Funnel"]);
  rows.push(["Stage", "Count", "Conversion from previous (%)", "Note"]);
  for (const step of report.funnel.steps) {
    rows.push([
      step.label,
      step.count,
      step.conversionFromPrevious ? rateCell(step.conversionFromPrevious) : "",
      step.conversionFromPrevious ? rateNote(step.conversionFromPrevious) : "",
    ]);
  }

  rows.push([]);
  rows.push(["Time to hire"]);
  rows.push(["Measure", "Days", "Sample"]);
  rows.push(["Average", report.timeToHire.averageDays, report.timeToHire.sample]);
  rows.push(["Median", report.timeToHire.medianDays, report.timeToHire.sample]);
  if (report.timeToHire.insufficient) {
    rows.push(["Note", "Sample too small for these figures to be meaningful"]);
  }

  rows.push([]);
  rows.push(["Time in stage"]);
  rows.push(["Stage", "Median days", "Average days", "Visits", "SLA days", "Over SLA"]);
  for (const duration of report.stageDurations) {
    rows.push([
      STAGE_LABELS[duration.stage] ?? duration.stage,
      duration.medianDays,
      duration.averageDays,
      duration.sample,
      duration.slaDays,
      duration.overSla ? "yes" : "no",
    ]);
  }

  rows.push([]);
  rows.push(["Source performance"]);
  rows.push(["Source", "Candidates", "Interviews", "Hires", "Hire rate (%)", "Note"]);
  for (const source of report.sources) {
    rows.push([
      source.source,
      source.candidates,
      source.interviews,
      source.hires,
      rateCell(source.hireRate),
      rateNote(source.hireRate),
    ]);
  }

  rows.push([]);
  rows.push(["AI screening"]);
  rows.push(["Measure", "Value", "Note"]);
  rows.push(["Calls attempted", report.screening.attempted, ""]);
  rows.push(["Answered", report.screening.answered, ""]);
  rows.push(["Completed", report.screening.completed, ""]);
  rows.push(["No answer", report.screening.noAnswer, ""]);
  rows.push(["Failed", report.screening.failed, ""]);
  rows.push(["Callback requested", report.screening.callbackRequests, ""]);
  rows.push([
    "Answer rate (%)",
    rateCell(report.screening.answerRate),
    rateNote(report.screening.answerRate),
  ]);
  rows.push([
    "Completion rate (%)",
    rateCell(report.screening.completionRate),
    rateNote(report.screening.completionRate),
  ]);
  rows.push(["Average duration (seconds)", report.screening.averageDurationSeconds, ""]);
  rows.push([
    "Estimated time saved (minutes)",
    report.timeSaved.minutes,
    report.timeSaved.assumption,
  ]);

  rows.push([]);
  rows.push(["Interviews"]);
  rows.push(["Measure", "Value", "Note"]);
  rows.push(["Scheduled", report.interviews.scheduled, ""]);
  rows.push(["Completed", report.interviews.completed, ""]);
  rows.push(["Cancelled", report.interviews.cancelled, ""]);
  rows.push(["No show", report.interviews.noShow, ""]);
  rows.push([
    "Completion rate (%)",
    rateCell(report.interviews.completionRate),
    rateNote(report.interviews.completionRate),
  ]);
  rows.push([
    "Interview to offer (%)",
    rateCell(report.interviewToOffer),
    rateNote(report.interviewToOffer),
  ]);
  rows.push(["Offer to hire (%)", rateCell(report.offerToHire), rateNote(report.offerToHire)]);

  rows.push([]);
  rows.push(["Automations"]);
  rows.push(["Measure", "Value", "Note"]);
  rows.push(["Runs", report.automations.runs, ""]);
  rows.push(["Succeeded", report.automations.succeeded, ""]);
  rows.push(["Failed", report.automations.failed, ""]);
  rows.push(["Blocked", report.automations.blocked, ""]);
  rows.push(["Skipped", report.automations.skipped, "conditions not met — normal operation"]);
  rows.push([
    "Success rate (%)",
    rateCell(report.automations.successRate),
    rateNote(report.automations.successRate),
  ]);

  if (report.automations.failures.length > 0) {
    rows.push([]);
    rows.push(["Automation failures"]);
    rows.push(["Automation", "Failed runs", "Total runs"]);
    for (const failure of report.automations.failures) {
      rows.push([failure.name, failure.failed, failure.runs]);
    }
  }

  if (report.comparisons) {
    rows.push([]);
    rows.push(["Compared with the previous period"]);
    rows.push(["Metric", "Current", "Previous", "Change (%)", "Verdict"]);
    for (const comparison of report.comparisons) {
      rows.push([
        comparison.description.split(":")[0],
        comparison.current,
        comparison.previous,
        comparison.percentChange,
        comparison.verdict,
      ]);
    }
  }

  return toCsv(rows);
}

/** Filename carrying the period, so two exports never collide in Downloads. */
export function exportFilename({
  organizationName,
  periods,
}: {
  organizationName: string;
  periods: PeriodPair;
}): string {
  const slug = organizationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const day = (date: Date) => date.toISOString().slice(0, 10);

  return `${slug || "analytics"}-${day(periods.current.start)}-to-${day(
    new Date(periods.current.end.getTime() - 86_400_000)
  )}.csv`;
}
