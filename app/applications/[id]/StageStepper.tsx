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
//
// THE MATCH SCORE IS NOT HERE. It used to sit at the right-hand end of this
// row, where it had no relationship to anything beside it — and the same
// number, with its status, strengths and concerns, is a few hundred pixels
// below in Resume & Match. One number in two styles on one screen invites the
// reader to check whether they disagree.
//
// This is an <ol> and stays one: the order of the stages is the meaning, and a
// screen reader should hear "3 of 8". The decimal markers it renders by default
// are turned off in CSS — see the note on .stepper.
// =============================================================================

import { Check, X } from "lucide-react";
import type { StepperSegment } from "@/lib/applications/effectiveStages";
import type { ApplicationStage } from "@/lib/applications/stages";

export function StageStepper({
  segments,
  onJumpTo,
}: {
  segments: StepperSegment[];
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
    </div>
  );
}
