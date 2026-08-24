// =============================================================================
// What the candidate actually typed, on the application they typed it into.
//
// WHY THIS CARD EXISTS AT ALL. The standard questions land on the candidate
// profile, so they are already visible. Everything else — the recruiter's own
// questions, and the standard ones the candidates table has no column for
// (current salary, LinkedIn, portfolio) — would otherwise live only in a jsonb
// column nobody reads. This is the only place those answers are shown.
//
// THE ORDER IS THE FORM'S ORDER, and the labels are the CURRENT labels: answers
// are keyed on field_key precisely so a renamed question keeps its answers.
// A question deleted after somebody answered it still shows, at the end, under
// its raw key — dropping an answer because the form changed afterwards would be
// rewriting the record.
//
// Server component: it renders, it does not write. Nobody edits somebody else's
// submission.
// =============================================================================
import Link from "next/link";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { formatAnswer } from "@/lib/forms/validation";
import { CANDIDATE_COLUMN_BY_KEY } from "@/lib/forms/fields";
import type { ApplicationFormResponse } from "@/lib/forms/queries";
import { formatDateTimeInZone } from "@/lib/time";

export function FormResponseCard({
  response,
  timeZone,
}: {
  response: ApplicationFormResponse;
  timeZone: string;
}) {
  /*
    WHAT IS WORTH SHOWING HERE, precisely.

    A key with a candidate column is already on the profile above, and repeating
    it would be two homes for one fact. Everything else is shown — which is both
    the custom questions and the standard fields that have nowhere else to go.
  */
  const shown = response.answers.filter(
    (answer) => !(answer.fieldKey in CANDIDATE_COLUMN_BY_KEY)
  );

  const needsAttention = response.response.status === "needs_attention";
  const needsReview = response.response.status === "needs_review";

  return (
    <div className="card mb-4" id="form-response">
      <div className="is-flex is-justify-content-space-between is-align-items-center mb-2">
        <h2 className="title is-5 mb-0">
          <ClipboardList size={16} aria-hidden="true" /> Application form responses
        </h2>
        <span className="has-text-secondary" style={{ fontSize: 12 }}>
          {response.formName} ·{" "}
          {formatDateTimeInZone(response.response.submitted_at, timeZone)}
        </span>
      </div>

      {/*
        THE ROW THAT SAYS SOMETHING WENT WRONG.

        A submission is never silently dropped — if the candidate could not be
        resolved, or their answers disagree with an existing profile, the
        applicant was still told "thank you" and this is where a recruiter finds
        out there is something to do about it.
      */}
      {(needsAttention || needsReview) && response.response.processing_error && (
        <div className={`apply-flag ${needsAttention ? "is-error" : "is-warning"}`}>
          <AlertTriangle size={14} aria-hidden="true" />
          <p>{response.response.processing_error}</p>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          This form asked only for the standard profile details, which are shown above.
        </p>
      ) : (
        <dl className="apply-answers">
          {shown.map((answer) => (
            <div key={answer.fieldKey} className="apply-answers__row">
              <dt className="apply-answers__q">{answer.label}</dt>
              <dd className="apply-answers__a">{formatAnswer(answer.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {response.response.resume_id && (
        <Link
          className="button is-outlined-primary is-small mt-3"
          href={`/api/resumes/${response.response.resume_id}/download`}
        >
          Open the resume they attached
        </Link>
      )}
    </div>
  );
}
