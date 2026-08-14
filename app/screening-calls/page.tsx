import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { listCalls } from "@/lib/screening/queries";
import { getStatus } from "@/lib/integrations/bolna";
import type { CallStatus } from "@/lib/screening/retry";
import { CallStatusBadge, ConsentBadge } from "./CallStatusBadge";

export const metadata = { title: "Screening calls · Recruitment OS" };
export const dynamic = "force-dynamic";

const FILTERABLE: CallStatus[] = [
  "completed",
  "no_answer",
  "failed",
  "callback_requested",
  "cancelled",
];

async function CallsTable({ status }: { status: string | undefined }) {
  const membership = await requireMembershipOrRedirect();

  const [{ calls, failed }, bolna] = await Promise.all([
    listCalls({
      organizationId: membership.organization.id,
      status: (FILTERABLE as string[]).includes(status ?? "") ? (status as CallStatus) : null,
    }),
    getStatus(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load screening calls." />;

  return (
    <>
      {bolna.status !== "connected" && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>Bolna isn&apos;t connected.</strong> Existing calls are shown below, but no new
            ones can be placed. Connection management arrives with Settings (Module 17).
          </p>
        </div>
      )}

      <div className="card mb-4">
        <div className="buttons">
          <Link className={`button is-small ${!status ? "is-primary" : ""}`} href="/screening-calls">
            All
          </Link>
          {FILTERABLE.map((option) => (
            <Link
              key={option}
              className={`button is-small ${status === option ? "is-primary" : ""}`}
              href={`/screening-calls?status=${option}`}
            >
              {option.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        {calls.length === 0 ? (
          <EmptyState
            message={
              status
                ? "No calls with that outcome."
                : "No screening calls yet. Start one from an application."
            }
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth is-hoverable">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Attempt</th>
                  <th>Outcome</th>
                  <th>Consent</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td>
                      <Link
                        href={`/applications/${call.application_id}/screening-call`}
                        style={{ fontWeight: 600 }}
                      >
                        {call.candidate_name}
                      </Link>
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {call.job_title}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {call.attempt_number}
                    </td>
                    <td>
                      <CallStatusBadge status={call.status} />
                    </td>
                    <td>
                      <ConsentBadge confirmed={call.consent_confirmed} />
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {new Date(call.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
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

export default async function ScreeningCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [, query] = await Promise.all([requireMembershipOrRedirect(), searchParams]);

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Screening calls</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Every automated screening call across the organization. Calls without recorded consent
          can&apos;t be used for screening decisions.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <CallsTable status={query.status} />
      </Suspense>
    </AppShell>
  );
}
