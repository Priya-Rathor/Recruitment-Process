// =============================================================================
// The report assembler.
//
// ONE function builds the whole report, and BOTH the screen and the CSV export
// render from its output. That is how the spec's "CSV export matches on-screen
// filtered results exactly" is satisfied — not by two code paths agreeing, but
// by there being one.
//
// Deterministic throughout. The AI narrator is handed this object and may only
// describe what is in it.
// =============================================================================
import type { OrgRole } from "@/lib/types";
import type { SlaConfig } from "@/lib/pipeline/sla";
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
  rate,
  type AutomationMetrics,
  type Funnel,
  type InterviewMetrics,
  type ScreeningMetrics,
  type SourcePerformance,
  type StageDuration,
  type TimeToHire,
  type Rate,
} from "@/lib/analytics/metrics";
import { compare, type Comparison } from "@/lib/analytics/trends";
import {
  fetchAutomationRuns,
  fetchFunnelRows,
  fetchInterviewRows,
  fetchScreeningRows,
  fetchStageDurations,
} from "@/lib/analytics/queries";
import type { AnalyticsFilters, PeriodPair } from "@/lib/analytics/filters";

export type AnalyticsReport = {
  funnel: Funnel;
  timeToHire: TimeToHire;
  stageDurations: StageDuration[];
  bottleneck: StageDuration | null;
  sources: SourcePerformance[];
  screening: ScreeningMetrics;
  timeSaved: ReturnType<typeof estimateTimeSaved>;
  interviews: InterviewMetrics;
  automations: AutomationMetrics;
  interviewToOffer: Rate;
  offerToHire: Rate;
  /** Present only when compare was requested AND a previous period resolved. */
  comparisons: Comparison[] | null;
  /** Any section that failed to load, named so the UI can say which. */
  failedSections: string[];
  /** Any section whose row cap was hit, so figures can be marked partial. */
  truncatedSections: string[];
};

type BuildArgs = {
  organizationId: string;
  periods: PeriodPair;
  filters: AnalyticsFilters;
  role: OrgRole;
  viewerId: string;
  slaConfig: SlaConfig;
};

/**
 * Builds the full report.
 *
 * Sections are fetched in parallel and each failure is NAMED rather than folded
 * into a zero. A funnel showing 0 applications because the query failed is a
 * false statement to a manager; "the funnel couldn't be loaded" is a true one.
 */
export async function buildReport({
  organizationId,
  periods,
  filters,
  role,
  viewerId,
  slaConfig,
}: BuildArgs): Promise<AnalyticsReport> {
  const base = { organizationId, filters, role, viewerId };

  const [funnelResult, durationResult, screeningResult, interviewResult, automationResult] =
    await Promise.all([
      fetchFunnelRows({ ...base, period: periods.current }),
      fetchStageDurations({ ...base, period: periods.current }),
      fetchScreeningRows({ ...base, period: periods.current }),
      fetchInterviewRows({ ...base, period: periods.current }),
      fetchAutomationRuns({ ...base, period: periods.current }),
    ]);

  const failedSections: string[] = [];
  const truncatedSections: string[] = [];

  const track = (name: string, result: { failed: boolean; truncated: boolean }) => {
    if (result.failed) failedSections.push(name);
    if (result.truncated) truncatedSections.push(name);
  };

  track("funnel", funnelResult);
  track("time in stage", durationResult);
  track("screening", screeningResult);
  track("interviews", interviewResult);
  track("automations", automationResult);

  const funnel = buildFunnel(funnelResult.rows);
  const stageDurations = computeStageDurations({
    rows: durationResult.rows,
    slaDays: slaConfig,
  });

  const interviewCount = funnel.steps.find((step) => step.key === "interviews")?.count ?? 0;
  const offerCount = funnel.steps.find((step) => step.key === "offers")?.count ?? 0;
  const hiredCount = funnel.steps.find((step) => step.key === "hired")?.count ?? 0;

  const report: AnalyticsReport = {
    funnel,
    timeToHire: computeTimeToHire(funnelResult.rows),
    stageDurations,
    bottleneck: findBottleneck(stageDurations),
    sources: computeSourcePerformance(funnelResult.rows),
    screening: computeScreeningMetrics(screeningResult.rows),
    timeSaved: estimateTimeSaved(screeningResult.rows),
    interviews: computeInterviewMetrics(interviewResult.rows),
    automations: computeAutomationMetrics(automationResult.rows),
    interviewToOffer: rate(offerCount, interviewCount),
    offerToHire: rate(hiredCount, offerCount),
    comparisons: null,
    failedSections,
    truncatedSections,
  };

  if (!filters.compare) return report;

  // ---------------------------------------------------------------------
  // Previous period. Fetched only when asked, because it doubles the query
  // cost and most views never turn it on.
  // ---------------------------------------------------------------------
  const [prevFunnel, prevScreening, prevInterviews, prevAutomations] = await Promise.all([
    fetchFunnelRows({ ...base, period: periods.previous }),
    fetchScreeningRows({ ...base, period: periods.previous }),
    fetchInterviewRows({ ...base, period: periods.previous }),
    fetchAutomationRuns({ ...base, period: periods.previous }),
  ]);

  // A failed previous-period fetch means no comparison, not a comparison
  // against zero — which would render every metric as a dramatic collapse.
  if (prevFunnel.failed || prevScreening.failed) return report;

  const previousFunnel = buildFunnel(prevFunnel.rows);
  const previousTimeToHire = computeTimeToHire(prevFunnel.rows);
  const previousScreening = computeScreeningMetrics(prevScreening.rows);
  const previousInterviews = computeInterviewMetrics(prevInterviews.rows);
  const previousAutomations = computeAutomationMetrics(prevAutomations.rows);

  const countOf = (built: Funnel, key: string) =>
    built.steps.find((step) => step.key === key)?.count ?? 0;

  report.comparisons = [
    compare({
      current: funnel.total,
      previous: previousFunnel.total,
      // Volume is not good or bad on its own — it depends on capacity.
      direction: "neutral",
      label: "Applications",
    }),
    compare({
      current: countOf(funnel, "hired"),
      previous: countOf(previousFunnel, "hired"),
      direction: "higher_is_better",
      label: "Hires",
    }),
    compare({
      current: report.timeToHire.medianDays,
      previous: previousTimeToHire.medianDays,
      // THE ONE THE SPEC WARNS ABOUT.
      direction: "lower_is_better",
      label: "Median time to hire",
      unit: " days",
    }),
    compare({
      current: percentOf(report.screening.completionRate),
      previous: percentOf(previousScreening.completionRate),
      direction: "higher_is_better",
      label: "Screening completion",
      unit: "%",
    }),
    compare({
      current: percentOf(report.interviews.completionRate),
      previous: percentOf(previousInterviews.completionRate),
      direction: "higher_is_better",
      label: "Interview completion",
      unit: "%",
    }),
    compare({
      current: report.automations.failed,
      previous: previousAutomations.failed,
      direction: "lower_is_better",
      label: "Automation failures",
    }),
  ];

  return report;
}

/** A Rate's percent, or null for the absent cases — never a substituted 0. */
function percentOf(value: Rate): number | null {
  return value.kind === "rate" ? value.percent : null;
}
