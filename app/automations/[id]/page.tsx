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
  TRIGGER_LABELS,
  TRIGGER_SOURCES,
  checkExecutable,
  contactsCandidate,
  describeRule,
  isScheduledTrigger,
  normalizeConditions,
} from "@/lib/automations/catalog";
import { listTeamMembers } from "@/lib/automations/queries";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { RunStatusBadge, StatusBadge } from "../AutomationBadges";
import { ActivationPanel } from "./ActivationPanel";
import { AutomationForm } from "../AutomationForm";
import { listMessageTemplates } from "@/lib/communications/queries";
import { Zap } from "lucide-react";

export const metadata = { title: "Automation" };
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

  const contactsCandidates = contactsCandidate(automation.actions ?? []);
  const spendsMoney = (automation.actions ?? []).some((action) =>
    CONSEQUENTIAL_ACTIONS.includes(action.type)
  );

  // Every trigger is wired now. What can still be unrunnable is a COMBINATION —
  // a sessionless trigger paired with an action that needs a signed-in user — so
  // the warning names the pairing rather than the trigger.
  const executable = checkExecutable({
    trigger: automation.trigger,
    actions: automation.actions ?? [],
  });

  const bolna = automation.required_integrations.includes("bolna")
    ? await getBolnaStatus(membership.organization.id)
    : null;

  // Both only feed the edit form, so neither is read for a role that cannot edit.
  const [teamMembers, messageTemplates] = canEdit
    ? await Promise.all([
        listTeamMembers(membership.organization.id),
        listMessageTemplates(membership.organization.id).then((result) => result.templates),
      ])
    : [[], []];

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

      {!executable.ok && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>This rule can&apos;t be activated as written.</strong> {executable.reason}
          </p>
        </div>
      )}

      {automation.status === "paused" && automation.paused_reason && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>This rule paused itself.</strong> {automation.paused_reason} Activating it again
            resets the count for today.
          </p>
        </div>
      )}

      {automation.requires_approval && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>This rule proposes, it doesn&apos;t act.</strong> When its conditions match it
            creates a request in{" "}
            <Link href="/automations/approvals">the approval queue</Link> and waits for an Owner or
            Admin. Nothing runs until somebody approves it, and a request that nobody decides
            expires after seven days.
          </p>
        </div>
      )}

      {isScheduledTrigger(automation.trigger) && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>{TRIGGER_LABELS[automation.trigger]}</strong> — fires{" "}
            {TRIGGER_SOURCES[automation.trigger]}. Whether the scheduler is running is shown on{" "}
            <Link href="/automations">the Automations page</Link>; if it isn&apos;t, this rule does
            nothing however healthy it looks here.
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
          {automation.daily_run_cap
            ? ` · at most ${automation.daily_run_cap} runs a day`
            : ""}
        </p>
      )}

      {canEdit && (
        <div className="mb-5">
          <h2 className="title is-5 mb-3">Edit the rule</h2>
          <AutomationForm
            mode="edit"
            canUseAi
            teamMembers={teamMembers}
            messageTemplates={messageTemplates}
            initial={{
              id: automation.id,
              name: automation.name,
              description: automation.description,
              trigger: automation.trigger,
              // Normalised on the way in, so a rule stored before condition
              // groups existed edits as a single "all of these" group rather
              // than rendering nothing.
              conditions: normalizeConditions(automation.conditions ?? []),
              actions: automation.actions ?? [],
              status: automation.status,
              drafted_by_ai: automation.drafted_by_ai,
              requires_approval: automation.requires_approval,
              daily_run_cap: automation.daily_run_cap,
              version: automation.version,
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
