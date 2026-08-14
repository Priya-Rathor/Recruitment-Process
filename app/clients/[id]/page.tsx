import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { getClient, getClientActivity } from "@/lib/clients/queries";
import { computeTurnaround, describeTurnaround } from "@/lib/clients/sla";
import { ClientActivityPanel } from "./ClientActivityPanel";

export const metadata = { title: "Client · Recruitment OS" };
export const dynamic = "force-dynamic";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="column is-one-third">
      <div className="card" style={{ height: "100%" }}>
        <p style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
        <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
          {label}
        </p>
        {hint && (
          <p className="has-text-secondary" style={{ fontSize: 11 }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const client = await getClient({ organizationId: membership.organization.id, clientId: id });
  if (!client) notFound();

  const activity = await getClientActivity({
    organizationId: membership.organization.id,
    clientId: id,
  });

  const { stats } = activity;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/clients">Clients</Link> / {client.name}
        </p>
        <h1 className="title is-4 mb-1">{client.name}</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {client.account_manager_name ?? "No account manager"} · expects a response within{" "}
          {client.feedback_sla_days} day{client.feedback_sla_days === 1 ? "" : "s"}
        </p>
      </div>

      <ClientActivityPanel clientId={client.id} />

      <div className="columns is-multiline mb-2">
        <Metric label="Open jobs" value={String(activity.activeJobs)} />
        <Metric label="Candidates submitted" value={String(activity.submittedCandidates)} />
        <Metric label="Interviews scheduled" value={String(activity.interviewsScheduled)} />
        <Metric
          label="Awaiting feedback"
          value={String(stats.pending)}
          hint={stats.overdue > 0 ? `${stats.overdue} past SLA` : undefined}
        />
        <Metric
          label="Average response"
          // "Not enough data" rather than a misleading 0 on an empty sample.
          value={stats.averageResponseDays === null ? "—" : `${stats.averageResponseDays}d`}
          hint={
            stats.averageResponseDays === null
              ? "No responses yet"
              : `Median ${stats.medianResponseDays}d`
          }
        />
        <Metric
          label="Responded on time"
          value={stats.onTimeRate === null ? "—" : `${stats.onTimeRate}%`}
          hint={stats.onTimeRate === null ? "No responses yet" : `of ${stats.responded} responses`}
        />
      </div>

      <div className="card">
        <h2 className="title is-5">Submissions</h2>
        {activity.events.length === 0 ? (
          <EmptyState message="No candidates have been submitted to this client yet." />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Submitted</th>
                  <th>Turnaround</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {activity.events.map((event) => {
                  const turnaround = computeTurnaround({
                    event,
                    slaDays: client.feedback_sla_days,
                  });
                  const late =
                    turnaround.status === "overdue" || turnaround.status === "responded_late";

                  return (
                    <tr key={event.id}>
                      <td>
                        <Link href={`/applications/${event.application_id}`} style={{ fontWeight: 600 }}>
                          {event.candidate_name}
                        </Link>
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {event.job_title}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {new Date(event.requestedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td
                        style={{
                          fontSize: 13,
                          color: late ? "var(--color-warning)" : undefined,
                        }}
                      >
                        {describeTurnaround(turnaround)}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {event.outcome ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
