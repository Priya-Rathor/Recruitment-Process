"use client";

// =============================================================================
// A repeatable list of small records — education, employment history.
//
// Generic over the record's fields, because the two lists differ only in their
// column labels. Two near-identical editors would have drifted the first time
// one of them gained a validation rule.
//
// Adds a BLANK row rather than opening a sub-form: these entries are three
// short fields, and a modal for "B.Tech / DTU / 2019" is more ceremony than the
// data deserves. An entry left entirely blank is dropped on save
// (normalizeEducation / normalizeEmploymentHistory), so an accidental Add costs
// nothing.
// =============================================================================

import { Plus, Trash2 } from "lucide-react";

export type FieldSpec<T> = {
  key: keyof T & string;
  label: string;
  placeholder?: string;
  /** Grid width in Bulma column classes. Defaults to an even split. */
  width?: string;
};

export function RepeatableEditor<T extends Record<string, string | null>>({
  label,
  help,
  entries,
  fields,
  blank,
  onChange,
  readOnly = false,
  addLabel = "Add",
  emptyText = "None yet.",
}: {
  label: string;
  help?: string;
  entries: T[];
  fields: FieldSpec<T>[];
  /** A fresh, all-null record. */
  blank: () => T;
  onChange: (entries: T[]) => void;
  readOnly?: boolean;
  addLabel?: string;
  emptyText?: string;
}) {
  function update(index: number, key: keyof T & string, value: string) {
    const next = entries.map((entry, i) =>
      i === index ? { ...entry, [key]: value === "" ? null : value } : entry
    );
    onChange(next);
  }

  return (
    <div className="repeatable">
      <label className="label">{label}</label>
      {help && <p className="stage-field__help">{help}</p>}

      {entries.length === 0 && (
        <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
          {emptyText}
        </p>
      )}

      {entries.map((entry, index) => (
        // Index as key, deliberately: these rows have no stable id, and keying
        // on content would remount the input the user is typing into on every
        // keystroke, losing the caret.
        <div key={index} className="repeatable__row">
          <div className="columns is-variable is-2 repeatable__fields">
            {fields.map((field) => (
              <div key={field.key} className={`column ${field.width ?? ""}`}>
                <input
                  className="input"
                  type="text"
                  aria-label={`${field.label}, entry ${index + 1}`}
                  placeholder={field.placeholder ?? field.label}
                  value={entry[field.key] ?? ""}
                  readOnly={readOnly}
                  onChange={(event) => update(index, field.key, event.target.value)}
                />
              </div>
            ))}
          </div>

          {!readOnly && (
            <button
              type="button"
              className="button is-small repeatable__remove"
              aria-label={`Remove entry ${index + 1}`}
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          className="button is-small mt-2"
          onClick={() => onChange([...entries, blank()])}
        >
          <Plus size={13} aria-hidden="true" />
          {addLabel}
        </button>
      )}
    </div>
  );
}
