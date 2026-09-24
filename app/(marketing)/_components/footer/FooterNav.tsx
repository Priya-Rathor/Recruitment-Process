"use client";

// =============================================================================
// THE FOOTER'S NAVIGATION COLUMNS.
//
// -----------------------------------------------------------------------------
// COLUMNS ON DESKTOP, ACCORDIONS ON A PHONE — FROM ONE SET OF MARKUP
// -----------------------------------------------------------------------------
//
// §8 asks for collapsible groups on mobile and rules out stacking the desktop
// footer into a wall. The tempting shortcuts are both wrong: rendering the
// links twice duplicates every href in the document, and forcing a closed
// <details> open with CSS is engine-dependent (older browsers hide the content
// with a UA `display: none`, newer ones with `content-visibility` on
// `::details-content`) — so it breaks differently in each.
//
// So the `open` attribute is driven by a media query, which is the thing
// actually being asked about. <details> stays the disclosure for the same
// reasons Module 22 chose it: Enter and Space, the expanded state exposed to
// assistive technology, and a real <summary> button rather than a clickable div.
//
// -----------------------------------------------------------------------------
// WHY useSyncExternalStore AND NOT AN EFFECT
// -----------------------------------------------------------------------------
//
// A media query IS an external store, and this is the API React provides for
// subscribing to one. Reading it in an effect and calling setState is the
// pattern `react-hooks/set-state-in-effect` exists to catch, and it also
// renders one frame with the wrong answer.
//
// THE SERVER SNAPSHOT IS `true` — open. That is deliberate: the HTML ships with
// every group expanded, so a crawler and anyone without JavaScript gets the
// whole footer. The collapse is the enhancement, not the baseline.
// =============================================================================

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { FOOTER_SECTIONS } from "@/lib/marketing/footer";

/** Matches the stylesheet's footer breakpoint. Keep the two in step. */
const DESKTOP = "(min-width: 900px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function FooterNav() {
  const getSnapshot = useCallback(() => window.matchMedia(DESKTOP).matches, []);
  // Server and first client paint agree on `true`, so hydration is clean; the
  // store correction happens after mount if this is a narrow viewport.
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => true);

  return (
    <div className="ft-nav">
      {FOOTER_SECTIONS.map((section) => (
        /*
          A <nav> PER COLUMN, each with its own accessible name, because §18
          asks for navigation regions and one unnamed <nav> wrapping four
          unrelated lists tells a screen-reader user nothing about which is
          which.
        */
        <nav key={section.title} aria-label={`${section.title} navigation`} className="ft-col">
          <details className="ft-group" open={isDesktop}>
            <summary className="ft-group__head">
              {/*
                The column title is an <h2>. The footer sits after the page's
                own content, so these are the last headings in the document and
                they belong at the level the page's sections use — the previous
                footer already made this choice and it is kept.
              */}
              <h2 className="ft-group__title">{section.title}</h2>
              <span className="ft-group__mark" aria-hidden="true" />
            </summary>

            <ul className="ft-group__links">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </details>
        </nav>
      ))}
    </div>
  );
}
