"use client";

// =============================================================================
// Configure: <stage>
//
// One modal for all four stages. The prompt editor and field picker are shared;
// only the block below the editor differs, because only the stage-specific
// extras differ. Four near-identical modals would have drifted within a month.
//
// THE PROMPT EDITOR NOW LIVES IN components/PlaceholderEditor.tsx. It was
// extracted, unchanged in behaviour, when Module 15's message templates needed
// the same picker, the same caret handling and the same preview — for the same
// reason the four stages share one modal.
//
// CANCEL SEMANTICS ARE THE SUBTLE PART. The spec: cancelling a FIRST-TIME
// enable reverts the toggle to off, but cancelling a later edit leaves the
// stage enabled. So this component reports what happened (`saved` vs
// `cancelled`) and the parent decides — the modal does not own the toggle.
// =============================================================================

import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { PlaceholderEditor } from "@/components/PlaceholderEditor";
import {
  MAX_CALL_ATTEMPTS,
  MAX_DURATION_MINUTES,
  MIN_CALL_ATTEMPTS,
  MIN_DURATION_MINUTES,
  type ScoringWeights,
  type StageConfig,
} from "@/lib/hiring-stages/config";
import { stageDefinition, type StageKey } from "@/lib/hiring-stages/catalog";
import { RESUME_SCORE_MAX, ROUND_SCORE_MAX } from "@/lib/evaluation/verdict";
import { COMPONENT_WEIGHTS, type ComponentKey } from "@/lib/matching/deterministic";
import { SEMANTIC_WEIGHT } from "@/lib/matching/score";
import { DEFAULT_SCORING_GUIDANCE } from "@/lib/matching/prompt";

/** Label and one-line reason for each scoring component. */
const WEIGHT_LABELS: Record<ComponentKey, { label: string; help: string }> = {
  skills: { label: "Required skills", help: "How much of the mandatory skill list they have" },
  experience: { label: "Experience", help: "Years against this job's range" },
  salary: { label: "Salary", help: "Their expectation against the band" },
  location: { label: "Location", help: "Where they are against where the job is" },
  notice: { label: "Notice period", help: "How soon they could start" },
};
import { StringListEditor } from "./StringListEditor";

export type StageDraft = {
  promptTemplate: string;
  config: StageConfig;
  /** Owned by the AI screening stage but stored in job_screening_questions. */
  screeningQuestions: string[];
};

export function StageConfigModal({
  stageKey,
  draft,
  readOnly,
  onSave,
  onCancel,
}: {
  stageKey: StageKey;
  draft: StageDraft;
  /** Viewer: the whole screen renders, nothing accepts input. */
  readOnly: boolean;
  onSave: (next: StageDraft) => void;
  onCancel: () => void;
}) {
  const stage = stageDefinition(stageKey);
  // Resume Score differs from the other four in kind, not just in its fields:
  // it always runs, and its "script" is judging guidance rather than words
  // anybody says out loud.
  const isScoring = stage.kind === "scoring";

  const [prompt, setPrompt] = useState(draft.promptTemplate);
  const [config, setConfig] = useState<StageConfig>(draft.config);
  const [questions, setQuestions] = useState<string[]>(draft.screeningQuestions);

  function patchConfig(changes: Partial<Record<string, unknown>>) {
    setConfig((current) => ({ ...current, ...changes }) as StageConfig);
  }

  // Null weights mean "platform defaults", so the form shows the defaults
  // rather than five blanks — someone deciding whether to change a weight needs
  // to see what it currently is.
  const weights: ScoringWeights =
    (config as { weights?: ScoringWeights | null }).weights ?? COMPONENT_WEIGHTS;
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);

  const usingDefaultPrompt = prompt.trim().length === 0 || prompt.trim() === DEFAULT_SCORING_GUIDANCE.trim();

  return (
    <div className="modal is-active intake-modal" role="dialog" aria-modal="true"
         aria-label={`Configure ${stage.label}`}>
      {/* No backdrop-click close: a mis-click would discard a long script. */}
      <div className="modal-background" />

      <div className="modal-card intake-modal__card">
        <header className="intake-modal__head">
          <div>
            <h2 className="intake-modal__title">Configure: {stage.label}</h2>
            <p className="intake-modal__subtitle">{stage.description}</p>
          </div>
          <button type="button" className="intake-modal__close" onClick={onCancel} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <section className="intake-modal__body">
          {readOnly && (
            <p className="intake-callout mb-4">
              Your role can view this configuration but not change it.
            </p>
          )}

          {/*
            Says which prompt is actually in force. "Customise the prompt" is
            only a real choice if you can tell, at a glance, whether you are
            looking at the default or at something someone edited last quarter.
          */}
          {isScoring && (
            <p className="intake-callout mb-4">
              {usingDefaultPrompt
                ? "This is the default scoring guidance every job starts with. Edit it to judge this role your own way, or leave it exactly as it is."
                : "This job uses its own scoring guidance. “Reset prompt and weights” below puts the standard one back."}{" "}
              The JSON format the scorer needs is added automatically and cannot be edited away, so
              a rewrite here can change the judgement but never break the score.
            </p>
          )}

          {/* ---- The script ------------------------------------------------ */}
          <PlaceholderEditor
            id="stage-prompt"
            label={isScoring ? "Scoring guidance" : "Script / instructions for this stage"}
            help="Write what should happen during this stage. Insert live job or candidate details using the field picker — they'll be replaced with real values when this runs."
            value={prompt}
            onChange={setPrompt}
            readOnly={readOnly}
            placeholder="e.g. Confirm {{candidate.name}} is still interested in {{job.title}}…"
          />


          {/* ---- Stage-specific extras ------------------------------------- */}
          <div className="stage-extras">
            {/*
              On EVERY stage, not just one. The four-part verdict (score +
              status + strengths + concerns) needs a number to judge against,
              and a threshold on some stages but not others would make "Pass"
              mean different things in different sections.

              Blank is meaningful: no gate configured reads as Needs Review
              rather than failing everyone below an invented number.
            */}
            <div className="columns is-variable is-3">
              <div className="column is-half">
                {/*
                  The resume score is a PERCENTAGE; every other stage is judged
                  on a 1-10 round score. One control, two scales, because the
                  numbers it gates are genuinely different — labelling both
                  "score" without the scale is how a 7 ends up meaning "7%".
                */}
                <label className="label" htmlFor="stage-passing">
                  {isScoring ? "Passing match score (%)" : "Passing score (1-10)"}
                </label>
                <input
                  id="stage-passing"
                  className="input"
                  type="number"
                  min={0}
                  max={isScoring ? RESUME_SCORE_MAX : ROUND_SCORE_MAX}
                  readOnly={readOnly}
                  value={(config as { passingScore: number | null }).passingScore ?? ""}
                  onChange={(e) =>
                    patchConfig({
                      passingScore: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <p className="stage-field__help">
                  {isScoring
                    ? "At or above this, the resume gate passes. Leave blank for no gate — results then read “Needs Review” rather than failing."
                    : "Leave blank for no gate — results then read “Needs Review” rather than failing."}
                </p>
              </div>
            </div>

            {isScoring && (
              <>
                <div className="stage-field">
                  <div className="stage-field__head">
                    <label className="label">What the score is made of</label>
                    {!readOnly && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          // Everything customisable on this row, in one action:
                          // a reset that left the prompt behind would put the
                          // job in a state the screen describes as "default"
                          // while it is still judged by somebody's rewrite.
                          setPrompt(DEFAULT_SCORING_GUIDANCE);
                          patchConfig({ weights: null, semanticWeightPercent: null });
                        }}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        Reset prompt and weights
                      </button>
                    )}
                  </div>
                  <p className="stage-field__help mb-3">
                    Relative weights, not percentages — they do not have to add up to 100. A
                    component with nothing to compare (no salary band on the job, no notice period
                    on the candidate) is skipped and its weight shared out, so a half-filled
                    profile is never scored as a bad fit.
                  </p>

                  <div className="columns is-variable is-2 is-multiline">
                    {(Object.keys(WEIGHT_LABELS) as ComponentKey[]).map((key) => (
                      <div className="column is-one-third" key={key}>
                        <label className="label" htmlFor={`weight-${key}`}>
                          {WEIGHT_LABELS[key].label}
                        </label>
                        <input
                          id={`weight-${key}`}
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          readOnly={readOnly}
                          value={weights[key]}
                          onChange={(e) =>
                            patchConfig({
                              weights: {
                                ...weights,
                                [key]: e.target.value === "" ? 0 : Number(e.target.value),
                              },
                            })
                          }
                        />
                        <p className="stage-field__help">{WEIGHT_LABELS[key].help}</p>
                      </div>
                    ))}
                  </div>

                  {weightTotal === 0 && (
                    <p className="stage-field__help" style={{ color: "var(--status-attention-text)" }}>
                      Every weight is zero, so there would be nothing to score on. Saved like this,
                      the platform defaults are used instead.
                    </p>
                  )}
                </div>

                <div className="columns is-variable is-3">
                  <div className="column is-half">
                    <label className="label" htmlFor="stage-ai-share">
                      How much the AI read counts (%)
                    </label>
                    <input
                      id="stage-ai-share"
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      readOnly={readOnly}
                      value={
                        (config as { semanticWeightPercent: number | null })
                          .semanticWeightPercent ?? ""
                      }
                      onChange={(e) =>
                        patchConfig({
                          semanticWeightPercent:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                    <p className="stage-field__help">
                      Blank uses the default of {Math.round(SEMANTIC_WEIGHT * 100)}%. The rest
                      comes from the checkable facts above. Set 0 to score on facts alone and skip
                      the AI call entirely.
                    </p>
                  </div>
                </div>
              </>
            )}

            {stageKey === "ai_screening_call" && (
              <>
                {/*
                  The SAME list Module 8 dials from, edited in place. The spec
                  forbids a second question list, and a copy in this stage's
                  config would be a second source of truth that Module 8 never
                  reads — so the call would ask one set while this screen
                  displayed another.
                */}
                <StringListEditor
                  label="Screening questions"
                  help="Asked on the automated call. Shared with the job's screening questions — editing here edits them."
                  items={questions}
                  onChange={setQuestions}
                  readOnly={readOnly}
                  placeholder="e.g. How many years have you worked with Java?"
                />

                {/*
                  MODULE 24 changed what an EMPTY list means, so it is said here.

                  It used to mean "this call cannot run". It now means "fall back
                  to the organization's default questions, if any are set". An
                  admin leaving this list empty needs to know a call may still
                  happen — and with questions they did not write on this screen.
                */}
                {questions.length === 0 && (
                  <p className="stage-note">
                    With no questions here, the call falls back to your organization&apos;s default
                    screening questions from the Voice Agent Console. If there are none there
                    either, no call can be placed.
                  </p>
                )}

                <div className="columns is-variable is-3 mt-4">
                  <div className="column is-half">
                    <label className="label" htmlFor="stage-attempts">Max call attempts</label>
                    <input
                      id="stage-attempts"
                      className="input"
                      type="number"
                      min={MIN_CALL_ATTEMPTS}
                      max={MAX_CALL_ATTEMPTS}
                      readOnly={readOnly}
                      value={(config as { maxAttempts: number | null }).maxAttempts ?? ""}
                      onChange={(e) =>
                        patchConfig({ maxAttempts: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                    <p className="stage-field__help">
                      Leave blank to use your organisation&apos;s screening default.
                    </p>
                  </div>

                  <div className="column is-half">
                    <label className="label" htmlFor="stage-language">Language</label>
                    <div className="select is-fullwidth">
                      <select
                        id="stage-language"
                        disabled={readOnly}
                        value={(config as { language: string | null }).language ?? ""}
                        onChange={(e) => patchConfig({ language: e.target.value || null })}
                      >
                        <option value="">Organisation default</option>
                        <option value="en">English</option>
                        <option value="hi">Hindi</option>
                        <option value="en-IN">English (India)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}

            {(stageKey === "phone_interview" || stageKey === "video_interview") && (
              <>
                <div className="columns is-variable is-3">
                  <div className="column is-half">
                    <label className="label" htmlFor="stage-duration">Suggested duration (minutes)</label>
                    <input
                      id="stage-duration"
                      className="input"
                      type="number"
                      min={MIN_DURATION_MINUTES}
                      max={MAX_DURATION_MINUTES}
                      readOnly={readOnly}
                      value={(config as { durationMinutes: number | null }).durationMinutes ?? ""}
                      onChange={(e) =>
                        patchConfig({ durationMinutes: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <StringListEditor
                  label="Suggested questions"
                  help="Offered to whoever runs this stage. Not asked automatically."
                  items={(config as { questions: string[] }).questions}
                  onChange={(items) => patchConfig({ questions: items })}
                  readOnly={readOnly}
                  placeholder="e.g. Walk me through a system you designed end to end."
                />

                {stageKey === "video_interview" && (
                  <div className="mt-4">
                    <label className="label" htmlFor="stage-evaluate">What to evaluate</label>
                    <textarea
                      id="stage-evaluate"
                      className="textarea"
                      rows={4}
                      readOnly={readOnly}
                      value={(config as { whatToEvaluate: string | null }).whatToEvaluate ?? ""}
                      onChange={(e) => patchConfig({ whatToEvaluate: e.target.value })}
                      placeholder="e.g. Depth on distributed systems; how they handle disagreement."
                    />
                    <p className="stage-field__help">
                      Feeds the interview brief once Module 11&apos;s integration is wired up.
                    </p>
                  </div>
                )}
              </>
            )}

            {stageKey === "written_assessment" && (
              <>
                <StringListEditor
                  label="Assessment questions"
                  help="Sent to the candidate as the assessment."
                  items={(config as { questions: string[] }).questions}
                  onChange={(items) => patchConfig({ questions: items })}
                  readOnly={readOnly}
                  placeholder="e.g. Design a rate limiter for a public API."
                />

                <div className="columns is-variable is-3 mt-4">
                  <div className="column is-half">
                    <label className="label" htmlFor="stage-limit">Time limit (minutes)</label>
                    <input
                      id="stage-limit"
                      className="input"
                      type="number"
                      min={MIN_DURATION_MINUTES}
                      max={MAX_DURATION_MINUTES}
                      readOnly={readOnly}
                      value={(config as { timeLimitMinutes: number | null }).timeLimitMinutes ?? ""}
                      onChange={(e) =>
                        patchConfig({ timeLimitMinutes: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            {stage.execution === "configuration_only" && (
              <p className="stage-note mt-4">
                This stage is saved and shown to your team, but nothing runs it yet — there is no
                engine for it in the product. The configuration is kept so it is ready when there is.
              </p>
            )}
          </div>
        </section>

        <footer className="intake-modal__foot">
          <span />
          <div className="is-flex" style={{ gap: "var(--space-2)" }}>
            <button type="button" className="button" onClick={onCancel}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button
                type="button"
                className="button is-primary"
                onClick={() =>
                  onSave({ promptTemplate: prompt, config, screeningQuestions: questions })
                }
              >
                Save
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
