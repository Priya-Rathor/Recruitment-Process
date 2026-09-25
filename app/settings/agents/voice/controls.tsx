"use client";

// =============================================================================
// The four small controls this console needs and the product did not already
// have: a labelled slider, a catalogue-backed <select>, a toggle ROW, and a
// number field with a unit.
//
// They live here rather than in components/ui/ on purpose. Every one of them is
// a thin arrangement of things that already exist — the shared Toggle, the shared
// Field, the stylesheet's own .input — and promoting a first-use-only layout into
// the global design system is how a component library fills up with one-caller
// components. If a second screen needs the slider, that is the moment to move it.
//
// The one thing NOT reinvented here is the switch. Every boolean on this page
// renders components/ui/Toggle — the same pill-style control the Job Hiring
// Stages screens use — because the console's spec is explicit: "do not introduce
// a different toggle style".
// =============================================================================

import type { ReactNode } from "react";
import { Toggle } from "@/components/ui/Toggle";
import type { CatalogOption } from "@/lib/voice/catalog";

/**
 * A boolean, as a row: label and explanation on the left, switch on the right.
 *
 * The label is a real <label>-equivalent via aria-labelledby rather than a bare
 * string, so a screen reader announces "Allow interruption, switch, on" instead
 * of an unnamed switch.
 */
export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Revealed only when the toggle is on — a sensitivity slider, a number. */
  children?: ReactNode;
}) {
  return (
    <div className="vac-toggle-row">
      <div className="vac-toggle-row__head">
        <div className="vac-toggle-row__text">
          <p className="vac-toggle-row__label" id={`${id}-label`}>
            {label}
          </p>
          {hint && <p className="vac-toggle-row__hint">{hint}</p>}
        </div>
        <Toggle id={id} checked={checked} onChange={onChange} labelledBy={`${id}-label`} disabled={disabled} />
      </div>

      {/* Dependent controls are hidden when the parent is off, not just disabled:
          an interruption sensitivity that does nothing is noise on the page. */}
      {checked && children && <div className="vac-toggle-row__body">{children}</div>}
    </div>
  );
}

/**
 * A slider with a numeric readout.
 *
 * The readout is not decoration. A slider alone communicates "somewhere in the
 * middle", and temperature is a value people compare between agents and talk
 * about in tickets — so the number is always visible, and it is the same number
 * that gets saved.
 */
export function Slider({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  /** Renders the readout. Defaults to the raw number. */
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className="vac-slider">
      <div className="vac-slider__head">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <output className="vac-slider__value" htmlFor={id}>
          {format ? format(value) : value}
        </output>
      </div>
      {hint && <p className="stage-field__help">{hint}</p>}
      <input
        id={id}
        className="vac-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** A number input with its unit spelled out beside it. */
export function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="vac-number">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint && <p className="stage-field__help">{hint}</p>}
      <div className="vac-number__row">
        <input
          id={id}
          className="input"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            // NaN from an emptied field would propagate into state and render as
            // a blank that saves as the default — clamped here instead.
            onChange(Number.isFinite(next) ? next : min);
          }}
        />
        <span className="vac-number__unit">{unit}</span>
      </div>
    </div>
  );
}

/**
 * A dropdown whose options came from the backend catalogue.
 *
 * THREE STATES, and the difference between them is the point:
 *
 *   options present        — a normal select
 *   options empty          — disabled, and it SAYS the list could not be loaded
 *   a saved key not in the
 *   list                   — the saved selection is shown as itself, not
 *                            silently replaced by the first option
 *
 * The third case is the one that matters. A select whose value is not among its
 * options renders as the first option in every browser, so an admin whose voice
 * was retired upstream would see a different voice sitting there looking saved —
 * and the next Save would write it. An explicit "saved selection" option keeps the
 * stored value visible and intact.
 */
export function CatalogSelect({
  id,
  label,
  hint,
  options,
  value,
  onChange,
  degraded,
  placeholder = "Platform default",
}: {
  id: string;
  label: string;
  hint?: string;
  options: CatalogOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  degraded: boolean;
  placeholder?: string;
}) {
  const known = value !== null && options.some((option) => option.key === value);
  const orphaned = value !== null && !known;

  return (
    <div className="vac-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {hint && <p className="stage-field__help">{hint}</p>}

      <div className="select is-fullwidth">
        <select
          id={id}
          value={value ?? ""}
          disabled={options.length === 0 && !orphaned}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{placeholder}</option>

          {orphaned && (
            <option value={value}>Saved selection (no longer listed)</option>
          )}

          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.language ? `${option.label} — ${option.language}` : option.label}
            </option>
          ))}
        </select>
      </div>

      {options.length === 0 && (
        <p className="stage-warning">
          {degraded
            ? "This list couldn't be loaded right now. Your saved selection is unchanged."
            : "No options are available for this yet."}
        </p>
      )}

      {orphaned && options.length > 0 && (
        <p className="stage-warning">
          The saved selection isn&apos;t in the current list. Pick a new one, or leave it — it is
          kept exactly as saved until you change it.
        </p>
      )}
    </div>
  );
}
