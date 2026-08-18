import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { listJobsWithHealth, listTeamMembers } from "@/lib/jobs/queries";
import { listOnboardingRecords, onboardingFiltersFromParams } from "@/lib/onboarding/queries";
import { ONBOARDING_STATUS_LABELS, ONBOARDING_STATUS_TONE } from "@/lib/onboarding/documents";
import { SCHEMA_OUT_OF_DATE_MESSAGE } from "@/lib/supabase/errors";
import { UserCheck } from "lucide-react";
import { OnboardingFilters } from "./OnboardingFilters";
import { ProgressBar } from "./ProgressBar";

export const metadata = { title: "Onboarding" };
export const dynamic = "force-dynamic";

/**
 * MODULE 19 — hires in onboarding.
 *
 * THE ROUTE IS /hires, NOT /onboarding. /onboarding was already taken by
 * Module 1's workspace setup wizard — the page requireMembershipOrRedirect()
 * sends a user to when they have no organization yet, and an allowlisted public
 * path in proxy.ts. Taking that route would have broken sign-up.
 *
 * The nav label stays "Onboarding" because that is what a recruiter calls this.
 */

/** Initials for the avatar. Same shape as the nav's, at row scale. */
function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.slice(0, 2) ?? "?").toUpperCase();

  return (
    <span className="onboarding-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

async function OnboardingTable({ searchParams }: { searchParams: Record<string, string> }) {
  const membership = await requireMembershipOrRedirect();
  const params = new URLSearchParams(searchParams);

  const [{ records, total, failed, schemaOutOfDate }, { jobs }, members] = await Promise.all([
    listOnboardingRecords({
      organizationId: membership.organization.id,
      filters: onboardingFiltersFromParams(params),
    }),
    // Archived jobs included: a hire's onboarding outlives the requisition
    // closing, so a filter that could not name the job would be a dead end.
    listJobsWithHealth({
      organizationId: membership.organization.id,
      filters: { includeArchived: true },
      limit: 200,
    }),
    listTeamMembers(membership.organization.id),
  ]);

  if (failed) {
    return (
      <ErrorState
        headline={schemaOutOfDate ? "Database migration pending" : "Couldn't load this"}
        message={schemaOutOfDate ? SCHEMA_OUT_OF_DATE_MESSAGE : "Couldn't load onboarding records."}
      />
    );
  }

  const hasFilters = Array.from(params.keys()).length > 0;

  return (
    <>
      <OnboardingFilters jobs={jobs} members={members} />

      <div className="card">
        {records.length === 0 ? (
          <EmptyState
            headline={hasFilters ? "Nothing matches these filters" : "No one is onboarding right now"}
            message={
              hasFilters
                ? "No onboarding records match what you've selected."
                : "New onboarding records are created automatically when an application reaches Hired."
            }
            icon={UserCheck}
            accent={hasFilters ? "neutral" : "primary"}
            action={
              hasFilters ? (
                <Link className="button" href="/hires">
                  Clear filters
                </Link>
              ) : (
                <Link className="button is-outlined-primary" href="/applications">
                  Open applications
                </Link>
              )
            }
          />
        ) : (
          <>
            <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
              {records.length === total
                ? `${total} ${total === 1 ? "hire" : "hires"}`
                : `Showing ${records.length} of ${total} hires`}
              {" · waiting longest first"}
            </p>

            <div className="table-container">
              <table className="table is-fullwidth is-hoverable">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Documents</th>
                    <th>Assigned to</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span
                          className="is-flex is-align-items-center"
                          style={{ gap: "var(--space-2)" }}
                        >
                          <Avatar name={record.candidate_name} />
                          <Link href={`/hires/${record.id}`} style={{ fontWeight: 600 }}>
                            {record.candidate_name}
                          </Link>
                        </span>
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        <Link href={`/jobs/${record.job_id}`}>{record.job_title}</Link>
                      </td>
                      <td>
                        <StatusChip
                          tone={ONBOARDING_STATUS_TONE[record.status]}
                          label={ONBOARDING_STATUS_LABELS[record.status]}
                        />
                      </td>
                      <td style={{ minWidth: 190 }}>
                        <ProgressBar progress={record.progress} />
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {record.assigned_to_name ?? "Unassigned"}
                      </td>
                      <td className="has-text-secondary" style={{ fontSize: 13 }}>
                        {new Date(record.started_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: membership.organization.timezone,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default async function HiresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Onboarding</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Documents to collect and verify for everyone who has been hired.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <OnboardingTable searchParams={params} />
      </Suspense>
    </AppShell>
  );
}
