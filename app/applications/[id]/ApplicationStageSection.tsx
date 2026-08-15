"use client";

// =============================================================================
// The stepper and the Evaluation panel, together.
//
// One client component because they SHARE ONE INTERACTION: clicking a segment
// scrolls to that stage's evaluation section. Split across two components the
// jump would need a shared ref or an id-scanning effect; here it is one
// scrollIntoView.
//
// Everything either half renders is computed on the server and handed down —
// this file adds interaction, not decisions.
// =============================================================================

import type { StepperSegment, StageAvailability } from "@/lib/applications/effectiveStages";
import type { EvaluationEntry } from "@/lib/applications/evaluations";
import type { ApplicationStage } from "@/lib/applications/stages";
import type { EvaluationStatus } from "@/lib/evaluation/verdict";
import type { NextAction } from "@/lib/evaluation/nextAction";
import { NextActionBanner } from "./NextActionBanner";
import { StageStepper } from "./StageStepper";
import { EvaluationPanel } from "./EvaluationPanel";

export function ApplicationStageSection({
  segments,
  matchScore,
  applicationId,
  availability,
  entries,
  resume,
  canEdit,
  timeZone,
  maxCallAttempts,
  nextAction,
}: {
  segments: StepperSegment[];
  matchScore: number | null;
  applicationId: string;
  availability: StageAvailability[];
  entries: EvaluationEntry[];
  resume: {
    matchScore: number | null;
    passingScore: number | null;
    status: EvaluationStatus;
    strengths: string[];
    concerns: string[];
    summary: string | null;
    resumeId: string | null;
  };
  canEdit: boolean;
  timeZone: string;
  maxCallAttempts: number;
  nextAction: NextAction;
}) {
  function jumpTo(stage: ApplicationStage) {
    // Applied / Shortlisted / Hired have no evaluation section — there is
    // nothing to record about them — so those clicks land on the panel's top
    // card rather than doing nothing, which would read as a broken control.
    const target =
      document.getElementById(`eval-${stage}`) ?? document.getElementById("eval-resume");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * The suggestion's button routes to the existing move control rather than
   * writing anything: it scrolls there and opens it. Every stage change still
   * goes through the confirmation already built for it.
   */
  function actOn(targetStage: string) {
    const control = document.getElementById("stage-control");
    control?.scrollIntoView({ behavior: "smooth", block: "center" });
    const select = control?.querySelector("select");
    if (select instanceof HTMLSelectElement) {
      select.value = targetStage;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.focus();
    }
  }

  return (
    <>
      <StageStepper segments={segments} matchScore={matchScore} onJumpTo={jumpTo} />

      <NextActionBanner action={nextAction} canAct={canEdit} onAct={actOn} />

      <div className="card mb-4">
        <EvaluationPanel
          applicationId={applicationId}
          availability={availability}
          entries={entries}
          resume={resume}
          canEdit={canEdit}
          timeZone={timeZone}
          maxCallAttempts={maxCallAttempts}
        />
      </div>
    </>
  );
}
