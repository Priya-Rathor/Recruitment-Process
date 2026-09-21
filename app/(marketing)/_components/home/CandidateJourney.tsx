"use client";

// =============================================================================
// THE CANDIDATE WORKSPACE — one candidate, six views, driven by the reader.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT A THIRD STICKY SCROLL STORY
// -----------------------------------------------------------------------------
//
// The brief asked for a sticky section of 220-300vh with the explanation on the
// left and a pinned workspace on the right. That is, to the pixel, the
// composition of the screening-call section immediately above it — which is
// itself the third of these on the page, after the AI screening story. Built as
// specified, a reader would meet the same two-column pinned panel three times
// in a row and the homepage would carry roughly 700vh of scroll track before
// reaching the pipeline.
//
// The three things that made the earlier ones work were: one candidate visibly
// travelling, a product surface that transforms, and a stage indicator. None of
// those requires scroll to be the transport. So here the READER drives it:
// six real views as a tablist, a timeline that fills as they go, and one card
// that carries its state across all six.
//
// It is a deliberate deviation, it is reported, and it is reversible — the
// sentinel-and-sticky machinery in AiStory/VoiceStory would drop in around this
// component unchanged if the judgement goes the other way.
//
// -----------------------------------------------------------------------------
// WHAT IT SHOWS
// -----------------------------------------------------------------------------
//
// Every view is a real screen (candidate Profile card, ResumesCard, the
// screening report, the Interviews section, EvaluationPanel, the activity
// Timeline) and every timeline entry is a real event type from
// lib/activity/events.ts. The card is a separate, prop-driven component so a
// later module can reuse it without inheriting any of this.
// =============================================================================

import { useRef, useState } from "react";
import {
  CANDIDATE_PROFILE,
  CANDIDATE_STAGES,
  CANDIDATE_TIMELINE,
  CANDIDATE_VIEWS,
} from "@/lib/marketing/home";
import { CandidateCard, type CandidateChip } from "./CandidateCard";

/**
 * What the card says at each stage.
 *
 * THIS IS THE JOURNEY. The card never moves and never unmounts; its chips are
 * what change, and by the sixth view it is carrying a match score and a verdict
 * it did not have at the first. A card that was destroyed and rebuilt per stage
 * would look identical in a screenshot and mean nothing.
 */
const CARD_STATE: CandidateChip[][] = [
  [{ label: "Stage", value: "Applied", tone: "neutral" }],
  [
    { label: "Stage", value: "Applied", tone: "neutral" },
    { label: "Resume", value: "Parsed", tone: "good" },
  ],
  [
    { label: "Stage", value: "AI Screening Call", tone: "neutral" },
    { label: "Match", value: "91 / 100", tone: "good" },
  ],
  [
    { label: "Stage", value: "Video Interview", tone: "neutral" },
    { label: "Match", value: "91 / 100", tone: "good" },
    { label: "Rounds", value: "1 of 2", tone: "neutral" },
  ],
  [
    { label: "Stage", value: "Director Round", tone: "neutral" },
    { label: "Match", value: "91 / 100", tone: "good" },
    { label: "Verdict", value: "Needs Review", tone: "warn" },
  ],
  [
    { label: "Stage", value: "Director Round", tone: "neutral" },
    { label: "Verdict", value: "Needs Review", tone: "warn" },
    { label: "History", value: "8 events", tone: "neutral" },
  ],
];

export function CandidateJourney() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);


  /** Arrow keys, Home and End, with automatic activation. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = CANDIDATE_STAGES.length - 1;
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

  /*
    Cursor lighting inside the workspace. Same shape as the two sections above:
    two custom properties, written at most once per frame, read by a gradient
    in the stylesheet. A style mutation rather than React state, so moving the
    mouse never re-renders the panel.
  */
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = panelRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const box = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${((event.clientX - box.left) / box.width) * 100}%`);
    node.style.setProperty("--my", `${((event.clientY - box.top) / box.height) * 100}%`);
  };

  return (
    <div className="cw" ref={panelRef} onPointerMove={onPointerMove}>
      <div className="cw__glow" aria-hidden="true" />

      <div className="cw__grid">
        {/* ---- LEFT: the candidate, and their history ---------------------- */}
        <div className="cw__side">
          <CandidateCard
            name={CANDIDATE_PROFILE.name}
            role={CANDIDATE_PROFILE.role}
            chips={CARD_STATE[active]}
            active
          />

          {/*
            THE TIMELINE. An <ol>, because it is chronological and the order is
            the content. Entries light up once their view has been reached, and
            the connecting rail fills to match — so the reader can see how far
            through the record they are without a separate progress bar.
          */}
          <div className="cw__timeline">
            <p className="cw__timelinehead">Activity</p>
            <ol className="cw-time">
              {CANDIDATE_TIMELINE.map((entry, index) => {
                const entryStage = CANDIDATE_STAGES.findIndex((s) => s.key === entry.at);
                return (
                  <li
                    key={`${entry.label}-${index}`}
                    className="cw-time__row"
                    data-on={entryStage <= active}
                  >
                    <span className="cw-time__dot" aria-hidden="true" />
                    <span className="cw-time__label">{entry.label}</span>
                    <span className="cw-time__by">{entry.by}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* ---- RIGHT: the six views ---------------------------------------- */}
        <div className="cw__main">
          <div
            role="tablist"
            aria-label="Candidate workspace views"
            className="cw-tabs"
            onKeyDown={onKeyDown}
          >
            {CANDIDATE_STAGES.map((item, index) => (
              <button
                key={item.key}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`cw-tab-${item.key}`}
                aria-selected={index === active}
                aria-controls={`cw-panel-${item.key}`}
                tabIndex={index === active ? 0 : -1}
                className="cw-tab"
                onClick={() => setActive(index)}
              >
                <span className="cw-tab__num" aria-hidden="true">
                  {item.num}
                </span>
                {item.label}
              </button>
            ))}
          </div>

          {/*
            ALL SIX PANELS IN THE DOM, five `hidden`. Same reasoning as the
            platform showcase: `aria-controls` on an unselected tab must point
            at an element that exists, and a crawler should get all six views
            rather than the first.
          */}
          {CANDIDATE_STAGES.map((item, index) => {
            const panel = CANDIDATE_VIEWS[item.key];
            return (
              <div
                key={item.key}
                role="tabpanel"
                id={`cw-panel-${item.key}`}
                aria-labelledby={`cw-tab-${item.key}`}
                tabIndex={0}
                hidden={index !== active}
                className="cw-view"
              >
                {/*
                  The heading is visually hidden rather than absent: the panel
                  needs a name in the document outline and for a screen reader
                  moving by heading, but on screen the tab above it already
                  says which view this is and repeating it would be noise.
                */}
                <h3 className="is-sr-only">{item.label}</h3>

                <dl className="cw-view__rows">
                  {panel.rows.map((row, rowIndex) => (
                    <div
                      key={row.label}
                      className="cw-view__row"
                      style={{ transitionDelay: `${rowIndex * 55}ms` }}
                    >
                      <dt>{row.label}</dt>
                      <dd data-tone={row.tone}>{row.value}</dd>
                    </div>
                  ))}
                </dl>

                <p className="cw-view__note">{panel.note}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        The explanation for the current view.

        Below the workspace rather than beside it, which is the other half of
        not repeating the section above: there, the copy is a pinned column and
        the product is the object; here the product is the whole width and the
        copy is its caption. All six are in the DOM, five `hidden`.
      */}
      <div className="cw__copy">
        {CANDIDATE_STAGES.map((item, index) => (
          <p key={item.key} className="cw__copytext" hidden={index !== active}>
            {item.copy}
          </p>
        ))}
      </div>
    </div>
  );
}
