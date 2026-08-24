"use client";

// =============================================================================
// The question editor.
//
// EXPLICIT SAVE, NEVER AUTO-SAVE. The design system says so, and here it matters
// twice over: this list is what a stranger sees on a public page, and a
// half-saved reorder would put the resume upload above somebody's name.
//
// THE WHOLE LIST IS SENT AT ONCE, because order is part of the configuration.
// The SERVER then diffs it against what exists (see replaceFormFields), so
// saving does not re-mint field_keys — answers already collected are stored
// under those keys and would be orphaned by a delete-and-reinsert.
//
// WHAT THIS EDITOR REFUSES TO DO, and where the refusal really lives:
//
//   - remove or un-require Email and Resume on a job application form. The
//     button is absent here, parseFieldDefinitions() rejects it server-side, and
//     a trigger in migration 0033 refuses the write. Three layers because the
//     browser holds a PostgREST client, so the UI is not a control.
//   - offer File upload as a question type. Nothing in this module stores an
//     arbitrary attachment, so offering it would accept a document and drop it.
// =============================================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { FormError } from "@/components/states";
import { Toggle } from "@/components/ui/Toggle";
import {
  CUSTOM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  PROTECTED_FIELD_KEYS,
  needsOptions,
  type FormFieldType,
} from "@/lib/forms/fields";
import { parseFieldDefinitions, slugifyFieldKey } from "@/lib/forms/validation";
import type { FormPurpose } from "@/lib/forms/types";

export type EditorField = {
  fieldKey: string;
  label: string;
  helpText: string | null;
  fieldType: FormFieldType;
  options: string[];
  required: boolean;
  isStandard: boolean;
};

export function FormEditor({
  formId,
  purpose,
  fields: initial,
  canEdit,
}: {
  formId: string;
  purpose: FormPurpose;
  fields: EditorField[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<EditorField[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isJobApplication = purpose === "job_application";

  // Derived, not stored: undoing every change leaves the card clean again rather
  // than nagging about a change that no longer exists.
  const dirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(initial),
    [fields, initial]
  );

  function update(index: number, patch: Partial<EditorField>) {
    setFields((current) =>
      current.map((field, position) => (position === index ? { ...field, ...patch } : field))
    );
    setSaved(false);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    setFields((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  function remove(index: number) {
    setFields((current) => current.filter((_, position) => position !== index));
    setSaved(false);
  }

  function add() {
    setFields((current) => [
      ...current,
      {
        // The key is minted ONCE, here, from the label's eventual value — and
        // then never changes, because answers are stored under it.
        fieldKey: slugifyFieldKey("New question", current.map((field) => field.fieldKey)),
        label: "",
        helpText: null,
        fieldType: "short_text",
        options: [],
        required: false,
        isStandard: false,
      },
    ]);
    setSaved(false);
  }

  /** Whether this row is one of the two a job application form cannot lose. */
  function protectedField(field: EditorField): boolean {
    return isJobApplication && PROTECTED_FIELD_KEYS.includes(field.fieldKey);
  }

  async function save() {
    setError(null);

    const payload = fields.map((field) => ({
      field_key: field.fieldKey,
      label: field.label,
      help_text: field.helpText,
      field_type: field.fieldType,
      options: field.options,
      required: field.required,
    }));

    // The SAME validator the API runs, so a problem is named here rather than
    // after a round trip. The server re-runs it against the form's real purpose,
    // which is the check that counts.
    const check = parseFieldDefinitions(payload, { purpose });
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/forms/${formId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: payload }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not save the questions.");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="job-card__head">
        <div>
          <h2 className="job-card__title">Questions</h2>
          <p className="job-card__subtitle">
            {isJobApplication
              ? "What a candidate is asked on the public application page, in this order. The standard questions map onto their candidate profile; anything you add is shown on their application."
              : "What the person filling this in is asked, in this order."}
          </p>
        </div>
      </div>

      <FormError message={error} />

      {fields.length === 0 && (
        <p className="job-empty is-warning">
          No questions yet. A form with no questions cannot be published.
        </p>
      )}

      <ul className="form-editor">
        {fields.map((field, index) => {
          const locked = protectedField(field);

          return (
            <li key={field.fieldKey} className="form-editor__row">
              <div className="form-editor__handle" aria-hidden="true">
                <GripVertical size={14} />
              </div>

              <div className="form-editor__body">
                <div className="form-editor__line">
                  <input
                    className="input"
                    type="text"
                    maxLength={200}
                    placeholder="Question label"
                    value={field.label}
                    disabled={!canEdit}
                    onChange={(event) => update(index, { label: event.target.value })}
                    aria-label={`Label for question ${index + 1}`}
                  />

                  <div className="select">
                    <select
                      value={field.fieldType}
                      // The type of a standard field is fixed: Email must stay
                      // an email (dedupe reads it) and Resume must stay a file.
                      disabled={!canEdit || field.isStandard}
                      onChange={(event) =>
                        update(index, {
                          fieldType: event.target.value as FormFieldType,
                          // Choices are meaningless on a type that has none;
                          // clearing them stops a stale list being saved.
                          options: needsOptions(event.target.value as FormFieldType)
                            ? field.options
                            : [],
                        })
                      }
                      aria-label={`Answer type for question ${index + 1}`}
                    >
                      {field.isStandard ? (
                        <option value={field.fieldType}>
                          {FIELD_TYPE_LABELS[field.fieldType]}
                        </option>
                      ) : (
                        CUSTOM_FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {FIELD_TYPE_LABELS[type]}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {needsOptions(field.fieldType) && (
                  <div className="form-editor__line">
                    <input
                      className="input"
                      type="text"
                      placeholder="Choices, separated by commas"
                      value={field.options.join(", ")}
                      disabled={!canEdit}
                      onChange={(event) =>
                        update(index, {
                          options: event.target.value
                            .split(",")
                            .map((option) => option.trim())
                            .filter((option) => option.length > 0),
                        })
                      }
                      aria-label={`Choices for question ${index + 1}`}
                    />
                  </div>
                )}

                <div className="form-editor__meta">
                  {/* Toggle renders the switch only, so the word has to be
                      here — and tied to it, or the switch is a mystery to a
                      screen reader and to anyone glancing at the row. */}
                  <span className="form-editor__required">
                    <Toggle
                      checked={field.required}
                      // A protected field's Required cannot be turned off — the
                      // trigger in migration 0033 refuses the write anyway.
                      disabled={!canEdit || locked}
                      onChange={(next) => update(index, { required: next })}
                      labelledBy={`required-${field.fieldKey}`}
                    />
                    <span id={`required-${field.fieldKey}`}>Required</span>
                  </span>

                  {locked && (
                    <span className="form-editor__locked">
                      <Lock size={12} aria-hidden="true" />
                      Always asked — candidate matching and resume parsing need it
                    </span>
                  )}

                  {field.isStandard && !locked && (
                    <span className="form-editor__badge">Saves to the candidate profile</span>
                  )}
                </div>
              </div>

              {canEdit && (
                <div className="form-editor__actions">
                  <button
                    className="button is-small is-quiet"
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move question ${index + 1} up`}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="button is-small is-quiet"
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label={`Move question ${index + 1} down`}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  {/* Absent, not disabled, for the two that cannot be removed. */}
                  {!locked && (
                    <button
                      className="button is-small is-danger-soft"
                      type="button"
                      onClick={() => remove(index)}
                      aria-label={`Remove question ${index + 1}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="job-card__foot">
          <button className="button is-quiet" type="button" onClick={add} disabled={saving}>
            <Plus size={14} aria-hidden="true" />
            Add question
          </button>

          <button
            className="button is-primary"
            type="button"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save questions"}
          </button>

          {saved && !dirty && <span className="form-editor__saved">Saved</span>}
        </div>
      )}
    </section>
  );
}
