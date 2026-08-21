"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CAPABILITY_GROUPS } from "@/lib/marketing/content";

/**
 * The tabbed capability explorer — the page's main content surface.
 *
 * WHY A TAB LIST RATHER THAN SIX STACKED SECTIONS. Six capability groups, each
 * with a heading, a paragraph and three capability lines, is roughly four
 * screens of scrolling if they are stacked. Almost nobody reads the fourth
 * screen. A tab strip puts all six in view at once and lets a visitor jump to
 * the one they came for, which is also the one they will judge the product on.
 *
 * WHY IT IS THE ONLY CLIENT COMPONENT ON THE PAGE. Everything else here is
 * static server-rendered markup. This needs state, so it is a small island —
 * the tab strip and one panel — rather than a reason to make the page client.
 *
 * ACCESSIBILITY. This follows the ARIA tabs pattern properly, which matters
 * because a hand-rolled tab strip is one of the most commonly broken widgets on
 * marketing sites:
 *
 *   - the strip is role="tablist", each button role="tab" with aria-selected
 *   - each tab owns its panel via aria-controls, and the panel points back
 *     with aria-labelledby
 *   - only the SELECTED tab is in the tab order (tabIndex 0 vs -1), so Tab
 *     moves past the whole strip in one press instead of six
 *   - arrow keys move between tabs, which is what a screen reader user expects
 *     once they are on a tablist, and Home/End jump to the ends
 *   - the panel is NOT focusable and NOT aria-live: it is reached by tabbing
 *     forward from the selected tab, and announcing it on every arrow press
 *     would talk over someone simply scanning the tab labels
 */
export function FeatureExplorer() {
  const [activeSlug, setActiveSlug] = useState(CAPABILITY_GROUPS[0].slug);
  // A stable id prefix, so two explorers on one page could never collide.
  const baseId = useId();

  const activeIndex = CAPABILITY_GROUPS.findIndex((g) => g.slug === activeSlug);
  const group = CAPABILITY_GROUPS[activeIndex] ?? CAPABILITY_GROUPS[0];

  const tabId = (slug: string) => `${baseId}-tab-${slug}`;
  const panelId = (slug: string) => `${baseId}-panel-${slug}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = CAPABILITY_GROUPS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight") next = activeIndex >= last ? 0 : activeIndex + 1;
    else if (event.key === "ArrowLeft") next = activeIndex <= 0 ? last : activeIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;

    if (next === null) return;

    // The arrow keys would otherwise also scroll the page horizontally.
    event.preventDefault();
    const slug = CAPABILITY_GROUPS[next].slug;
    setActiveSlug(slug);
    // Focus follows selection in this pattern, so the newly selected tab must
    // actually receive focus — otherwise the next arrow press goes nowhere.
    document.getElementById(tabId(slug))?.focus();
  }

  return (
    <>
      <div className="mkt-tabs" role="tablist" aria-label="Capabilities" onKeyDown={onKeyDown}>
        {CAPABILITY_GROUPS.map((g) => {
          const selected = g.slug === activeSlug;
          return (
            <button
              key={g.slug}
              id={tabId(g.slug)}
              type="button"
              role="tab"
              className="mkt-tab"
              aria-selected={selected}
              aria-controls={panelId(g.slug)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveSlug(g.slug)}
            >
              {g.tab}
            </button>
          );
        })}
      </div>

      <div
        className="mkt-panel"
        id={panelId(group.slug)}
        role="tabpanel"
        aria-labelledby={tabId(group.slug)}
      >
        <div>
          <p className="mkt-eyebrow">{group.eyebrow}</p>
          <h3>{group.heading}</h3>
          <p className="mkt-panel__body">{group.summary}</p>
          <Link href={`/product/${group.slug}`} className="mkt-panel__link">
            Explore {group.tab.toLowerCase()}
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <ul className="mkt-caps">
          {group.capabilities.map((cap) => (
            <li key={cap.label} className="mkt-cap">
              <strong>{cap.label}</strong>
              <span>{cap.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
