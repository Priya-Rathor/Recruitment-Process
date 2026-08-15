"use client";

// =============================================================================
// Configure: <stage>
//
// One modal for all four stages. The prompt editor and field picker are shared;
// only the block below the editor differs, because only the stage-specific
// extras differ. Four near-identical modals would have drifted within a month.
//
// CANCEL SEMANTICS ARE THE SUBTLE PART. The spec: cancelling a FIRST-TIME
// enable reverts the toggle to off, but cancelling a later edit leaves the
// stage enabled. So this component reports what happened (`saved` vs
// `cancelled`) and the parent decides — the modal does not own the toggle.
// =============================================================================

import { useRef, useState } from "react";
import { Eye, Plus, Search, X } from "lucide-react";
import {
  GROUP_LABELS,
  PLACEHOLDER_FIELDS,
  insertToken,
  renderPreview,
  splitTokens,
  type PlaceholderGroup,
} from "@/lib/hiring-stages/placeholders";
import {
  MAX_CALL_ATTEMPTS,
  MAX_DURATION_MINUTES,
  MIN_CALL_ATTEMPTS,
  MIN_DURATION_MINUTES,
  type StageConfig,
} from "@/lib/hiring-stages/config";
import { stageDefinition, type StageKey } from "@/lib/hiring-stages/catalog";
import { ROUND_SCORE_MAX } from "@/lib/evaluation/verdict";
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

  const [prompt, setPrompt] = useState(draft.promptTemplate);
  const [config, setConfig] = useState<StageConfig>(draft.config);
  const [questions, setQuestions] = useState<string[]>(draft.screeningQuestions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Which fields the script references — the "chip list" the spec asks for when
  // a plain <textarea> is used instead of a rich editor. Recomputed on render
  // rather than stored, so it can never disagree with the text above it.
  const { known, unknown } = splitTokens(prompt);

  /** Inserts at the caret and puts the caret back after the token. */
  function insert(token: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? prompt.length;
    const end = el?.selectionEnd ?? prompt.length;

    const { text, caret } = insertToken({ text: prompt, token, selectionStart: start, selectionEnd: end });
    setPrompt(text);
    setPickerOpen(false);
    setPickerQuery("");

    // After React repaints, or the caret lands wherever the browser left it.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  const filtered = PLACEHOLDER_FIELDS.filter((field) => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return true;
    return field.label.toLowerCase().includes(q) || field.token.includes(q);
  });

  const grouped = (["job", "candidate"] as PlaceholderGroup[])
    .map((group) => ({ group, fields: filtered.filter((f) => f.group === group) }))
    .filter((entry) => entry.fields.length > 0);

  function patchConfig(changes: Partial<Record<string, unknown>>) {
    setConfig((current) => ({ ...current, ...changes }) as StageConfig);
  }

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

          {/* ---- The script ------------------------------------------------ */}
          <div className="stage-field">
            <div className="stage-field__head">
              <label className="label" htmlFor="stage-prompt">
                Script / instructions for this stage
              </label>

              <div className="stage-picker">
                <button
                  type="button"
                  className="button is-small"
                  onClick={() => setPickerOpen((open) => !open)}
                  aria-expanded={pickerOpen}
                  disabled={readOnly}
                >
                  <Plus size={14} aria-hidden="true" />
                  Insert field
                </button>

                {pickerOpen && (
                  <div className="stage-picker__menu">
                    <div className="stage-picker__search">
                      <Search size={14} aria-hidden="true" />
                      <input
                        className="input"
                        type="search"
                        placeholder="Search fields"
                        value={pickerQuery}
                        onChange={(event) => setPickerQuery(event.target.value)}
                      />
                    </div>

                    <div className="stage-picker__list">
                      {grouped.map(({ group, fields }) => (
                        <div key={group}>
                          <p className="stage-picker__group">{GROUP_LABELS[group]}</p>
                          {fields.map((field) => (
                            <button
                              key={field.token}
                              type="button"
                              className="stage-picker__item"
                              onClick={() => insert(field.token)}
                            >
                              <span className="stage-picker__label">{field.label}</span>
                              <code className="stage-picker__token">{`{{${field.token}}}`}</code>
                            </button>
                          ))}
                        </div>
                      ))}
                      {grouped.length === 0 && (
                        <p className="stage-picker__empty">No field matches that.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <p className="stage-field__help">
              Write what should happen during this stage. Insert live job or candidate details
              using the field picker — they&apos;ll be replaced with real values when this runs.
            </p>

            <textarea
              id="stage-prompt"
              ref={textareaRef}
              className="textarea stage-textarea"
              rows={10}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              readOnly={readOnly}
              placeholder="e.g. Confirm {{candidate.name}} is still interested in {{job.title}}…"
            />

            {/*
              The chip list. A plain <textarea> cannot render a highlighted
              token inline — it holds text, not markup — so this is the spec's
              stated fallback: show which fields the script references.
            */}
            <div className="stage-chips">
              <span className="stage-chips__label">Fields used in this script:</span>
              {known.length === 0 && <span className="stage-chips__none">none yet</span>}
              {known.map((field) => (
                <span key={field.token} className="stage-chip">
                  {field.label}
                </span>
              ))}
            </div>

            {/*
              An unknown token does NOT block saving — refusing someone's work
              over a typo is worse than showing them the typo. But it is said
              out loud, because the alternative is an agent reading
              "{{candidate.naem}}" to a candidate.
            */}
            {unknown.length > 0 && (
              <p className="stage-warning">
                {unknown.length === 1 ? "This field isn't recognised" : "These fields aren't recognised"}
                {" and will be left as written: "}
                {unknown.map((token) => `{{${token}}}`).join(", ")}
              </p>
            )}

            <button
              type="button"
              className="text-link mt-3"
              onClick={() => setPreviewing((value) => !value)}
            >
              <Eye size={14} aria-hidden="true" />
              {previewing ? "Hide preview" : "Preview with sample data"}
            </button>

            {previewing && (
              <div className="stage-preview">
                <p className="stage-preview__label">Preview — sample values, not real candidates</p>
                <pre className="stage-preview__body">{renderPreview(prompt) || "Nothing to preview yet."}</pre>
              </div>
            )}
          </div>

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
                <label className="label" htmlFor="stage-passing">Passing score (1-10)</label>
                <input
                  id="stage-passing"
                  className="input"
                  type="number"
                  min={0}
                  max={ROUND_SCORE_MAX}
                  readOnly={readOnly}
                  value={(config as { passingScore: number | null }).passingScore ?? ""}
                  onChange={(e) =>
                    patchConfig({
                      passingScore: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <p className="stage-field__help">
                  Leave blank for no gate — results then read &ldquo;Needs Review&rdquo; rather
                  than failing.
                </p>
              </div>
            </div>

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
