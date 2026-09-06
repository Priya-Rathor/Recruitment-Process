"use client";

// =============================================================================
// The add/edit form for one custom field definition.
//
// THE KEY IS SHOWN, NOT EDITED, AND IT IS SHOWN FOR A REASON. It is what
// {{custom.*}} tokens in message templates resolve against, so somebody writing
// a template needs to know it — and somebody renaming a field needs to see that
// the key is NOT changing with the label, because their existing templates and
// stored answers still point at the old one.
// =============================================================================
import { useMemo, useState } from "react";
import { FormError } from "@/components/ui/states";
import {
  CUSTOM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  fieldKeyFromLabel,
  isReservedKey,
  needsOptions,
  validateDefinition,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type FormFieldType,
} from "@/lib/customFields/definitions";

export type EditorDraft = {
  label: string;
  field_type: FormFieldType;
  options: string[];
  required: boolean;
  show_on_public_form: boolean;
};

export function FieldEditor({
  entity,
  existing,
  takenKeys,
  busy,
  onCancel,
  onSave,
}: {
  entity: CustomFieldEntity;
  /** Present when editing; absent when adding. */
  existing?: CustomFieldDefinition;
  /** Keys already used for this entity, so the preview can warn about collisions. */
  takenKeys: readonly string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: EditorDraft) => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [fieldType, setFieldType] = useState<FormFieldType>(existing?.field_type ?? "short_text");
  const [optionsText, setOptionsText] = useState((existing?.options ?? []).join("\n"));
  const [required, setRequired] = useState(existing?.required ?? false);
  const [showOnPublicForm, setShowOnPublicForm] = useState(existing?.show_on_public_form ?? false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => optionsText.split("\n").map((line) => line.trim()).filter(Boolean),
    [optionsText]
  );

  /**
   * The key this label will produce.
   *
   * Recomputed live while ADDING, and frozen while EDITING — an editor that
   * showed the key drifting as somebody fixed a typo would imply the rename
   * moves it, which is exactly the thing that does not happen.
   */
  const previewKey = existing ? existing.field_key : fieldKeyFromLabel(label.trim());

  const reserved = !existing && previewKey.length > 0 && isReservedKey(entity, previewKey);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const draft: EditorDraft = {
      label: label.trim(),
      field_type: fieldType,
      options,
      required,
      show_on_public_form: entity === "job" && showOnPublicForm,
    };

    // The SAME validator the API and the database use. Running it here is not a
    // substitute for either — it is what turns a 400 into an inline message
    // while the person still has the form open.
    const check = validateDefinition(
      { entity_type: entity, ...draft },
      existing ? takenKeys.filter((key) => key !== existing.field_key) : takenKeys
    );

    if (!check.ok) {
      setError(check.error);
      return;
    }

    onSave(draft);
  }

  return (
    <form className="card mb-4" onSubmit={submit} style={{ padding: 20 }}>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
        {existing ? `Edit "${existing.label}"` : "New field"}
      </p>

      <FormError message={error} />

      <div className="field">
        <label className="label is-small" htmlFor="cf-label">
          Label
        </label>
        <div className="control">
          <input
            id="cf-label"
            className="input"
            value={label}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Visa sponsorship required"
            required
          />
        </div>
        {previewKey.length > 0 && (
          <p className="help">
            Reference in templates as{" "}
            <code>{`{{custom.${entity}.${previewKey}}}`}</code>
            {existing && " — unchanged by renaming."}
          </p>
        )}
        {reserved && (
          <p className="help is-danger">
            That matches the built-in {entity} field &quot;{previewKey}&quot;. Custom fields sit
            alongside the built-in ones, so pick a different name.
          </p>
        )}
      </div>

      <div className="field">
        <label className="label is-small" htmlFor="cf-type">
          Type
        </label>
        <div className="control">
          <div className="select is-fullwidth">
            <select
              id="cf-type"
              value={fieldType}
              onChange={(event) => setFieldType(event.target.value as FormFieldType)}
            >
              {CUSTOM_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {existing && existing.field_type !== fieldType && (
          <p className="help is-warning">
            Answers already recorded keep their current shape. Changing the type may make some
            of them display differently.
          </p>
        )}
      </div>

      {needsOptions(fieldType) && (
        <div className="field">
          <label className="label is-small" htmlFor="cf-options">
            Options
          </label>
          <div className="control">
            <textarea
              id="cf-options"
              className="textarea"
              rows={4}
              value={optionsText}
              onChange={(event) => setOptionsText(event.target.value)}
              placeholder={"One per line\nYes\nNo\nNot sure"}
            />
          </div>
          <p className="help">One per line. {options.length} option{options.length === 1 ? "" : "s"}.</p>
        </div>
      )}

      <label className="checkbox" style={{ display: "block", marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
        />{" "}
        Required
      </label>

      {/*
        JOB FIELDS ONLY, and the toggle is absent rather than disabled for the
        other two. A disabled control invites the question "why can't I?", and
        the answer — a public form belongs to a job — is not something a
        candidate-field editor should have to explain.
      */}
      {entity === "job" && (
        <label className="checkbox" style={{ display: "block", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={showOnPublicForm}
            onChange={(event) => setShowOnPublicForm(event.target.checked)}
          />{" "}
          Show on public application form
          <span className="has-text-secondary" style={{ display: "block", fontSize: 12, marginLeft: 24 }}>
            Asks every applicant this question. Their answer is saved on the application, not
            on the job.
          </span>
        </label>
      )}

      <div className="mt-4" style={{ display: "flex", gap: 8 }}>
        <button type="submit" className={`button is-primary is-small ${busy ? "is-loading" : ""}`} disabled={busy}>
          {existing ? "Save changes" : "Add field"}
        </button>
        <button type="button" className="button is-small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
