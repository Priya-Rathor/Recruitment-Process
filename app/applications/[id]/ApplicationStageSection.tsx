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
}: {
  segments: StepperSegment[];
  matchScore: number | null;
  applicationId: string;
  availability: StageAvailability[];
  entries: EvaluationEntry[];
  resume: { matchScore: number | null; summary: string | null; resumeId: string | null };
  canEdit: boolean;
  timeZone: string;
}) {
  function jumpTo(stage: ApplicationStage) {
    // Applied / Shortlisted / Hired have no evaluation section — there is
    // nothing to record about them — so those clicks land on the panel's top
    // card rather than doing nothing, which would read as a broken control.
    const target =
      document.getElementById(`eval-${stage}`) ?? document.getElementById("eval-resume");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <StageStepper segments={segments} matchScore={matchScore} onJumpTo={jumpTo} />

      <div className="card mb-4">
        <EvaluationPanel
          applicationId={applicationId}
          availability={availability}
          entries={entries}
          resume={resume}
          canEdit={canEdit}
          timeZone={timeZone}
        />
      </div>
    </>
  );
}
