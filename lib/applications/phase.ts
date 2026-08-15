// =============================================================================
// Pipeline phase — the coarse grouping above the eight granular stages.
//
// DERIVED, NEVER STORED. A phase column would be a second copy of a fact the
// stage already carries, and the two would disagree the first time anyone moved
// a stage by a path that forgot to update it. It is a function of the stage,
// computed everywhere it is shown.
//
// The grouping answers "roughly where is this?" for a manager scanning a board,
// which is a different question from "what happens next?" — that one needs the
// granular stage, and this never replaces it.
// =============================================================================
import { PIPELINE_STAGES, type ApplicationStage } from "@/lib/applications/stages";

export const PIPELINE_PHASES = ["screening", "interviewing", "final", "closed"] as const;
export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export function isPipelinePhase(value: unknown): value is PipelinePhase {
  return typeof value === "string" && (PIPELINE_PHASES as readonly string[]).includes(value);
}

export const PHASE_LABELS: Record<PipelinePhase, string> = {
  screening: "Screening",
  interviewing: "Interviewing",
  final: "Final",
  closed: "Closed",
};

/**
 * Stage -> phase.
 *
 * An exhaustive Record rather than a switch with a default: a stage added to
 * the pipeline without a phase then fails to compile, instead of silently
 * landing in whichever bucket the default happened to be.
 */
const STAGE_PHASE: Record<ApplicationStage, PipelinePhase> = {
  applied: "screening",
  shortlisted: "screening",
  ai_screening_call: "screening",

  phone_interview: "interviewing",
  video_interview: "interviewing",

  written_assessment: "final",
  director_round: "final",

  hired: "closed",
  rejected: "closed",
  // Not in the brief's list, but it ends the pipeline exactly as the other two
  // do — grouping it anywhere else would put a finished application in an
  // active phase.
  withdrawn: "closed",
};

export function phaseOf(stage: ApplicationStage): PipelinePhase {
  return STAGE_PHASE[stage];
}

/** Every stage in a phase, in board order. Used to filter a list by phase. */
export function stagesInPhase(phase: PipelinePhase): ApplicationStage[] {
  const board = PIPELINE_STAGES.filter((stage) => STAGE_PHASE[stage] === phase);
  // 'closed' spans the two terminal exits, which are not board stages.
  if (phase === "closed") return [...board, "rejected", "withdrawn"];
  return board;
}

/** Ordered, for a phase filter that reads left to right like the board. */
export const PHASE_ORDER: Record<PipelinePhase, number> = {
  screening: 0,
  interviewing: 1,
  final: 2,
  closed: 3,
};
