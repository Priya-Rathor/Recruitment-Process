import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { buildTimeline, daysInCurrentStage } from "@/lib/applications/timeline";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/types";
import { daysSince } from "@/lib/time";
import { MatchScore, StageBadge } from "../StageBadge";
import { ApplicationSummary, NoteComposer, StageControl } from "./ApplicationDetailClient";

export const metadata = { title: "Application · Recruitment OS" };
export const dynamic = "force-dynamic";

async function ApplicationDetailContent({ applicationId }: { applicationId: string }) {
  const membership = await requireMembershipOrRedirect();

  const application = await getApplicationDetail({
    organizationId: membership.organization.id,
    applicationId,
  });
  // Another organization's record resolves to null, so a guessed id looks
  // exactly like a missing one.
  if (!application) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const timeline = buildTimeline({
    stages: application.stageHistory,
    notes: application.notes,
  });
  const inStageDays = daysInCurrentStage(application.stageHistory);

  return (
    <>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> / {application.candidate_name}
        </p>
        <h1 className="title is-4 mb-2">
          <Link href={`/candidates/${application.candidate_id}`}>
            {application.candidate_name}
          </Link>
          <span className="has-text-secondary" style={{ fontWeight: 400 }}>
            {" "}
            for{" "}
          </span>
          <Link href={`/jobs/${application.job_id}`}>{application.job_title}</Link>
        </h1>
        <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
          <StageBadge stage={application.stage} />
          <Link href={`/applications/${application.id}/match`} title="See the match breakdown">
            <MatchScore score={application.match_score} />
          </Link>
          {application.archived_at && (
            <span className="tag is-light" style={{ fontSize: 12 }}>
              Archived
            </span>
          )}
        </div>
      </div>

      {/* Spec section 7: AI summary renders at the top, timeline below. */}
      <ApplicationSummary applicationId={application.id} />

      <div className="columns">
        <div className="column is-two-thirds">
          <div className="card mb-4">
            <h2 className="title is-5">Timeline</h2>
            <NoteComposer applicationId={application.id} canWrite={canEdit} />

            {timeline.length === 0 ? (
              <EmptyState message="Nothing has happened on this application yet." />
            ) : (
              <ul>
                {timeline.map((event) => (
                  <li
                    key={event.id}
                    className="py-3"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <div className="is-flex is-justify-content-space-between">
                      <p style={{ fontSize: 14, fontWeight: 600 }}>
                        {event.title}
                        {event.durationDays !== null && (
                          <span className="has-text-secondary" style={{ fontWeight: 400 }}>
                            {" "}
                            · {event.durationDays}{" "}
                            {event.durationDays === 1 ? "day" : "days"} in stage
                          </span>
                        )}
                      </p>
                      <span className="has-text-secondary" style={{ fontSize: 12 }}>
                        {new Date(event.at).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {event.detail && (
                      <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{event.detail}</p>
                    )}
                    {event.actor && (
                      <p className="has-text-secondary" style={{ fontSize: 12 }}>
                        {event.actor}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="column">
          <div className="card mb-4">
            <h2 className="title is-5">Pipeline</h2>
            <StageControl
              applicationId={application.id}
              currentStage={application.stage}
              canEdit={canEdit}
            />
          </div>

          <div className="card mb-4">
            <h2 className="title is-5">Details</h2>
            <dl style={{ fontSize: 14 }}>
              <Detail label="Recruiter" value={application.recruiter_name ?? "Unassigned"} />
              <Detail
                label="Source"
                value={CANDIDATE_SOURCE_LABELS[application.source] ?? application.source}
              />
              <Detail
                label="Days in current stage"
                value={inStageDays === null ? "—" : String(inStageDays)}
              />
              <Detail label="Days since applied" value={String(daysSince(application.created_at))} />
              <Detail
                label="Applied"
                value={new Date(application.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
            </dl>
            <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
              Match score and screening results belong to this application, not to the candidate
              generally — the same person can score differently against another job.
            </p>
            <Link
              className="button is-small is-fullwidth mt-3"
              href={`/applications/${application.id}/match`}
            >
              {application.match_score === null ? "Calculate match" : "See match breakdown"}
            </Link>
            <Link
              className="button is-small is-fullwidth mt-2"
              href={`/applications/${application.id}/screening-call`}
            >
              AI screening call
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <dt className="has-text-secondary" style={{ fontSize: 12 }}>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({
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
        <ApplicationDetailContent applicationId={id} />
      </Suspense>
    </AppShell>
  );
}
