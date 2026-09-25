"use client";

// The identity fields and the per-type configuration fields, rendered from
// lib/agents/config.ts CONFIG_FIELDS — the same list the API validates with, so
// the form can never offer a field the server refuses, and a type never shows
// another type's fields. Shared by the create flow and the edit page.

import { Field } from "@/components/ui/Field";
import { CONFIG_FIELDS, DESCRIPTION_MAX, NAME_MAX } from "@/lib/agents/config";
import type { AgentType } from "@/lib/agents/types";

export type AgentDraft = {
  name: string;
  description: string;
  configuration: Record<string, string>;
};

export function AgentFields({
  type,
  draft,
  onChange,
  showConfiguration = true,
}: {
  type: AgentType;
  draft: AgentDraft;
  onChange: (next: AgentDraft) => void;
  /** False for voice screening on the edit page: its settings live in the console. */
  showConfiguration?: boolean;
}) {
  const setConfig = (key: string, value: string) =>
    onChange({ ...draft, configuration: { ...draft.configuration, [key]: value } });

  return (
    <>
      <Field label="Name" htmlFor="agent-name">
        <input
          id="agent-name"
          className="input"
          value={draft.name}
          maxLength={NAME_MAX}
          required
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </Field>

      <Field label="Description" hint="Optional. Who this agent is for, in a line." htmlFor="agent-description">
        <textarea
          id="agent-description"
          className="textarea"
          rows={2}
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </Field>

      {showConfiguration &&
        CONFIG_FIELDS[type].map((field) => {
          const id = `agent-config-${field.key}`;
          const value = draft.configuration[field.key] ?? "";
          const label = field.required ? field.label : `${field.label} (optional)`;
          return (
            <Field key={field.key} label={label} hint={field.help} htmlFor={id}>
              {field.kind === "number" ? (
                <input
                  id={id}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={(event) => setConfig(field.key, event.target.value)}
                  style={{ maxWidth: 140 }}
                />
              ) : (
                <textarea
                  id={id}
                  className="textarea"
                  rows={field.key === "instructions" ? 6 : 3}
                  maxLength={field.max}
                  required={field.required}
                  value={value}
                  onChange={(event) => setConfig(field.key, event.target.value)}
                />
              )}
            </Field>
          );
        })}
    </>
  );
}

/** Form strings → the API's configuration object. Blank optional fields are left out. */
export function toConfiguration(type: AgentType, configuration: Record<string, string>) {
  const out: Record<string, string | number> = {};
  for (const field of CONFIG_FIELDS[type]) {
    const value = configuration[field.key]?.trim();
    if (!value) continue;
    out[field.key] = field.kind === "number" ? Number(value) : value;
  }
  return out;
}
