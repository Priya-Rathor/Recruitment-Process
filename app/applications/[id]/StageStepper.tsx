"use client";

// =============================================================================
// The stage stepper.
//
// Replaces a small chip that said only where the application is now. The chip
// answered one question; a recruiter opening this page is asking three — where
// is this, how far has it come, and what is left — and the stepper answers all
// three in one glance.
//
// SEGMENTS ARE COMPUTED, NOT LISTED. buildStepper() in
// lib/applications/effectiveStages.ts decides which stages exist for this
// application's job and how a rejection ends the run; this file only paints
// them. That is what keeps the stepper, the Evaluation panel and the move
// dropdown from disagreeing.
//
// CLICKING NAVIGATES, IT DOES NOT MOVE. The spec is explicit: clicking a
// segment scrolls to that stage's evaluation section. Moving an application
// still happens through the "Move to stage" control, so a mis-click cannot
// advance someone's pipeline.
// =============================================================================

import { Check, X } from "lucide-react";
import type { StepperSegment } from "@/lib/applications/effectiveStages";
import type { ApplicationStage } from "@/lib/applications/stages";

export function StageStepper({
  segments,
  matchScore,
  onJumpTo,
}: {
  segments: StepperSegment[];
  /** Kept beside the stepper: useful context, no longer the headline. */
  matchScore: number | null;
  /** Only called for segments that have an Evaluation section. */
  onJumpTo: (stage: ApplicationStage) => void;
}) {
  return (
    <div className="stepper-wrap">
      <ol className="stepper" aria-label="Application progress">
        {segments.map((segment, index) => {
          // Upcoming stages are not navigable: there is nothing to jump to, and
          // making them clickable would suggest they can be entered from here.
          const navigable = segment.state === "complete" || segment.state === "current";

          const content = (
            <>
              <span className="stepper__marker" aria-hidden="true">
                {segment.state === "complete" && <Check size={12} strokeWidth={3} />}
                {segment.state === "rejected" && <X size={12} strokeWidth={3} />}
                {(segment.state === "current" || segment.state === "upcoming") && (
                  <span className="stepper__dot" />
                )}
              </span>
              <span className="stepper__label">{segment.label}</span>
            </>
          );

          return (
            <li
              key={`${segment.stage}-${index}`}
              className={`stepper__segment is-${segment.state}`}
              aria-current={segment.state === "current" ? "step" : undefined}
            >
              {navigable ? (
                <button
                  type="button"
                  className="stepper__button"
                  onClick={() => onJumpTo(segment.stage)}
                >
                  {content}
                </button>
              ) : (
                <span className="stepper__button is-static">{content}</span>
              )}
            </li>
          );
        })}
      </ol>

      {matchScore !== null && (
        <p className="stepper__match">
          <span className="stepper__match-value">{matchScore}%</span> match
        </p>
      )}
    </div>
  );
}
