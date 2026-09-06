"use client";

// =============================================================================
// The "Custom Fields" section, rendered on a job, candidate or application.
//
// TWO MODES, BECAUSE CREATE AND EDIT ARE GENUINELY DIFFERENT.
//
//   Controlled  — no entityId. The parent owns the values and saves them after
//                 it has created the record. This is the job CREATE form: there
//                 is no job id to attach a value to until the job exists.
//   Self-saving — entityId given. The section owns its own Save button and PUTs
//                 to /api/custom-fields/values.
//
// The alternative was to make the create form save custom fields in the same
// request as the job. That would mean the jobs endpoint writing to a second
// table and having to decide what to do when the job saved and the fields did
// not — a partial write it would then have to unwind. Saving after, from the
// page that already knows the new id, keeps each write owned by the module that
// owns the table.
//
// AN EXPLICIT SAVE, NEVER AUTO-SAVE. AGENTS.md §Design system.
// =============================================================================
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldInput } from "@/components/FieldInput";
import { FormError } from "@/components/ui/states";
import type { CustomFieldDefinition, CustomFieldEntity } from "@/lib/customFields/definitions";
import { formatValue } from "@/lib/customFields/values";

/** What a control holds while being edited. Widened to what inputs produce. */
export type DraftValues = Record<string, string | string[] | boolean>;

/**
 * Turns a stored jsonb value into what the input expects.
 *
 * yes_no is the one that bites: it is stored as a BOOLEAN but the radio group
 * is keyed on the strings "yes"/"no". Without this, an existing "No" renders as
 * neither option selected and re-saving silently clears it.
 */
export function toDraft(
  definitions: readonly CustomFieldDefinition[],
  stored: Record<string, unknown>
): DraftValues {
  const draft: DraftValues = {};

  for (const definition of definitions) {
    const value = stored[definition.field_key];

    if (definition.field_type === "yes_no") {
      draft[definition.field_key] = value === true ? "yes" : value === false ? "no" : "";
    } else if (definition.field_type === "checkbox") {
      draft[definition.field_key] = Array.isArray(value) ? (value as string[]) : [];
    } else if (value === null || value === undefined) {
      draft[definition.field_key] = "";
    } else {
      draft[definition.field_key] = String(value);
    }
  }

  return draft;
}

export function CustomFieldsSection({
  entityType,
  entityId,
  definitions,
  values,
  onChange,
  canEdit,
  title = "Custom fields",
}: {
  entityType: CustomFieldEntity;
  /** Omit for the controlled mode used by a create form. */
  entityId?: string;
  definitions: CustomFieldDefinition[];
  /** Stored values keyed by field_key. */
  values: Record<string, unknown>;
  /** Controlled mode only — receives the draft on every keystroke. */
  onChange?: (draft: DraftValues) => void;
  canEdit: boolean;
  title?: string;
}) {
  const router = useRouter();

  const initial = useMemo(() => toDraft(definitions, values), [definitions, values]);
  const [draft, setDraft] = useState<DraftValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Nothing configured for this entity: render nothing at all rather than an
  // empty card. A heading with no content on every job page would be a
  // permanent reminder of a feature the organization has not adopted.
  if (definitions.length === 0) return null;

  function set(key: string, value: string | string[] | boolean) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setSaved(false);
    onChange?.(next);
  }

  async function save() {
    if (!entityId) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/custom-fields/values", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, values: draft }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not save those fields.");
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <section className="card mt-4">
      <h2 className="job-card__title">{title}</h2>

      <FormError message={error} />

      {definitions.map((definition) => {
        const id = `cf-${definition.field_key}`;

        return (
          <div className="field" key={definition.id}>
            <label className="label is-small" htmlFor={id}>
              {definition.label}
              {definition.required && <span aria-hidden="true"> *</span>}
            </label>

            {canEdit ? (
              <div className="control">
                <FieldInput
                  field={{
                    fieldKey: definition.field_key,
                    fieldType: definition.field_type,
                    options: definition.options,
                  }}
                  value={draft[definition.field_key]}
                  onChange={(value) => set(definition.field_key, value)}
                />
              </div>
            ) : (
              /*
                READ-ONLY IS TEXT, NOT A DISABLED INPUT. A greyed-out control
                still looks like something that ought to be clickable, and a
                Viewer clicking it repeatedly learns nothing about why.
              */
              <p style={{ fontSize: 14 }}>
                {formatValue(definition.field_type, values[definition.field_key]) || "—"}
              </p>
            )}
          </div>
        );
      })}

      {canEdit && entityId && (
        <div className="mt-3" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className={`button is-primary is-small ${busy ? "is-loading" : ""}`}
            onClick={save}
            disabled={busy}
          >
            Save custom fields
          </button>
          {saved && (
            <span className="has-text-secondary" style={{ fontSize: 13 }}>
              Saved.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
