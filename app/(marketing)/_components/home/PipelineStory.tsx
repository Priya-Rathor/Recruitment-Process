"use client";

// =============================================================================
// THE HIRING PIPELINE — a board one candidate actually crosses.
//
// -----------------------------------------------------------------------------
// THE CARD GENUINELY TRAVELS
// -----------------------------------------------------------------------------
//
// One <CandidateCard>, rendered ONCE, in an overlay grid that mirrors the
// board's columns exactly. Advancing a beat changes a single custom property,
// `--col`, and the card translates by `--col * (100% + gap)` — 100% of its own
// width being precisely one column, because the overlay cell and the board
// column are the same track.
//
// That is the whole trick, and it is why the card is the same DOM node in
// Applied and in Hired rather than six nodes taking turns. The alternative —
// rendering the card inside whichever column owns it — would unmount and
// remount it, which screenshots identically and animates not at all.
//
// TRANSFORM ONLY. No layout property is animated and no library is involved;
// `translateX` on one element is the entire movement.
//
// -----------------------------------------------------------------------------
// TWO CONTROLS THAT DO NOT FIGHT
// -----------------------------------------------------------------------------
//
// Scroll drives the STORY — which beat, and therefore where the card is.
// Clicking a column header FOCUSES that column and dims the rest. They are
// orthogonal, so a click is never undone by the next pixel of scroll. (The
// candidate-workspace section deliberately has no scroll control for exactly
// the opposite reason: there, the two would have collided.)
//
// -----------------------------------------------------------------------------
// WHAT IS NOT HERE
// -----------------------------------------------------------------------------
//
// No drag and drop, not even as an illusion. The real board uses a menu on the
// card, and its own comment explains why: "a dropdown is keyboard-accessible,
// works on a phone, and cannot fire from a mis-drag. Moving someone through a
// hiring pipeline should be deliberate." Animating a card being dragged would
// advertise the one interaction the product deliberately does not have.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import {
  PIPELINE_BEATS,
  PIPELINE_CARDS,
  PIPELINE_COLUMNS,
  PIPELINE_EXITS,
  PIPELINE_JOB,
  pipelineBreachesAt,
  pipelineCountAt,
} from "@/lib/marketing/home";
import { CandidateCard } from "./CandidateCard";

const BEAT_COUNT = PIPELINE_BEATS.length;

/** The travelling candidate's chips, per beat. */
const TRAVELLER_CHIPS = [
  [{ label: "Applied", value: "Today" }],
  [{ label: "Match", value: "91 / 100", tone: "good" as const }],
  [{ label: "Call", value: "Queued" }],
  [{ label: "SLA", value: "Day 2 of 7" }],
  [{ label: "Moved by", value: "R. Menon" }],
  [{ label: "Hired", value: "Offer accepted", tone: "good" as const }],
];

export function PipelineStory() {
  const [beat, setBeat] = useState(0);
  /** A column the reader has focused, or null. Independent of `beat`. */
  const [focus, setFocus] = useState<number | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  /* The beat observer. Same sentinels-and-midline technique as the two other
     scroll sections — one observer, no scroll handler. */
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
    const node = boardRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const box = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${((event.clientX - box.left) / box.width) * 100}%`);
    node.style.setProperty("--my", `${((event.clientY - box.top) / box.height) * 100}%`);
  };

  const active = PIPELINE_BEATS[beat];

  return (
    <div className="pl" ref={trackRef}>
      <div className="pl__runway" aria-hidden="true">
        {PIPELINE_BEATS.map((item, index) => (
          <span key={item.key} className="pl__mark" data-mark={index} />
        ))}
      </div>

      <div className="pl__pin">
        <div
          className="pl__board"
          ref={boardRef}
          onPointerMove={onPointerMove}
          data-beat={beat}
          data-focus={focus ?? "none"}
        >
          <div className="pl__glow" aria-hidden="true" />

          {/* ---- The job this board belongs to --------------------------- */}
          <div className="pl__head">
            <div>
              <p className="pl__job">{PIPELINE_JOB.title}</p>
              <p className="pl__jobmeta">{PIPELINE_JOB.meta}</p>
            </div>
            <span className="pl__demo">Illustrative</span>
          </div>

          {/* ---- The columns --------------------------------------------- */}
          <div className="pl__cols">
            {PIPELINE_COLUMNS.map((column, index) => (
              <div
                key={column.key}
                className="pl-col"
                data-state={
                  focus === null ? "normal" : focus === index ? "focus" : "dim"
                }
              >
                {/*
                  A TOGGLE, NOT A TAB. Pressing it focuses the column; pressing
                  it again clears — and `aria-pressed` is the honest role for
                  that, where a tab would promise a panel this does not have.

                  The DIMMING is on the column rather than the button, so the
                  styling hook is `data-state` on the parent and not
                  `aria-pressed` here. They cannot drift regardless: both are
                  computed from the single `focus` value a line above, so
                  there is one source of truth with two renderings rather than
                  two pieces of state to keep in step.
                */}
                <button
                  type="button"
                  className="pl-col__head"
                  aria-pressed={focus === index}
                  aria-label={`${column.label}, ${column.count} candidates. Focus this stage.`}
                  onClick={() => setFocus((current) => (current === index ? null : index))}
                >
                  <span className="pl-col__name">{column.label}</span>
                  {/*
                    LIVE. The travelling candidate is counted into whichever
                    column holds them, so a move decrements the source and
                    increments the destination — which is what a real board
                    does, and what stops the card reading as a duplicate
                    sliding over a static picture.

                    `aria-live` is deliberately NOT set: six counters
                    announcing themselves on every scroll beat would be
                    unusable. The beat caption below the board narrates the
                    same change once, in a sentence.
                  */}
                  <span className="pl-col__count">{pipelineCountAt(index, beat)}</span>
                </button>

                {/*
                  The SLA target, in words. The real board ages every card
                  against this; showing the target makes the at-risk and
                  breached badges below mean something instead of being decor.
                */}
                <p className="pl-col__sla">
                  {column.targetDays === null
                    ? "No target — terminal stage"
                    : `${column.targetDays}-day target`}
                </p>

                {/*
                  THE BOTTLENECK MOMENT, and it is a count rather than a claim.

                  lib/pipeline/sla.ts already marks a card `breached` past its
                  stage target; this only totals them. That distinction is the
                  whole of §13's caution — the product does not "detect
                  bottlenecks", it ages every card against a target you set,
                  and a column with two breaches is what that looks like.

                  Appears from the aging beat onward so it lands as a moment
                  rather than sitting there from the first frame.
                */}
                {beat >= 3 && pipelineBreachesAt(index) > 0 && (
                  <p className="pl-col__breach">
                    {pipelineBreachesAt(index)} past target
                  </p>
                )}

                <ul className="pl-col__cards">
                  {/*
                    A SLOT where the travelling card will land, so the column's
                    height does not change when it arrives. The overlay card is
                    painted above this.
                  */}
                  {active.at === index && (
                    <li className="pl-slot" aria-hidden="true" />
                  )}

                  {PIPELINE_CARDS.filter((card) => card.at === index).map((card) => (
                    <li key={card.id} className="pl-mini" data-sla={card.sla}>
                      <span className="pl-mini__name">{card.name}</span>
                      <span className="pl-mini__role">{card.role}</span>
                      {/*
                        The badge carries its own words — "4 days over", not a
                        bare red dot. The tint ranks; the text states.
                      */}
                      <span className="pl-mini__sla">{card.slaLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/*
            ---- THE TRAVELLER -------------------------------------------

            One card, one grid, one custom property. See the header.
            `aria-hidden` because the same candidate is described in text by
            the beat caption below the board — a card that teleports between
            columns as a screen reader user arrows past would be noise.
          */}
          <div className="pl__overlay" aria-hidden="true">
            <div
              className="pl__traveller"
              style={{ "--col": active.at } as React.CSSProperties}
            >
              <CandidateCard
                name="A. Sharma"
                role="Backend Engineer"
                chips={TRAVELLER_CHIPS[beat]}
                active
              />
            </div>
          </div>

          {/*
            ---- The move confirmation ---------------------------------------

            "Stage changed" is the REAL activity event label from
            lib/activity/events.ts, and the log records who did it — so the
            confirmation names a person rather than saying the board moved
            someone by itself. Shown only on the beat where the move happens.
          */}
          <p className="pl__toast" data-shown={beat === 4} aria-hidden={beat !== 4}>
            <span className="pl__toastdot" aria-hidden="true" />
            Stage changed to Director Round · R. Menon
          </p>

          {/* ---- The exits ------------------------------------------------ */}
          <p className="pl__exits">
            {PIPELINE_EXITS.map((exit) => `${exit.count} ${exit.label}`).join(" · ")}
            <span className="pl__exitnote">
              Terminal outcomes are counted here, not given columns.
            </span>
          </p>
        </div>

        {/* ---- The beat rail and its caption ----------------------------- */}
        <div className="pl__story">
          <ol className="pl-beats">
            {PIPELINE_BEATS.map((item, index) => (
              <li
                key={item.key}
                className="pl-beats__item"
                data-state={index === beat ? "on" : index < beat ? "done" : "off"}
                aria-current={index === beat ? "step" : undefined}
              >
                <span className="pl-beats__num" aria-hidden="true">
                  {item.num}
                </span>
                <span className="pl-beats__label">{item.label}</span>
              </li>
            ))}
          </ol>

          {/* All six in the DOM, five `hidden` — a crawler gets the lot. */}
          <div className="pl__copy">
            {PIPELINE_BEATS.map((item, index) => (
              <p key={item.key} className="pl__copytext" hidden={index !== beat}>
                {item.copy}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
