import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { listAutomations, listRuns } from "@/lib/automations/queries";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { describeRule } from "@/lib/automations/catalog";
import { RunStatusBadge, StatusBadge } from "./AutomationBadges";
import { Zap } from "lucide-react";

export const metadata = { title: "Automations · Recruitment OS" };
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

  const [{ automations, failed }, bolna] = await Promise.all([
    listAutomations(membership.organization.id),
    getBolnaStatus(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load automations." />;

  const activeNeedingBolna = automations.filter(
    (automation) =>
      automation.status === "active" && automation.required_integrations.includes("bolna")
  );

  return (
    <>
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
                      {automation.drafted_by_ai && (
                        <div
                          className="mt-1"
                          style={{ fontSize: 12, color: "var(--color-info, #2563EB)" }}
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

  return (
    <AppShell>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <h1 className="title is-4 mb-1">Automations</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            When something happens, if your conditions hold, then act.
          </p>
        </div>
        {/* Hidden, not greyed out — the API refuses it independently. */}
        {canEdit && (
          <Link className="button is-primary" href="/automations/new">
            New automation
          </Link>
        )}
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <AutomationsList />
      </Suspense>

      <div className="mt-5">
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
