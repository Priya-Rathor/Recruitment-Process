import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser } from "@/lib/tenant";
import { resolveTimeZone } from "@/lib/time";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { getSlaConfig, listBoardJobs } from "@/lib/pipeline/queries";
import { listClients } from "@/lib/clients/queries";
import { isAgencyMode } from "@/lib/organizations/hiringModel";
import { listTeamMembers } from "@/lib/jobs/queries";
import {
  describePeriod,
  filtersFromParams,
  filtersToQuery,
  resolvePeriods,
} from "@/lib/analytics/filters";
import { buildReport } from "@/lib/analytics/report";
import {
  canCompareRecruiters,
  canExport,
  fetchClientPerformance,
  fetchJobPerformance,
  fetchRecruiterPerformance,
} from "@/lib/analytics/queries";
import { explainRate, formatRate, type Rate } from "@/lib/analytics/metrics";
import { trendArrow, trendColor } from "@/lib/analytics/trends";
import { AnalyticsFilterBar } from "./AnalyticsFilters";
import { AskAnalytics } from "./AskAnalytics";
import { BarChart, ChartCard, FunnelChart, KpiTile, OrbitalMeterRow } from "./charts";
import { Briefcase, Building2, CheckCircle2, Inbox, Users } from "lucide-react";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "recruitment", label: "Recruitment" },
  { key: "screening", label: "Screening" },
  { key: "jobs", label: "Jobs" },
  /** Agency mode only — see visibleTabs() below. */
  { key: "clients", label: "Clients", agencyOnly: true },
  { key: "recruiters", label: "Recruiters" },
  { key: "automations", label: "Automations" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * The tabs an organization can actually see.
 *
 * An in-house team has no clients, so client turnaround is not a report they
 * can run — the tab would open onto a table that is empty by definition.
 */
function visibleTabs(agencyMode: boolean) {
  return TABS.filter((entry) => !("agencyOnly" in entry && entry.agencyOnly) || agencyMode);
}

/**
 * A rate becomes an ORBITAL METER, not a bar.
 *
 * A rate is a ratio against 100%, which is what a meter is for — the retired
 * bar spent a length encoding on a number that can only ever range 0-100, and
 * then scaled it relative to the other bars so a 40% rate beside a 45% one
 * looked nearly full.
 *
 * `percent: null` when there is no computable rate, which is NOT zero: a meter
 * pinned at 0% claims nobody converted, and "we cannot compute this yet" is a
 * different statement. formatRate()/explainRate() already say which it is.
 */
function rateMeter(label: string, value: Rate) {
  return {
    label,
    percent: value.kind === "rate" ? value.percent : null,
    displayValue: formatRate(value),
    note: explainRate(value),
  };
}

async function AnalyticsBody({
  tab,
  search,
}: {
  tab: TabKey;
  search: Record<string, string | string[] | undefined>;
}) {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  const params = new URLSearchParams(
    Object.entries(search)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value as string])
  );

  const agencyMode = isAgencyMode(membership.organization);
  const filters = filtersFromParams(params);
  const timeZone = resolveTimeZone(membership.organization.timezone);
  const periods = resolvePeriods({ range: filters.range, timeZone });
  const slaConfig = await getSlaConfig(membership.organization.id);

  const [report, jobs, { clients }, members] = await Promise.all([
    buildReport({
      organizationId: membership.organization.id,
      periods,
      filters,
      role: membership.role,
      viewerId: user.id,
      slaConfig,
    }),
    listBoardJobs(membership.organization.id),
    agencyMode
      ? listClients({ organizationId: membership.organization.id })
      : Promise.resolve({ clients: [], failed: false }),
    listTeamMembers(membership.organization.id),
  ]);

  const query = filtersToQuery(filters);
  const showRecruiters = canCompareRecruiters(membership.role);

  const comparisonFor = (label: string) =>
    report.comparisons?.find((entry) => entry.description.startsWith(label)) ?? null;

  const trendFor = (label: string) => {
    const comparison = comparisonFor(label);
    if (!comparison || comparison.verdict === "insufficient") return null;

    return {
      text:
        comparison.percentChange === null
          ? `${comparison.delta && comparison.delta > 0 ? "+" : ""}${comparison.delta ?? 0}`
          : `${Math.abs(comparison.percentChange)}% vs previous`,
      color: trendColor(comparison.verdict),
      arrow: trendArrow(comparison),
    };
  };

  return (
    <>
      <AnalyticsFilterBar
        filters={filters}
        jobs={jobs.map((job) => ({ id: job.id, title: job.title }))}
        clients={clients.map((client) => ({ id: client.id, name: client.name }))}
        recruiters={members.map((member) => ({ id: member.id, name: member.name }))}
        canFilterClient={agencyMode}
        canFilterRecruiter={showRecruiters}
      />

      <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
        {describePeriod(periods.current, timeZone)} · {timeZone}
        {membership.role === "recruiter" && " · showing only applications assigned to you"}
      </p>

      {/*
        A failed section is NAMED. A funnel reading zero because the query failed
        is a false statement to a manager; saying which section is missing is a
        true one.
      */}
      {report.failedSections.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-error)" }}>
          <p style={{ fontSize: 14, color: "var(--color-error)" }}>
            <strong>Some figures couldn&apos;t be loaded:</strong>{" "}
            {report.failedSections.join(", ")}. Those sections are missing, not zero.
          </p>
        </div>
      )}

      {report.truncatedSections.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>Partial figures.</strong> {report.truncatedSections.join(", ")} hit the row
            limit for this period, so these numbers are a lower bound. Narrow the date range for an
            exact count.
          </p>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="is-flex mb-4" style={{ gap: "1rem", flexWrap: "wrap" }}>
            <KpiTile
              label="Applications"
              value={String(report.funnel.total)}
              trend={trendFor("Applications")}
            />
            <KpiTile
              label="Hired"
              value={String(report.funnel.steps.find((s) => s.key === "hired")?.count ?? 0)}
              trend={trendFor("Hires")}
            />
            <KpiTile
              label="Median time to hire"
              value={
                report.timeToHire.medianDays === null
                  ? "—"
                  : `${report.timeToHire.medianDays} days`
              }
              caption={
                report.timeToHire.sample === 0
                  ? "No hires in this period"
                  : report.timeToHire.insufficient
                    ? `Only ${report.timeToHire.sample} hires — indicative only`
                    : `From ${report.timeToHire.sample} hires · average ${report.timeToHire.averageDays} days`
              }
              trend={trendFor("Median time to hire")}
            />
            <KpiTile
              label="Screening completion"
              value={formatRate(report.screening.completionRate)}
              caption={explainRate(report.screening.completionRate)}
              trend={trendFor("Screening completion")}
            />
          </div>

          <AskAnalytics query={query} />

          <ChartCard
            title="Recruitment funnel"
            subtitle="Each step counts applications that ever reached it, not those sitting there now."
          >
            {report.funnel.total === 0 ? (
              <EmptyState headline="No applications"
            message="Nothing was created in this date range. Try a wider period."
            icon={Inbox} />
            ) : (
              <FunnelChart
                bars={report.funnel.steps.map((step) => ({
                  label: step.label,
                  count: step.count,
                  conversion:
                    step.conversionFromPrevious?.kind === "rate"
                      ? formatRate(step.conversionFromPrevious)
                      : null,
                  conversionNote:
                    step.conversionFromPrevious && step.conversionFromPrevious.kind !== "rate"
                      ? explainRate(step.conversionFromPrevious)
                      : null,
                }))}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Time in stage"
            subtitle="Median days, from closed stage visits only. A stage nobody has left yet shows no figure."
          >
            <BarChart
              bars={report.stageDurations
                .filter((duration) => duration.sample > 0)
                .map((duration) => ({
                  label: STAGE_LABELS[duration.stage] ?? duration.stage,
                  value: duration.medianDays ?? 0,
                  displayValue: `${duration.medianDays} days`,
                  // Status colour only where it MEANS a status, and always with
                  // the label beside it so meaning isn't colour-alone.
                  statusColor: duration.overSla ? "var(--color-warning)" : null,
                  statusLabel: duration.overSla ? "over SLA" : null,
                  note: duration.insufficient
                    ? `Only ${duration.sample} visit${duration.sample === 1 ? "" : "s"} — not enough to draw on`
                    : `${duration.sample} visits${duration.slaDays !== null ? ` · SLA ${duration.slaDays} days` : ""}`,
                }))}
              emptyMessage="No stage has been completed in this period yet."
            />

            {report.bottleneck && (
              <p className="mt-4" style={{ fontSize: 14 }}>
                <strong>Biggest bottleneck:</strong>{" "}
                {STAGE_LABELS[report.bottleneck.stage] ?? report.bottleneck.stage} — a median of{" "}
                {report.bottleneck.medianDays} days against a {report.bottleneck.slaDays}-day SLA.
              </p>
            )}
          </ChartCard>
        </>
      )}

      {tab === "recruitment" && (
        <>
          <ChartCard title="Candidates by source">
            <BarChart
              bars={report.sources.map((source) => ({
                label: source.source,
                value: source.candidates,
                note: `${source.interviews} interviews · ${source.hires} hires`,
              }))}
            />
          </ChartCard>

          {/* A SECOND chart rather than a second axis. The spec asks for "two
              focused bar charts", and volume and rate have different scales —
              plotting them together would invent a correlation. */}
          <ChartCard
            title="Hire rate by source"
            subtitle="A source with too few candidates shows its raw counts instead of a percentage."
          >
            <OrbitalMeterRow
              meters={report.sources.map((source) => rateMeter(source.source, source.hireRate))}
            />
          </ChartCard>

          <ChartCard title="Conversion">
            <OrbitalMeterRow
              meters={[
                rateMeter("Interview to offer", report.interviewToOffer),
                rateMeter("Offer to hire", report.offerToHire),
                rateMeter("Interview completion", report.interviews.completionRate),
              ]}
            />
          </ChartCard>
        </>
      )}

      {tab === "screening" && (
        <>
          <div className="is-flex mb-4" style={{ gap: "1rem", flexWrap: "wrap" }}>
            <KpiTile label="Calls attempted" value={String(report.screening.attempted)} />
            <KpiTile
              label="Answer rate"
              value={formatRate(report.screening.answerRate)}
              caption={explainRate(report.screening.answerRate)}
            />
            <KpiTile
              label="Completion rate"
              value={formatRate(report.screening.completionRate)}
              caption={explainRate(report.screening.completionRate)}
            />
            <KpiTile
              label="Callback requests"
              value={String(report.screening.callbackRequests)}
              caption="Candidates who asked for a person instead"
            />
          </div>

          <ChartCard title="Call outcomes">
            <BarChart
              bars={[
                { label: "Completed", value: report.screening.completed },
                { label: "No answer", value: report.screening.noAnswer },
                {
                  label: "Failed",
                  value: report.screening.failed,
                  statusColor: report.screening.failed > 0 ? "var(--color-error)" : null,
                  statusLabel: report.screening.failed > 0 ? "needs attention" : null,
                },
                { label: "Callback requested", value: report.screening.cancelled },
              ]}
            />
          </ChartCard>

          <ChartCard title="Calls by language">
            <BarChart
              bars={report.screening.byLanguage.map((entry) => ({
                label: entry.language,
                value: entry.calls,
              }))}
            />
          </ChartCard>

          <div className="card mb-4">
            <h2 className="title is-5 mb-1">Estimated recruiter time saved</h2>
            <p style={{ fontSize: 30, fontWeight: 700, margin: "4px 0" }}>
              {Math.round(report.timeSaved.minutes / 6) / 10} hours
            </p>
            {/* The spec requires this be "labeled explicitly as an estimate",
                and the assumption travels with the number rather than living in
                a doc nobody opens. */}
            <p className="has-text-secondary" style={{ fontSize: 13 }}>
              {report.timeSaved.assumption}
            </p>
          </div>
        </>
      )}

      {tab === "jobs" && (
        <Suspense fallback={<SkeletonRows rows={5} />}>
          <JobsTab organizationId={membership.organization.id} query={query} filters={filters} />
        </Suspense>
      )}

      {tab === "clients" && (
        <Suspense fallback={<SkeletonRows rows={5} />}>
          <ClientsTab organizationId={membership.organization.id} />
        </Suspense>
      )}

      {tab === "recruiters" &&
        (showRecruiters ? (
          <Suspense fallback={<SkeletonRows rows={5} />}>
            <RecruitersTab organizationId={membership.organization.id} role={membership.role} />
          </Suspense>
        ) : (
          <div className="card">
            <h2 className="title is-5">Recruiter comparisons are restricted</h2>
            <p className="has-text-secondary" style={{ fontSize: 14 }}>
              Company-wide recruiter figures are available to Owners and Admins. Your other
              analytics show your own work.
            </p>
          </div>
        ))}

      {tab === "automations" && (
        <>
          <div className="is-flex mb-4" style={{ gap: "1rem", flexWrap: "wrap" }}>
            <KpiTile label="Runs" value={String(report.automations.runs)} />
            <KpiTile
              label="Success rate"
              value={formatRate(report.automations.successRate)}
              caption="Skipped runs are excluded — a rule whose conditions didn't match hasn't failed."
            />
            <KpiTile
              label="Failed"
              value={String(report.automations.failed)}
              trend={trendFor("Automation failures")}
            />
            <KpiTile
              label="Blocked"
              value={String(report.automations.blocked)}
              caption="A required integration was unavailable"
            />
          </div>

          <ChartCard
            title="Failures by automation"
            subtitle="Only rules that actually failed appear here."
          >
            {report.automations.failures.length === 0 ? (
              <EmptyState headline="No failures"
            message="Every automation run in this period completed or was skipped."
            icon={CheckCircle2} />
            ) : (
              <BarChart
                bars={report.automations.failures.map((failure) => ({
                  label: failure.name,
                  value: failure.failed,
                  statusColor: "var(--color-error)",
                  statusLabel: "failed",
                  note: `${failure.failed} of ${failure.runs} runs`,
                }))}
              />
            )}
          </ChartCard>
        </>
      )}

      {canExport(membership.role) && (
        <div className="card">
          <h2 className="title is-5 mb-1">Export</h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            A CSV of everything on this page, with the filters above applied. Figures that
            aren&apos;t available export as empty cells, never as zero.
          </p>
          {/* Same query string as the page, so the file matches the screen. */}
          <a className="button" href={`/api/analytics/export${query}`}>
            Download CSV
          </a>
        </div>
      )}
    </>
  );
}

async function JobsTab({
  organizationId,
  filters,
}: {
  organizationId: string;
  query: string;
  filters: ReturnType<typeof filtersFromParams>;
}) {
  const { rows, failed } = await fetchJobPerformance({ organizationId, filters });
  if (failed) return <ErrorState message="Couldn't load job performance." />;
  if (rows.length === 0) return <EmptyState headline="No jobs to report on"
            message="Job performance appears here once you have created a job."
            icon={Briefcase} />;

  return (
    <ChartCard title="Job performance" subtitle="Ordered by application volume.">
      <div className="table-container">
        <table className="table is-fullwidth is-hoverable">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Applications</th>
              <th>Reached interview</th>
              <th>Hires</th>
              <th>Avg match</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.job_id}>
                <td>
                  <Link href={`/jobs/${row.job_id}`}>{row.title}</Link>
                  {row.status === "open" && row.screening_question_count === 0 && (
                    <div style={{ fontSize: 12, color: "var(--status-attention-text, var(--status-attention-text))" }}>
                      Needs attention — no screening questions
                    </div>
                  )}
                </td>
                <td className="has-text-secondary" style={{ fontSize: 13 }}>
                  {row.status}
                </td>
                <td>{row.applications}</td>
                <td>{row.reached_interview_or_beyond}</td>
                <td>{row.hires}</td>
                <td className="has-text-secondary" style={{ fontSize: 13 }}>
                  {row.average_match_score === null
                    ? "—"
                    : Math.round(row.average_match_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

async function ClientsTab({ organizationId }: { organizationId: string }) {
  const { rows, failed } = await fetchClientPerformance({ organizationId });
  if (failed) return <ErrorState message="Couldn't load client performance." />;
  if (rows.length === 0) return <EmptyState headline="No clients to report on"
            message="Client turnaround appears here once you add a client."
            icon={Building2} />;

  return (
    <ChartCard
      title="Client feedback turnaround"
      subtitle="Averages cover responded submissions only — mixing in 'still waiting' would not be an average of anything."
    >
      <div className="table-container">
        <table className="table is-fullwidth is-hoverable">
          <thead>
            <tr>
              <th>Client</th>
              <th>Submissions</th>
              <th>Responded</th>
              <th>Awaiting</th>
              <th>Avg response</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const average =
                row.average_response_days === null
                  ? null
                  : Math.round(row.average_response_days * 10) / 10;
              const overSla = average !== null && average > row.feedback_sla_days;

              return (
                <tr key={row.client_id}>
                  <td>
                    <Link href={`/clients/${row.client_id}`}>{row.client_name}</Link>
                  </td>
                  <td>{row.submissions}</td>
                  <td>{row.responses}</td>
                  <td>{row.awaiting_response}</td>
                  <td style={{ color: overSla ? "var(--color-warning)" : undefined }}>
                    {average === null ? "—" : `${average} days`}
                    {overSla && (
                      <span className="ml-2" style={{ fontSize: 12, fontWeight: 600 }}>
                        over SLA
                      </span>
                    )}
                  </td>
                  <td className="has-text-secondary" style={{ fontSize: 13 }}>
                    {row.feedback_sla_days} days
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

async function RecruitersTab({
  organizationId,
  role,
}: {
  organizationId: string;
  role: Parameters<typeof fetchRecruiterPerformance>[0]["role"];
}) {
  const { rows, failed } = await fetchRecruiterPerformance({ organizationId, role });
  if (failed) return <ErrorState message="Couldn't load recruiter figures." />;
  if (rows.length === 0) return <EmptyState headline="No assigned work"
            message="Figures appear here once applications are assigned to recruiters."
            icon={Users} />;

  /*
    TWO SEPARATE VIEWS, not one ranked table.

    The spec: "Recruiter performance shown with workload and outcomes as separate
    views, never a single ranked leaderboard." Workload and outcomes measure
    different things — a recruiter carrying 80 applications and one carrying 12
    are not comparable on hires — and a single sorted column would be read as a
    ranking of people whatever the header said.
  */
  return (
    <>
      <ChartCard title="Workload" subtitle="Applications currently assigned and active.">
        <BarChart
          bars={rows.map((row) => ({
            label: row.recruiter_name ?? row.recruiter_email,
            value: row.active_applications,
            note: `${row.applications} total assigned`,
          }))}
        />
      </ChartCard>

      <ChartCard title="Outcomes" subtitle="Hires recorded against assigned applications.">
        <BarChart
          bars={rows.map((row) => ({
            label: row.recruiter_name ?? row.recruiter_email,
            value: row.hires,
            note: `${row.hires} hires from ${row.applications} assigned`,
          }))}
        />
      </ChartCard>

      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        Workload and outcomes are shown separately on purpose. Someone carrying twice the pipeline
        is not underperforming for having the same number of hires.
      </p>
    </>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [membership, search] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);

  const tabs = visibleTabs(isAgencyMode(membership.organization));

  // Resolved against the VISIBLE tabs, so ?tab=clients on an in-house workspace
  // falls back to the overview rather than rendering a hidden report.
  const requested = typeof search.tab === "string" ? search.tab : "overview";
  const tab = (tabs.find((entry) => entry.key === requested)?.key ?? "overview") as TabKey;

  const params = new URLSearchParams(
    Object.entries(search)
      .filter(([key, value]) => key !== "tab" && typeof value === "string")
      .map(([key, value]) => [key, value as string])
  );
  const tabQuery = params.toString();

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Analytics</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Where candidates come from, where they get stuck, and how long it takes.
        </p>
      </div>

      <div className="card mb-4">
        <div className="buttons mb-0">
          {tabs.map((entry) => (
            <Link
              key={entry.key}
              className={`button is-small ${tab === entry.key ? "is-primary" : ""}`}
              href={`/analytics?tab=${entry.key}${tabQuery ? `&${tabQuery}` : ""}`}
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense
        fallback={
          <>
            <div className="is-flex mb-4" style={{ gap: "1rem", flexWrap: "wrap" }}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="card" style={{ flex: "1 1 180px" }}>
                  <SkeletonRows rows={1} />
                </div>
              ))}
            </div>
            <div className="card">
              <SkeletonRows rows={6} />
            </div>
          </>
        }
      >
        <AnalyticsBody tab={tab} search={search} />
      </Suspense>
    </AppShell>
  );
}
