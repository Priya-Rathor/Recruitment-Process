import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { applicationFiltersFromParams, listApplications } from "@/lib/applications/queries";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";
import { daysSince } from "@/lib/time";
import { MatchScore, StageBadge } from "./StageBadge";
import { ApplicationFilters } from "./ApplicationFilters";
import { listJobsWithHealth } from "@/lib/jobs/queries";

export const metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

async function ApplicationsTable({ searchParams }: { searchParams: Record<string, string> }) {
  const membership = await requireMembershipOrRedirect();
  const params = new URLSearchParams(searchParams);

  const [{ applications, total, failed }, { jobs }] = await Promise.all([
    listApplications({
      organizationId: membership.organization.id,
      filters: applicationFiltersFromParams(params),
      viewerRole: membership.role,
      viewerId: membership.user_id,
    }),
    // For the Job filter. Archived jobs included: their applications are still
    // in the list, so a filter that could not name them would be a dead end.
    listJobsWithHealth({
      organizationId: membership.organization.id,
      filters: { includeArchived: true },
      limit: 200,
    }),
  ]);

  if (failed) return <ErrorState message="Couldn't load applications." />;

  const hasFilters = Array.from(params.keys()).length > 0;

  return (
    <>
      <ApplicationFilters jobs={jobs} />

      <div className="card">
        {applications.length === 0 ? (
          <EmptyState
            message={
              hasFilters
                ? "No applications match these filters."
                : "No applications yet. Link a candidate to a job to start a pipeline."
            }
            action={
              hasFilters ? (
                <Link className="button" href="/applications">
                  Clear filters
                </Link>
              ) : hasRole(membership.role, ["owner", "admin", "recruiter"]) ? (
                <Link className="button is-primary" href="/applications/new">
                  Link a candidate to a job
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
              {applications.length === total
                ? `${total} ${total === 1 ? "application" : "applications"}`
                : `Showing ${applications.length} of ${total} applications`}
              {membership.role === "recruiter" && " · yours and unassigned"}
            </p>

            <div className="table-container">
              <table className="table is-fullwidth is-hoverable">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Job</th>
                    <th>Stage</th>
                    <th>Match</th>
                    <th>Recruiter</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => {
                    const idleDays = daysSince(application.updated_at);
                    return (
                      <tr key={application.id}>
                        <td>
                          <Link
                            href={`/applications/${application.id}`}
                            style={{ fontWeight: 600 }}
                          >
                            {application.candidate_name}
                          </Link>
                          {application.archived_at && (
                            <span className="tag is-light ml-2" style={{ fontSize: 11 }}>
                              Archived
                            </span>
                          )}
                        </td>
                        <td className="has-text-secondary" style={{ fontSize: 13 }}>
                          {application.job_title}
                        </td>
                        <td>
                          <StageBadge stage={application.stage} />
                        </td>
                        <td>
                          <MatchScore score={application.match_score} />
                        </td>
                        <td className="has-text-secondary" style={{ fontSize: 13 }}>
                          {application.recruiter_name ?? "Unassigned"}
                        </td>
                        <td
                          className="has-text-secondary"
                          style={{
                            fontSize: 13,
                            color: idleDays >= 3 ? "var(--color-warning)" : undefined,
                          }}
                        >
                          {idleDays === 0 ? "Today" : `${idleDays}d ago`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const [membership, resolved] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);
  const canCreate = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  return (
    <AppShell>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-end mb-5">
        <div>
          <h1 className="title is-4 mb-1">Applications</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {APPLICATION_STAGES.slice(0, 8)
              .map((stage) => STAGE_LABELS[stage])
              .join(" → ")}
          </p>
        </div>
        {canCreate && (
          <Link className="button is-primary" href="/applications/new">
            New application
          </Link>
        )}
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <ApplicationsTable searchParams={resolved} />
      </Suspense>
    </AppShell>
  );
}
