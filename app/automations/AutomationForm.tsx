"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/states";
import {
  ACTIONS,
  ACTION_INTEGRATIONS,
  ACTION_LABELS,
  CONDITION_FIELDS,
  CONSEQUENTIAL_ACTIONS,
  FIELD_LABELS,
  FIELD_OPERATORS,
  OPERATOR_LABELS,
  TRIGGERS,
  TRIGGER_AVAILABILITY,
  TRIGGER_LABELS,
  describeRule,
  type Action,
  type ActionType,
  type Condition,
  type ConditionField,
  type Operator,
  type TriggerType,
} from "@/lib/automations/catalog";
import { APPLICATION_STAGES, STAGE_LABELS } from "@/lib/applications/stages";

export type AutomationFormValues = {
  id?: string;
  name: string;
  description: string | null;
  trigger: TriggerType;
  conditions: Condition[];
  actions: Action[];
  status: "draft" | "active" | "paused";
  drafted_by_ai: boolean;
};

const NEW_AUTOMATION: AutomationFormValues = {
  name: "",
  description: null,
  trigger: "application_stage_changed",
  conditions: [],
  actions: [],
  status: "draft",
  drafted_by_ai: false,
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
 */
export function AutomationForm({
  mode,
  initial,
  canUseAi,
}: {
  mode: "create" | "edit";
  initial?: AutomationFormValues;
  canUseAi: boolean;
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

  const triggerAvailability = TRIGGER_AVAILABILITY[values.trigger];

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
        rule: { trigger: TriggerType; conditions: Condition[]; actions: Action[] };
        rationale: string | null;
      };

      setValues((previous) => ({
        ...previous,
        name: previous.name.trim().length > 0 ? previous.name : draft.name,
        trigger: draft.rule.trigger,
        conditions: draft.rule.conditions,
        actions: draft.rule.actions,
        drafted_by_ai: true,
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
                {TRIGGER_AVAILABILITY[trigger].available ? "" : " (not available yet)"}
              </option>
            ))}
          </select>
        </div>

        {triggerAvailability && !triggerAvailability.available && (
          <p className="mt-3" style={{ fontSize: 13, color: "var(--status-attention-text, #B45309)" }}>
            {triggerAvailability.note} You can save this as a draft, but it can&apos;t be activated.
          </p>
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
                  ...values.conditions,
                  { field: "match_score", operator: "gt", value: 75 },
                ],
              })
            }
          >
            Add condition
          </button>
        </div>

        {values.conditions.length === 0 ? (
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            No conditions — this runs every time the trigger fires.
          </p>
        ) : (
          <>
            {values.conditions.map((condition, index) => {
              const operators = FIELD_OPERATORS[condition.field];
              return (
                <div
                  key={index}
                  className="is-flex mb-2"
                  style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
                >
                  {index > 0 && (
                    <span className="has-text-secondary" style={{ fontSize: 13 }}>
                      and
                    </span>
                  )}

                  <div className="select is-small">
                    <select
                      value={condition.field}
                      onChange={(event) => {
                        const field = event.target.value as ConditionField;
                        const next = [...values.conditions];
                        // Reset the operator: the old one may not apply here.
                        next[index] = { field, operator: FIELD_OPERATORS[field][0], value: null };
                        update({ conditions: next });
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
                        const next = [...values.conditions];
                        next[index] = {
                          ...condition,
                          operator,
                          value: needsValue(operator) ? condition.value ?? "" : null,
                        };
                        update({ conditions: next });
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
                          onChange={(event) => {
                            const next = [...values.conditions];
                            next[index] = { ...condition, value: event.target.value };
                            update({ conditions: next });
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
                    ) : (
                      <input
                        className="input is-small"
                        style={{ maxWidth: 140 }}
                        value={String(condition.value ?? "")}
                        onChange={(event) => {
                          const next = [...values.conditions];
                          next[index] = { ...condition, value: event.target.value };
                          update({ conditions: next });
                        }}
                      />
                    ))}

                  <button
                    type="button"
                    className="button is-small"
                    onClick={() =>
                      update({
                        conditions: values.conditions.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </>
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

        {values.actions.map((action, index) => (
          <div
            key={index}
            className="is-flex mb-2"
            style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
          >
            <div className="select is-small">
              <select
                value={action.type}
                onChange={(event) => {
                  const next = [...values.actions];
                  next[index] = { type: event.target.value as ActionType, config: {} };
                  update({ actions: next });
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

            {ACTION_INTEGRATIONS[action.type] && (
              <span className="has-text-secondary" style={{ fontSize: 12 }}>
                needs {ACTION_INTEGRATIONS[action.type]}
              </span>
            )}

            {action.type === "notify_recruiter" && (
              <span style={{ fontSize: 12, color: "var(--status-attention-text, #B45309)" }}>
                recorded in the run log only until Module 15
              </span>
            )}

            <button
              type="button"
              className="button is-small"
              onClick={() => update({ actions: values.actions.filter((_, i) => i !== index) })}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className="button is-small mt-2"
          onClick={() => update({ actions: [...values.actions, { type: "add_note", config: {} }] })}
        >
          Add action
        </button>
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
              . It runs at most once per application per stage-entry.
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
          disabled={saving || values.name.trim().length === 0 || values.actions.length === 0}
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
