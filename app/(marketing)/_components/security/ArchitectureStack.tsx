"use client";

// =============================================================================
// THE SECURITY ARCHITECTURE — the one sticky section on this page.
//
// §26 is explicit that not every section should be sticky and that the
// architecture visual is where it earns its place. It does, for a reason
// specific to this diagram: it is eight layers deep, each with a paragraph, and
// the thing a reader needs to hold is WHERE IN THE STACK they currently are.
// A plain list makes that position invisible the moment the heading scrolls
// off; pinning the stack keeps the whole shape on screen while the explanation
// beside it changes.
//
// SAME MACHINERY AS THE HOMEPAGE'S SIX STORIES — a track, a sticky viewport,
// one sentinel per step and a single IntersectionObserver reading the
// viewport's middle line (`rootMargin: -50% 0 -50%` reduces the root to that
// line, so exactly one sentinel is intersecting at a time). There is no scroll
// handler here and there is not one anywhere else in this codebase either.
//
// EVERY STEP'S TEXT IS ALWAYS IN THE DOM, inactive ones `hidden`. A crawler
// gets all eight explanations rather than the first, `hidden` keeps them out of
// the accessibility tree and the tab order, and switching an attribute does not
// remount eight paragraphs per scroll beat. Below the sticky breakpoint the
// stylesheet simply shows them all at once, which is also what happens when
// JavaScript never runs.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { SECURITY_ARCHITECTURE } from "@/lib/marketing/security";

const STEP_COUNT = SECURITY_ARCHITECTURE.length;

export function ArchitectureStack() {
  const [step, setStep] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const marks = Array.from(track.querySelectorAll<HTMLElement>("[data-mark]"));
    if (marks.length === 0) return;

    /*
      No IntersectionObserver — an old browser or a test environment — means
      land on the last step rather than the first. The final frame is the
      complete diagram; the first is the one that looks unfinished.
    */
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setStep(STEP_COUNT - 1), 0);
      return () => clearTimeout(t);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.mark);
          if (Number.isInteger(index)) setStep(index);
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
    );

    for (const mark of marks) observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sec-arch" ref={trackRef}>
      <div className="sec-arch__runway" aria-hidden="true">
        {SECURITY_ARCHITECTURE.map((item, index) => (
          <span key={item.key} className="sec-arch__mark" data-mark={index} />
        ))}
      </div>

      <div className="sec-arch__pin">
        <div className="sec-arch__grid">
          {/* ---- The stack ------------------------------------------------ */}
          <ol className="sec-stack">
            {SECURITY_ARCHITECTURE.map((item, index) => (
              <li
                key={item.key}
                className="sec-stack__row"
                data-layer={item.layer}
                data-state={index === step ? "on" : index < step ? "done" : "off"}
                aria-current={index === step ? "step" : undefined}
              >
                <span className="sec-stack__label">{item.label}</span>
                {/*
                  The layer is named in words beside every row, not shown only
                  as a tint. Which of four layers performs a step is the single
                  most useful thing in this diagram, and carrying it in colour
                  alone would lose it for anyone who cannot separate the two
                  blues — on the page whose subject is being precise.
                */}
                <span className="sec-stack__layer">{LAYER_LABEL[item.layer]}</span>
              </li>
            ))}
          </ol>

          {/* ---- The explanation for the current layer --------------------- */}
          <div className="sec-arch__copy">
            {SECURITY_ARCHITECTURE.map((item, index) => (
              <div key={item.key} className="sec-arch__panel" hidden={index !== step}>
                <h3 className="sec-arch__title">{item.label}</h3>
                <p className="sec-arch__detail">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The four layers, in the words the page uses for them elsewhere. */
const LAYER_LABEL: Record<string, string> = {
  edge: "Edge",
  server: "Server",
  database: "Database",
  human: "Person",
};
