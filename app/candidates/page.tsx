import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listCandidates } from "@/lib/candidates/queries";
import { filtersFromSearchParams, isEmptyFilters } from "@/lib/candidates/filters";
import { activeDefinitions } from "@/lib/customFields/queries";
import { CandidateList } from "./CandidateList";

export const metadata = { title: "Candidates" };
export const dynamic = "force-dynamic";

async function CandidatesContent({ searchParams }: { searchParams: Record<string, string> }) {
  const membership = await requireMembershipOrRedirect();

  // Filters are parsed and validated server-side; the URL is never trusted.
  const filters = filtersFromSearchParams(new URLSearchParams(searchParams));

  const [{ candidates, total, failed }, customFields] = await Promise.all([
    listCandidates({ organizationId: membership.organization.id, filters }),
    // MODULE 27. The DEFINITIONS are server-loaded so the picker is populated on
    // first paint; the VALUES are fetched by the list, because searching
    // replaces the rows. See components/CustomColumns.tsx.
    activeDefinitions(membership.organization.id, "candidate"),
  ]);

  if (failed) return <ErrorState message="Couldn't load candidates." />;

  return (
    <CandidateList
      candidates={candidates}
      total={total}
      canCreate={hasRole(membership.role, ["owner", "admin", "recruiter"])}
      hasFilters={!isEmptyFilters(filters)}
      customFields={customFields}
    />
  );
}

export default async function CandidatesPage({
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
          <h1 className="title is-4 mb-1">Candidates</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            Every candidate in {membership.organization.name}, however they arrived.
          </p>
        </div>
        {/* Viewer cannot create, so the action is absent rather than disabled. */}
        {canCreate && (
          <Link className="button is-primary" href="/candidates/new">
            Add candidate
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
        <CandidatesContent searchParams={resolved} />
      </Suspense>
    </AppShell>
  );
}
