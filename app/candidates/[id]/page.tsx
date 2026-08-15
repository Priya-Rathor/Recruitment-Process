import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getCandidate, getCandidateDuplicates } from "@/lib/candidates/queries";
import { listApplications } from "@/lib/applications/queries";
import { listPendingReviews, pendingReviewSummary } from "@/lib/resumes/pending";
import { listCandidateApplicationHistory } from "@/lib/candidates/applicationHistory";
import { resumeKeyPoints } from "@/lib/resumes/keyPoints";
import { getLatestParsedResume } from "@/lib/resumes/queries";
import { ApplicationHistory } from "./ApplicationHistory";
import { listResumeHistory } from "@/lib/resumes/history";
import { ResumesCard } from "./ResumesCard";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/types";
import { MatchScore, StageBadge } from "@/app/applications/StageBadge";
import { CandidateForm } from "../CandidateForm";
import { ArchiveCandidateButton } from "./CandidateActions";

export const metadata = { title: "Candidate" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="column is-one-third">
      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        {label}
      </p>
      <p style={{ fontSize: 15 }}>{value}</p>
    </div>
  );
}

async function CandidateDetailContent({
  candidateId,
  editing,
}: {
  candidateId: string;
  editing: boolean;
}) {
  const membership = await requireMembershipOrRedirect();

  const candidate = await getCandidate({
    organizationId: membership.organization.id,
    candidateId,
  });
  // Another organization's record resolves to null, so a guessed id is
  // indistinguishable from a genuinely missing one.
  if (!candidate) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const canArchive = hasRole(membership.role, ["owner", "admin"]);

  const [duplicates, { applications }, pendingReviews, resumes, historyCards, parsedResume] =
    await Promise.all([
    getCandidateDuplicates({ organizationId: membership.organization.id, candidateId }),
    listApplications({
      organizationId: membership.organization.id,
      filters: { candidateId },
      viewerRole: membership.role,
      viewerId: membership.user_id,
      limit: 25,
    }),
    // Resumes that proposed changes nobody has looked at yet. Bulk intake
    // queues these instead of interrupting a thirty-file upload thirty times,
    // which only works if the queue is visible somewhere.
    listPendingReviews({ organizationId: membership.organization.id, candidate }),
    // Full history, newest first. Nothing is filtered out — the point of the
    // section is that older resumes are still there.
    listResumeHistory({ organizationId: membership.organization.id, candidateId }),
    // Every application this candidate holds, each rolled up against ITS OWN
    // job's stage configuration — the shared effectiveStages() rule, not a
    // second implementation. See lib/candidates/applicationHistory.ts.
    listCandidateApplicationHistory({
      organizationId: membership.organization.id,
      candidateId,
      viewerRole: membership.role,
      viewerId: membership.user_id,
    }),
    getLatestParsedResume({ organizationId: membership.organization.id, candidateId }),
  ]);

  const pendingSummary = pendingReviewSummary(pendingReviews);

  // Edit mode is a query param rather than a separate route: the spec lists
  // only /candidates/[id], and editing in place keeps the duplicate context
  // visible while the recruiter works.
  if (editing && canEdit) {
    return (
      <>
        <div className="mb-5">
          <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
            <Link href="/candidates">Candidates</Link> /{" "}
            <Link href={`/candidates/${candidate.id}`}>{candidate.name}</Link> / Edit
          </p>
          <h1 className="title is-4">Edit candidate</h1>
        </div>
        <CandidateForm mode="edit" candidate={candidate} />
      </>
    );
  }

  return (
    <>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
            <Link href="/candidates">Candidates</Link> / {candidate.name}
          </p>
          <h1 className="title is-4 mb-2">{candidate.name}</h1>
          <div className="is-flex" style={{ gap: "0.5rem" }}>
            <span className="tag is-light" style={{ fontSize: 12 }}>
              {CANDIDATE_SOURCE_LABELS[candidate.source]}
            </span>
            {candidate.archived_at && (
              <span className="tag is-light" style={{ fontSize: 12 }}>
                Archived
              </span>
            )}
          </div>
        </div>

        <div className="buttons">
          <Link className="button" href={`/candidates/${candidate.id}/activity`}>
            Activity
          </Link>
          {canEdit && !candidate.archived_at && (
            <Link className="button is-primary" href={`/candidates/${candidate.id}?edit=1`}>
              Edit
            </Link>
          )}
        </div>
      </div>

      {/*
        Queued profile updates. Info-toned, not a warning: nothing is wrong, a
        resume simply said something different and we declined to guess. The
        link goes to Module 6's existing review screen — the same Conflict Row
        UI, reached from a new place rather than rebuilt.
      */}
      {pendingSummary && canEdit && (
        <div className="ai-panel mb-4">
          <div className="is-flex is-justify-content-space-between is-align-items-center">
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-info)" }}>
                From an uploaded resume
              </p>
              <p style={{ fontSize: 14 }}>{pendingSummary}</p>
            </div>
            <Link
              className="button is-small"
              // No resume id in the URL: the review screen already resolves the
              // most recent parsed resume itself, and intake always stores the
              // new one as the newest. Passing an id it ignores would be a lie.
              href={`/candidates/${candidate.id}/resume/review`}
            >
              Review
            </Link>
          </div>
          <p className="has-text-secondary mt-2" style={{ fontSize: 12 }}>
            Nothing has been changed on this profile. Each difference is shown side by side for
            you to accept or keep.
          </p>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Possible duplicate
          </h2>
          <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
            This record shares contact details with{" "}
            {duplicates.length === 1 ? "another candidate" : "other candidates"}. Nothing has been
            merged — merging two people&apos;s histories wrongly is worse than carrying a duplicate.
          </p>
          <ul>
            {duplicates.map((duplicate) => {
              const otherId =
                duplicate.candidate_id === candidate.id
                  ? duplicate.duplicate_of_id
                  : duplicate.candidate_id;
              return (
                <li key={duplicate.id} className="py-1" style={{ fontSize: 14 }}>
                  <Link href={`/candidates/${otherId}`}>View the other record</Link>
                  <span className="has-text-secondary"> — matched on {duplicate.matched_on}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5">Profile</h2>
        <div className="columns is-multiline">
          <Field label="Email" value={candidate.email ?? "—"} />
          <Field label="Phone" value={candidate.phone ?? "—"} />
          <Field label="Location" value={candidate.location ?? "—"} />
          <Field label="Current company" value={candidate.current_company ?? "—"} />
          <Field label="Current role" value={candidate.current_role ?? "—"} />
          <Field
            label="Total experience"
            value={
              candidate.total_experience_years === null
                ? "—"
                : `${candidate.total_experience_years} yrs`
            }
          />
          <Field
            label="Expected salary"
            value={
              candidate.expected_salary === null
                ? "—"
                : candidate.expected_salary.toLocaleString("en-IN")
            }
          />
          <Field
            label="Notice period"
            value={
              candidate.notice_period_days === null
                ? "—"
                : candidate.notice_period_days === 0
                  ? "Immediate"
                  : `${candidate.notice_period_days} days`
            }
          />
          <Field
            label="Added"
            value={new Date(candidate.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          />
        </div>

        <div className="mt-4">
          <p className="has-text-secondary mb-1" style={{ fontSize: 12 }}>
            Skills
          </p>
          {candidate.skills.length === 0 ? (
            <p style={{ fontSize: 14 }}>—</p>
          ) : (
            <div className="tags">
              {candidate.skills.map((skill) => (
                <span key={skill} className="tag is-light">
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The spec's "full history across jobs/applications" (Module 5). */}
      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
          <h2 className="title is-5 mb-0">Applications</h2>
          {canEdit && !candidate.archived_at && (
            <Link
              className="button is-small"
              href={`/applications/new?candidate_id=${candidate.id}`}
            >
              Apply to a job
            </Link>
          )}
        </div>

        {applications.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            This candidate isn&apos;t in any pipeline yet.
          </p>
        ) : (
          <ul>
            {applications.map((application) => (
              <li
                key={application.id}
                className="py-3 is-flex is-justify-content-space-between is-align-items-center"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <div>
                  <Link href={`/applications/${application.id}`} style={{ fontWeight: 600 }}>
                    {application.job_title}
                  </Link>
                  <p className="has-text-secondary" style={{ fontSize: 12 }}>
                    {application.recruiter_name ?? "Unassigned"}
                  </p>
                </div>
                <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
                  <MatchScore score={application.match_score} />
                  <StageBadge stage={application.stage} />
                </div>
              </li>
            ))}
          </ul>
        )}

      </div>

      {/*
        Replaces a single line that said only whether *a* resume existed. It
        could not answer the question a recruiter actually has — which version
        is this, and where did it come from.
      */}
      {/* Read-only for EVERY role, including Owner — it links out to where
          editing actually happens rather than duplicating it. */}
      <ApplicationHistory
        cards={historyCards}
        resumeSummary={resumeKeyPoints(parsedResume?.parseResult.raw_json)}
        timeZone={membership.organization.timezone}
      />

      <ResumesCard
        candidateId={candidate.id}
        resumes={resumes}
        canUpload={canEdit}
        timeZone={membership.organization.timezone}
      />

      {canArchive && !candidate.archived_at && (
        <div className="card" style={{ borderColor: "var(--color-error)" }}>
          <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
            Danger zone
          </h2>
          <ArchiveCandidateButton candidateId={candidate.id} name={candidate.name} />
        </div>
      )}

      {!canEdit && (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Your role has read-only access to candidates.
        </p>
      )}
    </>
  );
}

export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <CandidateDetailContent candidateId={id} editing={query.edit === "1"} />
      </Suspense>
    </AppShell>
  );
}
