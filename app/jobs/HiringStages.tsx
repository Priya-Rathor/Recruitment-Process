"use client";

// =============================================================================
// The "Hiring Stages" card — four toggleable rows.
//
// Used by the job CREATE form, the AI-assisted review screen and the job EDIT
// page, which is why it holds no fetching of its own: the parent owns the state
// and decides when it is written. On create there is no job id yet, so the
// stages ride along with the job's own save.
//
// TWO RULES FROM THE SPEC LIVE HERE, and both are about not losing work:
//
//   1. Toggling ON opens the configuration immediately, so a stage is never
//      left enabled-but-unconfigured. Cancelling a FIRST-TIME enable reverts
//      the toggle; cancelling a later edit does not.
//   2. Toggling OFF keeps the prompt and config in state (and in the database).
//      Re-enabling restores what was there rather than starting blank.
// =============================================================================

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";
import {
  CONFIGURATION_ONLY_NOTE,
  SCORING_OFF_NOTE,
  SCORING_ON_NOTE,
  STAGES,
  STARTER_TEMPLATES,
  type StageKey,
} from "@/lib/hiring-stages/catalog";
import { emptyStageConfig, type StageConfig } from "@/lib/hiring-stages/config";
import { StageConfigModal, type StageDraft } from "./StageConfigModal";

export type StageState = {
  enabled: boolean;
  promptTemplate: string;
  config: StageConfig;
};

export type StagesState = Record<StageKey, StageState>;

/** The state a job starts with: four stages, all off, all blank. */
export function emptyStages(): StagesState {
  return Object.fromEntries(
    STAGES.map((stage) => [
      stage.key,
      { enabled: false, promptTemplate: "", config: emptyStageConfig(stage.key) },
    ])
  ) as StagesState;
}

export function HiringStages({
  stages,
  onChange,
  screeningQuestions,
  onScreeningQuestionsChange,
  readOnly = false,
}: {
  stages: StagesState;
  onChange: (next: StagesState) => void;
  /**
   * Lifted from the parent, NOT held here.
   *
   * The AI screening stage edits the job's real screening questions — the same
   * list the job form shows and Module 8 dials from. Keeping a copy in this
   * component would let the two disagree the moment either is edited.
   */
  screeningQuestions: string[];
  onScreeningQuestionsChange: (questions: string[]) => void;
  readOnly?: boolean;
}) {
  // Which stage's modal is open, and whether opening it was a first-time
  // enable — the only thing that decides what Cancel means.
  const [editing, setEditing] = useState<{ key: StageKey; firstEnable: boolean } | null>(null);

  function patch(key: StageKey, changes: Partial<StageState>) {
    onChange({ ...stages, [key]: { ...stages[key], ...changes } });
  }

  function handleToggle(key: StageKey, next: boolean) {
    if (!next) {
      // OFF keeps everything. The row's script survives in state and in the
      // database, so re-enabling restores it.
      patch(key, { enabled: false });
      return;
    }

    // ON, and configure right away.
    patch(key, {
      enabled: true,
      // A starter script only when there is nothing saved — never overwriting a
      // script this stage already had from a previous enable.
      promptTemplate: stages[key].promptTemplate || STARTER_TEMPLATES[key],
    });
    setEditing({ key, firstEnable: true });
  }

  function handleCancel() {
    if (!editing) return;

    if (editing.firstEnable) {
      // Reverted, and the starter template offered on enable is cleared with
      // it — a stage nobody configured must not keep a script nobody chose.
      patch(editing.key, { enabled: false, promptTemplate: "" });
    }
    setEditing(null);
  }

  function handleSave(next: StageDraft) {
    if (!editing) return;
    patch(editing.key, { promptTemplate: next.promptTemplate, config: next.config });
    if (editing.key === "ai_screening_call") {
      onScreeningQuestionsChange(next.screeningQuestions);
    }
    setEditing(null);
  }

  return (
    <div className="card mb-4">
      <h2 className="title is-5">Hiring stages</h2>
      <p className="subtitle is-6 has-text-secondary">
        Choose what this role&apos;s candidates go through, and write the script for each. Resume
        Score is not a step they go through — it is how their resume is judged before any of this.
      </p>

      <ul className="stage-list">
        {STAGES.map((stage) => {
          const state = stages[stage.key];
          const configured = state.promptTemplate.trim().length > 0;

          return (
            <li key={stage.key} className="stage-row">
              <div className="stage-row__text">
                <p className="stage-row__name" id={`stage-label-${stage.key}`}>
                  {stage.label}
                </p>
                <p className="stage-row__description">{stage.description}</p>

                {/* Says plainly that three of the five cannot run yet, so
                    nobody enables one and waits for something to happen. */}
                {stage.execution === "configuration_only" && (
                  <span className="stage-row__note">{CONFIGURATION_ONLY_NOTE}</span>
                )}

                {/*
                  A scoring row's switch does NOT mean "does this happen".
                  Scoring always happens; the switch chooses whose rules. Both
                  positions are labelled, because the dangerous misreading is of
                  OFF — a recruiter who thinks they have turned resume scoring
                  off has been told something false.
                */}
                {stage.kind === "scoring" ? (
                  <span className={`stage-row__note${state.enabled ? " is-live" : ""}`}>
                    {state.enabled ? SCORING_ON_NOTE : SCORING_OFF_NOTE}
                  </span>
                ) : (
                  stage.execution === "live" &&
                  state.enabled && (
                    <span className="stage-row__note is-live">Runs through {stage.engine}</span>
                  )
                )}
              </div>

              <div className="stage-row__controls">
                {/* Configure stays available while ON, so editing does not
                    require switching the stage off and on again. */}
                {(state.enabled || stage.kind === "scoring") && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setEditing({ key: stage.key, firstEnable: false })}
                  >
                    <Settings2 size={14} aria-hidden="true" />
                    {/* Off + scoring = you are looking at the default, which is
                        exactly what someone deciding whether to customise needs
                        to read first. */}
                    {readOnly || (!state.enabled && stage.kind === "scoring")
                      ? "View"
                      : configured
                        ? "Configure"
                        : "Finish setup"}
                  </button>
                )}

                <Toggle
                  checked={state.enabled}
                  disabled={readOnly}
                  labelledBy={`stage-label-${stage.key}`}
                  onChange={(next) => handleToggle(stage.key, next)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <StageConfigModal
          stageKey={editing.key}
          readOnly={readOnly}
          draft={{
            promptTemplate: stages[editing.key].promptTemplate,
            config: stages[editing.key].config,
            screeningQuestions,
          }}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
