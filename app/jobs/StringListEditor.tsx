"use client";

// =============================================================================
// An editable list of free-text lines.
//
// The same shape the job form's QuestionEditor already uses — reorder, edit in
// place, remove, add — extracted so the four stage configurations and the job
// form are not four divergent copies of it.
//
// Deliberately NOT a refactor of QuestionEditor itself: that one is wired into
// the job form's own state and its own layout, and rewriting it as part of this
// feature would put an unrelated regression risk into a change about hiring
// stages. This is the version the new screens use; merging them is a tidy-up
// worth doing on its own.
// =============================================================================

import { useState } from "react";
import { ArrowUp, Plus, Trash2 } from "lucide-react";

export function StringListEditor({
  label,
  help,
  items,
  onChange,
  readOnly = false,
  placeholder,
}: {
  label: string;
  help?: string;
  items: string[];
  onChange: (items: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  }

  return (
    <div className="list-editor">
      <label className="label">{label}</label>
      {help && <p className="stage-field__help">{help}</p>}

      {items.length === 0 && (
        <p className="has-text-secondary" style={{ fontSize: "var(--text-label)" }}>
          None yet.
        </p>
      )}

      {items.map((item, index) => (
        <div key={`${index}-${item.slice(0, 12)}`} className="list-editor__row">
          <span className="list-editor__index">{index + 1}</span>
          <input
            className="input"
            type="text"
            value={item}
            readOnly={readOnly}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          {!readOnly && (
            <>
              <button
                type="button"
                className="button is-small"
                aria-label={`Move "${item.slice(0, 40)}" up`}
                disabled={index === 0}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="button is-small list-editor__remove"
                aria-label={`Remove "${item.slice(0, 40)}"`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="list-editor__add">
          <input
            className="input"
            type="text"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the line rather than submitting the surrounding form,
              // which would save a half-finished configuration.
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="button is-primary is-small" onClick={add} disabled={!draft.trim()}>
            <Plus size={13} aria-hidden="true" />
            Add
          </button>
        </div>
      )}
    </div>
  );
}
