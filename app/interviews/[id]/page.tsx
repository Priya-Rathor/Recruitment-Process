import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { getInterview } from "@/lib/interviews/queries";
import { listSessionsForInterview, suggestQuestionForInterview } from "@/lib/coding/queries";
import { canStartCodingRound } from "@/lib/coding/session";
import { buildCandidateUrl, isCodingTokenSigningConfigured } from "@/lib/coding/token";
import {
  MODE_LABELS,
  RECOMMENDATION_LABELS,
  feedbackReminderState,
} from "@/lib/interviews/feedback";
import { CalendarBadge, InterviewStatusBadge, ModeBadge } from "../InterviewBadges";
import { CancelInterview, FeedbackForm } from "./FeedbackForm";
import { CodingRoundPanel } from "./CodingRoundPanel";
import { MessageSquare } from "lucide-react";

export const metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  const result = await getInterview({
    organizationId: membership.organization.id,
    interviewId: id,
  });
  if (!result) notFound();

  const { interview, feedback } = result;

  const isStaff = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const isAssignedInterviewer =
    interview.interviewer_id === null || interview.interviewer_id === user.id;

  // Spec section 9: Recruiter submits feedback for interviews they are assigned
  // to; Owner/Admin may record it on anyone's behalf.
  const canSubmit =
    isStaff &&
    interview.status !== "cancelled" &&
    (membership.role !== "recruiter" || isAssignedInterviewer);

  const blockedReason = !isStaff
    ? "Your role can read feedback but not submit it."
    : interview.status === "cancelled"
      ? "This interview was cancelled, so there's nothing to give feedback on."
      : !isAssignedInterviewer
        ? "Only the assigned interviewer can submit feedback for this one."
        : null;

  const myFeedback = feedback.find((entry) => entry.submitted_by === user.id) ?? null;

  /**
   * Module 20's coding rounds, loaded HERE rather than fetched by the panel.
   *
   * The panel used to fetch on mount, which flashed an empty card on every visit
   * to an interview that already had a round open, and went against AGENTS.md's
   * "prefer loading data in server components" rule. The candidate URL is built
   * only for a round that is still open — a copy-to-clipboard button holding a
   * dead link is worse than no button.
   */
  const coding = await listSessionsForInterview({
    organizationId: membership.organization.id,
    interviewId: interview.id,
  });

  const codingSessions = await Promise.all(
    coding.sessions.map(async (session) => ({
      id: session.id,
      status: session.status,
      question_title: session.question_title,
      created_at: session.created_at,
      submitted_at: session.submitted_at,
      candidate_url:
        session.status === "created" || session.status === "in_progress"
          ? await buildCandidateUrl({ sessionId: session.id })
          : null,
    }))
  );

  // The question the job's Written Assessment configuration already holds, so a
  // recruiter is not asked to invent one they wrote down last month.
  const codingSuggestion = await suggestQuestionForInterview({
    organizationId: membership.organization.id,
    interviewId: interview.id,
  });

  const startable = canStartCodingRound(interview.status);

  const reminder = feedbackReminderState({
    interview: {
      id: interview.id,
      scheduledAt: interview.scheduled_at,
      durationMinutes: interview.duration_minutes,
      status: interview.status,
      hasFeedback: feedback.length > 0,
    },
  });

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/interviews">Interviews</Link> / {interview.candidate_name}
        </p>
        <h1 className="title is-4 mb-2">
          <Link href={`/applications/${interview.application_id}`}>
            {interview.candidate_name}
          </Link>
          <span className="has-text-secondary" style={{ fontWeight: 400 }}> — </span>
          {interview.job_title}
        </h1>
        <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
          <InterviewStatusBadge status={interview.status} />
          <ModeBadge mode={interview.mode} />
          <CalendarBadge
            status={interview.calendar_sync_status}
            error={interview.calendar_error}
          />
        </div>
      </div>

      {reminder.due && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>Feedback is outstanding.</strong> This interview finished{" "}
            {reminder.hoursOverdue} hours past the point feedback was due. Recollection fades
            quickly — worth filling in now.
          </p>
        </div>
      )}

      <div className="columns">
        <div className="column is-two-thirds">
          <div className="card mb-4">
            <h2 className="title is-5">Your feedback</h2>
            <FeedbackForm
              interviewId={interview.id}
              existing={myFeedback}
              canSubmit={canSubmit}
              blockedReason={blockedReason}
            />
          </div>

          {feedback.length > 0 && (
            <div className="card">
              <h2 className="title is-5">All feedback</h2>
              <ul>
                {feedback.map((entry) => (
                  <li
                    key={entry.id}
                    className="py-3"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                  >
                    <div className="is-flex is-justify-content-space-between is-align-items-center">
                      <p style={{ fontSize: 14, fontWeight: 600 }}>
                        {entry.submitter_name ?? "A teammate"}
                        {entry.submitted_by === user.id && (
                          <span className="tag is-light ml-2" style={{ fontSize: 10 }}>
                            You
                          </span>
                        )}
                      </p>
                      <div className="is-flex is-align-items-center" style={{ gap: "0.5rem" }}>
                        <span className="tag is-light" style={{ fontSize: 11 }}>
                          {entry.rating}/5
                        </span>
                        <span className="tag is-light" style={{ fontSize: 11, fontWeight: 600 }}>
                          {RECOMMENDATION_LABELS[entry.recommendation]}
                        </span>
                      </div>
                    </div>
                    {entry.notes && (
                      <p className="mt-2" style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>
                        {entry.notes}
                      </p>
                    )}
                    <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
                      {new Date(entry.submitted_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedback.length === 0 && (
            <div className="card">
              <h2 className="title is-5">All feedback</h2>
              <EmptyState headline="No feedback yet"
            message="The assigned interviewer can submit their assessment from this page."
            icon={MessageSquare} />
            </div>
          )}

          {/*
            Module 20. Below the feedback form rather than above it: feedback is
            what this page is FOR, and a coding round is one input to it. An
            interviewer arrives here to write their assessment, not to run a
            test they have usually already run.
          */}
          <CodingRoundPanel
            interviewId={interview.id}
            candidateName={interview.candidate_name}
            sessions={codingSessions}
            suggestion={codingSuggestion}
            signingConfigured={isCodingTokenSigningConfigured()}
            schemaOutOfDate={coding.schemaOutOfDate}
            canStart={isStaff && startable.ok}
            blockedReason={
              !isStaff
                ? "Your role can see coding rounds but not start them."
                : !startable.ok
                  ? startable.reason
                  : null
            }
          />

        </div>

        <div className="column">
          <div className="card mb-4">
            <h2 className="title is-5">Details</h2>
            <dl style={{ fontSize: 14 }}>
              <Detail
                label="When"
                value={new Date(interview.scheduled_at).toLocaleString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
              <Detail label="Duration" value={`${interview.duration_minutes} minutes`} />
              <Detail label="Mode" value={MODE_LABELS[interview.mode]} />
              <Detail label="Interviewer" value={interview.interviewer_name ?? "Unassigned"} />
              {interview.location && <Detail label="Location" value={interview.location} />}
            </dl>

            {interview.meeting_url && (
              <a
                className="button is-small is-fullwidth mt-2"
                href={interview.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join meeting
              </a>
            )}

            {/* Not-connected is stated plainly, not as an error. */}
            {interview.calendar_sync_status !== "synced" && interview.calendar_error && (
              <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
                {interview.calendar_error}
              </p>
            )}

            <Link
              className="button is-small is-fullwidth mt-3"
              href={`/applications/${interview.application_id}/interview-brief`}
            >
              Interview brief
            </Link>
          </div>

          {interview.notes && (
            <div className="card mb-4">
              <h2 className="title is-5">Notes</h2>
              <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{interview.notes}</p>
            </div>
          )}

          {isStaff && interview.status === "scheduled" && (
            <div className="card" style={{ borderColor: "var(--color-error)" }}>
              <h2 className="title is-5" style={{ color: "var(--color-error)" }}>
                Danger zone
              </h2>
              <CancelInterview interviewId={interview.id} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
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
