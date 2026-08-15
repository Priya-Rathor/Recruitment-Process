import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { getAutomation, listRuns } from "@/lib/automations/queries";
import {
  ACTION_LABELS,
  CONSEQUENTIAL_ACTIONS,
  TRIGGER_AVAILABILITY,
  TRIGGER_LABELS,
  describeRule,
} from "@/lib/automations/catalog";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { RunStatusBadge, StatusBadge } from "../AutomationBadges";
import { ActivationPanel } from "./ActivationPanel";
import { AutomationForm } from "../AutomationForm";
import { Zap } from "lucide-react";

export const metadata = { title: "Automation · Recruitment OS" };
export const dynamic = "force-dynamic";

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function RunHistory({ automationId }: { automationId: string }) {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  const { runs, failed } = await listRuns({
    organizationId: membership.organization.id,
    automationId,
    viewerId: membership.role === "recruiter" ? user.id : null,
  });

  if (failed) return <ErrorState message="Couldn't load the run history." />;
  if (runs.length === 0) {
    return (
      <EmptyState headline="No runs yet"
            message="Every run appears here with what happened — including the ones it skipped."
            icon={Zap} />
    );
  }

  return (
    <div className="table-container">
      <table className="table is-fullwidth">
        <thead>
          <tr>
            <th>When</th>
            <th>Application</th>
            <th>Outcome</th>
            <th>What happened</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="has-text-secondary" style={{ fontSize: 13 }}>
                {formatWhen(run.started_at)}
              </td>
              <td style={{ fontSize: 14 }}>
                {run.application_id ? (
                  <Link href={`/applications/${run.application_id}`}>
                    {run.candidate_name ?? "Application"}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <RunStatusBadge status={run.status} />
              </td>
              <td className="has-text-secondary" style={{ fontSize: 13 }}>
                {run.error_message ?? run.reason ?? "—"}
                {run.action_results?.length > 0 && (
                  <ul className="mt-1">
                    {run.action_results.map((result, index) => (
                      <li key={index}>
                        {ACTION_LABELS[result.action] ?? result.action}: {result.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();
  const canEdit = hasRole(membership.role, ["owner", "admin"]);

  const automation = await getAutomation({
    organizationId: membership.organization.id,
    automationId: id,
  });
  if (!automation) notFound();

  const summary = describeRule({
    trigger: automation.trigger,
    conditions: automation.conditions ?? [],
    actions: automation.actions ?? [],
  });

  const contactsCandidates = (automation.actions ?? []).some(
    (action) => action.type === "start_screening_call"
  );
  const spendsMoney = (automation.actions ?? []).some((action) =>
    CONSEQUENTIAL_ACTIONS.includes(action.type)
  );

  const availability = TRIGGER_AVAILABILITY[automation.trigger];
  const bolna = automation.required_integrations.includes("bolna")
    ? await getBolnaStatus(membership.organization.id)
    : null;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/automations">Automations</Link> / {automation.name}
        </p>
        <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
          <h1 className="title is-4 mb-0">{automation.name}</h1>
          <StatusBadge status={automation.status} />
        </div>
        {automation.description && (
          <p className="has-text-secondary mt-2" style={{ fontSize: 14 }}>
            {automation.description}
          </p>
        )}
      </div>

      {availability && !availability.available && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>{TRIGGER_LABELS[automation.trigger]}</strong> isn&apos;t wired up yet.{" "}
            {availability.note}
          </p>
        </div>
      )}

      {bolna && bolna.status !== "connected" && (
        <div className="card mb-4" style={{ borderColor: "var(--color-error)" }}>
          <p style={{ fontSize: 14, color: "var(--color-error)" }}>
            <strong>Bolna isn&apos;t connected.</strong> This rule can&apos;t be activated, and if
            it is already active its runs are recorded as blocked rather than placing calls.
          </p>
        </div>
      )}

      {canEdit && (
        <ActivationPanel
          automationId={automation.id}
          status={automation.status}
          summary={summary}
          contactsCandidates={contactsCandidates}
          draftedByAi={automation.drafted_by_ai}
        />
      )}

      {!canEdit && (
        <div className="card mb-4">
          <h2 className="title is-5 mb-2">What this rule does</h2>
          <p style={{ fontSize: 14 }}>{summary}</p>
          <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
            Only an Owner or Admin can change or activate it.
          </p>
        </div>
      )}

      {automation.activated_at && automation.status === "active" && (
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          Activated {formatWhen(automation.activated_at)}
          {spendsMoney ? " · this rule spends AI or calling budget when it runs" : ""}
        </p>
      )}

      {canEdit && (
        <div className="mb-5">
          <h2 className="title is-5 mb-3">Edit the rule</h2>
          <AutomationForm
            mode="edit"
            canUseAi
            initial={{
              id: automation.id,
              name: automation.name,
              description: automation.description,
              trigger: automation.trigger,
              conditions: automation.conditions ?? [],
              actions: automation.actions ?? [],
              status: automation.status,
              drafted_by_ai: automation.drafted_by_ai,
            }}
          />
        </div>
      )}

      <div>
        <h2 className="title is-5 mb-3">Run history</h2>
        <div className="card">
          <Suspense fallback={<SkeletonRows rows={4} />}>
            <RunHistory automationId={automation.id} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
