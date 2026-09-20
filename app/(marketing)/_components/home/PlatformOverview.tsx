"use client";

// =============================================================================
// THE PLATFORM SHOWCASE — six real screens, one frame.
//
// WHAT THIS REPLACED, AND WHY. This band used to be six cards, each an icon, a
// heading and a paragraph. That grid said what the product covers and showed
// nothing, which is the one thing a product-led section must not do. The same
// six capabilities are now six views of ONE product frame, and their copy
// survives as the caption under the tabs.
//
// ONE FRAME, NOT SIX DASHBOARDS. The chrome, the sidebar and the surface are
// the same in every state — only the panel's contents change, and the sidebar's
// active item moves to match. That is the argument the section is making: these
// are views of one workspace, not six products in a trench coat. Six separate
// mocks would have quietly said the opposite.
//
// THE FRAME IS THE HERO'S FRAME. `.mkt-product__*` is the same stylesheet the
// dashboard under the hero uses, so the two product shots on this page are
// recognisably the same application rather than two illustrations of it.
//
// A CLIENT COMPONENT, and only for the tab state. No data fetching, no session,
// no effects — the content is a static module import, so nothing about a real
// organization can reach this file even by accident.
//
// THE TABS ARE REAL ARIA TABS. `role="tablist"` / `role="tab"` / `role="tabpanel"`,
// roving tabindex, arrow keys, Home and End. The alternative — six buttons and
// a div — looks identical and tells a screen reader nothing about which of the
// six is showing.
// =============================================================================

import { useRef, useState } from "react";
import { DASHBOARD, PLATFORM_HEAD, PLATFORM_VIEWS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal } from "@/components/marketing/Reveal";

export function PlatformOverview() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const view = PLATFORM_VIEWS[active];

  /**
   * Arrow-key navigation, with AUTOMATIC activation.
   *
   * Focus and selection move together, which is the ARIA pattern's
   * recommendation when showing a panel is cheap — and here it is a re-render
   * of sixteen spans. Manual activation (arrow to move, Enter to select) would
   * make a keyboard user press twice to do what a mouse user does once, for no
   * benefit.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = PLATFORM_VIEWS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (event.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;

    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Section tone="light" id="platform">
      <SectionHeading
        eyebrow={PLATFORM_HEAD.eyebrow}
        title={PLATFORM_HEAD.title}
        lead={PLATFORM_HEAD.lead}
      />

      <Reveal className="mkt-showcase">
        {/*
          SCROLLS SIDEWAYS ON A PHONE RATHER THAN WRAPPING TO THREE ROWS.
          The scroll is contained here — the container clips, the page does not
          — which is the only form of horizontal scrolling this section is
          allowed to have.
        */}
        <div className="mkt-showcase__tabscroll">
          <div
            role="tablist"
            aria-label="Scoreboad platform capabilities"
            className="mkt-showcase__tabs"
            onKeyDown={onKeyDown}
          >
            {PLATFORM_VIEWS.map((item, index) => (
              <button
                key={item.key}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`platform-tab-${item.key}`}
                aria-selected={index === active}
                aria-controls={`platform-panel-${item.key}`}
                // Roving tabindex: one stop for the whole group, then arrows.
                // Six tab stops for six tabs is what makes a tablist tedious.
                tabIndex={index === active ? 0 : -1}
                className="mkt-showcase__tab"
                onClick={() => setActive(index)}
              >
                <span className="mkt-showcase__tabnum" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.tab}
              </button>
            ))}
          </div>
        </div>

        <p className="mkt-showcase__caption">{view.caption}</p>

        <div className="mkt-showcase__panel">
          <figure className="mkt-product mkt-product--onlight">
            <div className="mkt-product__halo" aria-hidden="true" />

            <div className="mkt-product__frame">
              <div className="mkt-product__bar" aria-hidden="true">
                <span className="mkt-product__dot" />
                <span className="mkt-product__dot" />
                <span className="mkt-product__dot" />
              </div>

              <div className="mkt-product__body">
                {/*
                  The real application's top-level nav, in the real order, with
                  the item for the selected capability active. Screening and
                  evaluation both light up Applications, because that is where
                  both of them live.
                */}
                <nav className="mkt-product__side" aria-hidden="true">
                  {DASHBOARD.nav.map((item) => (
                    <span
                      key={item}
                      className={`mkt-product__navitem${item === view.nav ? " is-active" : ""}`}
                    >
                      <span className="mkt-product__navdot" />
                      {item}
                    </span>
                  ))}
                </nav>

                <div className="mkt-product__main">
                  {/*
                    ALL SIX PANELS ARE IN THE DOM, five of them `hidden`.

                    The first version rendered only the selected one, which
                    left `aria-controls` on the other five tabs pointing at
                    element ids that did not exist — a dangling IDREF, which is
                    an invalid ARIA reference and exactly the kind of thing
                    that passes a visual review.

                    This is NOT the "six separate dashboards" the brief rules
                    out: the chrome, the sidebar and the frame are still single,
                    and what is duplicated is four rows of text six times. The
                    `hidden` attribute takes the inactive ones out of the tab
                    order and the accessibility tree at no layout cost.
                  */}
                  {PLATFORM_VIEWS.map((item, index) => (
                    <div
                      key={item.key}
                      role="tabpanel"
                      id={`platform-panel-${item.key}`}
                      aria-labelledby={`platform-tab-${item.key}`}
                      // Focusable, because the panel is what the tabs control
                      // and a keyboard user must be able to Tab into what they
                      // just selected. `hidden` keeps the other five out.
                      tabIndex={0}
                      hidden={index !== active}
                      className="mkt-showcase__view"
                    >
                      <div className="mkt-product__head">
                        <h3>{item.panel.title}</h3>
                        <span className="mkt-product__range">{item.panel.meta}</span>
                      </div>

                      <div className="mkt-showcase__cols" aria-hidden="true">
                        {item.panel.columns.map((column) => (
                          <span key={column}>{column}</span>
                        ))}
                      </div>

                      <ul className="mkt-showcase__rows">
                        {item.panel.rows.map((row) => (
                          <li key={row.primary} className="mkt-showcase__row">
                            <span className="mkt-showcase__cell">
                              <strong>{row.primary}</strong>
                              {row.pct !== undefined && (
                                <span className="mkt-showcase__track" aria-hidden="true">
                                  <span
                                    className="mkt-showcase__bar"
                                    style={{ width: `${row.pct}%` }}
                                  />
                                </span>
                              )}
                            </span>
                            <span className="mkt-showcase__sub">{row.secondary}</span>
                            {/*
                              The status cell is tinted, and the tint is never
                              the only signal — the word itself says "Needs
                              attention" or "3 overdue". Same rule the real
                              tiles follow.
                            */}
                            <span className="mkt-showcase__meta" data-tone={row.tone}>
                              {row.meta}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <figcaption className="mkt-product__caption">
              Example data, shown to illustrate the interface.
            </figcaption>
          </figure>
        </div>
      </Reveal>
    </Section>
  );
}
