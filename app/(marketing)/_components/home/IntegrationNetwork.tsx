"use client";

// =============================================================================
// THE INTEGRATION NETWORK — Scoreboad at the centre, five verified spokes.
//
// -----------------------------------------------------------------------------
// WHY THIS ONE IS NOT A STICKY SCROLL STORY
// -----------------------------------------------------------------------------
//
// §11 asks for 180-240vh of sticky scroll. This page already carries five such
// tracks totalling roughly 1060vh, and the thing being built here is five
// lines — a beat and a half of content stretched over two screens of scrolling.
//
// So the network BUILDS ON ENTRY instead: the section's <Reveal> adds
// `.is-shown`, and the stylesheet draws each connection in turn off a
// per-index delay. That satisfies what §12 actually asks for — a graph that
// assembles rather than appearing at once — using the primitive the site
// already has, and without adding a sixth scroll track to a page that cannot
// afford one.
//
// The selection behaviour is where the reader's time goes instead, which is
// also the right trade: a network's interesting question is "what is that one
// for?", and that is a click, not a scroll position.
//
// -----------------------------------------------------------------------------
// THE GEOMETRY
// -----------------------------------------------------------------------------
//
// A 3x3 grid holds the centre and five nodes. One SVG lies over it with
// `preserveAspectRatio="none"` and a 0-100 viewBox, so its coordinates map
// linearly onto the grid's box and a line drawn to (16.7, 50) lands on the
// left-middle cell at any width. No measurement, no resize observer, and the
// lines cannot drift out of step with the nodes because both are positioned by
// the same box.
// =============================================================================

import { useState } from "react";
import { INTEGRATIONS } from "@/lib/marketing/home";
import { Logo } from "@/components/Logo";
import { iconFor } from "./icons";

/**
 * Where each cell's centre sits in the SVG's 0-100 space.
 *
 * Matches the 3x3 grid's track centres. The gap shifts these by a fraction of
 * a percent, which is invisible because every line ends underneath a node card
 * rather than at its edge.
 */
const CELL_POINT: Record<string, [number, number]> = {
  top: [50, 15],
  left: [15, 50],
  right: [85, 50],
  "bottom-left": [26, 86],
  "bottom-right": [74, 86],
};

export function IntegrationNetwork() {
  const [open, setOpen] = useState<string | null>(null);
  const selected = INTEGRATIONS.find((item) => item.key === open) ?? null;

  return (
    <div className="ig">
      <div className="ig-net">
        {/*
          The connections. `aria-hidden` because a line is not readable — every
          relationship it draws is stated in text in the node's own detail
          panel, which is what §28 asks for.
        */}
        <svg
          className="ig-net__wires"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {INTEGRATIONS.map((item, index) => {
            const [x, y] = CELL_POINT[item.cell];
            return (
              <line
                key={item.key}
                className="ig-wire"
                x1="50"
                y1="50"
                x2={x}
                y2={y}
                data-live={open === item.key}
                // The build: each line draws in turn once the section lands.
                style={{ transitionDelay: `${180 + index * 130}ms` }}
              />
            );
          })}
        </svg>

        {/* ---- The centre ------------------------------------------------ */}
        <div className="ig-hub">
          {/*
            The mark, and the only place it appears between the navbar and the
            footer apart from the candidate workspace's panel header. It is
            here because the section's whole claim is that this product sits in
            the middle — a word would not say it as directly.
          */}
          <span className="ig-hub__mark" aria-hidden="true">
            <Logo variant="mark" height={34} />
          </span>
          <span className="ig-hub__name">Scoreboad</span>
          <span className="ig-hub__sub">One hiring workspace</span>
        </div>

        {/* ---- The nodes -------------------------------------------------- */}
        {INTEGRATIONS.map((item, index) => {
          const Icon = iconFor(item.icon);
          const isOpen = open === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className="ig-node"
              data-cell={item.cell}
              data-open={isOpen}
              aria-expanded={isOpen}
              aria-controls="ig-detail"
              // The node's own name plus what it does, so a screen reader gets
              // the relationship the line is drawing without the line.
              aria-label={`${item.label} — ${item.description} Show details.`}
              style={{ transitionDelay: `${220 + index * 130}ms` }}
              onClick={() => setOpen((current) => (current === item.key ? null : item.key))}
            >
              <span className="ig-node__icon" aria-hidden="true">
                <Icon size={17} strokeWidth={1.6} />
              </span>
              <span className="ig-node__text">
                <strong>{item.label}</strong>
                <span>{item.category}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/*
        ---- The detail panel ---------------------------------------------

        ONE panel below the network rather than a popover beside each node:
        it works identically under a tap on a phone and a click on a desktop,
        and it never covers the graph it is describing.

        Always in the DOM so `aria-controls` resolves; it shows a default
        summary when nothing is selected rather than collapsing, which keeps
        the section's height stable and gives a reader who never clicks
        something to read.
      */}
      <div className="ig-detail" id="ig-detail" aria-live="polite">
        {selected ? (
          <>
            <p className="ig-detail__head">
              <strong>{selected.label}</strong>
              <span className="ig-detail__chip">{selected.connect}</span>
            </p>
            <p className="ig-detail__desc">{selected.description}</p>

            <p className="ig-detail__label">Disconnect it and this stops</p>
            <ul className="ig-detail__impact">
              {selected.impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="ig-detail__head">
              <strong>Five connections</strong>
              <span className="ig-detail__chip">All off by default</span>
            </p>
            <p className="ig-detail__desc">
              Pick one to see what it does and, more usefully, what stops working
              if you turn it off.
            </p>
            {/*
              THE LIST IS THE ACCESSIBLE EQUIVALENT OF THE DIAGRAM. Every node
              and its category, as text, so the network's content survives
              without the lines, without colour and without a pointer.
            */}
            <ul className="ig-detail__impact">
              {INTEGRATIONS.map((item) => (
                <li key={item.key}>
                  {item.label} — {item.description}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
