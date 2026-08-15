"use client";

// =============================================================================
// Every application this candidate holds, consolidated.
//
// READ-ONLY, for every role including Owner. Nothing is logged and no stage is
// moved here — each card links out to the Application detail page, which owns
// all of that. Two surfaces that can both write one row is how they drift.
//
// EACH CARD USES ITS OWN JOB'S STAGE CONFIGURATION. The visibility rule is
// computed on the server by effectiveStages(), the same function the Evaluation
// panel calls, so a candidate with two applications to two differently
// configured jobs sees two genuinely different sets of sections — never a
// blended union of both.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import {
  OUTCOME_LABELS,
  OUTCOME_TONE,
  mostRecent,
  type ApplicationHistoryCard,
} from "@/lib/candidates/applicationHistoryView";
import { EVALUATION_STAGES, OUTCOME_LABELS as ENTRY_OUTCOME_LABELS, previewSummary } from "@/lib/applications/evaluations";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { formatDateInZone } from "@/lib/time";

export function ApplicationHistory({
  cards,
  resumeSummary,
  timeZone,
}: {
  cards: ApplicationHistoryCard[];
  /** From Module 6's parse, shared across applications — the person's resume. */
  resumeSummary: string | null;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (cards.length === 0) {
    return (
      <div className="card mb-4">
        <h2 className="title is-5">Application history</h2>
        <div className="history-empty">
          <p className="history-empty__title">No applications yet</p>
          <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
            This candidate hasn&apos;t been linked to a job.
          </p>
          <Link className="button is-primary mt-3" href="/applications/new">
            Link them to a job
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5 mb-1">Application history</h2>
      <p className="has-text-secondary mb-3" style={{ fontSize: "var(--text-label)" }}>
        {cards.length} {cards.length === 1 ? "application" : "applications"} across all jobs.
        Read-only — logging and stage changes happen on each application.
      </p>

      <ul className="history-list">
        {cards.map((card) => {
          const open = expanded.has(card.applicationId);
          const outcome = card.outcome;

          return (
            <li key={card.applicationId} className="history-card">
              <div className="history-card__head">
                <button
                  type="button"
                  className="history-card__toggle"
                  onClick={() => toggle(card.applicationId)}
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                  <span className="history-card__job">{card.jobTitle}</span>
                </button>

                <div className="history-card__badges">
                  <span className="intake-chip is-neutral">{STAGE_LABELS[card.stage]}</span>
                  <span className={`intake-chip is-${OUTCOME_TONE[outcome.kind]}`}>
                    {OUTCOME_LABELS[outcome.kind]}
                  </span>
                  <Link href={`/applications/${card.applicationId}`} className="text-link">
                    View full application
                    <ExternalLink size={13} aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {open && (
                <div className="history-card__body">
                  {/* --- Resume & match, per application ------------------- */}
                  <div className="history-block">
                    <p className="history-block__title">Resume &amp; match</p>
                    <p className="history-block__value">
                      {card.matchScore === null ? (
                        <span className="has-text-secondary">Not scored for this job</span>
                      ) : (
                        `${card.matchScore}% match`
                      )}
                    </p>
                    {/*
                      The score is PER APPLICATION — the same person scores
                      differently against different jobs, so it is never
                      flattened onto the candidate. The summary is the person's,
                      so it is shared.
                    */}
                    <p className="history-block__detail">
                      {resumeSummary ?? "No parsed resume summary on file."}
                    </p>
                  </div>

                  {/* --- One block per stage THIS job runs ----------------- */}
                  {EVALUATION_STAGES.filter((stage) => card.visible.includes(stage)).map((stage) => {
                    const entries = card.entriesByStage[stage] ?? [];
                    const latest = mostRecent(entries);

                    return (
                      <div key={stage} className="history-block">
                        <p className="history-block__title">
                          {STAGE_LABELS[stage]}
                          {entries.length > 1 && (
                            <span className="history-block__count">{entries.length} attempts</span>
                          )}
                        </p>

                        {latest === null ? (
                          <p className="history-block__detail">Nothing logged.</p>
                        ) : (
                          <>
                            <p className="history-block__value">
                              {formatDateInZone(latest.occurredAt, timeZone)}
                              {latest.score !== null && ` · ${latest.score}/10`}
                              {latest.outcome && ` · ${ENTRY_OUTCOME_LABELS[latest.outcome]}`}
                            </p>
                            <p className="history-block__detail">
                              {previewSummary(latest.summary)}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* --- Final outcome ------------------------------------ */}
                  <div className="history-block">
                    <p className="history-block__title">Final outcome</p>
                    <p className="history-block__value">
                      {outcome.kind === "hired" && "Hired"}
                      {outcome.kind === "in_progress" &&
                        `In progress — currently ${STAGE_LABELS[card.stage]}`}
                      {(outcome.kind === "rejected" || outcome.kind === "withdrawn") && (
                        <>
                          {OUTCOME_LABELS[outcome.kind]}
                          {outcome.fromStage
                            ? ` after ${STAGE_LABELS[outcome.fromStage]}`
                            : " — stage not recorded"}
                        </>
                      )}
                    </p>
                  </div>

                  <Link
                    href={`/applications/${card.applicationId}`}
                    className="text-link history-card__manage"
                  >
                    Manage evaluation
                    <ExternalLink size={13} aria-hidden="true" />
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
