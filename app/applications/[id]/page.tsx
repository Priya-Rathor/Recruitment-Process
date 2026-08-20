import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { isAgencyMode } from "@/lib/organizations/hiringModel";
import { getApplicationDetail } from "@/lib/applications/queries";
import { buildTimeline } from "@/lib/applications/timeline";
import { buildStageTimings } from "@/lib/applications/stageTimings";
import { CANDIDATE_SOURCE_LABELS } from "@/lib/types";
import { listInterviews } from "@/lib/interviews/queries";
import { listTeamMembers } from "@/lib/jobs/queries";
import { InterviewStatusBadge } from "@/app/interviews/InterviewBadges";
import { ScheduleInterview } from "./ScheduleInterview";
import { daysSince, formatDateTimeInZone } from "@/lib/time";
import { ApplicationSummary, NoteComposer, StageControl } from "./ApplicationDetailClient";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { listEvaluationEntries } from "@/lib/applications/evaluationQueries";
import { countByStage } from "@/lib/applications/evaluations";
import {
  buildStepper,
  effectiveStages,
  flagsFromRows,
  movableStages,
  visibleStages,
} from "@/lib/applications/effectiveStages";
import { statusFor } from "@/lib/evaluation/verdict";
import { DEFAULT_SCREENING_SETTINGS } from "@/lib/settings/queries";
import { suggestNextAction } from "@/lib/evaluation/nextAction";
import { getMatchHighlights, getJobResumeThreshold, thresholdsFromStages } from "@/lib/evaluation/sources";
import { phaseOf, PHASE_LABELS } from "@/lib/applications/phase";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { getLatestParsedResume } from "@/lib/resumes/queries";
import { resumeKeyPoints } from "@/lib/resumes/keyPoints";
import { ApplicationStageSection } from "./ApplicationStageSection";
import { ApplicationHeaderActions } from "./ApplicationHeaderActions";
import { SendMessagePanel } from "./SendMessagePanel";
import { CommunicationLog } from "@/components/CommunicationLog";
import {
  getCommunicationPreferences,
  listApplicationMessages,
  listMessageTemplates,
} from "@/lib/communications/queries";
import { getChannelAvailability } from "@/lib/communications/channels";
import { loadMessageContext } from "@/lib/communications/triggers";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_LABELS, PRIORITY_TONE, type ApplicationPriority } from "@/lib/applications/validation";
import { Activity, Layers, Pencil } from "lucide-react";

export const metadata = { title: "Application" };
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

  const [
    { interviews },
    members,
    stageRows,
    parsedResume,
    matchHighlights,
    resumeThreshold,
  ] = await Promise.all([
    listInterviews({
      organizationId: membership.organization.id,
      applicationId: application.id,
    }),
    listTeamMembers(membership.organization.id),
    // Which of the four configurable stages this application's JOB runs.
    listJobStages({ organizationId: membership.organization.id, jobId: application.job_id }),
    getLatestParsedResume({
      organizationId: membership.organization.id,
      candidateId: application.candidate_id,
    }),
    // Module 7's labelled lists — strong_matches, gaps, needs_verification —
    // ARE the resume gate's strengths and concerns. Read, never re-derived.
    getMatchHighlights({
      organizationId: membership.organization.id,
      applicationId: application.id,
    }),
    getJobResumeThreshold({
      organizationId: membership.organization.id,
      jobId: application.job_id,
    }),
  ]);

  // Per-stage passing thresholds, from the SAME rows that decided visibility —
  // one fetch, so the two cannot disagree about the job's configuration.
  const thresholds = thresholdsFromStages(stageRows);

  // Module 15's candidate communication. Read in parallel with each other and
  // AFTER the application resolves, because every one of them is keyed on the
  // candidate or application id.
  //
  // The message CONTEXT is loaded even for a role that cannot send, because the
  // composer's preview renders from it and a Recruiter who is not assigned still
  // sees the log. Nothing here is a secret from a team member.
  const [
    { messages, failed: messagesFailed },
    { templates: messageTemplates },
    communicationPreferences,
    channels,
    messageContext,
  ] = await Promise.all([
    listApplicationMessages({
      organizationId: membership.organization.id,
      applicationId: application.id,
    }),
    listMessageTemplates(membership.organization.id),
    getCommunicationPreferences({
      organizationId: membership.organization.id,
      candidateId: application.candidate_id,
    }),
    getChannelAvailability(membership.organization.id),
    loadMessageContext({
      client: await createClient(),
      organizationId: membership.organization.id,
      applicationId: application.id,
    }),
  ]);

  /**
   * "Manual send: Owner/Admin/Recruiter (assigned) can send."
   *
   * The assignment condition is mirrored here so the composer is not offered to
   * somebody the API will refuse — and the API refuses independently, because a
   * hidden button is not an access control.
   */
  const canSendMessage =
    hasRole(membership.role, ["owner", "admin"]) ||
    (membership.role === "recruiter" &&
      application.assigned_recruiter_id === membership.user_id);

  // Loaded AFTER the stages, because each entry's Pass/Fail is judged against
  // its own stage's threshold, and those live on the rows above.
  const evaluationEntries = await listEvaluationEntries({
    organizationId: membership.organization.id,
    applicationId: application.id,
    thresholds,
  });

  // One derivation, shared by the stepper, the Evaluation panel and the move
  // dropdown — so the three cannot disagree about which stages exist here.
  const availability = effectiveStages({
    flags: flagsFromRows(stageRows),
    entryCounts: countByStage(evaluationEntries),
    currentStage: application.stage,
  });
  const screeningConfig = stageRows.find((row) => row.stage_key === "ai_screening_call")
    ?.config as { maxAttempts: number | null } | undefined;

  const resumeStatus = statusFor({
    score: application.match_score,
    threshold: resumeThreshold,
  });

  // The suggestion. Reads the most recent COMPLETED round, judged against its
  // own stage's threshold — never a global one.
  const lastRound = evaluationEntries[0] ?? null;
  const nextAction = suggestNextAction({
    currentStage: application.stage,
    visibleStages: visibleStages(availability),
    lastRoundStatus: lastRound ? lastRound.status : null,
  });

  const stepper = buildStepper({
    availability,
    currentStage: application.stage,
    rejectedAtStage: application.rejected_at_stage ?? null,
    labels: STAGE_LABELS,
  });

  const timeline = buildTimeline({
    stages: application.stageHistory,
    notes: application.notes,
  });

  // The same history the Timeline renders chronologically, folded per stage so
  // each Evaluation section can state its own dates beside its own scores.
  const timings = buildStageTimings(application.stageHistory);

  // Interviews the Evaluation panel already shows in their own stage section.
  // Anything left — an onsite round, or a phone interview on a job that has
  // since switched that stage off — still needs somewhere to appear, and that
  // is the only thing the sidebar card is now for.
  const shownInterviewIds = new Set(
    evaluationEntries.filter((entry) => entry.source === "interview").map((entry) => entry.id)
  );
  const otherInterviews = interviews.filter((interview) => !shownInterviewIds.has(interview.id));

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
        {/*
          One status line, not three fragments. Each piece is a different KIND
          of thing — derived context, a stored attribute, an action — so each
          gets the treatment of its kind (plain text with an icon, a chip, a
          link) and a hairline divider between them. Run together at equal
          weight, as they were, a reader has to parse where one ends.
        */}
        <div className="meta-line mt-2">
          {/* Derived from the stage, never stored — see lib/applications/phase.ts. */}
          <span className="meta-line__item">
            <Layers size={14} aria-hidden="true" />
            Phase: {PHASE_LABELS[phaseOf(application.stage)]}
          </span>

          <span className="meta-line__divider" aria-hidden="true" />

          <span className={`intake-chip is-${PRIORITY_TONE[(application.priority ?? "normal") as ApplicationPriority]}`}>
            {PRIORITY_LABELS[(application.priority ?? "normal") as ApplicationPriority]} priority
          </span>

          {application.archived_at && (
            <>
              <span className="meta-line__divider" aria-hidden="true" />
              <span className="tag is-light" style={{ fontSize: 12 }}>
                Archived
              </span>
            </>
          )}

          <span className="meta-line__divider" aria-hidden="true" />

          {/*
            Candidate identity is shown, never edited here. One candidate can
            hold five applications, and letting any of them own the person's
            phone number means five screens racing over one fact.
          */}
          <Link href={`/candidates/${application.candidate_id}`} className="text-link is-primary">
            <Pencil size={13} aria-hidden="true" />
            Edit candidate details
          </Link>
        </div>
      </div>

      {canEdit && (
        <ApplicationHeaderActions
          applicationId={application.id}
          members={members}
          initial={{
            assignedRecruiterId: application.assigned_recruiter_id,
            source: application.source,
            priority: (application.priority ?? "normal") as ApplicationPriority,
          }}
          actions={
            canSendMessage && messageContext ? (
              <SendMessagePanel
                applicationId={application.id}
                candidateName={application.candidate_name}
                // The application's REAL values, resolved server-side by the same
                // loader the automatic sends use — so the preview cannot differ
                // from what actually goes out.
                values={messageContext.values}
                templates={messageTemplates}
                candidateEmail={messageContext.candidateEmail}
                candidatePhone={messageContext.candidatePhone}
                emailOptedOut={communicationPreferences.email_opted_out}
                whatsappOptedOut={communicationPreferences.whatsapp_opted_out}
                emailConnected={channels.emailConnected}
                whatsappConnected={channels.whatsappConnected}
              />
            ) : null
          }
        />
      )}

      {/*
        The stepper replaces the small stage chip. It spans the full width
        directly under the heading, because "where is this and how far has it
        come" is the first question this page is opened to answer.
      */}
      <ApplicationStageSection
        segments={stepper}
        applicationId={application.id}
        availability={availability}
        entries={evaluationEntries}
        timings={timings}
        resume={{
          matchScore: application.match_score,
          passingScore: resumeThreshold,
          status: resumeStatus,
          strengths: matchHighlights.strengths,
          concerns: matchHighlights.concerns,
          summary: resumeKeyPoints(parsedResume?.parseResult.raw_json),
          resumeId: parsedResume?.resume.id ?? null,
        }}
        maxCallAttempts={screeningConfig?.maxAttempts ?? DEFAULT_SCREENING_SETTINGS.maxAttempts}
        nextAction={nextAction}
        canEdit={canEdit}
        timeZone={membership.organization.timezone}
      />

      {/* Spec section 7: AI summary renders at the top, timeline below. */}
      <ApplicationSummary applicationId={application.id} />

      {/*
        Communications. Its own section rather than folded into the Timeline,
        because the two answer different questions: the timeline says what happened
        to the application, this says what the candidate was actually told. A
        recruiter deciding whether to chase somebody needs the second, in full,
        with the exact wording available.

        Visible to EVERY role, read-only for every role — it is a record.
      */}
      <div className="card mb-4" id="communications">
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-2">
          <h2 className="title is-5 mb-0">Communications</h2>
          {(communicationPreferences.email_opted_out ||
            communicationPreferences.whatsapp_opted_out ||
            communicationPreferences.unknown) && (
            <span className="has-text-secondary" style={{ fontSize: 12 }}>
              {communicationPreferences.unknown
                ? "Opt-out status unknown"
                : [
                    communicationPreferences.email_opted_out ? "Email opted out" : null,
                    communicationPreferences.whatsapp_opted_out ? "WhatsApp opted out" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          )}
        </div>
        <CommunicationLog
          messages={messages}
          failed={messagesFailed}
          timeZone={membership.organization.timezone}
          emptyMessage={
            messageTemplates.some((template) => template.active)
              ? "Nothing has been sent about this application yet. Active templates send as their events happen."
              : "Nothing has been sent about this application yet, and no message template is switched on."
          }
        />
      </div>

      <div className="columns">
        <div className="column is-two-thirds">
          <div className="card mb-4">
            <h2 className="title is-5">Timeline</h2>
            <NoteComposer applicationId={application.id} canWrite={canEdit} />

            {timeline.length === 0 ? (
              <EmptyState headline="No activity yet"
            message="Stage changes, calls and notes appear here as they happen."
            icon={Activity} />
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
                        {/*
                          The ORGANIZATION's timezone, never the server's — see
                          the note at the top of lib/time.ts.
                        */}
                        {formatDateTimeInZone(event.at, membership.organization.timezone)}
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
            <div id="stage-control">
            <StageControl
              applicationId={application.id}
              currentStage={application.stage}
              canEdit={canEdit}
              allowedStages={movableStages(availability)}
            />
            </div>
          </div>

          <div className="card mb-4">
            <h2 className="title is-5">Details</h2>
            {/*
              WHAT IS NOT HERE ANY MORE, AND WHY.
              Days in current stage, the applied date, and the entry points for
              Match and Screening all used to sit in this card as well as in
              their own Evaluation section. Two homes for one fact is two things
              to keep in step, and the sidebar copies were unconditional — a job
              that never places a screening call still offered the call screen.
              Each stage now appears exactly once, in the section for that stage.
            */}
            <dl style={{ fontSize: 14 }}>
              <Detail label="Recruiter" value={application.recruiter_name ?? "Unassigned"} />
              <Detail
                label="Source"
                value={CANDIDATE_SOURCE_LABELS[application.source] ?? application.source}
              />
              {/* Total age, which is not the same as time in any one stage. */}
              <Detail label="Days since applied" value={String(daysSince(application.created_at))} />
            </dl>
            <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
              Match score and screening results belong to this application, not to the candidate
              generally — the same person can score differently against another job.
            </p>
            {/*
              These two are not stages. An interview brief spans whichever
              rounds this job runs, and a client submission belongs to Module 12
              — neither has a stage section to live in, so they stay here.
            */}
            <Link
              className="button is-outlined-primary is-small is-fullwidth mt-3"
              href={`/applications/${application.id}/interview-brief`}
            >
              Interview brief
            </Link>
            {/* Agency mode only: an in-house team has no client to submit to. */}
            {isAgencyMode(membership.organization) && (
              <Link
                className="button is-outlined-primary is-small is-fullwidth mt-2"
                href={`/applications/${application.id}/submission`}
              >
                Submit to client
              </Link>
            )}
          </div>

          <div className="card mb-4">
            <h2 className="title is-5">Interviews</h2>
            {otherInterviews.length === 0 ? (
              <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
                {interviews.length === 0
                  ? "No interviews scheduled yet."
                  : "Scheduled rounds appear in their own stage above."}
              </p>
            ) : (
              <ul className="mb-3">
                {otherInterviews.map((interview) => (
                  <li key={interview.id} className="py-2">
                    <Link href={`/interviews/${interview.id}`} style={{ fontSize: 14 }}>
                      {formatDateTimeInZone(
                        interview.scheduled_at,
                        membership.organization.timezone
                      )}
                    </Link>
                    <div className="mt-1">
                      <InterviewStatusBadge status={interview.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ScheduleInterview
              applicationId={application.id}
              members={members}
              canSchedule={canEdit}
            />
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
