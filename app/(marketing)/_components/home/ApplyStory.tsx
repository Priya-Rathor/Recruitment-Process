"use client";

// =============================================================================
// CANDIDATE APPLICATIONS — the public form, and what Scoreboad does with it.
//
// -----------------------------------------------------------------------------
// THE FORM CANNOT SUBMIT ANYTHING. BY CONSTRUCTION, NOT BY CARE.
// -----------------------------------------------------------------------------
//
// There is no `action`, no `onSubmit`, no fetch, and no Supabase client
// anywhere in this file's import graph. Every input is `readOnly` and the
// button is `disabled`. It is not "a demo form we remembered not to wire up" —
// there is nothing here that could reach a backend if somebody tried.
//
// The values fill in as the story advances rather than being typed, which is
// also why read-only is the honest state: an input a reader can type into and
// then cannot submit is a worse experience than one that plainly narrates
// itself.
//
// REAL LABELS AND REAL INPUTS, THOUGH. <label for> / <input id>, not divs
// dressed as fields and not placeholders standing in for labels — a form that
// only looks like a form to sighted readers is not a demonstration of a form.
//
// -----------------------------------------------------------------------------
// THE SPLIT IS THE ARGUMENT
// -----------------------------------------------------------------------------
//
// Candidate side on the left, Scoreboad on the right, and rows appearing on the
// right as the beats advance. The order those rows appear in is the order
// lib/forms/submit.ts actually does the work — answers, then file, then
// candidate, then parse, then a proposal — which is not the order anybody
// would guess, and is the whole reason the section is worth building.
// =============================================================================

import { useEffect, useId, useRef, useState } from "react";
import {
  APPLY_BEATS,
  APPLY_FIELDS,
  APPLY_RECORDS,
} from "@/lib/marketing/home";

const BEAT_COUNT = APPLY_BEATS.length;

export function ApplyStory() {
  const [beat, setBeat] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();

  /* One observer on five sentinels. Same technique as the other scroll bands. */
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
    const node = splitRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const box = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${((event.clientX - box.left) / box.width) * 100}%`);
    node.style.setProperty("--my", `${((event.clientY - box.top) / box.height) * 100}%`);
  };

  return (
    <div className="ap" ref={trackRef}>
      <div className="ap__runway" aria-hidden="true">
        {APPLY_BEATS.map((item, index) => (
          <span key={item.key} className="ap__mark" data-mark={index} />
        ))}
      </div>

      <div className="ap__pin">
        <div className="ap__split" ref={splitRef} data-beat={beat} onPointerMove={onPointerMove}>
          <div className="ap__glow" aria-hidden="true" />

          {/* ================= LEFT: the candidate's side ================= */}
          <section className="ap-form" aria-labelledby={`${fieldId}-formhead`}>
            <header className="ap-form__head">
              <p className="ap-form__eyebrow">Application</p>
              <h3 id={`${fieldId}-formhead`} className="ap-form__title">
                Senior Backend Engineer
              </h3>
              <p className="ap-form__note">Shared as a link · no account needed</p>
            </header>

            {/*
              No action, no onSubmit. See the header — this element cannot post
              anywhere, and that is a property of what is written here rather
              than of anyone remembering to be careful.
            */}
            <form className="ap-form__body">
              {APPLY_FIELDS.map((field, index) => (
                <div key={field.label} className="ap-field" data-filled={beat >= field.at}>
                  <label htmlFor={`${fieldId}-${index}`}>
                    {field.label}
                    {field.required && (
                      <span className="ap-field__req"> (required)</span>
                    )}
                  </label>
                  <input
                    id={`${fieldId}-${index}`}
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={beat >= field.at ? field.value : ""}
                    /*
                      The value narrates the story, so it must not be
                      announced as an editable field a reader has failed to
                      fill in. The whole form is described by the caption
                      below the split.
                    */
                    aria-describedby={`${fieldId}-demo`}
                  />
                </div>
              ))}

              {/* ---- The resume row ------------------------------------- */}
              <div className="ap-file" data-state={beat >= 2 ? "done" : beat >= 1 ? "busy" : "idle"}>
                <span className="ap-file__label">
                  Resume <span className="ap-field__req">(required)</span>
                </span>
                <span className="ap-file__row">
                  <span className="ap-file__name">sharma-backend.pdf</span>
                  {/*
                    "Processing", never a percentage. A number here would be a
                    progress bar for work that is not happening — the brief
                    rules it out and it would also be the easiest lie in the
                    section to tell.
                  */}
                  <span className="ap-file__state">
                    {beat >= 2 ? "Filed" : beat >= 1 ? "Processing" : "PDF or Word, up to 10 MB"}
                  </span>
                </span>
                <span className="ap-file__bar" aria-hidden="true">
                  <span className="ap-file__fill" />
                </span>
              </div>

              <button type="button" className="ap-form__submit" disabled>
                {beat >= 2 ? "Application received" : "Send application"}
              </button>
            </form>

            <p id={`${fieldId}-demo`} className="ap-form__demo">
              An illustration of the real application form. It is read-only and
              submits nothing.
            </p>
          </section>

          {/* ================= THE FLOW BETWEEN ========================= */}
          {/*
            Three rules in the gap, with a signal on the one carrying data at
            this beat. CSS rather than SVG for the same reason as the
            pipeline's connectors: these are straight segments in a gap whose
            width changes with the viewport, and a pseudo-element is aligned to
            that grid by construction where an SVG viewBox would have to be
            recomputed per breakpoint.
          */}
          <div className="ap-flow" aria-hidden="true">
            <span className="ap-flow__line" data-on={beat >= 2} />
            <span className="ap-flow__line" data-on={beat >= 3} />
            <span className="ap-flow__line" data-on={beat >= 4} />
          </div>

          {/* ================= RIGHT: inside Scoreboad =================== */}
          <section className="ap-in" aria-labelledby={`${fieldId}-inhead`}>
            <header className="ap-in__head">
              <p className="ap-form__eyebrow">In Scoreboad</p>
              <h3 id={`${fieldId}-inhead`} className="ap-form__title">
                What exists now
              </h3>
              <p className="ap-form__note">In the order the submission creates it</p>
            </header>

            {/*
              EVERY ROW IS IN THE DOM from the first paint, revealed as its
              beat arrives — so a crawler gets the whole sequence and the list
              cannot collapse and reflow under the reader as rows appear.
            */}
            <ol className="ap-in__rows">
              {APPLY_RECORDS.map((row, index) => (
                <li
                  key={row.label}
                  className="ap-rec"
                  data-shown={beat >= row.at}
                  data-state={row.state}
                  style={{ transitionDelay: `${(index % 2) * 90}ms` }}
                >
                  <span className="ap-rec__tick" aria-hidden="true" />
                  <span className="ap-rec__text">
                    <strong>{row.label}</strong>
                    <span>{row.value}</span>
                  </span>
                </li>
              ))}
            </ol>

            {/*
              The closing point, and the one the whole order exists to make.
              Shown at the last beat, always in the markup.
            */}
            <p className="ap-in__note" data-shown={beat >= 5}>
              A recruiter reviews the proposal and decides what lands on the
              record.
            </p>
          </section>
        </div>

        {/* ---- The beat rail and caption ------------------------------- */}
        <div className="ap__story">
          <ol className="ap-beats">
            {APPLY_BEATS.map((item, index) => (
              <li
                key={item.key}
                className="ap-beats__item"
                data-state={index === beat ? "on" : index < beat ? "done" : "off"}
                aria-current={index === beat ? "step" : undefined}
              >
                <span className="ap-beats__num" aria-hidden="true">
                  {item.num}
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ol>

          <div className="ap__copy">
            {APPLY_BEATS.map((item, index) => (
              <p key={item.key} className="ap__copytext" hidden={index !== beat}>
                {item.copy}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
