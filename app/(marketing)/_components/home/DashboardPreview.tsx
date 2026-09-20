import { DASHBOARD } from "@/lib/marketing/home";

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
 * IT IS LABELLED AS ILLUSTRATIVE. The figures are plausible for a small team
 * rather than impressive, and the caption says they are an example. A product
 * shot carrying invented metrics presented as real is the same class of thing
 * as an invented testimonial.
 *
 * THE SIDEBAR IS THE APPLICATION'S REAL TOP-LEVEL NAV, in the real order. That
 * is what makes this a picture of Scoreboad rather than of a generic SaaS
 * dashboard, and it costs nothing to be accurate about.
 *
 * DELIBERATELY NOT INTERACTIVE. No tabs that switch, no hover states that imply
 * a control. It is a photograph of a product, and a mock that responds to
 * clicks by doing nothing is worse than one that plainly does not respond.
 */
export function DashboardPreview() {
  return (
    <div className="mkt-shell">
      <figure className="mkt-product">
        <div className="mkt-product__frame">
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
                  <span className="mkt-product__navdot" />
                  {item}
                </span>
              ))}
            </nav>

            <div className="mkt-product__main">
              <div className="mkt-product__head">
                <h3>Overview</h3>
                <span className="mkt-product__range">Last 30 days</span>
              </div>

              {/* ---- KPI tiles ------------------------------------------- */}
              <div className="mkt-product__tiles">
                {DASHBOARD.tiles.map((tile) => (
                  <div key={tile.label} className="mkt-product__tile">
                    <span className="mkt-product__tilelabel">{tile.label}</span>
                    <strong className="mkt-product__tilevalue">{tile.value}</strong>
                    {/*
                      The delta carries an arrow as well as a colour, so the
                      direction is not communicated by colour alone — the same
                      rule the real dashboard follows.
                    */}
                    <span
                      className={`mkt-product__delta${tile.good ? " is-good" : ""}`}
                    >
                      {tile.good ? "▲" : "•"} {tile.delta}
                    </span>
                  </div>
                ))}
              </div>

              {/* ---- The funnel ------------------------------------------ */}
              <div className="mkt-product__panel">
                <div className="mkt-product__panelhead">
                  <h4>Hiring pipeline</h4>
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

        <figcaption className="mkt-product__caption">
          Example data, shown to illustrate the interface.
        </figcaption>
      </figure>
    </div>
  );
}
