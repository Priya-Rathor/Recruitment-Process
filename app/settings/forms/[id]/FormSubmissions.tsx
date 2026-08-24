// =============================================================================
// Submissions to one form.
//
// FOR A JOB APPLICATION FORM this is a secondary view — the primary one is the
// applications list, which is Module 5's and is not duplicated here. Each row
// links straight to the application it created, and to the candidate.
//
// FOR A STANDALONE FORM IT IS THE ONLY VIEW. Nothing is created by those
// submissions, so there is no application detail page for their answers to
// appear on. Without this screen, publishing a questionnaire would collect
// answers into a jsonb column the product never shows.
//
// Read-only, for every role. Nobody edits somebody else's submission.
// =============================================================================
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatAnswer } from "@/lib/forms/validation";
import type { FormSubmission } from "@/lib/forms/queries";
import { formatDateTimeInZone } from "@/lib/time";

const STATUS_NOTE: Record<string, string> = {
  received: "Still being processed",
  needs_review: "Some answers disagree with the existing profile",
  needs_attention: "Something went wrong after this was submitted",
};

export function FormSubmissions({
  submissions,
  total,
  isJobApplication,
  timeZone,
}: {
  submissions: FormSubmission[];
  total: number;
  isJobApplication: boolean;
  timeZone: string;
}) {
  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">Submissions</h2>
          <p className="job-card__subtitle">
            {total === 0
              ? "Nothing submitted yet."
              : isJobApplication
                ? `${total} ${total === 1 ? "submission" : "submissions"}. Each one is also an application, where the recruiter works.`
                : `${total} ${total === 1 ? "submission" : "submissions"}.`}
          </p>
        </div>
      </div>

      {submissions.length === 0 ? (
        <p className="job-empty">
          {isJobApplication
            ? "When somebody applies through the public link, they appear here and in this job's pipeline."
            : "When somebody fills this in, their answers appear here."}
        </p>
      ) : (
        <ul className="job-rows">
          {submissions.map((submission) => (
            <li key={submission.id} className="job-rows__row">
              <div className="is-flex is-justify-content-space-between is-align-items-center">
                <p className="job-rows__meta">
                  {formatDateTimeInZone(submission.submittedAt, timeZone)}
                </p>
                <div className="job-rows__links">
                  {submission.applicationId && (
                    <Link href={`/applications/${submission.applicationId}`} className="text-link">
                      Open application
                    </Link>
                  )}
                  {submission.candidateId && (
                    <Link href={`/candidates/${submission.candidateId}`} className="text-link">
                      Open candidate
                    </Link>
                  )}
                </div>
              </div>

              {/* A submission that could not be resolved is never silently
                  dropped — this is where a recruiter finds out about it. */}
              {submission.status !== "linked" && (
                <div
                  className={`apply-flag ${
                    submission.status === "needs_attention" ? "is-error" : "is-warning"
                  }`}
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  <p>
                    {submission.processingError ??
                      STATUS_NOTE[submission.status] ??
                      "Needs a look."}
                  </p>
                </div>
              )}

              <dl className="apply-answers">
                {submission.answers
                  // An unanswered optional question is stored as null. Showing a
                  // column of dashes would bury the answers that exist.
                  .filter((answer) => answer.value !== null && answer.value !== "")
                  .map((answer) => (
                    <div key={answer.fieldKey} className="apply-answers__row">
                      <dt className="apply-answers__q">{answer.label}</dt>
                      <dd className="apply-answers__a">{formatAnswer(answer.value)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      {total > submissions.length && (
        <p className="job-card__hint">
          Showing the {submissions.length} most recent of {total}.
        </p>
      )}
    </section>
  );
}
