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
import { listJobStages } from "@/lib/hiring-stages/queries";
import { STAGES } from "@/lib/hiring-stages/catalog";
import { getOrganizationSettings } from "@/lib/settings/queries";
// MODULE 24 — the organization's screening fallbacks, so this page can say what
// an empty question list actually means for this job.
import { loadOrgCallDataContext } from "@/lib/voice/queries";
import type { AiScreeningConfig, ResumeScoreConfig } from "@/lib/hiring-stages/config";
import { getJobApplicationForm } from "@/lib/forms/queries";
import { buildApplyUrl } from "@/lib/forms/token";
import { requestOrigin } from "@/lib/forms/origin";
import { ScreeningSummary } from "./ScreeningSummary";
import { JobHiringStages, type PipelineStageRow } from "./JobHiringStages";
import { ResumeScoringCard } from "./ResumeScoringCard";
import { StageWorkflowBuilder } from "./StageWorkflowBuilder";
import { ApplyFlowTemplate } from "./ApplyFlowTemplate";
import { loadJobWorkflow } from "@/lib/workflow/queries";
import { loadWorkflowOptions } from "@/lib/workflow/options";
import { HealthBadge, HealthReasons, StatusBadge } from "../JobBadges";
import { ArchiveJobButton } from "./JobActions";
import { IntakeModal } from "./IntakeModal";
import { ApplicationFormCard } from "./ApplicationFormCard";

export const metadata = { title: "Job" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="job-fields__item">
      <p className="job-fields__label">{label}</p>
      <p className="job-fields__value">{value}</p>
    </div>
  );
}

function SkillTags({ label, skills }: { label: string; skills: string[] }) {
  return (
    <div className="job-skills">
      <p className="job-fields__label">{label}</p>
      {skills.length === 0 ? (
        <p className="job-fields__value">—</p>
      ) : (
        <div className="tags mt-2">
          {skills.map((skill) => (
            <span key={skill} className="tag is-light">
              {skill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The screening question list.
 *
 * A numbered badge and a row divider rather than a bare `<ol>` marker, so the
 * list reads like every other row list in the product. Still an ordered list in
 * the markup: the order is the order they are asked in, which a screen reader
 * should hear as well as see.
 */
function QuestionList({ questions }: { questions: JobQuestion[] }) {
  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">Screening questions</h2>
          <p className="job-card__subtitle">Asked on the automated screening call.</p>
        </div>
      </div>

      {questions.length === 0 ? (
        <p className="job-empty is-warning">
          None yet — automated screening can&apos;t run on this job until questions are added.
        </p>
      ) : (
        <ol className="qlist">
          {questions.map((question, index) => (
            <li key={question.id} className="qlist__row">
              <span className="qlist__num" aria-hidden="true">
                {index + 1}
              </span>
              <p className="qlist__text">{question.question}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

async function JobDetailContent({
  jobId,
  stagesFailed,
}: {
  jobId: string;
  /** Set when the job saved but its hiring stages did not (see JobForm). */
  stagesFailed: boolean;
}) {
  const membership = await requireMembershipOrRedirect();
  const job = await getJobDetail({ organizationId: membership.organization.id, jobId });
  // A job belonging to another organization resolves to null here, so a guessed
  // id is indistinguishable from a genuinely missing one.
  if (!job) notFound();

  const canEdit = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  /**
   * The workflow builder is Owner/Admin, NOT the page's general `canEdit`.
   *
   * It writes `automations` rows, and Module 13's spec puts rule authoring out of
   * a Recruiter's reach ("Create/edit automations — Recruiter: No"). Reusing
   * `canEdit` here would have offered a Recruiter controls whose save the RLS
   * policy then refuses — a permission error where a hidden control belonged.
   */
  const canEditWorkflow = hasRole(membership.role, ["owner", "admin"]);
  const canArchive = hasRole(membership.role, ["owner", "admin"]);
  /**
   * Regenerating the public application link is the same bar as archiving: it
   * takes something away from people outside the organization (every link
   * already forwarded, every QR code already printed), which a Recruiter should
   * not be able to do on their own.
   */
  const canManageLinks = hasRole(membership.role, ["owner", "admin"]);

  const [
    { applications },
    intakeConflicts,
    hiringStages,
    orgSettings,
    applicationForm,
    orgCallData,
    workflow,
    workflowOptions,
  ] = await Promise.all([
    listApplications({
      organizationId: membership.organization.id,
      filters: { jobId },
      viewerRole: membership.role,
      viewerId: membership.user_id,
      limit: 50,
    }),
    listUnresolvedConflicts({ organizationId: membership.organization.id, jobId }),
    listJobStages({ organizationId: membership.organization.id, jobId }),
    getOrganizationSettings(membership.organization.id),
    getJobApplicationForm({ organizationId: membership.organization.id, jobId }),
    loadOrgCallDataContext({
      organizationId: membership.organization.id,
      companyName: membership.organization.name,
    }),
    // MODULE 25. Both loaded here, in the same round, rather than fetched by the
    // client component — AGENTS.md prefers server loads, and it keeps the
    // builder's pickers populated on first paint rather than a beat later.
    loadJobWorkflow({ organizationId: membership.organization.id, jobId }),
    loadWorkflowOptions(membership.organization.id),
  ]);

  /*
    THE PUBLIC LINK IS BUILT ON THE SERVER, never in the browser.

    Signing it client-side would mean shipping INTEGRATION_ENCRYPTION_KEY into a
    bundle. It is also only built for a PUBLISHED form: a draft has no link to
    copy, and generating one anyway would put a working URL on screen for a form
    that has not been opened to the public yet.
  */
  const applyUrl =
    applicationForm?.status === "published"
      ? await buildApplyUrl({
          formId: applicationForm.id,
          tokenVersion: applicationForm.token_version,
          origin: await requestOrigin(),
        })
      : null;

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

  /*
    THE FOUR STAGES, ALWAYS ALL FOUR.

    listJobStages() already returns a row per stage whether or not one was ever
    saved, so "off" and "never configured" arrive here identically shaped. The
    only filter is by KIND: resume scoring is not a step candidates move
    through, so it gets its own card rather than a row in this list.
  */
  const pipelineStages: PipelineStageRow[] = STAGES.filter(
    (definition) => definition.kind === "pipeline"
  ).map((definition) => {
    const row = hiringStages.find((stage) => stage.stage_key === definition.key);
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      live: definition.execution === "live",
      engine: definition.engine,
      enabled: row?.enabled ?? false,
      promptTemplate: row?.prompt_template ?? null,
      config: row?.config ?? {},
      configured: Boolean(row?.prompt_template?.trim()),
    } as PipelineStageRow;
  });

  const resumeScore = hiringStages.find((stage) => stage.stage_key === "resume_score");
  const screening = hiringStages.find((stage) => stage.stage_key === "ai_screening_call");

  return (
    <div className="job-detail">
      <header className="job-header">
        <div className="job-header__text">
          <p className="job-header__crumbs">
            <Link href="/jobs">Jobs</Link> / {job.title}
          </p>
          <h1 className="job-header__title">{job.title}</h1>
          <div className="job-header__badges">
            <StatusBadge status={job.status} />
            <HealthBadge health={job.health} />
            {job.archived_at && <span className="tag is-light">Archived</span>}
          </div>
        </div>

        {/*
          ONE way to add people, not two. This used to sit beside a second
          button that opened a different flow under a nearly identical name
          ("Add candidates" / "Add a candidate"), which made the pair read as a
          choice a recruiter had to understand before clicking either.
        */}
        {canEdit && !job.archived_at && (
          <div className="job-header__actions">
            <IntakeModal jobId={job.id} jobTitle={job.title} />
            <Link className="button is-primary" href={`/jobs/${job.id}/edit`}>
              Edit job
            </Link>
          </div>
        )}
      </header>

      {/*
        Files the matcher refused to guess at. They created nothing, so this is
        the only place they exist in the UI — without it, a conflict would be
        indistinguishable from a file nobody ever uploaded.
      */}
      {intakeConflicts.length > 0 && (
        <section className="card is-attention">
          <h2 className="job-card__title is-attention">
            {intakeConflicts.length === 1
              ? "1 resume needs manual review"
              : `${intakeConflicts.length} resumes need manual review`}
          </h2>
          <p className="job-card__subtitle mb-3">
            Each of these matched more than one existing candidate, so no candidate or application
            was created. Open the candidates below and decide who the resume belongs to.
          </p>
          <ul className="job-rows">
            {intakeConflicts.map((item) => (
              <li key={item.id} className="job-rows__row">
                <p className="job-rows__name">{item.file_name}</p>
                <p className="job-rows__meta">
                  Matched{" "}
                  {item.conflict_candidate_ids
                    .map((id) => conflictNames.get(id) ?? "an archived candidate")
                    .join(" and ")}
                  .
                </p>
                <div className="job-rows__links">
                  {item.conflict_candidate_ids.map((id) => (
                    <Link key={id} href={`/candidates/${id}`} className="text-link">
                      {conflictNames.get(id) ?? "View candidate"}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stagesFailed && (
        <section className="card is-attention">
          <h2 className="job-card__title is-attention">Hiring stages weren&apos;t saved</h2>
          <p className="job-card__subtitle">
            The job itself saved correctly. Set the hiring stages again below — if it keeps
            failing, ask an administrator to check the workspace setup.
          </p>
        </section>
      )}

      {/* ---- Hiring stages: all four, on or off -------------------------- */}
      <JobHiringStages jobId={job.id} stages={pipelineStages} canEdit={canEdit} />

      {/* ---- Stage workflow: what fires on entry into each stage ---------
          Placed after the stage toggles and before Resume Scoring, because it
          reads as the consequence of the toggles above it: these are the stages
          this job runs, and this is what happens at each one. ---------------- */}
      {/* MODULE 26 — the one-click starting point, above the builder it fills
          in. Owner/Admin only, same bar as saving a single stage list. */}
      {canEditWorkflow && (
        <ApplyFlowTemplate
          jobId={job.id}
          hasExistingWorkflow={workflow.stages.some((stage) =>
            stage.lists.some((list) => list.actions.length > 0)
          )}
        />
      )}

      <StageWorkflowBuilder
        jobId={job.id}
        stages={workflow.stages}
        options={workflowOptions}
        canEdit={canEditWorkflow}
      />

      {/* ---- Resume scoring: always on, so never a stage row ------------- */}
      <ResumeScoringCard
        jobId={job.id}
        enabled={resumeScore?.enabled ?? false}
        config={(resumeScore?.config ?? {}) as ResumeScoreConfig}
        canEdit={canEdit}
      />

      {/* The screening stage gets a fuller card of its own — it is the one that
          actually calls a candidate, so its setup is worth seeing in full. */}
      {screening?.enabled && (
        <ScreeningSummary
          jobId={job.id}
          promptTemplate={screening.prompt_template}
          config={screening.config as AiScreeningConfig}
          questionCount={job.screeningQuestions.length}
          organizationMaxAttempts={orgSettings.settings.screening_settings.maxAttempts}
          organizationFallbackQuestions={orgCallData.callData.fallbackQuestions.length}
          canEdit={canEdit}
        />
      )}

      {/* ---- Application form: how candidates get in here at all --------- */}
      <ApplicationFormCard
        jobId={job.id}
        formId={applicationForm?.id ?? null}
        status={applicationForm?.status ?? null}
        fieldCount={applicationForm?.fieldCount ?? 0}
        submissionCount={applicationForm?.submissionCount ?? 0}
        publicUrl={applyUrl}
        canEdit={canEdit}
        canRegenerate={canManageLinks}
        jobArchived={Boolean(job.archived_at)}
      />

      {/* ---- Health ------------------------------------------------------ */}
      <section className="card">
        <div className="job-card__head">
          <div>
            <h2 className="job-card__title">Health</h2>
            <p className="job-card__subtitle">
              Rule-based, not AI-scored — from how complete this job is, how long it has been open,
              and whether candidates are moving.
            </p>
          </div>
        </div>
        <HealthReasons health={job.health} />
      </section>

      {/* ---- Details: the structured facts ------------------------------- */}
      <section className="card">
        <div className="job-card__head">
          <div>
            <h2 className="job-card__title">Details</h2>
          </div>
        </div>

        <div className="job-fields">
          <Field label="Experience" value={formatExperience(job.experience_min, job.experience_max)} />
          <Field label="Salary band" value={formatSalary(job.salary_min, job.salary_max)} />
          <Field label="Location" value={job.location ?? "—"} />
          <Field label="Work mode" value={job.work_mode ? WORK_MODE_LABELS[job.work_mode] : "—"} />
          <Field label="Client" value={job.clientName ?? "—"} />
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

        <SkillTags label="Required skills" skills={job.required_skills} />
        <SkillTags label="Preferred skills" skills={job.preferred_skills} />
      </section>

      {/* ---- Description: the narrative, and nothing that is already above -- */}
      {job.description && (
        <section className="card">
          <div className="job-card__head">
            <div>
              <h2 className="job-card__title">Description</h2>
            </div>
          </div>
          <p className="job-description">{job.description}</p>
        </section>
      )}

      <QuestionList questions={job.screeningQuestions} />

      {/* ---- Pipeline ---------------------------------------------------- */}
      <section className="card">
        <div className="job-card__head">
          <div>
            <h2 className="job-card__title">Pipeline</h2>
            <p className="job-card__subtitle">
              {applications.length === 0
                ? "Nobody in this job's pipeline yet."
                : `${applications.length} ${applications.length === 1 ? "candidate" : "candidates"} in this pipeline.`}
            </p>
          </div>

          {/* The same action as the header's, by the same name and the same
              component — a second entry point, not a second behaviour. */}
          {canEdit && !job.archived_at && applications.length > 0 && (
            <IntakeModal jobId={job.id} jobTitle={job.title} />
          )}
        </div>

        {applications.length === 0 ? (
          <div className="job-empty is-centred">
            <p className="job-empty__text">
              Drop resumes here and each one becomes a candidate on this job.
            </p>
            {canEdit && !job.archived_at && (
              <IntakeModal jobId={job.id} jobTitle={job.title} variant="primary" />
            )}
          </div>
        ) : (
          <ul className="job-rows">
            {applications.map((application) => (
              <li key={application.id} className="job-rows__row is-split">
                <div>
                  <Link href={`/applications/${application.id}`} className="job-rows__name">
                    {application.candidate_name}
                  </Link>
                  <p className="job-rows__meta">{application.recruiter_name ?? "Unassigned"}</p>
                </div>
                <div className="job-rows__end">
                  <MatchScore score={application.match_score} />
                  <StageBadge stage={application.stage} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Danger zone: sized to what it holds ------------------------- */}
      {canArchive && !job.archived_at && (
        <section className="card is-danger is-snug">
          <div>
            <h2 className="job-card__title is-danger">Danger zone</h2>
            <p className="job-card__subtitle">
              Archiving closes this job and hides it from the list. Nothing is deleted, and
              applications keep their history.
            </p>
          </div>
          <ArchiveJobButton jobId={job.id} title={job.title} />
        </section>
      )}

      {/* Actions a role can't take are absent, not greyed out. */}
      {!canEdit && <p className="job-card__subtitle">Your role has read-only access to jobs.</p>}
    </div>
  );
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stages_failed?: string }>;
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
        <JobDetailContent jobId={id} stagesFailed={query.stages_failed === "1"} />
      </Suspense>
    </AppShell>
  );
}
