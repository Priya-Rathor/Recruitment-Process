import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { getCandidate } from "@/lib/candidates/queries";
import { candidateTimelineTargets, getEntityTimeline } from "@/lib/activity/queries";
import { NarrativePanel } from "./NarrativePanel";
import { Activity } from "lucide-react";

export const metadata = { title: "Candidate activity · Recruitment OS" };
export const dynamic = "force-dynamic";

async function Timeline({ candidateId, candidateName }: { candidateId: string; candidateName: string }) {
  const membership = await requireMembershipOrRedirect();

  const targets = await candidateTimelineTargets({
    organizationId: membership.organization.id,
    candidateId,
  });

  const { events, failed } = await getEntityTimeline({
    organizationId: membership.organization.id,
    targets,
  });

  if (failed) return <ErrorState message="Couldn't load this candidate's activity." />;

  if (events.length === 0) {
    return (
      <EmptyState headline="No activity yet"
            message="Everything recorded for this candidate appears here as they move through the pipeline."
            icon={Activity} />
    );
  }

  return (
    <>
      <NarrativePanel
        candidateId={candidateId}
        candidateName={candidateName}
        eventCount={events.length}
      />

      <div className="card">
        <h2 className="title is-5 mb-4">Timeline</h2>
        {/* showEntity, because a candidate's history spans their applications,
            resumes and calls — without it two similar lines are indistinguishable. */}
        <ActivityTimeline events={events} showEntity />
      </div>
    </>
  );
}

export default async function CandidateActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const candidate = await getCandidate({
    organizationId: membership.organization.id,
    candidateId: id,
  });
  if (!candidate) notFound();

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/candidates">Candidates</Link> /{" "}
          <Link href={`/candidates/${id}`}>{candidate.name}</Link> / Activity
        </p>
        <h1 className="title is-4 mb-1">{candidate.name}&apos;s activity</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Everything recorded across this candidate&apos;s applications, resumes, calls and
          interviews.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={6} />
          </div>
        }
      >
        <Timeline candidateId={id} candidateName={candidate.name} />
      </Suspense>
    </AppShell>
  );
}
