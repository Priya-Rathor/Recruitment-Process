"use client";

// =============================================================================
// One collapsible section of the console.
//
// INDEPENDENTLY EXPANDABLE, NOT AN ACCORDION. The spec is explicit that
// "multiple sections must be independently expandable at once (not a strict
// one-open-at-a-time accordion)", so each section owns its own open state and no
// parent coordinates them. That is also the honest behaviour for a page where
// someone is comparing the greeting against the closing message.
//
// The heading is a real <button aria-expanded> inside an <h2>, and the section
// carries the anchor id the nav row scrolls to. A <div onClick> would be
// unreachable by keyboard and silent to a screen reader — and this control's whole
// job is to say whether there is more content below it.
// =============================================================================

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ConsoleSection({
  id,
  title,
  description,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onToggle,
  /** Rendered in the header, right-aligned — a count, a chip, a warning. */
  aside,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /**
   * OPTIONALLY CONTROLLED.
   *
   * Every section manages its own open state — that is what makes them
   * independently expandable rather than an accordion, and it stays the default.
   *
   * The Test Agent section is the one exception: the page header's "Get call from
   * agent" button arms a confirmation that lives inside it, and a confirmation
   * behind a collapsed heading is a dialog nobody can see. So the console owns
   * that one section's state and passes it here.
   *
   * A controlled pair rather than a `forceOpen` flag: a flag has to be applied in
   * an effect, which is a render late and a setState-in-an-effect. This way the
   * parent's click handler opens the section in the same tick it arms the
   * confirmation, and the reader can still close it, because onToggle flips the
   * parent's state rather than fighting it.
   */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  aside?: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => {
    const next = !open;
    if (onToggle) onToggle(next);
    else setUncontrolledOpen(next);
  };

  return (
    <section id={id} className="card vac-section">
      <div className="vac-section__head">
        <h2 className="vac-section__title">
          <button
            type="button"
            className="vac-section__toggle"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={toggle}
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`vac-section__chevron${open ? " is-open" : ""}`}
            />
            {title}
          </button>
        </h2>
        {aside}
      </div>

      {description && <p className="vac-section__description">{description}</p>}

      {/*
        Unmounted rather than hidden with CSS when collapsed. These sections hold
        textareas and sliders; keeping thirty of them mounted behind
        `display: none` costs a measurable amount on a page this long, and nothing
        here needs to keep uncommitted DOM state — the form's values live in the
        console's state object, not in the inputs.
      */}
      {open && (
        <div id={`${id}-body`} className="vac-section__body">
          {children}
        </div>
      )}
    </section>
  );
}
