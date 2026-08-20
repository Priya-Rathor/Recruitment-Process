import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listApprovals } from "@/lib/automations/approvals";
import { ACTION_LABELS } from "@/lib/automations/catalog";
import { ApprovalCard } from "./ApprovalCard";
import { listMessageTemplates } from "@/lib/communications/queries";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Automation approvals" };
export const dynamic = "force-dynamic";

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * THE OVERSIGHT QUEUE.
 *
 * Two lists, deliberately on one page. Pending is the work; decided is the
 * record. Splitting them across screens would make the record something nobody
 * looks at, and the record is the half that answers "who let this happen?".
 *
 * READABLE BY EVERY ROLE, decidable by Owner/Admin. A recruiter whose candidate
 * is waiting on somebody else's decision should be able to see that this is what
 * is holding it up, rather than watching an application sit still.
 */
export default async function ApprovalsPage() {
  const membership = await requireMembershipOrRedirect();
  const canDecide = hasRole(membership.role, ["owner", "admin"]);

  const [pending, decided, { templates }] = await Promise.all([
    listApprovals({ organizationId: membership.organization.id, status: "pending" }),
    listApprovals({ organizationId: membership.organization.id, status: "all", limit: 50 }),
    // Module 15. So a proposal to send a templated message NAMES the template
    // rather than asking somebody to approve wording they cannot see. One read for
    // the whole page, not one per card.
    listMessageTemplates(membership.organization.id),
  ]);

  const templateNames = Object.fromEntries(
    templates.map((template) => [template.id, template.name])
  );

  const history = decided.approvals.filter((approval) => approval.status !== "pending");

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/automations">Automations</Link> / Approvals
        </p>
        <h1 className="title is-4 mb-1">Waiting for a decision</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Rules set to require approval propose their actions here instead of running them. Nothing
          on this page has happened yet.
        </p>
      </div>

      {pending.failed ? (
        <ErrorState message="Couldn't load the approval queue. This is not the same as nothing being in it — reload before assuming there is nothing to decide." />
      ) : pending.approvals.length === 0 ? (
        <div className="card mb-5">
          <EmptyState
            headline="Nothing is waiting"
            message="When a rule that requires approval matches an application, its proposed actions appear here."
            icon={ShieldCheck}
          />
        </div>
      ) : (
        <div className="mb-5">
          {pending.approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={{
                id: approval.id,
                automation_id: approval.automation_id,
                automation_name: approval.automation_name,
                application_id: approval.application_id,
                candidate_name: approval.candidate_name,
                job_title: approval.job_title,
                actions: approval.actions,
                summary: approval.summary,
                expires_at: approval.expires_at,
                created_at: approval.created_at,
              }}
              canDecide={canDecide}
              templateNames={templateNames}
            />
          ))}
        </div>
      )}

      <h2 className="title is-5 mb-3">Decisions already made</h2>
      <div className="card">
        {decided.failed ? (
          <ErrorState message="Couldn't load the decision history." />
        ) : history.length === 0 ? (
          <EmptyState
            headline="No decisions yet"
            message="Every approval, rejection and expiry is kept here — it is the record of who intervened, and when."
            icon={ShieldCheck}
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth">
              <thead>
                <tr>
                  <th>Automation</th>
                  <th>Application</th>
                  <th>Decision</th>
                  <th>Who</th>
                  <th>Proposed actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((approval) => (
                  <tr key={approval.id}>
                    <td style={{ fontSize: 14 }}>
                      <Link href={`/automations/${approval.automation_id}`}>
                        {approval.automation_name}
                      </Link>
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      <Link href={`/applications/${approval.application_id}`}>
                        {approval.candidate_name ?? "Application"}
                      </Link>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {approval.status === "approved" && (
                        <span style={{ color: "var(--color-success)" }}>Approved</span>
                      )}
                      {approval.status === "rejected" && <span>Declined</span>}
                      {/* Expiry reads differently from a decision on purpose:
                          nobody chose it, and that is the point of recording it. */}
                      {approval.status === "expired" && (
                        <span style={{ color: "var(--color-warning)" }}>
                          Expired undecided
                        </span>
                      )}
                      {approval.decided_at && (
                        <div className="has-text-secondary" style={{ fontSize: 12 }}>
                          {formatWhen(approval.decided_at)}
                        </div>
                      )}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {approval.decided_by_name ?? "—"}
                      {approval.decision_note && (
                        <div style={{ fontSize: 12 }}>“{approval.decision_note}”</div>
                      )}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {approval.actions
                        .map((action) => ACTION_LABELS[action.type] ?? action.type)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
