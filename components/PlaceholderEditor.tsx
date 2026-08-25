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
  /** Where the last chip-click landed, so repeat clicks walk occurrences. */
  const lastMatchRef = useRef<{ token: string; index: number }>({ token: "", index: -1 });

  /**
   * Selects a token's next occurrence in the textarea.
   *
   * Matched with the SAME pattern the renderer uses, so a token written by hand
   * with inner spaces — `{{ job.title }}` — is found exactly as it would be
   * substituted. A second finder with a stricter pattern would fail to find
   * tokens that do resolve, which is worse than not offering this at all.
   */
  function selectToken(token: string) {
    const element = textareaRef.current;
    if (!element) return;

    const pattern = new RegExp(`\\{\\{\\s*${token.replace(".", "\\.")}\\s*\\}\\}`, "gi");
    const matches = [...value.matchAll(pattern)];
    if (matches.length === 0) return;

    const previous = lastMatchRef.current;
    const next =
      previous.token === token ? (previous.index + 1) % matches.length : 0;
    lastMatchRef.current = { token, index: next };

    const match = matches[next];
    const start = match.index ?? 0;

    element.focus();
    element.setSelectionRange(start, start + match[0].length);

    /*
      Scroll the selection into view.

      A textarea does not do this on setSelectionRange alone when the match is
      below the fold. Approximating the line from the newlines before the match is
      cruder than measuring, and it is enough: it puts the right line on screen,
      which is all the click promised.
      */
    const linesBefore = value.slice(0, start).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20;
    element.scrollTop = Math.max(0, (linesBefore - 2) * lineHeight);
  }

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
          {/*
            Outline, not Bulma's unmodified `.button` — which this theme paints
            near-black, making the least important control on the field the
            heaviest thing near it.

            THIS COMPONENT IS SHARED. The change lands on all three callers at
            once — the Job Hiring Stages prompt editors, the message template
            editor and the Voice Agent Console — which is the point: one control,
            one appearance, rather than three pages fixed one at a time.
          */}
          <button
            type="button"
            className="button is-small is-outlined-primary"
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
        {/*
          CLICK A CHIP TO FIND ITS TOKEN.

          A textarea holds text, not markup, so a token cannot be highlighted
          where it sits. What a textarea CAN do is select a range — so clicking a
          chip focuses the field and selects that token, which the browser paints
          in the selection colour and scrolls into view. That is the nearest
          honest thing to "highlight it", and it costs no new dependency.

          Repeated tokens cycle: clicking again finds the NEXT occurrence and wraps
          at the end, because a message that says {{candidate.name}} twice is
          exactly the case where hunting by eye is hardest.
        */}
        {known.map((field) => (
          <button
            key={field.token}
            type="button"
            className="stage-chip stage-chip--clickable"
            title={`Find {{${field.token}}} in the text`}
            onClick={() => selectToken(field.token)}
          >
            {field.label}
          </button>
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
