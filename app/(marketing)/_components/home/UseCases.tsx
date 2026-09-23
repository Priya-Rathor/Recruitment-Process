"use client";

// =============================================================================
// USE CASES — an index by problem.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS NOT
// -----------------------------------------------------------------------------
//
// Not customer stories: there are none. docs/modules/21-public-website.md says
// so outright, there is no CMS and no quotes file, and public/ holds three
// Scoreboad brand files and nothing else. §11's alternative applies.
//
// Not a fifth retelling either. The five scenarios map onto bands this page has
// already demonstrated at length — the AI band, the screening call, the
// candidate workspace, the pipeline board, the automation graph. Showing them
// again would be a recap of the page it sits in.
//
// -----------------------------------------------------------------------------
// WHAT IT IS
// -----------------------------------------------------------------------------
//
// The one thing none of those bands can do for itself: let a reader who
// skimmed say "that one is my problem" and go straight to the part that
// answers it. Each scenario carries a link INTO this page and a link OUT to
// the capability page — navigation by situation rather than by feature, which
// is what §16's internal-linking requirement is actually for.
//
// That also settles the composition. An index wants to be scanned, so it is
// reader-driven and costs the page no extra height; a sticky scroll story
// would be a seventh on a page that already carries six.
//
// The signature scattered-to-connected animation §6 asks for is already the
// challenge band near the top of this page, built beat for beat. Doing it a
// second time here would be the clearest duplication on the site. The visual
// is the scenario's own chain instead — different stages per scenario, which
// is the thing that actually differs between them.
// =============================================================================

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { USE_CASES } from "@/lib/marketing/home";

export function UseCases() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = USE_CASES.length - 1;
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

  return (
    <div className="uc">
      <div className="uc__tabscroll">
        <div
          role="tablist"
          aria-label="Hiring situations"
          className="uc-tabs"
          onKeyDown={onKeyDown}
        >
          {USE_CASES.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`uc-tab-${item.key}`}
              aria-selected={index === active}
              aria-controls={`uc-panel-${item.key}`}
              tabIndex={index === active ? 0 : -1}
              className="uc-tab"
              onClick={() => setActive(index)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>

      {/*
        All five panels in the DOM, four `hidden` — `aria-controls` resolves,
        and a crawler gets every scenario rather than the first. That matters
        more here than usual: these five H3s are the section's SEO surface.
      */}
      {USE_CASES.map((item, index) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`uc-panel-${item.key}`}
          aria-labelledby={`uc-tab-${item.key}`}
          tabIndex={0}
          hidden={index !== active}
          className="uc-panel"
        >
          <div className="uc-panel__head">
            <h3 className="uc-panel__title">{item.title}</h3>
            <p className="uc-panel__challenge">{item.challenge}</p>
          </div>

          {/*
            The scenario's chain. An <ol> because the order is the content, and
            the connectors are drawn by the items themselves so a chain of a
            different length needs no other change.
          */}
          <ol className="uc-chain">
            {item.chain.map((step) => (
              <li key={step} className="uc-chain__step">
                {step}
              </li>
            ))}
          </ol>

          <p className="uc-panel__outcome">
            <span className="uc-panel__outlabel">What you end up with</span>
            {item.outcome}
          </p>

          {/*
            THE INDEX'S POINT. One link down into the band on this page that
            demonstrates the scenario, one out to the capability page. Both
            carry descriptive text rather than "learn more", and the icons say
            which direction each goes.
          */}
          <p className="uc-links">
            <Link href={item.onPage.href} className="uc-link">
              <ArrowDown size={14} aria-hidden="true" />
              {item.onPage.label}
            </Link>
            <Link href={item.page.href} className="uc-link uc-link--out">
              {item.page.label}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </div>
      ))}
    </div>
  );
}
