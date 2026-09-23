"use client";

// =============================================================================
// WHO IT'S FOR — the same workspace, from four places.
//
// -----------------------------------------------------------------------------
// THE CENTRAL VISUAL IS THE PRODUCT'S OWN NAVIGATION
// -----------------------------------------------------------------------------
//
// One nav rail — the application's real top-level surfaces, in the real order —
// with the ones a given person actually opens lit and the rest dimmed. That is
// "the same product from different perspectives" said literally, with no
// diagram to invent and nothing to keep in step: switch persona and the same
// six items are still there, just differently weighted.
//
// The candidate's rail lights NOTHING, because a candidate never signs in. It
// is the most useful frame in the section and it required no design at all —
// only the discipline not to light something to avoid an awkward blank.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO SCROLL TRACK
// -----------------------------------------------------------------------------
//
// §7 asks for 180-260vh of sticky scroll. But §5 and §9 describe a SELECTOR —
// the reader picks a persona and the workspace answers — and scroll-as-
// transport would fight that: choose "Hiring managers", scroll one pixel, and
// a scroll-driven beat would overrule the choice. That is the same collision
// the candidate workspace section was built to avoid.
//
// So the reader drives it, and the section costs the page no extra height. It
// is the fourth time this trade has been made deliberately; the page already
// carries six scroll tracks.
//
// -----------------------------------------------------------------------------
// REAL TABS
// -----------------------------------------------------------------------------
//
// role="tablist" / "tab" / "tabpanel", roving tabindex, arrow keys, Home and
// End, and all four panels in the DOM so `aria-controls` resolves and a
// crawler gets every perspective rather than the first.
// =============================================================================

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DASHBOARD, PERSONA_VIEWS } from "@/lib/marketing/home";
import { ROLE_FLOWS } from "@/lib/marketing/content";

/**
 * The persona's own words, from ROLE_FLOWS.
 *
 * Read rather than copied, so this section, /how-it-works and the navbar's
 * "Who It's For" menu cannot disagree about who the product is for.
 */
function flowFor(anchor: string) {
  const flow = ROLE_FLOWS.find((item) => item.anchor === anchor);
  if (!flow) throw new Error(`No ROLE_FLOWS entry for "${anchor}"`);
  return flow;
}

export function PersonaSwitch() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = PERSONA_VIEWS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = active === last ? 0 : active + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = active === 0 ? last : active - 1;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;

    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const view = PERSONA_VIEWS[active];

  return (
    <div className="pv">
      {/* ---- The selector ------------------------------------------------ */}
      <div className="pv__tabscroll">
        <div
          role="tablist"
          aria-label="Choose a hiring perspective"
          className="pv-tabs"
          onKeyDown={onKeyDown}
        >
          {PERSONA_VIEWS.map((item, index) => (
            <button
              key={item.anchor}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`pv-tab-${item.anchor}`}
              aria-selected={index === active}
              aria-controls={`pv-panel-${item.anchor}`}
              tabIndex={index === active ? 0 : -1}
              className="pv-tab"
              onClick={() => setActive(index)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>

      <div className="pv__grid">
        {/* ---- The workspace, seen from here --------------------------- */}
        <div className="pv-rail" aria-hidden="true">
          <p className="pv-rail__head">The workspace</p>

          <ul className="pv-rail__items">
            {DASHBOARD.nav.map((item) => (
              <li
                key={item}
                className="pv-rail__item"
                data-on={view.surfaces.includes(item)}
              >
                <span className="pv-rail__dot" />
                {item}
              </li>
            ))}
          </ul>

          {/*
            The candidate's frame. Lighting nothing needs saying, or it reads
            as a rendering failure rather than as the point.

            RENDERED ALWAYS, shown only when the rail is empty. Gating the JSX
            instead kept the line out of the crawlable HTML until somebody
            selected that tab — the same mistake the screening-call section
            made with its correction line. The persona's full note is in its
            panel either way; this is the rail's one-line version of it.
          */}
          <p className="pv-rail__none" hidden={view.surfaces.length > 0}>
            None of it. They never sign in.
          </p>
        </div>

        {/* ---- The panels ---------------------------------------------- */}
        {PERSONA_VIEWS.map((item, index) => {
          const flow = flowFor(item.anchor);
          return (
            <div
              key={item.anchor}
              role="tabpanel"
              id={`pv-panel-${item.anchor}`}
              aria-labelledby={`pv-tab-${item.anchor}`}
              tabIndex={0}
              hidden={index !== active}
              className="pv-panel"
            >
              {/*
                The H3 per persona, which is also §14's heading structure. The
                role name comes from ROLE_FLOWS, so the heading and the navbar
                menu item describe the same person.
              */}
              <h3 className="pv-panel__title">{flow.role}</h3>
              <p className="pv-panel__summary">{flow.summary}</p>

              <ol className="pv-steps">
                {flow.steps.map((step) => (
                  <li key={step} className="pv-steps__item">
                    {step}
                  </li>
                ))}
              </ol>

              <p className="pv-panel__note">{item.note}</p>

              <ul className="pv-links">
                {item.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="pv-link">
                      {link.label}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
