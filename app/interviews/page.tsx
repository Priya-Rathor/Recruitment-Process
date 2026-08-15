import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { listInterviews } from "@/lib/interviews/queries";
import { getStatus } from "@/lib/integrations/calendar";
import {
  FEEDBACK_DUE_HOURS,
  INTERVIEW_STATUSES,
  overdueFeedback,
  STATUS_LABELS,
  type InterviewStatus,
} from "@/lib/interviews/feedback";
import {
  CalendarBadge,
  FeedbackBadge,
  InterviewStatusBadge,
  ModeBadge,
} from "./InterviewBadges";

export const metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

async function InterviewsTable({ status }: { status?: string }) {
  const membership = await requireMembershipOrRedirect();

  const [{ interviews, failed }, calendar] = await Promise.all([
    listInterviews({
      organizationId: membership.organization.id,
      status: (INTERVIEW_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as InterviewStatus)
        : null,
    }),
    getStatus(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load interviews." />;

  // The internal reminder queue standing in for Module 15. Computed on read;
  // nothing is sent anywhere.
  const overdue = overdueFeedback({
    interviews: interviews.map((interview) => ({
      id: interview.id,
      scheduledAt: interview.scheduled_at,
      durationMinutes: interview.duration_minutes,
      status: interview.status,
      hasFeedback: interview.has_feedback,
    })),
  });

  const overdueIds = new Set(overdue.map((entry) => entry.interview.id));

  return (
    <>
      {calendar.status !== "connected" && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>Google Calendar isn&apos;t connected.</strong> Interviews are scheduled and
            tracked here, but no invites are sent. Connecting it arrives with Settings (Module 17).
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <h2 className="title is-5" style={{ color: "var(--status-attention-text)" }}>
            Feedback outstanding
          </h2>
          <p className="has-text-secondary mb-2" style={{ fontSize: 13 }}>
            {overdue.length} interview{overdue.length === 1 ? "" : "s"} finished more than{" "}
            {FEEDBACK_DUE_HOURS} hours ago without feedback. Send a reminder to each assigned
            interviewer from{" "}
            <Link href="/notifications">Notifications</Link>.
          </p>
          <ul>
            {overdue.slice(0, 5).map((entry) => {
              const interview = interviews.find((row) => row.id === entry.interview.id);
              return (
                <li key={entry.interview.id} className="py-1" style={{ fontSize: 14 }}>
                  <Link href={`/interviews/${entry.interview.id}`}>
                    {interview?.candidate_name ?? "Interview"}
                  </Link>
                  <span className="has-text-secondary">
                    {" "}
                    — {entry.hoursOverdue}h overdue
                    {interview?.interviewer_name ? ` · ${interview.interviewer_name}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card mb-4">
        <div className="buttons">
          <Link className={`button is-small ${!status ? "is-primary" : ""}`} href="/interviews">
            All
          </Link>
          {INTERVIEW_STATUSES.map((option) => (
            <Link
              key={option}
              className={`button is-small ${status === option ? "is-primary" : ""}`}
              href={`/interviews?status=${option}`}
            >
              {STATUS_LABELS[option]}
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        {interviews.length === 0 ? (
          <EmptyState
            message={
              status
                ? "No interviews with that status."
                : "No interviews scheduled yet. Schedule one from an application."
            }
          />
        ) : (
          <div className="table-container">
            <table className="table is-fullwidth is-hoverable">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>When</th>
                  <th>Interviewer</th>
                  <th>Status</th>
                  <th>Feedback</th>
                </tr>
              </thead>
              <tbody>
                {interviews.map((interview) => (
                  <tr key={interview.id}>
                    <td>
                      <Link href={`/interviews/${interview.id}`} style={{ fontWeight: 600 }}>
                        {interview.candidate_name}
                      </Link>
                      <div className="is-flex mt-1" style={{ gap: "0.3rem" }}>
                        <ModeBadge mode={interview.mode} />
                        <CalendarBadge
                          status={interview.calendar_sync_status}
                          error={interview.calendar_error}
                        />
                      </div>
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {interview.job_title}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {new Date(interview.scheduled_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="has-text-secondary" style={{ fontSize: 13 }}>
                      {interview.interviewer_name ?? "Unassigned"}
                    </td>
                    <td>
                      <InterviewStatusBadge status={interview.status} />
                    </td>
                    <td>
                      <span
                        style={{
                          outline: overdueIds.has(interview.id)
                            ? "2px solid var(--color-warning)"
                            : undefined,
                          borderRadius: 4,
                        }}
                      >
                        <FeedbackBadge hasFeedback={interview.has_feedback} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [, query] = await Promise.all([requireMembershipOrRedirect(), searchParams]);

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Interviews</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Scheduling, briefs, and structured feedback.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <InterviewsTable status={query.status} />
      </Suspense>
    </AppShell>
  );
}
