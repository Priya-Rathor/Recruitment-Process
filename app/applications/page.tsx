import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { applicationFiltersFromParams, listApplications } from "@/lib/applications/queries";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";
import { ApplicationFilters } from "./ApplicationFilters";
import { ApplicationTable } from "./ApplicationTable";
import { activeDefinitions } from "@/lib/customFields/queries";
import { listJobsWithHealth } from "@/lib/jobs/queries";
import { SCHEMA_OUT_OF_DATE_MESSAGE } from "@/lib/supabase/errors";

export const metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

async function ApplicationsTable({ searchParams }: { searchParams: Record<string, string> }) {
  const membership = await requireMembershipOrRedirect();
  const params = new URLSearchParams(searchParams);

  const [{ applications, total, failed, schemaOutOfDate }, { jobs }, customFields] =
    await Promise.all([
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
    }),,
    // MODULE 27. Definitions only — the table fetches the values for the rows it
    // is showing, which keeps one code path for filtered and unfiltered views.
    activeDefinitions(membership.organization.id, "application"),
  ]);

  if (failed) {
    return (
      <ErrorState
        headline={schemaOutOfDate ? "Database migration pending" : "Couldn't load this"}
        message={schemaOutOfDate ? SCHEMA_OUT_OF_DATE_MESSAGE : "Couldn't load applications."}
      />
    );
  }

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
            <ApplicationTable
              applications={applications}
              total={total}
              countSuffix={membership.role === "recruiter" ? " · yours and unassigned" : ""}
              customFields={customFields}
            />
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
