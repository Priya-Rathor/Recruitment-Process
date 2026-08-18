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
import type { StageTiming } from "@/lib/applications/stageTimings";
import type { ApplicationStage } from "@/lib/applications/stages";
import type { EvaluationStatus } from "@/lib/evaluation/verdict";
import type { NextAction } from "@/lib/evaluation/nextAction";
import { NextActionBanner } from "./NextActionBanner";
import { StageStepper } from "./StageStepper";
import { EvaluationPanel } from "./EvaluationPanel";

export function ApplicationStageSection({
  segments,
  applicationId,
  availability,
  entries,
  timings,
  resume,
  canEdit,
  timeZone,
  maxCallAttempts,
  nextAction,
}: {
  segments: StepperSegment[];
  applicationId: string;
  availability: StageAvailability[];
  entries: EvaluationEntry[];
  timings: Record<ApplicationStage, StageTiming>;
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
    // Every visible stage now has a section — Applied, Shortlisted and Hired
    // carry no score but do carry their dates. The fallback stays for the
    // rejection terminus, which is a segment without a section of its own.
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
      <StageStepper segments={segments} onJumpTo={jumpTo} />

      <NextActionBanner action={nextAction} canAct={canEdit} onAct={actOn} />

      <div className="card mb-4">
        <EvaluationPanel
          applicationId={applicationId}
          availability={availability}
          entries={entries}
          timings={timings}
          resume={resume}
          canEdit={canEdit}
          timeZone={timeZone}
          maxCallAttempts={maxCallAttempts}
        />
      </div>
    </>
  );
}
