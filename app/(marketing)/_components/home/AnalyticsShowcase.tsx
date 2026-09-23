"use client";

// =============================================================================
// ANALYTICS — activity becoming insight.
//
// -----------------------------------------------------------------------------
// THIS RENDERS THE PRODUCT'S OWN CHART COMPONENTS
// -----------------------------------------------------------------------------
//
// `KpiTile`, `FunnelChart`, `BarChart` and `OrbitalMeter` are imported from
// app/analytics/charts.tsx — the same modules the real analytics page renders.
// They turned out to be importable because they are pure: no "use client", no
// imports at all, no data access. Presentational components that happen to
// live under app/.
//
// That is worth more than a rebuilt lookalike. The funnel here IS the product's
// concentric-orbit funnel, with the shared twelve o'clock start and the legend
// its own comments argue for; the bar chart is the deliberately-linear one. If
// somebody changes how the product draws a funnel, this page changes with it.
//
// THE PRICE IS A TOKEN BRIDGE, and it is in the stylesheet under
// `.an-surface`. Those components style themselves with the APPLICATION's
// tokens, which are dark by default and flip with `prefers-color-scheme`. The
// marketing palette is deliberately pinned instead — the page's light and dark
// bands are art direction, not a preference — so a visitor whose OS is set to
// dark would otherwise get dark-mode chart colours on a white marketing card.
// The bridge re-declares the app tokens these components read, at their LIGHT
// values, unconditionally.
//
// -----------------------------------------------------------------------------
// WHAT THE SCROLL DOES
// -----------------------------------------------------------------------------
//
// Four beats: loose events, events grouped, the dashboard lit, and a person
// reading it. The dashboard is present and readable from the first frame —
// the beats change what is EMPHASISED, not what exists, so the section is
// complete for anyone who lands in the middle of it or has animation off.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_BEATS,
  ANALYTICS_EVENTS,
  ANALYTICS_FUNNEL,
  ANALYTICS_GROUPS,
  ANALYTICS_KPIS,
  ANALYTICS_SOURCES,
  ANALYTICS_STAGE_DAYS,
} from "@/lib/marketing/home";
import { BarChart, FunnelChart, KpiTile, OrbitalMeter } from "@/app/analytics/charts";

const BEAT_COUNT = ANALYTICS_BEATS.length;

export function AnalyticsShowcase() {
  const [beat, setBeat] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="an" ref={trackRef}>
      <div className="an__runway" aria-hidden="true">
        {ANALYTICS_BEATS.map((item, index) => (
          <span key={item.key} className="an__mark" data-mark={index} />
        ))}
      </div>

      <div className="an__pin">
        <div className="an__stage" data-beat={beat}>
          {/* ---- The raw activity ------------------------------------- */}
          <div className="an-stream">
            <p className="an-stream__head">
              Activity
              <span className="an-stream__demo">Illustrative</span>
            </p>

            {/*
              The same eight events at every beat — what changes is whether
              they are loose or sorted under their group. The group heading is
              rendered as text from beat 1 so the sorting is readable rather
              than only visible.
            */}
            <ul className="an-stream__list" data-grouped={beat >= 1}>
              {ANALYTICS_GROUPS.map((group) => (
                <li key={group} className="an-group">
                  <p className="an-group__name" aria-hidden={beat < 1}>
                    {group}
                  </p>
                  <ul className="an-group__items">
                    {ANALYTICS_EVENTS.filter((event) => event.group === group).map(
                      (event, index) => (
                        <li
                          key={event.label}
                          className="an-event"
                          data-tilt={index % 2}
                          style={{ transitionDelay: `${index * 60}ms` }}
                        >
                          <strong>{event.label}</strong>
                          <span>{event.meta}</span>
                        </li>
                      )
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          {/* ---- The dashboard ---------------------------------------- */}
          {/*
            `an-surface` is the token bridge — see the header. Everything
            inside it is the application's own component, drawing with the
            application's light-mode palette.
          */}
          <div className="an-surface" data-lit={beat >= 2}>
            <div className="an-surface__bar">
              <p className="an-surface__title">Hiring analytics</p>
              {/*
                The product's real filters, shown as a picture of the control
                rather than a working one — `aria-hidden` and not focusable,
                because a filter that cannot filter is worse than none. The
                four ranges are the real DATE_RANGES.
              */}
              <div className="an-surface__filters" aria-hidden="true">
                <span className="an-chip is-on">Last 30 days</span>
                <span className="an-chip">All jobs</span>
                <span className="an-chip">All recruiters</span>
              </div>
            </div>

            <div className="an-surface__kpis">
              {ANALYTICS_KPIS.map((kpi) => (
                <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} />
              ))}
            </div>

            <div className="an-surface__charts">
              <section className="an-card">
                <h3 className="an-card__title">Recruitment funnel</h3>
                <p className="an-card__sub">
                  Each step counts applications that ever reached it, not those
                  sitting there now.
                </p>
                <FunnelChart
                  bars={ANALYTICS_FUNNEL.map((row) => ({
                    label: row.label,
                    count: row.value,
                    conversion: `${row.pct}%`,
                    conversionNote: null,
                  }))}
                />
              </section>

              <section className="an-card">
                <h3 className="an-card__title">Time in stage</h3>
                <p className="an-card__sub">
                  Median days, from closed stage visits only. A stage nobody has
                  left yet shows no figure.
                </p>
                <BarChart
                  bars={ANALYTICS_STAGE_DAYS.map((row) => ({
                    label: row.label,
                    value: row.value ?? 0,
                    // The product prints an em dash rather than a zero when a
                    // stage has no completed visits. Reproducing the GAP is
                    // more honest than filling it in.
                    displayValue: row.value === null ? "—" : `${row.value}d`,
                  }))}
                />
              </section>

              <section className="an-card an-card--wide">
                <h3 className="an-card__title">Hire rate by source</h3>
                <p className="an-card__sub">
                  A source with too few candidates shows its raw counts instead
                  of a percentage.
                </p>
                <div className="an-meters">
                  {ANALYTICS_SOURCES.map((source) => (
                    <OrbitalMeter
                      key={source.label}
                      label={source.label}
                      percent={source.pct}
                      displayValue={source.pct === null ? source.raw : `${source.pct}%`}
                      note={source.pct === null ? "Too few to rate" : source.raw}
                      size={104}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* ---- The person at the end -------------------------------- */}
          <div className="an-human" data-shown={beat >= 3}>
            <span className="an-human__chain" aria-hidden="true" />
            <p className="an-human__text">
              <strong>A recruiter reads it.</strong> Analytics says where the
              process is slow and which sources are worth the effort. It does not
              rank candidates, and it decides nothing.
            </p>
          </div>
        </div>

        <div className="an__story">
          <ol className="an-beats">
            {ANALYTICS_BEATS.map((item, index) => (
              <li
                key={item.key}
                className="an-beats__item"
                data-state={index === beat ? "on" : index < beat ? "done" : "off"}
                aria-current={index === beat ? "step" : undefined}
              >
                <span className="an-beats__num" aria-hidden="true">
                  {item.num}
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ol>

          <div className="an__copy">
            {ANALYTICS_BEATS.map((item, index) => (
              <p key={item.key} className="an__copytext" hidden={index !== beat}>
                {item.copy}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
