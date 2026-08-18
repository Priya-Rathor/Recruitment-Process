"use client";

// =============================================================================
// The Evaluation panel.
//
// ONE SECTION PER STAGE THIS APPLICATION'S JOB RUNS — every stage, not only the
// ones that carry a score. Sections come from `availability`, so a stage the job
// never switched on is not rendered at all: not greyed, not collapsed, absent.
//
// AND ONE SECTION IS THE ONLY PLACE THAT STAGE APPEARS ON THE PAGE. Everything
// known about a stage — when it was reached, how long it held, what was scored,
// and the screens that own it — is inside its own section. The sidebar used to
// carry a second copy of the screening links and the interview list; two homes
// for one stage means a reader checking whether they agree, and a job that
// switched the stage off still showing it in one of them.
//
// EVERY SECTION STATES ITS OWN TIMING. The dates come from
// application_stage_history via buildStageTimings(), which is the same history
// the Timeline card renders — folded per stage here, chronologically there.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO:
//
//   1. It does not move the application. Logging an entry and advancing the
//      pipeline are separate actions; coupling them would mean a recruiter
//      writing up a failed interview accidentally promoting the candidate.
//   2. It does not edit screening reports or scheduled interviews. Those rows
//      belong to Modules 9 and 11 and are edited there — a second write path
//      would drift from the first.
//   3. It does not hide a stage that holds history. A stage switched off after
//      entries were logged stays visible and read-only, because deleting a
//      recruiter's record of an interview is not a display decision.
// =============================================================================

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Phone, Plus, SquarePen } from "lucide-react";
import {
  INTEREST_LABELS,
  groupByStage,
  isEvaluationStage,
  isManualEvaluationStage,
  previewSummary,
  type EvaluationEntry,
  type EvaluationStage,
} from "@/lib/applications/evaluations";
import { acceptsEntries, visibleStages, type StageAvailability } from "@/lib/applications/effectiveStages";
import { STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";
import {
  stageTimingPhase,
  type StageTiming,
} from "@/lib/applications/stageTimings";
import { formatDateInZone } from "@/lib/time";
import { EvaluationVerdict } from "@/components/EvaluationVerdict";
import type { EvaluationStatus } from "@/lib/evaluation/verdict";
import { EvaluationEntryForm, type EntryDraft } from "./EvaluationEntryForm";

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/**
 * The one-line history of a stage.
 *
 * "so far" on an open stage rather than a bare number: the count is measured
 * against now, and a reader should be able to tell a running total from a
 * finished one without checking which stage is current.
 */
function StageTimingLine({ timing, timeZone }: { timing: StageTiming; timeZone: string }) {
  const phase = stageTimingPhase(timing);

  if (phase === "not_reached") {
    return <p className="eval-section__timing">Not reached yet.</p>;
  }

  const parts: string[] = [`Entered ${formatDateInZone(timing.firstEnteredAt, timeZone)}`];

  if (phase === "completed") {
    parts.push(`left ${formatDateInZone(timing.lastExitedAt, timeZone)}`);
  }

  if (timing.days !== null) {
    parts.push(phase === "in_progress" ? `${days(timing.days)} so far` : days(timing.days));
  }

  // Only worth saying when it happened. A single visit is the normal case and
  // naming it would be noise on every other section.
  if (timing.visits > 1) parts.push(`${timing.visits} visits`);

  return <p className="eval-section__timing">{parts.join(" · ")}</p>;
}

export function EvaluationPanel({
  applicationId,
  availability,
  entries,
  timings,
  resume,
  canEdit,
  timeZone,
  maxCallAttempts,
}: {
  applicationId: string;
  availability: StageAvailability[];
  entries: EvaluationEntry[];
  /** Per-stage dates and durations, folded from application_stage_history. */
  timings: Record<ApplicationStage, StageTiming>;
  /** From the job's screening config, falling back to the org default. */
  maxCallAttempts: number;
  resume: {
    matchScore: number | null;
    passingScore: number | null;
    status: EvaluationStatus;
    strengths: string[];
    concerns: string[];
    summary: string | null;
    resumeId: string | null;
  };
  /** Owner/Admin/Recruiter. A Viewer sees everything and changes nothing. */
  canEdit: boolean;
  timeZone: string;
}) {
  const [editing, setEditing] = useState<
    { stage: EvaluationStage; entry: EvaluationEntry | null } | null
  >(null);

  const grouped = groupByStage(entries);
  const shown = visibleStages(availability);

  /** Resume & Match — read-only, from Modules 6 and 7. */
  const resumeSection = (
    <section className="eval-section" id="eval-resume" key="resume">
      <div className="eval-section__head">
        <h3 className="eval-section__title">
          <FileText size={15} aria-hidden="true" />
          Resume &amp; Match
        </h3>
      </div>

      <div className="eval-resume">
        <div className="eval-resume__summary" style={{ gridColumn: "1 / -1" }}>
          {/*
            Strengths and concerns here are Module 7's own strong_matches and
            gaps — already labelled, already tagged with whether code or AI
            produced them, and already scored against THIS job's description.
            Storing a second copy would give the same judgement two homes.
          */}
          <EvaluationVerdict
            verdict={{
              score: resume.matchScore,
              threshold: resume.passingScore,
              status: resume.status,
              summary: resume.summary?.trim()
                ? previewSummary(resume.summary, 400)
                : "No parsed summary on file.",
              strengths: resume.strengths,
              concerns: resume.concerns,
            }}
            scoreSuffix="%"
            summaryIsEmptyState={!resume.summary?.trim()}
          />

          <div className="is-flex mt-2" style={{ gap: "var(--space-4)", flexWrap: "wrap" }}>
            {/* A compact preview, never a replacement for the real screens. */}
            <Link href={`/applications/${applicationId}/match`} className="text-link">
              {resume.matchScore === null ? "Calculate match" : "View match breakdown"}
            </Link>
            {resume.resumeId && (
              <a
                href={`/api/resumes/${resume.resumeId}/download`}
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                View full resume
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  function renderStage(stage: ApplicationStage) {
    const timing = timings[stage];
    const scored = isEvaluationStage(stage);
    const stageEntries = scored ? grouped[stage] : [];
    const open = acceptsEntries(availability, stage);
    const manual = isManualEvaluationStage(stage);

    return (
      <section key={stage} className="eval-section" id={`eval-${stage}`}>
        <div className="eval-section__head">
          <h3 className="eval-section__title">
            {STAGE_LABELS[stage]}
            {stageEntries.length > 0 && (
              <span className="eval-section__count">{stageEntries.length}</span>
            )}
            {/*
              An EXPLICIT counter, not one implied by how many rows happen to be
              listed. "3 of 2 max" is the sentence a recruiter needs before
              deciding whether another attempt is even allowed — counting rows
              themselves is work the page should do.
            */}
            {stage === "ai_screening_call" && (
              <span className="eval-section__attempts">
                Attempts: {stageEntries.length} of {maxCallAttempts} max
              </span>
            )}
          </h3>

          {/*
            The screening screens live HERE, in the stage they belong to, and
            only when this job runs that stage. They used to sit in the sidebar
            for every application, including the ones whose job never places a
            call.
          */}
          {stage === "ai_screening_call" && (
            <div className="eval-section__links">
              <Link href={`/applications/${applicationId}/screening-call`} className="text-link">
                <Phone size={13} aria-hidden="true" />
                Screening call
              </Link>
              <Link href={`/applications/${applicationId}/screening-report`} className="text-link">
                <FileText size={13} aria-hidden="true" />
                Screening report
              </Link>
            </div>
          )}

          {/*
            No add button when the stage is closed. `open` is false for a stage
            the job switched off that is only visible because it holds history —
            the record stays, new entries do not.
          */}
          {canEdit && open && manual && (
            <button
              type="button"
              className="text-link"
              onClick={() => setEditing({ stage: stage as EvaluationStage, entry: null })}
            >
              <Plus size={14} aria-hidden="true" />
              {stage === "video_interview" ? "Log video interview" : "Add entry"}
            </button>
          )}
        </div>

        <StageTimingLine timing={timing} timeZone={timeZone} />

        {!open && (
          <p className="eval-section__note">
            This stage is switched off for this job. Existing records are kept; new entries
            can&apos;t be added.
          </p>
        )}

        {/*
          Applied, Shortlisted and Hired carry no score — nothing is assessed at
          them, they are reached. Their timing above is the whole record, and an
          empty "Nothing logged yet" underneath would imply someone forgot to
          write something up.
        */}
        {scored &&
          (stageEntries.length === 0 ? (
            <p className="eval-section__empty">
              {stage === "ai_screening_call"
                ? "No screening call has run yet."
                : "Nothing logged yet."}
            </p>
          ) : (
            <ul className="eval-list">
              {stageEntries.map((entry) => (
                <li key={entry.id} className="eval-row">
                  <div className="eval-row__meta">
                    <p className="eval-row__date">{formatDateInZone(entry.occurredAt, timeZone)}</p>
                    {entry.loggedByName && (
                      <p className="eval-row__author">by {entry.loggedByName}</p>
                    )}
                  </div>

                  {/*
                    The same four-part block the resume gate and every other
                    round uses — score, status, strengths, concerns — so the
                    layout is learned once and read everywhere.
                  */}
                  <div className="eval-row__verdict">
                    <EvaluationVerdict
                      verdict={{
                        score: entry.score,
                        threshold: entry.threshold,
                        status: entry.status,
                        summary: previewSummary(entry.summary),
                        strengths: entry.strengths,
                        concerns: entry.concerns,
                      }}
                    />

                    {entry.interested && (
                      <span className="intake-chip is-neutral mt-2">
                        Interested: {INTEREST_LABELS[entry.interested]}
                      </span>
                    )}
                  </div>

                  <div className="eval-row__actions">
                    {entry.editable && canEdit && open && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() =>
                          setEditing({ stage: entry.stage, entry })
                        }
                      >
                        <SquarePen size={13} aria-hidden="true" />
                        Edit
                      </button>
                    )}
                    {entry.href && (
                      <Link href={entry.href} className="text-link">
                        <ExternalLink size={13} aria-hidden="true" />
                        Open
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>
    );
  }

  // Board order, with Resume & Match sitting where it actually happens: after
  // the application arrives, before anyone decides to shortlist it.
  const sections: ReactNode[] = [];
  let resumePlaced = false;
  for (const stage of shown) {
    sections.push(renderStage(stage));
    if (stage === "applied") {
      sections.push(resumeSection);
      resumePlaced = true;
    }
  }
  if (!resumePlaced) sections.unshift(resumeSection);

  return (
    <div className="evaluation">
      <h2 className="title is-5">Evaluation</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: "var(--text-label)" }}>
        Every stage this job runs, in order, with when it was reached and what was assessed.
        Logging an entry never moves the application — use &ldquo;Move to stage&rdquo; for that.
      </p>

      {sections}

      {editing && (
        <EvaluationEntryForm
          applicationId={applicationId}
          stage={editing.stage}
          entry={
            editing.entry
              ? ({
                  id: editing.entry.id,
                  occurredAt: editing.entry.occurredAt,
                  score: editing.entry.nativeScore,
                  outcome: editing.entry.outcome ?? "pending",
                  summary: editing.entry.summary ?? "",
                } satisfies EntryDraft)
              : null
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
