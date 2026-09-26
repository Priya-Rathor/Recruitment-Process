import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import {
  countChargeableActions,
  listAutomations,
  listRuns,
} from "@/lib/automations/queries";
import { countPendingApprovals } from "@/lib/automations/approvals";
import { getLatestSweep } from "@/lib/automations/sweep";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { describeRule, isScheduledTrigger } from "@/lib/automations/catalog";
import { automationsEnabled } from "@/lib/organizations/automationSwitch";
import { RunStatusBadge, StatusBadge } from "./AutomationBadges";
import { SchedulerPanel } from "./SchedulerPanel";
import { Zap } from "lucide-react";

export const metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function AutomationsList() {
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  const [{ automations, failed }, bolna, sweep] = await Promise.all([
    listAutomations(membership.organization.id),
    getBolnaStatus(membership.organization.id),
    getLatestSweep(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load automations." />;

  const activeNeedingBolna = automations.filter(
    (automation) =>
      automation.status === "active" && automation.required_integrations.includes("bolna")
  );

  const scheduledRuleCount = automations.filter(
    (automation) => automation.status === "active" && isScheduledTrigger(automation.trigger)
  ).length;

  const pausedByEngine = automations.filter(
    (automation) => automation.status === "paused" && automation.paused_reason
  );

  return (
    <>
      <SchedulerPanel
        sweep={sweep.sweep}
        sweepReadFailed={sweep.failed}
        enabled={automationsEnabled(membership.organization)}
        scheduledRuleCount={scheduledRuleCount}
        canControl={canEdit}
      />

      {pausedByEngine.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>
              {pausedByEngine.length} rule{pausedByEngine.length === 1 ? "" : "s"} paused
              {pausedByEngine.length === 1 ? " itself" : " themselves"}.
            </strong>{" "}
            {pausedByEngine.map((automation) => automation.name).join(", ")} — a daily limit was
            reached. Open{pausedByEngine.length === 1 ? " it" : " them"} to see why and turn
            {pausedByEngine.length === 1 ? " it" : " them"} back on.
          </p>
        </div>
      )}

      {bolna.status !== "connected" && activeNeedingBolna.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-error)" }}>
          <p style={{ fontSize: 14, color: "var(--color-error)" }}>
            <strong>Bolna isn&apos;t connected.</strong> {activeNeedingBolna.length} active
            automation{activeNeedingBolna.length === 1 ? "" : "s"} need it and will be recorded as
            blocked rather than placing calls.
          </p>
        </div>
      )}

      <div className="card">
        {automations.length === 0 ? (
          <EmptyState
            message="No automations yet. A rule runs When something happens, If your conditions hold, Then it acts."
            action={
              canEdit ? (
                <Link className="button is-primary" href="/automations/new">
                  Create your first automation
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth is-hoverable">
              <thead>
                <tr>
                  <th>Automation</th>
                  <th>Status</th>
                  <th>Runs</th>
                  <th>Chargeable actions</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((automation) => (
                  <tr key={automation.id}>
                    <td>
                      <Link href={`/automations/${automation.id}`} style={{ fontWeight: 600 }}>
                        {automation.name}
                      </Link>
                      <div className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
                        {describeRule({
                          trigger: automation.trigger,
                          conditions: automation.conditions ?? [],
                          actions: automation.actions ?? [],
                        })}
                      </div>
                      {automation.requires_approval && (
                        <div className="mt-1" style={{ fontSize: 12 }}>
                          Needs approval before acting
                        </div>
                      )}
                      {automation.drafted_by_ai && (
                        <div
                          className="mt-1"
                          style={{ fontSize: 12, color: "var(--color-info, var(--color-info))" }}
                        >
                          Drafted by AI
                          {automation.activated_at ? " · reviewed and activated" : " · not yet activated"}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={automation.status} />
                    </td>
                    <td style={{ fontSize: 14 }}>
                      {automation.runCount}
                      {automation.failureCount > 0 && (
                        <span style={{ color: "var(--color-error)" }}>
                          {" "}
                          · {automation.failureCount} failed
                        </span>
                      )}
                      {automation.awaitingApprovalCount > 0 && (
                        <div style={{ fontSize: 12, color: "var(--color-info, var(--color-info))" }}>
                          {automation.awaitingApprovalCount} waiting for approval
                        </div>
                      )}
                    </td>
                    {/* A COUNT, not a currency figure. Nothing here measures
                        tokens or call minutes, so a rupee number would be
                        invented — see migration 0029's column comment. */}
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {automation.chargeableActions === 0 ? "—" : automation.chargeableActions}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {automation.lastRunAt ? formatWhen(automation.lastRunAt) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Recent run history. Visible to every role; a Recruiter sees their own scope. */
async function RecentRuns() {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  const { runs, failed } = await listRuns({
    organizationId: membership.organization.id,
    viewerId: membership.role === "recruiter" ? user.id : null,
    limit: 25,
  });

  if (failed) return <ErrorState message="Couldn't load the run history." />;
  if (runs.length === 0) {
    return <EmptyState headline="No runs yet"
            message="Runs appear here once an automation is active and its trigger fires."
            icon={Zap} />;
  }

  return (
    <div className="table-container">
      <table className="table is-fullwidth is-hoverable">
        <thead>
          <tr>
            <th>When</th>
            <th>Automation</th>
            <th>Application</th>
            <th>Outcome</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="has-text-secondary" style={{ fontSize: 13 }}>
                {formatWhen(run.started_at)}
              </td>
              <td style={{ fontSize: 14 }}>{run.automation_name}</td>
              <td className="has-text-secondary" style={{ fontSize: 13 }}>
                {run.application_id ? (
                  <Link href={`/applications/${run.application_id}`}>
                    {run.candidate_name ?? "Application"}
                  </Link>
                ) : (
                  "—"
                )}
                {run.job_title ? ` · ${run.job_title}` : ""}
              </td>
              <td>
                <RunStatusBadge status={run.status} />
              </td>
              <td className="has-text-secondary" style={{ fontSize: 13 }}>
                {run.error_message ?? run.reason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AutomationsPage() {
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  const [pendingApprovals, chargeableThisWeek] = await Promise.all([
    countPendingApprovals(membership.organization.id),
    countChargeableActions({ organizationId: membership.organization.id, days: 7 }),
  ]);

  return (
    <AppShell>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <h1 className="title is-4 mb-1">Automations</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            When something happens, if your conditions hold, then act.
          </p>
        </div>
        <div className="is-flex" style={{ gap: "0.5rem" }}>
          <Link className="button" href="/automations/approvals">
            Approvals
            {/* null means the count failed. Rendering it as 0 would say
                "nothing is waiting", which is a claim we cannot make. */}
            {pendingApprovals !== null && pendingApprovals > 0 ? ` (${pendingApprovals})` : ""}
          </Link>
          {/* Hidden, not greyed out — the API refuses it independently. */}
          {canEdit && (
            <Link className="button is-primary" href="/automations/new">
              New automation
            </Link>
          )}
        </div>
      </div>

      {pendingApprovals === null && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            Couldn&apos;t count what is waiting for approval. There may be proposals sitting
            undecided — <Link href="/automations/approvals">open the queue</Link> to check.
          </p>
        </div>
      )}

      {chargeableThisWeek !== null && chargeableThisWeek > 0 && (
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          Automations have run <strong>{chargeableThisWeek}</strong> chargeable action
          {chargeableThisWeek === 1 ? "" : "s"} in the last 7 days — screening calls, match scoring,
          reports and candidate emails. This is a count of actions, not a bill: nothing here
          measures call minutes or tokens yet.
        </p>
      )}

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <AutomationsList />
      </Suspense>

      {/* Anchored: Settings → Automation → Run history lands here. */}
      <div className="mt-5" id="recent-runs">
        <h2 className="title is-5 mb-3">Recent runs</h2>
        <div className="card">
          <Suspense fallback={<SkeletonRows rows={5} />}>
            <RecentRuns />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
