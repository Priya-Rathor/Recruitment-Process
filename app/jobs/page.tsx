import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listJobsWithHealth, listTeamMembers } from "@/lib/jobs/queries";
import { listClients } from "@/lib/clients/queries";
import { formatExperience } from "@/lib/jobs/format";
import { isJobStatus, JOB_STATUS_LABELS, WORK_MODE_LABELS } from "@/lib/types";
import { HealthBadge, StatusBadge } from "./JobBadges";
import { JobFilters } from "./JobFilters";

export const metadata = { title: "Jobs · Recruitment OS" };
export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string;
  recruiter_id?: string;
  client_id?: string;
  q?: string;
  archived?: string;
};

async function JobsTable({ searchParams }: { searchParams: SearchParams }) {
  const membership = await requireMembershipOrRedirect();

  const [{ jobs, failed }, members, { clients }] = await Promise.all([
    listJobsWithHealth({
      organizationId: membership.organization.id,
      filters: {
        // Filters are validated here, not trusted from the URL.
        status: isJobStatus(searchParams.status) ? searchParams.status : undefined,
        recruiterId: searchParams.recruiter_id || undefined,
        clientId: searchParams.client_id || undefined,
        search: searchParams.q || undefined,
        includeArchived: searchParams.archived === "true",
      },
    }),
    listTeamMembers(membership.organization.id),
    listClients({ organizationId: membership.organization.id }),
  ]);

  const hasFilters = Boolean(
    searchParams.status ||
      searchParams.recruiter_id ||
      searchParams.client_id ||
      searchParams.q ||
      searchParams.archived
  );

  return (
    <>
      <JobFilters members={members} clients={clients} />

      <div className="card">
        {failed ? (
          <ErrorState message="Couldn't load jobs." />
        ) : jobs.length === 0 ? (
          <EmptyState
            message={
              hasFilters
                ? "No jobs match these filters."
                : "No jobs yet. Create your first requisition — you can paste a job description and let AI structure it."
            }
            action={
              hasFilters ? (
                <Link className="button" href="/jobs">
                  Clear filters
                </Link>
              ) : hasRole(membership.role, ["owner", "admin", "recruiter"]) ? (
                <Link className="button is-primary" href="/jobs/new">
                  Create a job
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth is-hoverable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Experience</th>
                  <th>Location</th>
                  <th>Client</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link href={`/jobs/${job.id}`} style={{ fontWeight: 600 }}>
                        {job.title}
                      </Link>
                      {job.archived_at && (
                        <span className="tag is-light ml-2" style={{ fontSize: 11 }}>
                          Archived
                        </span>
                      )}
                      {job.required_skills.length > 0 && (
                        <p className="has-text-secondary" style={{ fontSize: 12 }}>
                          {job.required_skills.slice(0, 4).join(" · ")}
                          {job.required_skills.length > 4 && " …"}
                        </p>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>
                      <HealthBadge health={job.health} />
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {formatExperience(job.experience_min, job.experience_max)}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {job.location ?? "—"}
                      {job.work_mode && (
                        <span className="has-text-secondary"> · {WORK_MODE_LABELS[job.work_mode]}</span>
                      )}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {job.clientName ?? "—"}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {job.ownerName ?? "Unassigned"}
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

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [membership, resolvedParams] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);
  const canCreate = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  return (
    <AppShell>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-end mb-5">
        <div>
          <h1 className="title is-4 mb-1">Jobs</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {Object.values(JOB_STATUS_LABELS).join(" · ")}
          </p>
        </div>
        {/* Viewer cannot create, so the action is absent rather than greyed out. */}
        {canCreate && (
          <Link className="button is-primary" href="/jobs/new">
            New job
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
        <JobsTable searchParams={resolvedParams} />
      </Suspense>
    </AppShell>
  );
}
