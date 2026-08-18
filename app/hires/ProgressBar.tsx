// =============================================================================
// The document progress indicator.
//
// Shared (no "use client") so the list's compact bar and the detail page's large
// one are the same component with the same arithmetic — two implementations of
// "4/7 verified" would eventually disagree about whether optional documents
// count.
//
// THE BAR TRACKS REQUIRED DOCUMENTS. The fraction beside it says which, in
// words, because a bar alone cannot distinguish "5 of 5 required" from "5 of 9
// total" and the difference decides whether this hire can be completed.
// =============================================================================
import type { ChecklistProgress } from "@/lib/onboarding/documents";

export function ProgressBar({
  progress,
  size = "compact",
}: {
  progress: ChecklistProgress;
  size?: "compact" | "large";
}) {
  const complete = progress.requiredTotal > 0 && progress.requiredVerified === progress.requiredTotal;

  // An org with no checklist configured. Saying "0/0 verified" invites the
  // reader to wonder what went wrong; saying so plainly does not.
  if (progress.total === 0) {
    return (
      <span className="has-text-secondary" style={{ fontSize: "var(--text-caption)" }}>
        No checklist
      </span>
    );
  }

  return (
    <div className={`doc-progress is-${size}`}>
      <div
        className="doc-progress__track"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress.requiredVerified} of ${progress.requiredTotal} required documents verified`}
      >
        <div
          className={`doc-progress__fill${complete ? " is-complete" : ""}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <p className="doc-progress__label">
        <strong>
          {progress.requiredVerified}/{progress.requiredTotal}
        </strong>{" "}
        required verified
        {/* Only when there ARE optional ones, so the common case stays short. */}
        {progress.total > progress.requiredTotal && (
          <span className="doc-progress__optional">
            {" "}
            · {progress.verified}/{progress.total} including optional
          </span>
        )}
      </p>
    </div>
  );
}
