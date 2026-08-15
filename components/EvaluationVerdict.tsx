// =============================================================================
// The four-part evaluation result, rendered.
//
// ONE COMPONENT for the resume gate, the screening call and every interview
// round — so a recruiter learns the layout once and reads it everywhere. Five
// bespoke layouts for the same four fields is how a product stops feeling like
// one product.
//
//   Score + Status chip, side by side
//   Narrative summary below
//   Strengths | Concerns, two columns on desktop, stacked on mobile
//
// Shared module (no "use client"): it adopts whichever environment imports it,
// so a server-rendered section and a client one both get it.
// =============================================================================
import { AlertTriangle, Check } from "lucide-react";
import {
  STATUS_LABELS,
  STATUS_TONE,
  isEmptyVerdict,
  type Verdict,
} from "@/lib/evaluation/verdict";

export function EvaluationVerdict({
  verdict,
  scoreSuffix = "/10",
  compact = false,
}: {
  verdict: Verdict;
  /** "/10" for rounds, "%" for the resume match. */
  scoreSuffix?: string;
  /** Drops the narrative, for the rollup on the candidate page. */
  compact?: boolean;
}) {
  if (isEmptyVerdict(verdict)) {
    return (
      <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
        Not evaluated yet.
      </p>
    );
  }

  const hasLists = verdict.strengths.length > 0 || verdict.concerns.length > 0;

  return (
    <div className="verdict">
      <div className="verdict__head">
        <span className="verdict__score">
          {verdict.score === null ? "—" : `${verdict.score}${scoreSuffix}`}
        </span>

        {/*
          The status chip sits beside the score, never instead of it: the number
          is the evidence and the word is the judgement, and a reader checking
          a borderline call needs both.
        */}
        <span className={`intake-chip is-${STATUS_TONE[verdict.status]}`}>
          {STATUS_LABELS[verdict.status]}
        </span>

        {verdict.threshold !== null && (
          <span className="verdict__threshold">
            passing {verdict.threshold}
            {scoreSuffix}
          </span>
        )}
      </div>

      {!compact && verdict.summary && <p className="verdict__summary">{verdict.summary}</p>}

      {hasLists && (
        <div className="verdict__lists">
          <div className="verdict__list">
            <p className="verdict__list-title">Strengths</p>
            {verdict.strengths.length === 0 ? (
              <p className="verdict__none">None recorded.</p>
            ) : (
              <ul>
                {verdict.strengths.map((item) => (
                  <li key={item} className="verdict__item">
                    <Check size={13} aria-hidden="true" className="verdict__bullet is-strength" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="verdict__list">
            <p className="verdict__list-title">Concerns</p>
            {verdict.concerns.length === 0 ? (
              <p className="verdict__none">None recorded.</p>
            ) : (
              <ul>
                {verdict.concerns.map((item) => (
                  <li key={item} className="verdict__item">
                    <AlertTriangle
                      size={13}
                      aria-hidden="true"
                      className="verdict__bullet is-concern"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
