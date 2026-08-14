"use client";

// The side-by-side review screen: "Resume says expected CTC is 20 LPA. Existing
// profile says 18 LPA." — recruiter chooses which value to keep.
//
// Defaults are deliberate:
//   - a CONFLICT defaults to "keep", so doing nothing preserves verified data
//   - a NEW value defaults to "accept", since filling a blank discards nothing
//
// That asymmetry is the whole safety argument: the risky action requires an
// explicit click, the safe one doesn't.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { FieldComparison, ReviewDecision, ReviewableField } from "@/lib/resumes/review";

function initialDecisions(comparisons: FieldComparison[]): Record<string, ReviewDecision> {
  const decisions: Record<string, ReviewDecision> = {};
  for (const comparison of comparisons) {
    if (comparison.status === "new") decisions[comparison.field] = "accept";
    else if (comparison.status === "conflict") decisions[comparison.field] = "keep";
  }
  return decisions;
}

export function ReviewForm({
  resumeId,
  candidateId,
  comparisons,
  alreadyReviewed,
}: {
  resumeId: string;
  candidateId: string;
  comparisons: FieldComparison[];
  alreadyReviewed: boolean;
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>(() =>
    initialDecisions(comparisons)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionable = comparisons.filter(
    (comparison) => comparison.status === "new" || comparison.status === "conflict"
  );
  const unchanged = comparisons.filter(
    (comparison) => comparison.status === "same" || comparison.status === "missing"
  );

  const acceptCount = Object.values(decisions).filter((value) => value === "accept").length;

  function setDecision(field: ReviewableField, decision: ReviewDecision) {
    setDecisions((current) => ({ ...current, [field]: decision }));
  }

  async function save() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/resumes/${resumeId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions }),
    });

    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not apply those changes.");
      return;
    }

    router.push(`/candidates/${candidateId}`);
    router.refresh();
  }

  return (
    <div>
      <FormError message={error} />

      {alreadyReviewed && (
        <div className="card mb-4" style={{ borderColor: "var(--color-info)" }}>
          <p style={{ fontSize: 14 }}>
            This resume has already been reviewed. Reviewing again will apply your choices on top of
            the current profile.
          </p>
        </div>
      )}

      {actionable.length === 0 ? (
        <div className="card mb-4">
          <h2 className="title is-5">Nothing to decide</h2>
          <p style={{ fontSize: 14 }}>
            Everything the resume mentions already matches this candidate&apos;s profile.
          </p>
        </div>
      ) : (
        <div className="card mb-4">
          <h2 className="title is-5">Review changes</h2>
          <p className="subtitle is-6 has-text-secondary">
            Conflicts default to keeping what&apos;s already on the profile. Nothing is saved until
            you apply.
          </p>

          <div className="table-container">
            <table className="table is-fullwidth">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Profile says</th>
                  <th>Resume says</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                {actionable.map((comparison) => {
                  const decision = decisions[comparison.field] ?? "keep";
                  return (
                    <tr key={comparison.field}>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>
                        {comparison.label}
                        {comparison.status === "new" && (
                          <span
                            className="tag is-light ml-2"
                            style={{ fontSize: 10, fontWeight: 400 }}
                          >
                            new
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          fontSize: 13,
                          color: comparison.existing ? undefined : "var(--color-text-secondary)",
                        }}
                      >
                        {comparison.existing ?? "— empty —"}
                      </td>
                      <td style={{ fontSize: 13 }}>{comparison.proposed}</td>
                      <td>
                        <div className="buttons has-addons mb-0">
                          <button
                            type="button"
                            className={`button is-small ${decision === "keep" ? "is-primary" : ""}`}
                            onClick={() => setDecision(comparison.field, "keep")}
                            disabled={busy || comparison.existing === null}
                            title={
                              comparison.existing === null
                                ? "Nothing stored to keep"
                                : "Keep the profile value"
                            }
                          >
                            Profile
                          </button>
                          <button
                            type="button"
                            className={`button is-small ${
                              decision === "accept" ? "is-primary" : ""
                            }`}
                            onClick={() => setDecision(comparison.field, "accept")}
                            disabled={busy}
                          >
                            Resume
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {unchanged.length > 0 && (
        <div className="card mb-4">
          <h2 className="title is-5">No change needed</h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            Shown so you can see what the resume did and didn&apos;t contain.
          </p>
          <table className="table is-fullwidth" style={{ fontSize: 13 }}>
            <tbody>
              {unchanged.map((comparison) => (
                <tr key={comparison.field}>
                  <td style={{ fontWeight: 600 }}>{comparison.label}</td>
                  <td className="has-text-secondary">
                    {comparison.status === "same"
                      ? `Matches: ${comparison.existing}`
                      : "Not mentioned in the resume"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="is-flex is-justify-content-space-between is-align-items-center">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {acceptCount === 0
              ? "No changes will be applied."
              : `${acceptCount} ${acceptCount === 1 ? "field" : "fields"} will be updated.`}
          </p>
          <div className="buttons mb-0">
            <button
              type="button"
              className={`button is-primary ${busy ? "is-loading" : ""}`}
              onClick={save}
              disabled={busy}
            >
              Apply and finish
            </button>
            <button
              type="button"
              className="button"
              onClick={() => router.push(`/candidates/${candidateId}`)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
