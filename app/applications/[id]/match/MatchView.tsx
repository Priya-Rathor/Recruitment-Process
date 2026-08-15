"use client";

// Match breakdown. The spec is emphatic that AI "never returns a bare
// percentage" — so the score is always shown alongside the three labelled lists,
// and every item says whether it was CHECKED (by code) or ASSESSED (by AI).
//
// That distinction is the point: salary being over band is a fact, "Spring
// covers Spring Boot" is a judgement, and a recruiter deciding someone's career
// deserves to know which is which.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import type { MatchFinding } from "@/lib/matching/deterministic";
import { scoreBand } from "@/lib/matching/score";
import type { StoredMatch } from "@/lib/matching/queries";
import { formatDateTimeInZone } from "@/lib/time";

const BAND_COLOR = {
  strong: "var(--color-success)",
  moderate: "var(--color-warning)",
  weak: "var(--color-error)",
} as const;

function SourceTag({ source }: { source: MatchFinding["source"] }) {
  const isCode = source === "code";
  return (
    <span
      className="tag is-light ml-2"
      style={{ fontSize: 10, fontWeight: 600 }}
      title={
        isCode
          ? "Checked against recorded data"
          : "Assessed by AI — a judgement, not a verified fact"
      }
    >
      {isCode ? "checked" : "AI"}
    </span>
  );
}

function FindingList({
  title,
  findings,
  emptyMessage,
  accent,
}: {
  title: string;
  findings: MatchFinding[];
  emptyMessage: string;
  accent: string;
}) {
  return (
    <div className="card mb-4">
      <h2 className="title is-5" style={{ color: accent }}>
        {title}
      </h2>
      {findings.length === 0 ? (
        <p className="has-text-secondary" style={{ fontSize: 14 }}>
          {emptyMessage}
        </p>
      ) : (
        <ul>
          {findings.map((finding, index) => (
            <li
              key={`${finding.key}-${index}`}
              className="py-2"
              style={{ borderTop: index === 0 ? "none" : "1px solid var(--color-border)" }}
            >
              <p style={{ fontSize: 13, fontWeight: 600 }}>
                {finding.label}
                <SourceTag source={finding.source} />
              </p>
              <p style={{ fontSize: 14 }}>{finding.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MatchView({
  match,
  applicationId,
  canRecalculate,
  timeZone,
}: {
  match: StoredMatch | null;
  applicationId: string;
  canRecalculate: boolean;

  /** The ORGANIZATION's timezone, so dates read the same on server and client. */
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recalculate() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/match`, {
      method: "POST",
    });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error ?? "Could not recalculate the match.");
      return;
    }
    router.refresh();
  }

  if (!match) {
    return (
      <div className="card">
        <h2 className="title is-5">No match calculated</h2>
        <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
          {canRecalculate
            ? "Run a match to see how this candidate fits this job."
            : "No match has been calculated yet. Ask a recruiter to run one."}
        </p>
        <FormError message={error} />
        {canRecalculate && (
          <button
            type="button"
            className={`button is-primary ${busy ? "is-loading" : ""}`}
            onClick={recalculate}
            disabled={busy}
          >
            Calculate match
          </button>
        )}
      </div>
    );
  }

  const band = scoreBand(match.overall_score);

  return (
    <div>
      <FormError message={error} />

      {match.is_stale && (
        <div className="card mb-4" style={{ borderColor: "var(--color-warning)" }}>
          <p style={{ fontSize: 14 }}>
            <strong>Out of date.</strong> {match.stale_reason ?? "The underlying data changed."}{" "}
            {canRecalculate
              ? "Recalculate to refresh it."
              : "Ask a recruiter to recalculate it."}
          </p>
        </div>
      )}

      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-flex-start">
          <div>
            <p className="has-text-secondary" style={{ fontSize: 13 }}>
              Overall match
            </p>
            <p
              style={{
                fontSize: 44,
                fontWeight: 700,
                lineHeight: 1.1,
                color: BAND_COLOR[band],
              }}
            >
              {Math.round(match.overall_score)}%
            </p>

            {/* The two halves, so the number is never a black box. */}
            <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
              {Math.round(match.deterministic_score)}% from checked data
              {match.semantic_score !== null
                ? ` · ${Math.round(match.semantic_score)}% from AI assessment`
                : " · no AI assessment"}
            </p>
          </div>

          {canRecalculate && (
            <button
              type="button"
              className={`button is-small ${busy ? "is-loading" : ""}`}
              onClick={recalculate}
              disabled={busy}
            >
              Recalculate
            </button>
          )}
        </div>

        {/* An AI outage produces a real, usable score — but says so. */}
        {!match.ai_used && (
          <p
            className="mt-3"
            style={{ fontSize: 13, color: "var(--status-attention-text)" }}
          >
            This score is from checked data only — the AI assessment didn&apos;t run
            {match.ai_error ? `: ${match.ai_error}` : "."} Salary, experience, location, notice
            period and listed skills are all still compared.
          </p>
        )}

        <p className="has-text-secondary mt-3" style={{ fontSize: 12 }}>
          Calculated {formatDateTimeInZone(match.calculated_at, timeZone)}
          . This score is for this job only — the same candidate scores differently elsewhere.
        </p>
      </div>

      <FindingList
        title="Strong matches"
        findings={match.strong_matches}
        emptyMessage="Nothing stood out as a clear strength."
        accent="var(--color-success)"
      />

      <FindingList
        title="Possible gaps"
        findings={match.gaps}
        emptyMessage="No gaps found."
        accent="var(--status-attention-text)"
      />

      <FindingList
        title="Needs verification"
        findings={match.needs_verification}
        emptyMessage="Nothing outstanding to check."
        accent="var(--color-info)"
      />
    </div>
  );
}
