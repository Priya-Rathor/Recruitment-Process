import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getJobDetail } from "@/lib/jobs/queries";
import { formatExperience, formatSalary } from "@/lib/jobs/format";
import { listApplications } from "@/lib/applications/queries";
import { MatchScore, StageBadge } from "@/app/applications/StageBadge";
import { WORK_MODE_LABELS, type JobQuestion } from "@/lib/types";
import { listUnresolvedConflicts, loadConflictCandidates } from "@/lib/intake/queries";
import { HealthBadge, HealthReasons, StatusBadge } from "../JobBadges";
import { ArchiveJobButton } from "./JobActions";
import { IntakeModal } from "./IntakeModal";

export const metadata = { title: "Job · Recruitment OS" };
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

function QuestionList({
  title,
  help,
  questions,
  emptyWarning,
}: {
  title: string;
  help: string;
  questions: JobQuestion[];
  emptyWarning?: string;
}) {
  return (
    <div className="card mb-4">
      <h2 className="title is-5">{title}</h2>
      <p className="subtitle is-6 has-text-secondary">{help}</p>

      {questions.length === 0 ? (
        <p style={{ fontSize: 14, color: emptyWarning ? "var(--status-attention-text)" : undefined }}>
          {emptyWarning ?? "None yet."}
        </p>
      ) : (
        <ol style={{ fontSize: 14, listStyle: "decimal", paddingLeft: "1.25rem" }}>
          {questions.map((question) => (
            <li key={question.id} className="mb-2">
              {question.question}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

async function JobDetailContent({ jobId }: { jobId: string }) {
  const membership = await requireMembershipOrRedirect();
  const job = await getJobDetail({ organizationId: membership.organization.id, jobId });
  // A job belonging to another organization resolves to null here, so a guessed
  // id is indistinguishable from a genuinely missing one.
  if (!job) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const canArchive = hasRole(membership.role, ["owner", "admin"]);

  const [{ applications }, intakeConflicts] = await Promise.all([
    listApplications({
      organizationId: membership.organization.id,
      filters: { jobId },
      viewerRole: membership.role,
      viewerId: membership.user_id,
      limit: 50,
    }),
    listUnresolvedConflicts({ organizationId: membership.organization.id, jobId }),
  ]);

  // Names for the candidates each conflicted file pointed at. One query for the
  // whole banner rather than one per row.
  const conflictNames = new Map(
    (
      await loadConflictCandidates({
        organizationId: membership.organization.id,
        candidateIds: [...new Set(intakeConflicts.flatMap((item) => item.conflict_candidate_ids))],
      })
    ).map((candidate) => [candidate.id, candidate.name])
  );

  return (
    <>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
            <Link href="/jobs">Jobs</Link> / {job.title}
          </p>
          <h1 className="title is-4 mb-2">{job.title}</h1>
          <div className="is-flex" style={{ gap: "0.5rem" }}>
            <StatusBadge status={job.status} />
            <HealthBadge health={job.health} />
            {job.archived_at && (
              <span className="tag is-light" style={{ fontSize: 12 }}>
                Archived
              </span>
            )}
          </div>
        </div>

        {/*
          Two frequent actions, equal size, distinct styles. "Add candidates" is
          outlined rather than filled so the pair reads as two choices instead of
          one control with a shadow. Both are hidden for a Viewer — the API
          refuses them anyway, but showing a button that always fails is worse
          than not showing it.
        */}
        {canEdit && !job.archived_at && (
          <div className="is-flex" style={{ gap: "var(--space-2)" }}>
            <IntakeModal jobId={job.id} jobTitle={job.title} />
            <Link className="button is-primary" href={`/jobs/${job.id}/edit`}>
              Edit job
            </Link>
          </div>
        )}
      </div>

      {/*
        Files the matcher refused to guess at. They created nothing, so this is
        the only place they exist in the UI — without it, a conflict would be
        indistinguishable from a file nobody ever uploaded.
      */}
      {intakeConflicts.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--status-attention-text)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            {intakeConflicts.length === 1
              ? "1 resume needs manual review"
              : `${intakeConflicts.length} resumes need manual review`}
          </h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            Each of these matched more than one existing candidate, so no candidate or application
            was created. Open the candidates below and decide who the resume belongs to.
          </p>
          <ul>
            {intakeConflicts.map((item) => (
              <li
                key={item.id}
                className="py-3"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <p style={{ fontSize: 14, fontWeight: 600 }}>{item.file_name}</p>
                <p className="has-text-secondary" style={{ fontSize: 13 }}>
                  Matched{" "}
                  {item.conflict_candidate_ids
                    .map((id) => conflictNames.get(id) ?? "an archived candidate")
                    .join(" and ")}
                  .
                </p>
                <div className="is-flex mt-2" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
                  {item.conflict_candidate_ids.map((id) => (
                    <Link key={id} href={`/candidates/${id}`} style={{ fontSize: 13 }}>
                      {conflictNames.get(id) ?? "View candidate"}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5">Health</h2>
        <HealthReasons health={job.health} />
        <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
          Rule-based, not AI-scored. See <code>docs/modules/03-job-health-rules.md</code>.
        </p>
      </div>

      <div className="card mb-4">
        <h2 className="title is-5">Details</h2>
        <div className="columns is-multiline">
          <Field label="Experience" value={formatExperience(job.experience_min, job.experience_max)} />
          <Field label="Salary band" value={formatSalary(job.salary_min, job.salary_max)} />
          <Field label="Location" value={job.location ?? "—"} />
          <Field
            label="Work mode"
            value={job.work_mode ? WORK_MODE_LABELS[job.work_mode] : "—"}
          />
          <Field label="Owner" value={job.ownerName ?? "Unassigned"} />
          <Field
            label="Created"
            value={new Date(job.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          />
        </div>

        <div className="mt-4">
          <p className="has-text-secondary" style={{ fontSize: 12 }}>
            Required skills
          </p>
          {job.required_skills.length === 0 ? (
            <p style={{ fontSize: 14 }}>—</p>
          ) : (
            <div className="tags mt-2">
              {job.required_skills.map((skill) => (
                <span key={skill} className="tag is-light">
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <p className="has-text-secondary" style={{ fontSize: 12 }}>
            Preferred skills
          </p>
          {job.preferred_skills.length === 0 ? (
            <p style={{ fontSize: 14 }}>—</p>
          ) : (
            <div className="tags mt-2">
              {job.preferred_skills.map((skill) => (
                <span key={skill} className="tag is-light">
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {job.description && (
          <div className="mt-4">
            <p className="has-text-secondary mb-1" style={{ fontSize: 12 }}>
              Description
            </p>
            <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{job.description}</p>
          </div>
        )}
      </div>

      <QuestionList
        title="Screening questions"
        help="Asked on the automated screening call (Module 8)."
        questions={job.screeningQuestions}
        emptyWarning="None yet — AI screening can't run on this job until questions are added."
      />

      <QuestionList
        title="Interview questions"
        help="Suggested to the human interviewer (Module 11)."
        questions={job.interviewQuestions}
      />

      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
          <h2 className="title is-5 mb-0">Pipeline</h2>
          {canEdit && !job.archived_at && (
            <Link className="button is-small" href={`/applications/new?job_id=${job.id}`}>
              Add a candidate
            </Link>
          )}
        </div>

        {applications.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 14 }}>
            No candidates in this job&apos;s pipeline yet.
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
                    {application.candidate_name}
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

      {canArchive && !job.archived_at && (
        <div className="card" style={{ borderColor: "var(--color-error)" }}>
          {/* Danger Zone, kept away from normal actions per the design spec. */}
          <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
            Danger zone
          </h2>
          <ArchiveJobButton jobId={job.id} title={job.title} />
        </div>
      )}

      {/* Actions a role can't take are absent, not greyed out. */}
      {!canEdit && (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Your role has read-only access to jobs.
        </p>
      )}
    </>
  );
}

export default async function JobDetailPage({
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
            <SkeletonRows rows={4} />
          </div>
        }
      >
        <JobDetailContent jobId={id} />
      </Suspense>
    </AppShell>
  );
}
