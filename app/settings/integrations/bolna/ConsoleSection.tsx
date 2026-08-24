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
  /** Rendered in the header, right-aligned — a count, a chip, a warning. */
  aside,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} className="card vac-section">
      <div className="vac-section__head">
        <h2 className="vac-section__title">
          <button
            type="button"
            className="vac-section__toggle"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((previous) => !previous)}
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
