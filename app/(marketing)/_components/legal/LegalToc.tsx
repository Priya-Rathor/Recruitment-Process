"use client";

// =============================================================================
// THE LEGAL DOCUMENT'S TABLE OF CONTENTS.
//
// A STICKY RAIL ON DESKTOP, A COLLAPSED DISCLOSURE ON A PHONE — and the `open`
// attribute is driven by the media query rather than hardcoded, for the reason
// Module 23's footer established: forcing a closed <details> open with CSS is
// engine-dependent (older browsers hide the content with a UA `display: none`,
// newer ones with `content-visibility` on `::details-content`), so it breaks
// differently in each.
//
// THIRTEEN SECTION LINKS OPEN BY DEFAULT ON A PHONE is precisely the
// "navigation wall" §18 rules out — the reader would scroll past the whole
// contents before reaching the first line of the document.
//
// THE SERVER SNAPSHOT IS `true`. The HTML ships with every link present and
// visible, so a crawler and anyone without JavaScript gets the full contents;
// collapsing on a narrow screen is the enhancement, never the baseline.
//
// This is the only client component on a legal page. Everything else — the
// document, its tables, its notes — is server-rendered markup.
// =============================================================================

import { useCallback, useSyncExternalStore } from "react";
import type { LegalSection } from "@/lib/marketing/legal";

/** Matches the stylesheet's legal-page breakpoint. Keep the two in step. */
const DESKTOP = "(min-width: 900px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function LegalToc({ sections }: { sections: LegalSection[] }) {
  const getSnapshot = useCallback(() => window.matchMedia(DESKTOP).matches, []);
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => true);

  return (
    <details className="lg-toc" open={isDesktop}>
      <summary className="lg-toc__head">
        <h2 className="lg-toc__title">On this page</h2>
        <span className="lg-toc__mark" aria-hidden="true" />
      </summary>

      <nav aria-label="Sections of this document">
        <ol className="lg-toc__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}
