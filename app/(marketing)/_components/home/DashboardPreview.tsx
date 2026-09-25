import { DASHBOARD, HERO_SIGNALS } from "@/lib/marketing/home";
import { iconFor } from "./icons";

/**
 * The bright product visual under the hero.
 *
 * WHY THIS IS BUILT IN HTML RATHER THAN BEING A SCREENSHOT.
 *
 * A PNG of the real dashboard would be heavier, would blur on a retina screen
 * unless shipped at 2x, would need re-cutting every time the product's chrome
 * changes, and would carry whatever test data happened to be on screen the day
 * it was taken. Built in markup it is a few KB of DOM, it is sharp at every
 * density, it reflows on a phone instead of becoming an unreadable
 * thumbnail — and its text is real text, so a screen reader and a search engine
 * both get the actual words.
 *
 * It also means there is no image to reserve space for and no image to shift
 * the page when it arrives: the frame has its own height from its own content
 * on the first paint, so this section contributes nothing to CLS.
 *
 * IT IS LABELLED AS ILLUSTRATIVE. The figures are plausible for a small team
 * rather than impressive, and the caption says they are an example. A product
 * shot carrying invented metrics presented as real is the same class of thing
 * as an invented testimonial.
 *
 * NO REAL CANDIDATE DATA CAN REACH THIS COMPONENT. It imports a static content
 * module and nothing else — no Supabase client, no props from a page that has
 * one. That is not an accident of the current implementation; the marketing
 * layout is forbidden from constructing a session client at all, so the only
 * data available here is the data in the file next to it.
 *
 * THE CHROME IS THE APPLICATION'S REAL CHROME. The sidebar is the real
 * top-level nav in the real order; the KPI tiles are the real METRIC_LABELS
 * with the real icons and the real "this number is bad news" amber edge; the
 * funnel rows are the real STAGE_LABELS. That is what makes this a picture of
 * Scoreboad rather than of a generic SaaS dashboard, and it costs nothing to
 * be accurate about.
 *
 * DELIBERATELY NOT INTERACTIVE. No tabs that switch, no hover states that imply
 * a control. It is a photograph of a product, and a mock that responds to
 * clicks by doing nothing is worse than one that plainly does not respond.
 */
export function DashboardPreview() {
  return (
    <div className="mkt-shell">
      <figure className="mkt-product">
        {/*
          The bloom behind the frame. Separate from the frame's own shadow so it
          can be much wider and much softer than a box-shadow would be sensible
          at, which is what makes the product read as lit from behind rather
          than as a card with a glow on it.
        */}
        <div className="mkt-product__halo" aria-hidden="true" />

        <div className="mkt-product__frame mkt-rise">
          {/* ---- The app chrome ------------------------------------------- */}
          <div className="mkt-product__bar" aria-hidden="true">
            <span className="mkt-product__dot" />
            <span className="mkt-product__dot" />
            <span className="mkt-product__dot" />
          </div>

          <div className="mkt-product__body">
            <nav className="mkt-product__side" aria-hidden="true">
              {DASHBOARD.nav.map((item, index) => (
                <span
                  key={item}
                  className={`mkt-product__navitem${index === 0 ? " is-active" : ""}`}
                >
                  {item}
                </span>
              ))}
            </nav>

            <div className="mkt-product__main">
              <div className="mkt-product__head">
                {/*
                  A <p>, NOT AN <h3>. This is chrome inside a PICTURE of the
                  product, and a heading here enters the page's real document
                  outline: a screen-reader user navigating the homepage by
                  heading arrived at "Overview" and "Hiring pipeline" as though
                  they were sections of the marketing page, straight after the
                  h1 and before the first real h2 — which also skipped a level.

                  The text stays in the DOM, so it is still crawlable and still
                  describes the product. It simply stops claiming to be a
                  section of this page.
                */}
                <p className="mkt-product__title">Overview</p>
                <span className="mkt-product__range">Last 30 days</span>
              </div>

              {/* ---- KPI tiles ------------------------------------------- */}
              <div className="mkt-product__tiles">
                {DASHBOARD.tiles.map((tile, index) => {
                  const Icon = iconFor(tile.icon);
                  return (
                    <div
                      key={tile.label}
                      className={`mkt-product__tile mkt-enter${tile.warn ? " is-warn" : ""}`}
                      /*
                        The stagger, as a delay per tile rather than a class per
                        tile. They start after the frame has largely settled, so
                        the panel arrives and then fills — which is the order the
                        real thing loads in.
                      */
                      style={{ animationDelay: `${560 + index * 45}ms` }}
                    >
                      <span className="mkt-product__tilehead">
                        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                        <span className="mkt-product__tilelabel">{tile.label}</span>
                      </span>
                      <strong className="mkt-product__tilevalue">{tile.value}</strong>
                    </div>
                  );
                })}
              </div>

              {/* ---- The funnel ------------------------------------------ */}
              <div
                className="mkt-product__panel mkt-enter"
                style={{ animationDelay: "740ms" }}
              >
                <div className="mkt-product__panelhead">
                  {/* Same reason as "Overview" above — mockup chrome, not a section. */}
                  <p className="mkt-product__paneltitle">Hiring pipeline</p>
                  <span className="mkt-product__range">Senior Backend Engineer</span>
                </div>

                <ol className="mkt-product__funnel">
                  {DASHBOARD.funnel.map((row, index) => (
                    <li key={row.stage} className="mkt-product__frow">
                      <span className="mkt-product__fstage">{row.stage}</span>
                      <span className="mkt-product__ftrack">
                        {/*
                          Width is the stage's share of the top of the funnel.
                          An inline width is unavoidable for a data-driven bar;
                          the COLOUR comes from a token, so the palette still
                          lives in one place.

                          The bar grows via `transform: scaleX()` from its own
                          class, NOT by animating this width — animating width
                          is a layout animation on every frame, which is the
                          thing the performance rules rule out.
                        */}
                        <span
                          className="mkt-product__fbar"
                          style={{
                            width: `${row.pct}%`,
                            background: `var(--mkt-ramp-${index})`,
                          }}
                        />
                      </span>
                      <span className="mkt-product__fvalue">{row.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/*
          ---- The floating signals ------------------------------------------

          DECORATIVE, AND HIDDEN FROM ASSISTIVE TECH. They restate nothing the
          page does not say elsewhere, and a screen reader announcing two fake
          notifications in the middle of the hero would be announcing UI that
          does not exist on this page.

          They sit OUTSIDE the frame, and the stylesheet removes them entirely
          below 1400px — the width at which there stops being room in the gutter
          for them. The alternative, letting them overlap the dashboard, trades
          a readable product shot for a flourish.
        */}
        <div className="mkt-product__signals" aria-hidden="true">
          {HERO_SIGNALS.map((signal, index) => {
            const Icon = iconFor(signal.icon);
            return (
              <div
                key={signal.title}
                className={`mkt-signal mkt-signal--${index === 0 ? "a" : "b"}`}
                data-tone={signal.tone}
                style={{ animationDelay: `${1150 + index * 160}ms` }}
              >
                <span className="mkt-signal__icon">
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="mkt-signal__text">
                  <strong>{signal.title}</strong>
                  <span>{signal.meta}</span>
                </span>
              </div>
            );
          })}
        </div>

        <figcaption className="mkt-product__caption">
          Example data, shown to illustrate the interface.
        </figcaption>
      </figure>
    </div>
  );
}
