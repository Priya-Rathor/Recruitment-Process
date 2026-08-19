"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import {
  ACTIONS,
  ACTION_INTEGRATIONS,
  ACTION_LABELS,
  ACTION_MODES,
  CONDITION_FIELDS,
  CONSEQUENTIAL_ACTIONS,
  FIELD_LABELS,
  FIELD_OPERATORS,
  FIELD_VALUE_OPTIONS,
  OPERATOR_LABELS,
  TRIGGERS,
  TRIGGER_LABELS,
  TRIGGER_MODES,
  TRIGGER_SOURCES,
  approvalIsMandatory,
  checkExecutable,
  describeRule,
  isScheduledTrigger,
  normalizeConditions,
  type Action,
  type ActionType,
  type Condition,
  type ConditionField,
  type ConditionGroup,
  type Operator,
  type TriggerType,
} from "@/lib/automations/catalog";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";

export type AutomationFormValues = {
  id?: string;
  name: string;
  description: string | null;
  trigger: TriggerType;
  conditions: ConditionGroup[];
  actions: Action[];
  status: "draft" | "active" | "paused";
  drafted_by_ai: boolean;
  requires_approval: boolean;
  daily_run_cap: number | null;
  version?: number;
};

export type TeamMember = { id: string; label: string };

const NEW_AUTOMATION: AutomationFormValues = {
  name: "",
  description: null,
  trigger: "application_stage_changed",
  conditions: [],
  actions: [],
  status: "draft",
  drafted_by_ai: false,
  requires_approval: false,
  daily_run_cap: null,
};

function needsValue(operator: Operator) {
  return operator !== "is_true" && operator !== "is_false";
}

/**
 * The When / If / Then builder.
 *
 * Explicit Save throughout — nothing here auto-saves, per the design system, and
 * a rule that quietly saved itself while being typed could become active with
 * half a condition set.
 *
 * THREE THINGS THE UPGRADE ADDED TO THIS SCREEN, and the reasoning each carries:
 *
 *   - CONDITION GROUPS. "(Java or Kotlin) and score above 75" was inexpressible
 *     and the workaround was duplicating the whole rule per language. Groups are
 *     ANDed; each group is an ANY or an ALL. The plain-English panel parenthesises
 *     ANY groups so the sentence cannot be read two ways.
 *
 *   - EXECUTABILITY, shown while building rather than discovered on activation. A
 *     scheduled trigger cannot run the AI actions, and being told that at the
 *     moment you pick the combination is the difference between a two-second fix
 *     and a rule someone believes is working.
 *
 *   - APPROVAL AND A DAILY LIMIT. Both are guardrails, so both are visible where
 *     the rule is written instead of buried in settings. Approval is FORCED for a
 *     candidate email and the checkbox says so rather than silently ignoring a
 *     click.
 */
export function AutomationForm({
  mode,
  initial,
  canUseAi,
  teamMembers = [],
}: {
  mode: "create" | "edit";
  initial?: AutomationFormValues;
  canUseAi: boolean;
  /** For "assign a specific recruiter". Empty is handled, not assumed away. */
  teamMembers?: TeamMember[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<AutomationFormValues>(initial ?? NEW_AUTOMATION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRationale, setAiRationale] = useState<string | null>(null);

  const update = (patch: Partial<AutomationFormValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
    setDirty(true);
  };

  const groups = values.conditions;

  const updateGroup = (index: number, patch: Partial<ConditionGroup>) => {
    const next = [...groups];
    next[index] = { ...next[index], ...patch };
    update({ conditions: next });
  };

  const updateCondition = (
    groupIndex: number,
    conditionIndex: number,
    patch: Partial<Condition>
  ) => {
    const next = [...groups];
    const conditions = [...next[groupIndex].conditions];
    conditions[conditionIndex] = { ...conditions[conditionIndex], ...patch };
    next[groupIndex] = { ...next[groupIndex], conditions };
    update({ conditions: next });
  };

  const summary = useMemo(
    () =>
      values.actions.length > 0
        ? describeRule({
            trigger: values.trigger,
            conditions: values.conditions,
            actions: values.actions,
          })
        : null,
    [values.trigger, values.conditions, values.actions]
  );

  const executable = useMemo(
    () => checkExecutable({ trigger: values.trigger, actions: values.actions }),
    [values.trigger, values.actions]
  );

  const approvalForced = approvalIsMandatory(values.actions);
  const scheduled = isScheduledTrigger(values.trigger);

  const hasStageAgeCondition = groups.some((group) =>
    group.conditions.some(
      (condition) =>
        condition.field === "days_in_stage" &&
        (condition.operator === "gt" || condition.operator === "gte")
    )
  );

  const consequential = values.actions.filter((action) =>
    CONSEQUENTIAL_ACTIONS.includes(action.type)
  );

  async function draftWithAi() {
    setAiBusy(true);
    setAiError(null);
    setAiRationale(null);

    try {
      const response = await fetch("/api/automations/ai-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiPrompt }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setAiError(payload.error ?? "Couldn't draft that rule.");
        return;
      }

      // The proposal fills the form. It is NOT saved and NOT active — the admin
      // still has to press Save, and activation is another step after that.
      const draft = payload.data as {
        name: string;
        rule: { trigger: TriggerType; conditions: ConditionGroup[]; actions: Action[] };
        rationale: string | null;
      };

      setValues((previous) => ({
        ...previous,
        name: previous.name.trim().length > 0 ? previous.name : draft.name,
        trigger: draft.rule.trigger,
        conditions: normalizeConditions(draft.rule.conditions),
        actions: draft.rule.actions,
        drafted_by_ai: true,
        // Recomputed from the drafted actions, so an AI-proposed candidate email
        // arrives with approval already on rather than needing the server to
        // correct it silently.
        requires_approval:
          previous.requires_approval || approvalIsMandatory(draft.rule.actions),
      }));
      setAiRationale(draft.rationale);
      setDirty(true);
    } catch {
      setAiError("Couldn't reach the AI service. Build the rule by hand, or try again.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        mode === "create" ? "/api/automations" : `/api/automations/${values.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            description: values.description,
            trigger: values.trigger,
            conditions: values.conditions,
            actions: values.actions,
            drafted_by_ai: values.drafted_by_ai,
            requires_approval: values.requires_approval,
            daily_run_cap: values.daily_run_cap,
            // Only on edit. The server compares it and refuses a stale save
            // rather than overwriting a colleague's change unannounced.
            ...(mode === "edit" && values.version !== undefined
              ? { expected_version: values.version }
              : {}),
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Couldn't save that automation.");
        return;
      }

      setDirty(false);
      router.push(`/automations/${payload.data.id}`);
      router.refresh();
    } catch {
      setError("Couldn't save that automation. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {canUseAi && (
        <div className="card mb-4">
          <h2 className="title is-5 mb-2">Describe it instead</h2>
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            Say what you want in a sentence and AI will fill in the rule below. It only produces a
            draft — you review it here, save it, and activate it yourself.
          </p>

          <textarea
            className="textarea mb-3"
            rows={2}
            placeholder="e.g. Start AI screening for anyone entering Screening with a match above 75% who has a phone number"
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
          />

          <button
            type="button"
            className={`button ${aiBusy ? "is-loading" : ""}`}
            onClick={draftWithAi}
            disabled={aiBusy || aiPrompt.trim().length < 10}
          >
            Draft with AI
          </button>

          <FormError message={aiError} />

          {aiRationale && (
            <p className="mt-3 has-text-secondary" style={{ fontSize: 13 }}>
              <strong>AI&apos;s reasoning:</strong> {aiRationale} — check it against the rule below
              before saving.
            </p>
          )}
        </div>
      )}

      <div className="card mb-4">
        <h2 className="title is-5 mb-3">Name</h2>
        <input
          className="input mb-3"
          value={values.name}
          maxLength={120}
          placeholder="Screen strong matches automatically"
          onChange={(event) => update({ name: event.target.value })}
        />
        <textarea
          className="textarea"
          rows={2}
          placeholder="Optional — why this rule exists"
          value={values.description ?? ""}
          onChange={(event) => update({ description: event.target.value || null })}
        />
      </div>

      {/* WHEN */}
      <div className="card mb-4">
        <h2 className="title is-5 mb-3">When</h2>
        <div className="select is-fullwidth">
          <select
            value={values.trigger}
            onChange={(event) => update({ trigger: event.target.value as TriggerType })}
          >
            {TRIGGERS.map((trigger) => (
              <option key={trigger} value={trigger}>
                {TRIGGER_LABELS[trigger]}
              </option>
            ))}
          </select>
        </div>

        <p className="has-text-secondary mt-2" style={{ fontSize: 13 }}>
          Fires {TRIGGER_SOURCES[values.trigger]}.
        </p>

        {scheduled && (
          <div
            className="mt-3"
            style={{
              fontSize: 13,
              padding: "0.75rem",
              borderRadius: 8,
              background: "var(--color-background)",
            }}
          >
            <strong>This one runs on a schedule.</strong> The scheduler checks for applications
            that have been sitting too long, so this rule needs a{" "}
            <em>Days in current stage is at least&nbsp;…</em> condition — without one it would match
            every open application at once. The Automations page shows whether the scheduler is
            actually running.
            {!hasStageAgeCondition && (
              <div className="mt-2" style={{ color: "var(--color-error)" }}>
                No time condition yet, so this can&apos;t be saved.
              </div>
            )}
          </div>
        )}
      </div>

      {/* IF */}
      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-3">
          <h2 className="title is-5 mb-0">If</h2>
          <button
            type="button"
            className="button is-small"
            onClick={() =>
              update({
                conditions: [
                  ...groups,
                  {
                    match: "all",
                    conditions: [{ field: "match_score", operator: "gt", value: 75 }],
                  },
                ],
              })
            }
          >
            Add condition group
          </button>
        </div>

        {groups.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            No conditions — this runs every time the trigger fires.
          </p>
        ) : (
          groups.map((group, groupIndex) => (
            <div
              key={groupIndex}
              className="mb-3"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "0.75rem",
              }}
            >
              {groupIndex > 0 && (
                <p
                  className="has-text-secondary mb-2"
                  style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}
                >
                  and
                </p>
              )}

              <div
                className="is-flex is-align-items-center mb-2"
                style={{ gap: "0.5rem", flexWrap: "wrap" }}
              >
                <span className="has-text-secondary" style={{ fontSize: 13 }}>
                  Match
                </span>
                <div className="select is-small">
                  <select
                    value={group.match}
                    onChange={(event) =>
                      updateGroup(groupIndex, { match: event.target.value as "all" | "any" })
                    }
                  >
                    <option value="all">all of these</option>
                    <option value="any">any of these</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="button is-small"
                  onClick={() =>
                    update({ conditions: groups.filter((_, i) => i !== groupIndex) })
                  }
                >
                  Remove group
                </button>
              </div>

              {group.conditions.map((condition, conditionIndex) => {
                const operators = FIELD_OPERATORS[condition.field];
                const options = FIELD_VALUE_OPTIONS[condition.field];

                return (
                  <div
                    key={conditionIndex}
                    className="is-flex mb-2"
                    style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
                  >
                    {conditionIndex > 0 && (
                      <span className="has-text-secondary" style={{ fontSize: 13 }}>
                        {group.match === "any" ? "or" : "and"}
                      </span>
                    )}

                    <div className="select is-small">
                      <select
                        value={condition.field}
                        onChange={(event) => {
                          const field = event.target.value as ConditionField;
                          // Reset the operator and value: neither may apply here.
                          updateCondition(groupIndex, conditionIndex, {
                            field,
                            operator: FIELD_OPERATORS[field][0],
                            value: null,
                          });
                        }}
                      >
                        {CONDITION_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {FIELD_LABELS[field]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="select is-small">
                      <select
                        value={condition.operator}
                        onChange={(event) => {
                          const operator = event.target.value as Operator;
                          updateCondition(groupIndex, conditionIndex, {
                            operator,
                            value: needsValue(operator) ? (condition.value ?? "") : null,
                          });
                        }}
                      >
                        {operators.map((operator) => (
                          <option key={operator} value={operator}>
                            {OPERATOR_LABELS[operator]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {needsValue(condition.operator) &&
                      (condition.field === "stage" ? (
                        <div className="select is-small">
                          <select
                            value={String(condition.value ?? "")}
                            onChange={(event) =>
                              updateCondition(groupIndex, conditionIndex, {
                                value: event.target.value,
                              })
                            }
                          >
                            <option value="">Choose a stage</option>
                            {APPLICATION_STAGES.map((stage) => (
                              <option key={stage} value={stage}>
                                {STAGE_LABELS[stage]}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : options ? (
                        // A fixed vocabulary gets a select, not a text box. A typo
                        // here used to save fine and then never match.
                        <div className="select is-small">
                          <select
                            value={String(condition.value ?? "")}
                            onChange={(event) =>
                              updateCondition(groupIndex, conditionIndex, {
                                value: event.target.value,
                              })
                            }
                          >
                            <option value="">Choose one</option>
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <input
                          className="input is-small"
                          style={{ maxWidth: 140 }}
                          value={String(condition.value ?? "")}
                          onChange={(event) =>
                            updateCondition(groupIndex, conditionIndex, {
                              value: event.target.value,
                            })
                          }
                        />
                      ))}

                    <button
                      type="button"
                      className="button is-small"
                      onClick={() => {
                        const next = [...groups];
                        next[groupIndex] = {
                          ...group,
                          conditions: group.conditions.filter((_, i) => i !== conditionIndex),
                        };
                        // An empty group means nothing, so it goes with its last
                        // condition rather than lingering as a no-op.
                        update({
                          conditions: next.filter((entry) => entry.conditions.length > 0),
                        });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                className="button is-small mt-1"
                onClick={() =>
                  updateGroup(groupIndex, {
                    conditions: [
                      ...group.conditions,
                      { field: "match_score", operator: "gt", value: 75 },
                    ],
                  })
                }
              >
                {group.match === "any" ? "Add an alternative" : "Add condition"}
              </button>
            </div>
          ))
        )}

        {groups.length > 1 && (
          <p className="has-text-secondary" style={{ fontSize: 12 }}>
            Groups are combined with <strong>and</strong>. Inside a group, the choice above decides.
          </p>
        )}
      </div>

      {/* THEN */}
      <div className="card mb-4">
        <h2 className="title is-5 mb-3">Then</h2>

        {values.actions.length === 0 && (
          <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
            Pick at least one action.
          </p>
        )}

        {values.actions.map((action, index) => {
          const runsHere = ACTION_MODES[action.type]?.includes(TRIGGER_MODES[values.trigger]);

          return (
            <div key={index} className="mb-2">
              <div
                className="is-flex"
                style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
              >
                <div className="select is-small">
                  <select
                    value={action.type}
                    onChange={(event) => {
                      const next = [...values.actions];
                      const type = event.target.value as ActionType;
                      next[index] = {
                        type,
                        // Sensible starting config, so a freshly picked action is
                        // not immediately invalid.
                        config:
                          type === "assign_recruiter"
                            ? { strategy: "job_owner" }
                            : type === "send_candidate_email"
                              ? { template: "candidate_stage_update" }
                              : {},
                      };
                      update({
                        actions: next,
                        requires_approval:
                          values.requires_approval || approvalIsMandatory(next),
                      });
                    }}
                  >
                    {ACTIONS.map((type) => (
                      <option key={type} value={type}>
                        {ACTION_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>

                {action.type === "move_to_stage" && (
                  <div className="select is-small">
                    <select
                      value={String(action.config?.stage ?? "")}
                      onChange={(event) => {
                        const next = [...values.actions];
                        next[index] = { ...action, config: { stage: event.target.value } };
                        update({ actions: next });
                      }}
                    >
                      <option value="">Choose a stage</option>
                      {APPLICATION_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {action.type === "assign_recruiter" && (
                  <>
                    <div className="select is-small">
                      <select
                        value={String(action.config?.strategy ?? "job_owner")}
                        onChange={(event) => {
                          const next = [...values.actions];
                          next[index] = {
                            ...action,
                            config: { strategy: event.target.value },
                          };
                          update({ actions: next });
                        }}
                      >
                        <option value="job_owner">the job&apos;s owning recruiter</option>
                        <option value="specific_user">a specific person</option>
                      </select>
                    </div>

                    {action.config?.strategy === "specific_user" && (
                      <div className="select is-small">
                        <select
                          value={String(action.config?.user_id ?? "")}
                          onChange={(event) => {
                            const next = [...values.actions];
                            next[index] = {
                              ...action,
                              config: { strategy: "specific_user", user_id: event.target.value },
                            };
                            update({ actions: next });
                          }}
                        >
                          <option value="">Choose someone</option>
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                {action.type === "call_n8n_webhook" && (
                  <input
                    className="input is-small"
                    style={{ maxWidth: 240 }}
                    placeholder="webhook path, e.g. recruitment/hired"
                    value={String(action.config?.path ?? "")}
                    onChange={(event) => {
                      const next = [...values.actions];
                      next[index] = { ...action, config: { path: event.target.value } };
                      update({ actions: next });
                    }}
                  />
                )}

                {action.type === "add_note" && (
                  <input
                    className="input is-small"
                    style={{ maxWidth: 280 }}
                    placeholder="Optional note text"
                    value={String(action.config?.text ?? "")}
                    onChange={(event) => {
                      const next = [...values.actions];
                      next[index] = { ...action, config: { text: event.target.value } };
                      update({ actions: next });
                    }}
                  />
                )}

                {ACTION_INTEGRATIONS[action.type] && (
                  <span className="has-text-secondary" style={{ fontSize: 12 }}>
                    needs {ACTION_INTEGRATIONS[action.type]}
                  </span>
                )}

                <button
                  type="button"
                  className="button is-small"
                  onClick={() => {
                    const next = values.actions.filter((_, i) => i !== index);
                    update({ actions: next });
                  }}
                >
                  Remove
                </button>
              </div>

              {!runsHere && (
                <p className="mt-1" style={{ fontSize: 12, color: "var(--color-error)" }}>
                  This action can&apos;t run on the trigger you picked.
                </p>
              )}

              {action.type === "notify_recruiter" && (
                <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
                  Goes to the assigned recruiter. Skipped when nobody is assigned.
                </p>
              )}

              {action.type === "send_candidate_email" && (
                <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
                  Sends one approved template — a stage update with no free text. Always needs
                  approval first.
                </p>
              )}

              {action.type === "call_n8n_webhook" && (
                <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
                  Posts ids and the stage to a workflow in your own n8n instance. No candidate
                  name, email or phone is sent.
                </p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="button is-small mt-2"
          onClick={() => update({ actions: [...values.actions, { type: "add_note", config: {} }] })}
        >
          Add action
        </button>

        {!executable.ok && (
          <div className="mt-3" style={{ fontSize: 13, color: "var(--color-error)" }}>
            {executable.reason}
          </div>
        )}
      </div>

      {/* GUARDRAILS */}
      <div className="card mb-4">
        <h2 className="title is-5 mb-1">Guardrails</h2>
        <p className="has-text-secondary mb-3" style={{ fontSize: 13 }}>
          A rule already runs at most once per application per stage-entry. These two bound what it
          can do across <em>all</em> your applications.
        </p>

        <label className="is-flex mb-1" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={values.requires_approval || approvalForced}
            disabled={approvalForced}
            onChange={(event) => update({ requires_approval: event.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: 14 }}>
            A person must approve the actions before they run
            {approvalForced && (
              <span className="has-text-secondary">
                {" "}
                — required, because this rule emails candidates
              </span>
            )}
          </span>
        </label>

        <p className="has-text-secondary mb-4" style={{ fontSize: 12, marginLeft: "1.6rem" }}>
          The rule still evaluates on its own; when it matches, it proposes and waits. Proposals
          expire after seven days.
        </p>

        <div className="is-flex is-align-items-center" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14 }}>Run at most</span>
          <input
            className="input is-small"
            style={{ maxWidth: 90 }}
            type="number"
            min={1}
            placeholder="∞"
            value={values.daily_run_cap ?? ""}
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") {
                update({ daily_run_cap: null });
                return;
              }
              const parsed = Number(raw);
              update({
                daily_run_cap: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
              });
            }}
          />
          <span style={{ fontSize: 14 }}>times per day</span>
        </div>

        <p className="has-text-secondary mt-1" style={{ fontSize: 12 }}>
          Leave empty for no limit. Counted in your organization&apos;s timezone. Hitting the limit
          pauses the rule and tells your Owners and Admins why — it does not keep trying quietly.
        </p>
      </div>

      {summary && (
        <div className="card mb-4">
          <h2 className="title is-5 mb-2">In plain English</h2>
          <p style={{ fontSize: 15 }}>{summary}</p>

          {consequential.length > 0 && (
            <p className="mt-3" style={{ fontSize: 13, color: "var(--status-attention-text, #B45309)" }}>
              This rule spends money when it runs
              {consequential.some((action) => action.type === "start_screening_call")
                ? " and telephones candidates"
                : ""}
              . It runs at most once per application per stage-entry
              {values.daily_run_cap ? `, and at most ${values.daily_run_cap} times a day` : ""}.
            </p>
          )}
        </div>
      )}

      <FormError message={error} />

      <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
        <button
          type="button"
          className={`button is-primary ${saving ? "is-loading" : ""}`}
          onClick={save}
          disabled={
            saving ||
            values.name.trim().length === 0 ||
            values.actions.length === 0 ||
            (scheduled && !hasStageAgeCondition)
          }
        >
          {mode === "create" ? "Save as draft" : "Save changes"}
        </button>

        {dirty && (
          <span className="has-text-secondary" style={{ fontSize: 13 }}>
            Unsaved changes
          </span>
        )}
      </div>

      <p className="has-text-secondary mt-3" style={{ fontSize: 13 }}>
        {mode === "create"
          ? "Saving creates a draft. Nothing runs until you activate it on the next screen."
          : "Editing what an active rule does sends it back to draft, so somebody re-approves it before it acts again."}
      </p>
    </div>
  );
}
