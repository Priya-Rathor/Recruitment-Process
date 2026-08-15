"use client";

// =============================================================================
// Toggle switch — the reusable "dongle".
//
// The spec asks for this exact control anywhere a boolean setting wants a
// switch instead of a checkbox, so it lives in components/ui/ rather than
// beside the one screen that needed it first.
//
// IT IS A REAL <button role="switch">, NOT A STYLED DIV. A div with an onClick
// is invisible to a screen reader, unreachable by keyboard, and does not
// announce its state — and this control's entire job is to communicate a state.
// `aria-checked` is what makes "on" audible; the visual slide is the same fact
// for people who can see it.
//
// Track 40x22, thumb slides 18px, 150ms — the spec's dimensions, kept in the
// stylesheet next to the other control tokens rather than inline here.
// =============================================================================

export function Toggle({
  checked,
  onChange,
  disabled = false,
  /** Required: a switch with no label is a mystery to anyone not looking at it. */
  label,
  /** Ties the switch to visible text, when that text is rendered elsewhere. */
  labelledBy,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`toggle${checked ? " is-on" : ""}`}
    >
      <span className="toggle__thumb" aria-hidden="true" />
    </button>
  );
}
