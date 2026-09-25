"use client";

// =============================================================================
// RECRUITMENT AUTOMATION — one rule, building itself.
//
// -----------------------------------------------------------------------------
// THE GRAPH BUILDS, THE LOG FILLS
// -----------------------------------------------------------------------------
//
// Left: a vertical workflow graph whose nodes join as the beats advance, with
// a signal travelling the connector that is currently carrying the run. Right:
// the run's log, one line per thing that happened. Both are the same rule seen
// two ways — the shape of it, and the record of it — which is exactly how the
// product presents a rule and its runs.
//
// -----------------------------------------------------------------------------
// TWO AXES THAT DO NOT COLLIDE
// -----------------------------------------------------------------------------
//
// Scroll advances the RUN. Clicking a node opens its DETAIL, inline, below it.
// Independent state, so a click survives the next pixel of scroll — the same
// arrangement as the pipeline board's column focus, and for the same reason.
//
// Inline rather than in a side panel because §26 wants a tap on a phone to
// open the detail under the node, and one behaviour that works on both is
// better than two that each work on one.
//
// -----------------------------------------------------------------------------
// THE APPROVAL NODE IS STRUCTURAL
// -----------------------------------------------------------------------------
//
// It sits between the conditions and every action, because that is where the
// engine puts it: a rule marked `requires_approval` does not act at all, it
// proposes, and the whole run parks. Drawing the gate anywhere else — beside
// one action, or after them — would describe a different engine and would
// quietly imply the others run without it.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { FLOW_BEATS, FLOW_LOG, FLOW_NODES } from "@/lib/marketing/home";

const BEAT_COUNT = FLOW_BEATS.length;

/** The word shown on a node's chip. The kinds are the engine's own vocabulary. */
const KIND_LABEL: Record<string, string> = {
  trigger: "Trigger",
  condition: "Condition",
  approval: "Approval",
  wait: "Wait",
  action: "Action",
  // "Result", not "Candidate": this row is what the rule CHANGED, not a step
  // of it, and naming it like a step made it read as an eighth instruction.
  candidate: "Result",
};

export function AutomationStory() {
  const [beat, setBeat] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const marks = Array.from(track.querySelectorAll<HTMLElement>("[data-mark]"));
    if (marks.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setBeat(BEAT_COUNT - 1), 0);
      return () => clearTimeout(t);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.mark);
          if (Number.isInteger(index)) setBeat(index);
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
    );

    for (const mark of marks) observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  /* Cursor light. A style mutation, never state — see AiStory. */
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = stageRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const box = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${((event.clientX - box.left) / box.width) * 100}%`);
    node.style.setProperty("--my", `${((event.clientY - box.top) / box.height) * 100}%`);
  };

  return (
    <div className="fl" ref={trackRef}>
      <div className="fl__runway" aria-hidden="true">
        {FLOW_BEATS.map((item, index) => (
          <span key={item.key} className="fl__mark" data-mark={index} />
        ))}
      </div>

      <div className="fl__pin">
        <div className="fl__stage" ref={stageRef} data-beat={beat} onPointerMove={onPointerMove}>
          <div className="fl__glow" aria-hidden="true" />

          <div className="fl__grid">
            {/* ---- LEFT: the graph -------------------------------------- */}
            <div className="fl__graph">
              <p className="fl__rule">
                <span className="fl__rulename">Rule</span>
                After a screening call, move strong candidates on
              </p>

              <ol className="fl-nodes">
                {FLOW_NODES.map((node, index) => {
                  const joined = beat >= node.at;
                  const opened = open === node.key;
                  return (
                    <li
                      key={node.key}
                      className="fl-node"
                      data-kind={node.kind}
                      data-joined={joined}
                      // The connector above this node carries the signal on the
                      // beat that brings the node in. One at a time, never five.
                      data-live={beat === node.at && index > 0}
                    >
                      <button
                        type="button"
                        className="fl-node__btn"
                        aria-expanded={opened}
                        aria-controls={`fl-detail-${node.key}`}
                        onClick={() => setOpen((current) => (current === node.key ? null : node.key))}
                      >
                        <span className="fl-node__kind">{KIND_LABEL[node.kind]}</span>
                        <span className="fl-node__label">{node.label}</span>
                        {/*
                          The chevron is decoration; `aria-expanded` on the
                          button is what actually announces the state, so a
                          reader is never relying on a rotated glyph.
                        */}
                        <span className="fl-node__chev" aria-hidden="true" />
                      </button>

                      {/*
                        IN THE DOM ALWAYS, `hidden` when closed — so every
                        node's explanation is in the crawlable HTML and
                        `aria-controls` never points at something absent.
                      */}
                      <div
                        id={`fl-detail-${node.key}`}
                        className="fl-node__detail"
                        hidden={!opened}
                      >
                        {node.detail}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* ---- RIGHT: the run log ----------------------------------- */}
            <div className="fl__log">
              <p className="fl__loghead">
                Run log
                <span className="fl__logdemo">Illustrative</span>
              </p>

              <ol className="fl-log">
                {FLOW_LOG.map((entry, index) => (
                  <li
                    key={`${entry.time}-${index}`}
                    className="fl-log__row"
                    data-shown={beat >= entry.at}
                    data-tone={entry.tone}
                    style={{ transitionDelay: `${(index % 3) * 70}ms` }}
                  >
                    <span className="fl-log__time">{entry.time}</span>
                    <span className="fl-log__text">{entry.text}</span>
                  </li>
                ))}
              </ol>

              {/*
                The one sentence the whole section exists to make, held to the
                end so it reads as a conclusion rather than a disclaimer.
              */}
              <p className="fl__note" data-shown={beat >= BEAT_COUNT - 1}>
                Two actions, one approval, and a named person on the line that
                mattered.
              </p>
            </div>
          </div>
        </div>

        <div className="fl__story">
          {/*
            A TIMELINE OF THE RUN, NOT A LEGEND FOR THE GRAPH. The beats are
            past-tense events so they cannot be mistaken for node names: two of
            them ("Proposed", "Approved") happen at the one Approval node, and
            "Complete" is the finished graph rather than a node of its own.
          */}
          <ol className="fl-beats" aria-label="How the run unfolds">
            {FLOW_BEATS.map((item, index) => (
              <li
                key={item.key}
                className="fl-beats__item"
                data-state={index === beat ? "on" : index < beat ? "done" : "off"}
                aria-current={index === beat ? "step" : undefined}
              >
                <span className="fl-beats__num" aria-hidden="true">
                  {item.num}
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ol>

          <div className="fl__copy">
            {FLOW_BEATS.map((item, index) => (
              <p key={item.key} className="fl__copytext" hidden={index !== beat}>
                {item.copy}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
