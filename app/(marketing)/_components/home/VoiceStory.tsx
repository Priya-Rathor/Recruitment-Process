"use client";

// =============================================================================
// THE AI SCREENING CALL — a scroll-driven demonstration.
//
// SAME SCROLL MACHINERY AS THE AI STORY ONE BAND ABOVE, deliberately: a track,
// a sticky viewport, six sentinels and one IntersectionObserver reading the
// viewport's middle line. Inventing a second scroll mechanism for the second
// scroll section is how a codebase ends up with two of everything.
//
// A DIFFERENT COMPOSITION, THOUGH. That section is one centred panel; this is
// two columns — the stage's explanation on the left, the call interface on the
// right, both pinned, with the left text swapping as the right transforms.
// Same technique, different picture, which is the point.
//
// WHAT THE INTERFACE SHOWS IS THE REAL CALL. The consent line is quoted
// verbatim from lib/screening/script.ts; the status words are the real
// `screening_call_status` enum; the report fields are the real columns of
// `screening_reports`, including the uncertain-field flag and the pair that
// records what the AI said against what a recruiter changed it to.
//
// THERE IS NO AUDIO IN THIS COMPONENT. No <audio>, no file, no Web Audio. The
// waveform is a drawing.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { VOICE_REPORT, VOICE_STAGES, VOICE_TRANSCRIPT } from "@/lib/marketing/home";
import { VoiceWaveform, type WaveState } from "./VoiceWaveform";

const STAGE_COUNT = VOICE_STAGES.length;

/**
 * What the call is doing at each stage.
 *
 * `status` uses the real `screening_call_status` values — queued, dialing,
 * answered, completed — rather than invented ones, so the demo's chrome says
 * what the product's chrome would say.
 */
const CALL_STATE: { status: string; tone: string; wave: WaveState; speaker: string }[] = [
  { status: "Queued", tone: "wait", wave: "idle", speaker: "Attempt 1 of 3" },
  { status: "Answered", tone: "live", wave: "ai", speaker: "Assistant speaking" },
  { status: "Answered", tone: "live", wave: "ai", speaker: "Assistant speaking" },
  { status: "Answered", tone: "live", wave: "candidate", speaker: "Candidate speaking" },
  { status: "Completed", tone: "done", wave: "processing", speaker: "Building the report" },
  { status: "Completed", tone: "done", wave: "complete", speaker: "Awaiting review" },
];

export function VoiceStory() {
  const [stage, setStage] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const call = CALL_STATE[stage];

  /* The stage observer. See AiStory for why this is sentinels and not scroll. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const marks = Array.from(track.querySelectorAll<HTMLElement>("[data-mark]"));
    if (marks.length === 0) return;

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
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 }
    );

    for (const mark of marks) observer.observe(mark);
    return () => observer.disconnect();
  }, []);

  /*
    Cursor lighting plus a very small tilt. Two custom properties, written once
    per frame, read by a gradient and a rotate in the stylesheet.

    The tilt is capped at 1.2deg each way. The brief allows CSS perspective and
    warns that the interface must stay readable; past about 2deg the transcript
    starts to shimmer on a non-retina display, which is a high price for depth
    nobody consciously notices.
  */
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let px = 50;
    let py = 50;

    const paint = () => {
      frame = 0;
      node.style.setProperty("--mx", `${px}%`);
      node.style.setProperty("--my", `${py}%`);
      node.style.setProperty("--ry", `${((px - 50) / 50) * 1.2}deg`);
      node.style.setProperty("--rx", `${((50 - py) / 50) * 1.2}deg`);
    };

    const onMove = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      px = ((event.clientX - box.left) / box.width) * 100;
      py = ((event.clientY - box.top) / box.height) * 100;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      px = 50;
      py = 50;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="vi-story" ref={trackRef}>
      <div className="vi-story__runway" aria-hidden="true">
        {VOICE_STAGES.map((item, index) => (
          <span key={item.key} className="vi-story__mark" data-mark={index} />
        ))}
      </div>

      <div className="vi-story__pin">
        <div className="vi-grid" data-stage={stage}>
          {/* ---- LEFT: the stage indicator and the changing explanation ---- */}
          <div className="vi-copy">
            <ol className="vi-steps">
              {VOICE_STAGES.map((item, index) => (
                <li
                  key={item.key}
                  className="vi-steps__item"
                  data-state={index === stage ? "on" : index < stage ? "done" : "off"}
                  aria-current={index === stage ? "step" : undefined}
                >
                  <span className="vi-steps__num" aria-hidden="true">
                    {item.num}
                  </span>
                  <span className="vi-steps__label">{item.label}</span>
                </li>
              ))}
            </ol>

            {/*
              EVERY STAGE'S TEXT IS IN THE DOM, and the inactive ones are
              `hidden` rather than absent. Three reasons: a crawler gets all six
              explanations instead of the first; `hidden` keeps them out of the
              accessibility tree and out of the tab order; and swapping an
              attribute does not remount six paragraphs on every scroll beat.

              This is also what makes the section readable with animation off —
              the mobile stylesheet simply shows all six at once.
            */}
            <div className="vi-copy__body">
              {VOICE_STAGES.map((item, index) => (
                <p key={item.key} className="vi-copy__text" hidden={index !== stage}>
                  {item.copy}
                </p>
              ))}
            </div>
          </div>

          {/* ---- RIGHT: the call interface --------------------------------- */}
          <div className="vi-panel" ref={panelRef}>
            <div className="vi-panel__glow" aria-hidden="true" />

            <div className="vi-panel__inner">
              <header className="vi-panel__head">
                <span className="vi-panel__title">AI screening call</span>
                {/*
                  Status is a word, and the dot is the second signal. A coloured
                  dot alone would be the classic "important information carried
                  by colour" failure, on the one element that says whether a
                  call is live.
                */}
                <span className="vi-status" data-tone={call.tone}>
                  <span className="vi-status__dot" aria-hidden="true" />
                  {call.status}
                </span>
              </header>

              <div className="vi-panel__meta">
                <span>A. Sharma</span>
                <span aria-hidden="true">·</span>
                <span>Senior Backend Engineer</span>
              </div>

              {/* ---- The waveform, and what it means in words -------------- */}
              <div className="vi-voice">
                <VoiceWaveform state={call.wave} />
                {/*
                  `aria-live="polite"` so a screen reader is told the call moved
                  on, rather than being left with a silent animation. Polite,
                  not assertive: this is narration, and interrupting whatever
                  the reader is on would be worse than a beat's delay.
                */}
                <p className="vi-voice__label" aria-live="polite">
                  {call.speaker}
                </p>
              </div>

              {/* ---- The transcript ---------------------------------------- */}
              <div className="vi-transcript" data-shown={stage >= 1}>
                <p className="vi-transcript__head">
                  Transcript
                  <span className="vi-transcript__demo">Illustrative</span>
                </p>

                <ol className="vi-transcript__lines">
                  {VOICE_TRANSCRIPT.map((line, index) => (
                    <li
                      key={index}
                      className="vi-line"
                      data-who={line.who}
                      // A line is present once its stage is reached, so the
                      // transcript grows as the call proceeds rather than
                      // arriving whole.
                      data-shown={stage >= line.at}
                      style={{ transitionDelay: `${Math.min(index, 4) * 70}ms` }}
                    >
                      <span className="vi-line__who">
                        {line.who === "ai" ? "Assistant" : "Candidate"}
                      </span>
                      <span className="vi-line__text">{line.text}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* ---- The structured report --------------------------------- */}
              <div className="vi-report" data-shown={stage >= 4}>
                <p className="vi-report__head">Screening report</p>

                <dl className="vi-report__fields">
                  {VOICE_REPORT.map((row, index) => (
                    <div
                      key={row.field}
                      className="vi-report__row"
                      style={{ transitionDelay: `${index * 60}ms` }}
                    >
                      <dt>{row.field}</dt>
                      <dd>
                        {row.value}

                        {/*
                          `uncertain_fields` is a real column. The product
                          surfaces what the model was unsure about so a
                          recruiter checks it first, which is the opposite of
                          what a confident-sounding summary would do.
                        */}
                        {row.uncertain && (
                          <span className="vi-flag" data-kind="uncertain">
                            Flagged uncertain
                          </span>
                        )}

                        {/*
                          THE PAIR THE SCHEMA KEEPS FOREVER. `ai_*` columns are
                          never updated after insert and `corrected_fields`
                          records the edit, so what the AI said and what a
                          person changed it to are both permanently visible.
                          This is the most honest thing the product does and it
                          only takes one line to show it.
                        */}
                        {row.corrected && (
                          <span
                            className="vi-flag"
                            data-kind="corrected"
                            // RENDERED ALWAYS, revealed at the review stage.
                            // Gating the JSX instead kept the single most
                            // distinctive line in this section out of the
                            // crawlable HTML until somebody scrolled to it —
                            // and out of it entirely without JavaScript.
                            // Everything else here gates visibility, not
                            // existence; this now matches.
                            data-shown={stage >= 5}
                          >
                            AI said &ldquo;{row.corrected.from}&rdquo; · corrected by{" "}
                            {row.corrected.by}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>

                {/*
                  NO SCORE, AND THAT IS A FINDING RATHER THAN AN OMISSION.
                  `screening_reports` has no score column — the call produces
                  fields and a summary, and the match score belongs to the
                  resume stage. A number here would be the easiest thing in
                  this section to invent and the hardest for a reader to check.
                */}
                <p className="vi-report__note" data-shown={stage >= 5}>
                  Reviewed by R. Menon · the candidate was told on the call that a
                  recruiter would read this.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
