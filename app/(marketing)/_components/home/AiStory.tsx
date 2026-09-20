"use client";

// =============================================================================
// THE AI SCREENING STORY — a scroll-driven product demonstration.
//
// -----------------------------------------------------------------------------
// HOW THE SCROLL WORKS, AND WHY THERE IS NO SCROLL HANDLER
// -----------------------------------------------------------------------------
//
// A tall track, a sticky viewport, and FIVE INVISIBLE SENTINELS spaced down the
// track. One IntersectionObserver with `rootMargin: -50% 0px -50% 0px` reduces
// the viewport to a single horizontal line at its middle; whichever sentinel is
// crossing that line is the active stage.
//
// The alternatives were all worse:
//
//   * a `scroll` listener recomputing getBoundingClientRect runs on the main
//     thread during the exact gesture it is decorating, which is how a section
//     like this makes a page feel slower than the one it replaced;
//   * `animation-timeline: view()` is genuinely off-thread and genuinely not
//     available in Firefox, so it would need the observer as a fallback anyway
//     — two mechanisms for one behaviour;
//   * a scroll-animation library is a dependency for decoration, which the
//     brief and this repository both rule out.
//
// The observer fires five times for the whole section. That is the entire
// per-scroll cost.
//
// -----------------------------------------------------------------------------
// MOBILE IS A DIFFERENT COMPOSITION, NOT A SMALLER ONE
// -----------------------------------------------------------------------------
//
// Below 900px the track collapses, the viewport stops being sticky, and every
// stage renders lit and stacked — the flow becomes a vertical sequence the
// reader scrolls past normally. That is a stylesheet decision, so the markup is
// identical and there is no second render tree and no hydration risk. The
// cursor lighting and the stage gating simply have no effect there.
//
// -----------------------------------------------------------------------------
// WHAT IS INTERACTIVE, AND WHAT DELIBERATELY IS NOT
// -----------------------------------------------------------------------------
//
// The three candidate cards are a RADIO GROUP: pick one, and the insight panel
// and the recruiter panel show what the pipeline produced for that person.
// Radio rather than tabs, and not only for semantics — the platform showcase
// one section above is a tablist, and two consecutive click-to-switch bands
// that look and behave the same is how a page starts to feel like a template.
//
// There is no play/pause/replay control. The scroll IS the transport.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import {
  AI_STORY_CANDIDATES,
  AI_STORY_JOB,
  AI_STORY_STAGES,
  AI_STORY_STEPS,
  AI_STORY_VERDICT_NOTE,
} from "@/lib/marketing/home";

/** Which stage each sentinel activates. Index into AI_STORY_STAGES. */
const STAGE_COUNT = AI_STORY_STAGES.length;

export function AiStory() {
  const [stage, setStage] = useState(0);
  const [picked, setPicked] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const candidate = AI_STORY_CANDIDATES[picked];

  /*
    THE STAGE OBSERVER.

    Watches the sentinels, not the stages: the stages are stacked inside a
    sticky box and never move relative to the viewport, so observing them would
    report the same thing forever. The sentinels live in the scrolling track
    behind it and are what actually pass by.
  */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const marks = Array.from(track.querySelectorAll<HTMLElement>("[data-mark]"));
    if (marks.length === 0) return;

    // No observer — an old browser, or a test environment — means show the
    // finished story. A progressive enhancement that hides content when it
    // fails is not an enhancement.
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setStage(STAGE_COUNT - 1), 0);
      return () => clearTimeout(t);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.mark);
          if (Number.isInteger(index)) setStage(index);
        }
      },
      // The viewport reduced to its middle line. A sentinel "is intersecting"
      // only while it straddles that line, so exactly one is active at a time.
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
    );

    for (const mark of marks) observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  /*
    CURSOR LIGHTING — desktop, pointer devices, no reduced-motion.

    Writes two custom properties that a radial gradient in the stylesheet
    reads. Throttled to one write per frame: pointermove fires far faster than
    the compositor can use, and the naive version is a genuine jank source on a
    section this size.

    It sets a CSS variable rather than React state on purpose. State would
    re-render the whole subtree on every mouse movement; a style property
    mutation touches one node and never re-renders anything.
  */
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let x = 50;
    let y = 50;

    const paint = () => {
      frame = 0;
      node.style.setProperty("--mx", `${x}%`);
      node.style.setProperty("--my", `${y}%`);
    };

    const onMove = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      x = ((event.clientX - box.left) / box.width) * 100;
      y = ((event.clientY - box.top) / box.height) * 100;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    node.addEventListener("pointermove", onMove);
    return () => {
      node.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /** Arrow keys move between candidates, as a radio group requires. */
  const onCardKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = AI_STORY_CANDIDATES.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = picked === last ? 0 : picked + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = picked === 0 ? last : picked - 1;
    }

    if (next === null) return;
    event.preventDefault();
    setPicked(next);
    cardRefs.current[next]?.focus();
  };

  return (
    <div className="ai-story" ref={trackRef}>
      {/*
        THE SCROLL RUNWAY. Five sentinels, evenly spaced, zero height, hidden
        from assistive tech — they are a scroll measurement, not content. The
        track's own height is what gives the sticky viewport something to be
        sticky against; it collapses to nothing on mobile.
      */}
      <div className="ai-story__runway" aria-hidden="true">
        {AI_STORY_STAGES.map((item, index) => (
          <span key={item.key} className="ai-story__mark" data-mark={index} />
        ))}
      </div>

      <div className="ai-story__viewport">
        <div className="ai-story__stage" ref={stageRef} data-stage={stage}>
          {/* The background: a fixed mesh plus the cursor's own light. */}
          <div className="ai-story__mesh" aria-hidden="true" />
          <div className="ai-story__cursor" aria-hidden="true" />

          {/*
            ---- The progress rail ------------------------------------------
            A real <ol> so the order is in the markup, with the current stage
            announced rather than only tinted. `aria-current` is the only part
            of this that a screen reader needs; the numbers are decoration.
          */}
          <ol className="ai-rail">
            {AI_STORY_STAGES.map((item, index) => (
              <li
                key={item.key}
                className="ai-rail__item"
                data-state={index === stage ? "on" : index < stage ? "done" : "off"}
                aria-current={index === stage ? "step" : undefined}
              >
                <span className="ai-rail__num" aria-hidden="true">
                  {item.num}
                </span>
                <span className="ai-rail__label">{item.label}</span>
              </li>
            ))}
          </ol>

          <div className="ai-flow">
            {/* ---- 01 · The role ------------------------------------------ */}
            <section className="ai-flow__block ai-job" data-at="0" aria-label="The role">
              <p className="ai-flow__kicker">Job</p>
              <h3 className="ai-job__title">{AI_STORY_JOB.title}</h3>
              <p className="ai-job__meta">{AI_STORY_JOB.meta}</p>
              <ul className="ai-job__reqs">
                {AI_STORY_JOB.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </section>

            <span className="ai-flow__link" data-at="1" aria-hidden="true">
              <span className="ai-flow__pulse" />
            </span>

            {/* ---- 02 · The candidates ------------------------------------ */}
            <section className="ai-flow__block" data-at="1" aria-label="Candidates">
              <p className="ai-flow__kicker">Applications</p>
              <div
                role="radiogroup"
                aria-label="Choose a candidate to follow through screening"
                className="ai-cands"
                onKeyDown={onCardKeys}
              >
                {AI_STORY_CANDIDATES.map((person, index) => (
                  <button
                    key={person.id}
                    ref={(node) => {
                      cardRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={index === picked}
                    // Roving tabindex, as a radio group requires: one tab stop
                    // for the group, then arrows within it.
                    tabIndex={index === picked ? 0 : -1}
                    className="ai-cand"
                    onClick={() => setPicked(index)}
                  >
                    <span className="ai-cand__name">{person.name}</span>
                    <span className="ai-cand__role">{person.headline}</span>
                  </button>
                ))}
              </div>
            </section>

            {/*
              ---- The converging paths -----------------------------------
              THE ONE PLACE SVG EARNS ITS KEEP. Three cards meeting one layer
              is not a straight line, and drawing it with borders would need a
              different hack at every breakpoint. `preserveAspectRatio="none"`
              lets one 300x48 viewBox stretch to whatever width the panel has,
              and the strokes are drawn on by dash-offset when the stage lands.
            */}
            <svg
              className="ai-converge"
              data-at="2"
              viewBox="0 0 300 48"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M50 0 C50 28, 150 20, 150 48" />
              <path d="M150 0 L150 48" />
              <path d="M250 0 C250 28, 150 20, 150 48" />
            </svg>

            {/* ---- 03 · The AI layer -------------------------------------- */}
            <section className="ai-flow__block ai-layer" data-at="2" aria-label="Screening">
              <p className="ai-flow__kicker">Screening</p>
              <ol className="ai-layer__steps">
                {AI_STORY_STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className="ai-step"
                    data-by={step.by}
                    style={{ transitionDelay: `${index * 90}ms` }}
                  >
                    {/*
                      WHO DID IT, IN WORDS. The three tints are a second
                      signal; this badge is the first, because "two of these
                      four steps are not the model" is the single most
                      important true thing this section says and it must not
                      depend on telling mint from periwinkle.
                    */}
                    <span className="ai-step__by">
                      {step.by === "ai" ? "AI" : step.by === "code" ? "Code" : "Person"}
                    </span>
                    <span className="ai-step__title">{step.title}</span>
                    <span className="ai-step__body">{step.body}</span>
                  </li>
                ))}
              </ol>
            </section>

            <span className="ai-flow__link" data-at="3" aria-hidden="true">
              <span className="ai-flow__pulse" />
            </span>

            {/* ---- 04 · The insight, and 05 · the review ------------------ */}
            <div className="ai-out">
              <section className="ai-flow__block ai-insight" data-at="3" aria-label="Insight">
                <p className="ai-flow__kicker">Insight</p>

                {/*
                  Keyed on the candidate so the panel replays its entrance when
                  the reader picks someone else — the "morph" between states,
                  using the hero's keyframe rather than a second system.
                */}
                <div key={candidate.id} className="ai-insight__body mkt-enter">
                  <p className="ai-insight__who">
                    {candidate.name} · {AI_STORY_JOB.title}
                  </p>

                  <p className="ai-insight__score">
                    <strong>{candidate.score}</strong>
                    <span> / 100 match</span>
                  </p>
                  <span className="ai-insight__track" aria-hidden="true">
                    <span
                      className="ai-insight__bar"
                      style={{ width: `${candidate.score}%` }}
                    />
                  </span>

                  <dl className="ai-insight__lists">
                    <div>
                      <dt>Strong matches</dt>
                      <dd>{candidate.strengths.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Gaps</dt>
                      <dd>{candidate.gaps.join(" · ")}</dd>
                    </div>
                    {candidate.verify.length > 0 && (
                      <div>
                        <dt>Needs verification</dt>
                        <dd>{candidate.verify.join(" · ")}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </section>

              <section className="ai-flow__block ai-review" data-at="4" aria-label="Recruiter review">
                <p className="ai-flow__kicker">Recruiter review</p>

                <p className="ai-review__verdict">{candidate.verdict}</p>
                <p className="ai-review__note">{AI_STORY_VERDICT_NOTE}</p>

                {/*
                  A PICTURE OF CONTROLS, NOT CONTROLS.

                  These are the product's three real verdicts, rendered as
                  spans and marked `aria-hidden` — they are not buttons,
                  because a button on a marketing page that looks like it
                  advances a candidate and does nothing is worse than no button
                  at all. The section says a person decides; it must not then
                  fake the deciding.
                */}
                <div className="ai-review__acts" aria-hidden="true">
                  <span className="ai-review__act is-primary">Pass</span>
                  <span className="ai-review__act">Needs Review</span>
                  <span className="ai-review__act">Fail</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
