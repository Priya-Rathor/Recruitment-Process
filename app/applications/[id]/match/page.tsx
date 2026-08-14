import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getOrCalculateMatch } from "@/lib/matching/queries";
import { MatchView } from "./MatchView";

export const metadata = { title: "Match · Recruitment OS" };
export const dynamic = "force-dynamic";

async function MatchContent({ applicationId }: { applicationId: string }) {
  const membership = await requireMembershipOrRedirect();

  const application = await getApplicationDetail({
    organizationId: membership.organization.id,
    applicationId,
  });
  if (!application) notFound();

  const canRecalculate = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  // Calculates only when absent or stale — staleness is set by a database
  // trigger on real data changes, so this is not a per-view AI call.
  const { match } = await getOrCalculateMatch({
    organizationId: membership.organization.id,
    applicationId,
    allowCalculate: canRecalculate,
  });

  return (
    <>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> /{" "}
          <Link href={`/applications/${application.id}`}>{application.candidate_name}</Link> / Match
        </p>
        <h1 className="title is-4 mb-1">
          {application.candidate_name}
          <span className="has-text-secondary" style={{ fontWeight: 400 }}> for </span>
          {application.job_title}
        </h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Salary, experience, location, notice period and listed skills are compared by code. AI
          only judges skill equivalence, role similarity and seniority.
        </p>
      </div>

      <MatchView match={match} applicationId={application.id} canRecalculate={canRecalculate} />
    </>
  );
}

export default async function ApplicationMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <MatchContent applicationId={id} />
      </Suspense>
    </AppShell>
  );
}
