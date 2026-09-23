"use client";

// =============================================================================
// SECURITY — the boundary, and four layers that hold it.
//
// -----------------------------------------------------------------------------
// THE SIGNATURE VISUAL IS A BOUNDARY, NOT A FLOW
// -----------------------------------------------------------------------------
//
// Two workspaces with a seam between them, and a request that crosses it
// getting "not found" rather than "forbidden" — because in this product an id
// belonging to another workspace returns 404, so nobody can use the difference
// between the two answers to work out which records exist.
//
// That is a SPATIAL fact, which is why this section is not a fifth scroll
// story. The AI section, the screening call and the automation graph are all
// flows — a fourth version of "watch a thing travel down a chain" would say
// nothing new, and §5's phases are that shape. A boundary wants to be seen at
// once, with the layers that hold it examined one at a time.
//
// So the reader drives it: four layers, four panels, no scroll track. Fifth
// deliberate instance of that trade; the page already carries six.
//
// -----------------------------------------------------------------------------
// WHAT IS SHOWN IS WHAT IS IMPLEMENTED
// -----------------------------------------------------------------------------
//
// docs/SECURITY.md labels every area IMPLEMENTED / PARTIAL / RISK / MISSING.
// Only the IMPLEMENTED ones appear — see the note above SECURITY_LAYERS. The
// diagram contains no policy SQL, no table names, no ids and no key material;
// it is the shape of the rule, not the rule.
// =============================================================================

import { useRef, useState } from "react";
import { SECURITY_CHAIN, SECURITY_LAYERS, SECURITY_RECORDS } from "@/lib/marketing/home";

export function SecurityArchitecture() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = SECURITY_LAYERS.length - 1;
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

  const layer = SECURITY_LAYERS[active];

  return (
    <div className="sc">
      {/* ---- The boundary ----------------------------------------------- */}
      {/*
        `aria-hidden`: every relationship it draws is stated in the panels
        below, and a diagram of two boxes and a seam is not readable. The
        accessible version of this picture is the four layers' bullet points.
      */}
      <div className="sc-map" aria-hidden="true" data-layer={layer.key}>
        <div className="sc-map__side">
          <p className="sc-map__name">Your workspace</p>
          <ul className="sc-map__records">
            {SECURITY_RECORDS.map((record) => (
              <li key={record}>{record}</li>
            ))}
          </ul>
        </div>

        {/*
          The seam. A request arriving from another workspace gets the same
          answer as a request for something that does not exist — which is the
          whole point, and is why the label reads "not found" rather than
          "denied".
        */}
        <div className="sc-map__seam">
          <span className="sc-map__seamline" />
          <span className="sc-map__verdict">Not found</span>
          <span className="sc-map__seamnote">Never “forbidden”</span>
          <span className="sc-map__seamline" />
        </div>

        <div className="sc-map__side is-other">
          <p className="sc-map__name">Another workspace</p>
          <ul className="sc-map__records">
            {SECURITY_RECORDS.map((record) => (
              <li key={record}>{record}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* ---- The layers -------------------------------------------------- */}
      <div className="sc__tabscroll">
        <div
          role="tablist"
          aria-label="Security layers"
          className="sc-tabs"
          onKeyDown={onKeyDown}
        >
          {SECURITY_LAYERS.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`sc-tab-${item.key}`}
              aria-selected={index === active}
              aria-controls={`sc-panel-${item.key}`}
              tabIndex={index === active ? 0 : -1}
              className="sc-tab"
              onClick={() => setActive(index)}
            >
              <span className="sc-tab__num" aria-hidden="true">
                {item.num}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        All four panels in the DOM, three `hidden` — `aria-controls` resolves
        and a crawler gets every layer rather than the first.
      */}
      {SECURITY_LAYERS.map((item, index) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`sc-panel-${item.key}`}
          aria-labelledby={`sc-tab-${item.key}`}
          tabIndex={0}
          hidden={index !== active}
          className="sc-panel"
        >
          <h3 className="sc-panel__claim">{item.claim}</h3>
          <ul className="sc-panel__points">
            {item.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ))}

      {/* ---- The human-in-the-loop chain --------------------------------- */}
      {/*
        §9's most important moment, and the one constraint this whole site is
        built around: AI output is a structured result that is validated, shown
        beside what it came from, and acted on by a named person. The `by`
        badge carries the word, so "two of these four are not the model" does
        not depend on telling two tints apart.
      */}
      <div className="sc-chain">
        <p className="sc-chain__head">What happens to anything a model produces</p>
        <ol className="sc-chain__steps">
          {SECURITY_CHAIN.map((step) => (
            <li key={step.label} className="sc-step" data-by={step.by}>
              <span className="sc-step__by">
                {step.by === "ai" ? "AI" : step.by === "code" ? "Code" : "Person"}
              </span>
              <span className="sc-step__label">{step.label}</span>
              <span className="sc-step__note">{step.note}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
