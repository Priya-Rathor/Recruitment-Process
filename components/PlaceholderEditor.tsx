"use client";

// =============================================================================
// The {{placeholder}} editor — one component, two features.
//
// EXTRACTED, NOT COPIED. This is exactly the editor app/jobs/StageConfigModal.tsx
// already used for Job Hiring Stage prompts: the same "Insert field" picker with
// its search, the same caret-preserving insertToken(), the same chip list of
// fields in use, the same unknown-token warning, the same "Preview with sample
// data" toggle, and the same CSS classes in app/globals.scss.
//
// Module 15's message-template editor needs all of it. Rebuilding it would have
// meant two pickers to keep in step, and the ways they would drift are not
// cosmetic: a second implementation of insertToken() that forgets the caret makes
// inserting a second field maddening, and a second preview that renders
// differently from the real send is worse than no preview, because it is believed.
//
// The only parameter that matters is `fields`. A stage script and a candidate
// message draw on different catalogues — {{interview.time}} has no value during a
// screening call — so each caller passes the vocabulary that is true where it
// renders, and neither can offer a token it cannot fill. See lookupFor() in
// lib/hiring-stages/placeholders.ts.
// =============================================================================
import { useRef, useState, type RefObject } from "react";
import { Eye, Plus, Search } from "lucide-react";
import {
  GROUP_LABELS,
  PLACEHOLDER_FIELDS,
  insertToken,
  renderPreview,
  splitTokens,
  type PlaceholderField,
  type PlaceholderGroup,
} from "@/lib/hiring-stages/placeholders";

const GROUP_ORDER: PlaceholderGroup[] = ["job", "candidate", "interview", "organization"];

export function PlaceholderEditor({
  id,
  label,
  help,
  value,
  onChange,
  rows = 10,
  placeholder,
  readOnly = false,
  fields = PLACEHOLDER_FIELDS,
  /** Rendered under the textarea, above the chips — e.g. a character count. */
  footer,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  fields?: PlaceholderField[];
  footer?: React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Which fields the text references. Recomputed on render rather than stored,
  // so it can never disagree with the text above it.
  const { known, unknown } = splitTokens(value, fields);

  const filtered = fields.filter((field) => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return true;
    return field.label.toLowerCase().includes(query) || field.token.includes(query);
  });

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    fields: filtered.filter((field) => field.group === group),
  })).filter((entry) => entry.fields.length > 0);

  return (
    <div className="stage-field">
      <div className="stage-field__head">
        <label className="label" htmlFor={id}>
          {label}
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
                {grouped.map(({ group, fields: groupFields }) => (
                  <div key={group}>
                    <p className="stage-picker__group">{GROUP_LABELS[group]}</p>
                    {groupFields.map((field) => (
                      <button
                        key={field.token}
                        type="button"
                        className="stage-picker__item"
                        onClick={() => {
                          insertAtCaret({
                            textareaRef,
                            text: value,
                            token: field.token,
                            onChange,
                          });
                          setPickerOpen(false);
                          setPickerQuery("");
                        }}
                      >
                        <span className="stage-picker__label">{field.label}</span>
                        <code className="stage-picker__token">{`{{${field.token}}}`}</code>
                      </button>
                    ))}
                  </div>
                ))}
                {grouped.length === 0 && <p className="stage-picker__empty">No field matches that.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {help && <p className="stage-field__help">{help}</p>}

      <textarea
        id={id}
        ref={textareaRef}
        className="textarea stage-textarea"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
      />

      {footer}

      {/*
        The chip list. A plain <textarea> cannot render a highlighted token
        inline — it holds text, not markup — so this is the stated fallback: show
        which fields the text references.
      */}
      <div className="stage-chips">
        <span className="stage-chips__label">Fields used:</span>
        {known.length === 0 && <span className="stage-chips__none">none yet</span>}
        {known.map((field) => (
          <span key={field.token} className="stage-chip">
            {field.label}
          </span>
        ))}
      </div>

      {/*
        An unknown token does NOT block saving — refusing someone's work over a
        typo is worse than showing them the typo. But it is said out loud, because
        the alternative is a candidate reading "{{candidate.naem}}".
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
        onClick={() => setPreviewing((open) => !open)}
      >
        <Eye size={14} aria-hidden="true" />
        {previewing ? "Hide preview" : "Preview with sample data"}
      </button>

      {previewing && (
        <div className="stage-preview">
          <p className="stage-preview__label">Preview — sample values, not real candidates</p>
          <pre className="stage-preview__body">
            {renderPreview(value, fields) || "Nothing to preview yet."}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Inserts at the caret and puts the caret back after the token.
 *
 * Returning only the new string leaves the caret at position 0 after every
 * insert, which makes inserting a second field maddening — the reason
 * insertToken() returns a caret position at all.
 */
function insertAtCaret({
  textareaRef,
  text,
  token,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  token: string;
  onChange: (next: string) => void;
}) {
  const element = textareaRef.current;
  const start = element?.selectionStart ?? text.length;
  const end = element?.selectionEnd ?? text.length;

  const { text: next, caret } = insertToken({
    text,
    token,
    selectionStart: start,
    selectionEnd: end,
  });

  onChange(next);

  // After React repaints, or the caret lands wherever the browser left it.
  requestAnimationFrame(() => {
    element?.focus();
    element?.setSelectionRange(caret, caret);
  });
}
