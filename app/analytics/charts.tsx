// =============================================================================
// Chart primitives — FUTURE WORKFORCE.
//
// Plain HTML/CSS and inline SVG. No charting library: a dependency would be more
// code than these four forms.
//
// THE FORM FOLLOWS THE DATA'S JOB, and the theme asked for orbital/radial. Those
// two things agree in some places and conflict in others, so they were resolved
// case by case rather than globally:
//
//   RATIO AGAINST A LIMIT -> OrbitalMeter (a radial arc).
//     Conversion rates, hire rates, completion rates. A ratio against 100% is
//     exactly what a meter is for, so here the requested form IS the correct
//     one. Each of these used to be a bar in a track, which spent a length
//     encoding on a number that only ever ranges 0-100.
//
//   ORDERED PART-TO-WHOLE -> FunnelChart, as CONCENTRIC ORBITS.
//     Every ring starts at twelve o'clock and sweeps by its share of the top of
//     the funnel. Nested arcs from a SHARED START ANGLE stay comparable — the
//     reader compares sweep against a common origin — which is the one radial
//     arrangement that does not wreck comparison. Pie slices at differing start
//     angles would.
//
//   MAGNITUDE ACROSS CATEGORIES -> BarChart, STILL LINEAR. Deliberately.
//     "Median days in each stage" and "candidates by source" compare magnitudes
//     across unordered categories, and arc length at differing radii is the
//     worst common encoding for that: arcs compare badly by eye, and a longer
//     arc at a smaller radius can be the smaller value. The dataviz
//     anti-pattern list names a donut for comparing close values as simply
//     wrong. Converting these would have cost a recruiter the ability to see
//     which stage is slow in exchange for looking more orbital, so they stayed
//     linear and were restyled instead. Called out in the completion report
//     rather than changed quietly.
//
// COLOUR COMES FROM TOKENS, NEVER A LITERAL HERE. Every ramp step and series
// colour is a var() into app/globals.scss, so there is one copy of the palette
// and app/theme.test.ts can assert its contrast and monotonicity against the
// real values. The retired theme hard-coded six hexes in this file, which is
// exactly how its ramp drifted out of step with its own tokens.
//
// The ramp and the series were generated in OKLCH and validated with the
// dataviz skill's validator — lightness band, chroma floor, CVD separation,
// normal-vision floor, contrast against the surface, and ordinal step gaps.
// The numbers are recorded in globals.scss beside the tokens.
//
// STILL TRUE FROM BEFORE, AND WORTH KEEPING:
//   - Status colours appear only where the value MEANS a status, never as
//     decoration, and always beside a text label so meaning is not colour-alone.
//   - No dual axis anywhere. Two measures of different scale get two charts.
// =============================================================================

/**
 * The ordinal funnel ramp — LIGHT at the top of the funnel, DEEP at the bottom.
 *
 * TOKEN REFERENCES, not hexes. The values live in app/globals.scss
 * (--ramp-0 .. --ramp-5) and app/theme.test.ts asserts them there for monotone
 * lightness and visible step gaps. Holding them here as literals is what let
 * the retired theme's ramp drift away from its own tokens.
 *
 * The DIRECTION was chosen after rendering it, and it survives the theme change
 * for the reason it was chosen: rings get shorter down a funnel, so light-to-deep
 * leaves the small outcome rings (Offers, Hired) — the ones anyone actually
 * cares about — carrying the most visual weight, while the big top rings stay a
 * calm wash. Deep-to-light made the last steps both smallest and palest.
 */
export const FUNNEL_RAMP = [
  "var(--ramp-0)",
  "var(--ramp-1)",
  "var(--ramp-2)",
  "var(--ramp-3)",
  "var(--ramp-4)",
  "var(--ramp-5)",
] as const;

export function rampStep(index: number): string {
  return FUNNEL_RAMP[Math.min(index, FUNNEL_RAMP.length - 1)];
}

/**
 * Bar width as a percentage of the widest bar.
 *
 * Extracted and tested because this is the arithmetic that actually breaks:
 * a zero max divides to NaN, a negative value produces a bar extending
 * leftwards out of its track, and a genuine-but-tiny value rounds to a width of
 * zero and disappears — which reads as "no data" when the data says otherwise.
 *
 * A non-zero value therefore always gets at least a visible sliver, and zero
 * always gets nothing.
 */
export function barWidthPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  if (value <= 0) return 0;

  return Math.min(Math.max((value / max) * 100, 1.5), 100);
}

// -----------------------------------------------------------------------------
// KPI tile
// -----------------------------------------------------------------------------

export function KpiTile({
  label,
  value,
  caption,
  trend,
}: {
  label: string;
  /** Pre-formatted. A tile never does arithmetic. */
  value: string;
  caption?: string | null;
  trend?: {
    text: string;
    color: string | null;
    arrow: "up" | "down" | "flat";
  } | null;
}) {
  return (
    <div className="card" style={{ flex: "1 1 180px", minWidth: 160 }}>
      <p
        className="has-text-secondary"
        style={{ fontSize: 13, margin: 0, textTransform: "none" }}
      >
        {label}
      </p>
      <p style={{ fontSize: 30, fontWeight: 700, margin: "4px 0 0", lineHeight: 1.1 }}>{value}</p>

      {trend && (
        <p style={{ fontSize: 13, margin: "6px 0 0", color: trend.color ?? "var(--color-text-secondary)" }}>
          {/* The arrow follows the NUMBER; the colour follows the VERDICT. A
              falling time-to-hire is a green down arrow. */}
          {trend.arrow === "up" ? "▲" : trend.arrow === "down" ? "▼" : "■"} {trend.text}
        </p>
      )}

      {caption && (
        <p className="has-text-secondary" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {caption}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Orbital meter — a ratio against a limit
// -----------------------------------------------------------------------------

/**
 * ORBITAL METER — one ratio against 100%.
 *
 * The theme's signature form, and the correct form for this data rather than a
 * concession to it: a ratio against a limit is what a meter is for. The value
 * is the hero number in the middle; the arc is the at-a-glance read.
 *
 * GEOMETRY. One circle, stroked twice — a full-circumference track and a value
 * arc clipped with stroke-dasharray. No path arithmetic, which means no
 * arc-flag edge case at 50% and none of the wrapping bugs a hand-built arc
 * path has at 0 and 100.
 *
 * Starts at TWELVE O'CLOCK and sweeps clockwise, because that is where a reader
 * expects zero to be. Round caps, because the brief says nothing sharp.
 *
 * A NULL VALUE IS NOT ZERO. An absent rate draws an empty track and says so —
 * a meter pinned at 0% is a claim that nobody converted, which is a different
 * statement from "we cannot compute this yet".
 */
export function OrbitalMeter({
  label,
  percent,
  displayValue,
  note,
  tone = "primary",
  size = 132,
}: {
  label: string;
  /** 0-100, or null when there is nothing to show. */
  percent: number | null;
  /** Pre-formatted. The meter never does arithmetic. */
  displayValue: string;
  note?: string | null;
  /** Status tone only where the value MEANS a status. */
  tone?: "primary" | "success" | "warning" | "error";
  size?: number;
}) {
  const RADIUS = 48;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  // Clamped, because a rate computed from a tiny denominator can exceed 100 and
  // an arc longer than its circumference silently wraps back over itself.
  const clamped =
    percent === null || !Number.isFinite(percent) ? null : Math.min(Math.max(percent, 0), 100);

  const stroke =
    tone === "success"
      ? "var(--color-success)"
      : tone === "warning"
        ? "var(--color-warning)"
        : tone === "error"
          ? "var(--color-error)"
          : "var(--color-primary)";

  return (
    <div className="orbital">
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${displayValue}`}
        className="orbital__svg"
      >
        {/* The track. Recessive — it is the scale, not a mark. */}
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth="9"
        />

        {clamped !== null && clamped > 0 && (
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - clamped / 100)}
            // -90deg puts zero at twelve o'clock; the sweep then runs clockwise.
            transform="rotate(-90 60 60)"
            className="orbital__arc"
          />
        )}

        {/*
          The value, inside the ring. TEXT TOKENS, not the arc's colour — the
          mark beside it already carries the identity, and colouring the number
          too makes a figure that is hard to read at 12px.
        */}
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          className="orbital__value"
        >
          {displayValue}
        </text>
      </svg>

      <p className="orbital__label">{label}</p>
      {note && <p className="orbital__note">{note}</p>}
    </div>
  );
}

/** A row of meters, so a set of rates shares one scale and one rhythm. */
export function OrbitalMeterRow({ meters }: { meters: React.ComponentProps<typeof OrbitalMeter>[] }) {
  if (meters.length === 0) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        No data in this period.
      </p>
    );
  }

  return (
    <div className="orbital-row">
      {meters.map((meter) => (
        <OrbitalMeter key={meter.label} {...meter} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Funnel — concentric orbits
// -----------------------------------------------------------------------------

export type FunnelBar = {
  label: string;
  count: number;
  conversion: string | null;
  conversionNote: string | null;
};

/**
 * THE FUNNEL AS CONCENTRIC ORBITS.
 *
 * Each stage is a ring. Every ring starts at twelve o'clock and sweeps by its
 * share of the TOP of the funnel, so the outermost ring is a full circle and
 * each one inside it is shorter. The drop-off is the gap between one sweep and
 * the next.
 *
 * WHY THIS RADIAL FORM IS LEGITIMATE WHERE A PIE IS NOT. The usual objection to
 * radial encodings is that the reader has to compare arcs at different radii,
 * which they do badly. Two things fix it here: every arc shares a start angle,
 * so the comparison is of END angle against a common origin rather than of
 * length; and every ring is DIRECT-LABELLED with its count and conversion, so
 * the arc is the at-a-glance shape while the numbers are the precise read. The
 * fill never carries the value alone.
 *
 * Replaces a horizontal bar list. The bars were a better pure encoding — this
 * is a considered trade for the theme's requested form, made safe by the shared
 * start angle and the labels, and it is called out in the report.
 *
 * The legend is not optional at six rings: the dataviz rules require one for
 * more than four series, and it doubles as the table view.
 */
export function FunnelChart({ bars }: { bars: FunnelBar[] }) {
  if (bars.length === 0) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        No applications in this period.
      </p>
    );
  }

  // Share of the TOP of the funnel, not of the widest ring — the top is the
  // denominator a funnel is read against.
  const top = Math.max(bars[0]?.count ?? 0, 1);

  const OUTER = 88;
  const STEP = 14;        // ring pitch
  const WIDTH = 10;       // stroke, leaving a 4px surface gap between rings

  return (
    <div className="funnel-orbit">
      <svg
        viewBox="0 0 200 200"
        className="funnel-orbit__svg"
        role="img"
        aria-label={`Pipeline funnel: ${bars
          .map((bar) => `${bar.label} ${bar.count}`)
          .join(", ")}`}
      >
        {bars.map((bar, index) => {
          const radius = OUTER - index * STEP;
          if (radius <= WIDTH / 2) return null;

          const circumference = 2 * Math.PI * radius;
          const share = Math.min(Math.max(bar.count / top, 0), 1);

          return (
            <g key={bar.label}>
              <circle
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke="var(--chart-track)"
                strokeWidth={WIDTH}
              />
              {share > 0 && (
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={rampStep(index)}
                  strokeWidth={WIDTH}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - share)}
                  transform="rotate(-90 100 100)"
                >
                  {/* The hover layer, carrying the same facts the visual does. */}
                  {/*
                    ONE string child. Two adjacent text children make React
                    emit a <!-- --> separator on the server, and an SVG <title>
                    does not keep it the way HTML does — so the client saw
                    different text and threw away the whole page's hydration.
                  */}
                  <title>
                    {`${bar.label}: ${bar.count}${
                      bar.conversion ? ` — ${bar.conversion} from the previous stage` : ""
                    }`}
                  </title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      {/*
        THE LEGEND, WHICH IS ALSO THE TABLE VIEW. Identity is never carried by
        colour alone: every row pairs its swatch with the stage name, the count
        and the conversion, so a colourblind reader, a screen-reader user and
        somebody reading a greyscale printout all get the whole dataset.
      */}
      <ol className="funnel-orbit__legend">
        {bars.map((bar, index) => (
          <li key={bar.label} className="funnel-orbit__row">
            <span
              className="funnel-orbit__swatch"
              style={{ background: rampStep(index) }}
              aria-hidden="true"
            />
            <span className="funnel-orbit__stage">{bar.label}</span>
            <span className="funnel-orbit__count">{bar.count}</span>
            <span className="funnel-orbit__conv">
              {bar.conversion ? `${bar.conversion} from previous` : ""}
              {bar.conversionNote ?? ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Single-series bar chart — STILL LINEAR, deliberately
//
// See this file's header. These compare magnitudes across unordered categories
// ("median days in each stage", "candidates by source"), which is the one job a
// radial form does measurably worse: arcs at differing radii compare badly by
// eye, and a longer arc at a smaller radius can be the smaller value. Restyled
// into the theme rather than converted.
// -----------------------------------------------------------------------------

export type Bar = {
  label: string;
  value: number;
  /** Shown instead of the raw value — e.g. "—" for an absent rate. */
  displayValue?: string;
  /** Only for values that MEAN a status. Never decorative. */
  statusColor?: string | null;
  /** Required beside a status colour, so meaning is never colour-alone. */
  statusLabel?: string | null;
  note?: string | null;
};

export function BarChart({
  bars,
  emptyMessage = "No data in this period.",
}: {
  bars: Bar[];
  emptyMessage?: string;
}) {
  if (bars.length === 0) {
    return (
      <p className="has-text-secondary" style={{ fontSize: 13 }}>
        {emptyMessage}
      </p>
    );
  }

  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div>
      {bars.map((bar, index) => (
        <div key={bar.label} style={{ marginBottom: index === bars.length - 1 ? 0 : 12 }}>
          <div
            className="is-flex is-justify-content-space-between"
            style={{ fontSize: 13, marginBottom: 3 }}
          >
            <span>{bar.label}</span>
            <span style={{ fontWeight: 600 }}>
              {bar.displayValue ?? bar.value}
              {bar.statusLabel && (
                <span
                  className="ml-2"
                  style={{ fontSize: 12, fontWeight: 600, color: bar.statusColor ?? undefined }}
                >
                  {bar.statusLabel}
                </span>
              )}
            </span>
          </div>

          <div
            style={{
              // The TRACK token rather than the border colour: a track is chart
              // chrome and must stay recessive behind its mark, while the border
              // token is tuned to be visible as an edge.
              background: "var(--chart-track)",
              borderRadius: "var(--radius-pill)",
              height: 8,
              overflow: "hidden",
            }}
            title={`${bar.label}: ${bar.displayValue ?? bar.value}${bar.note ? ` — ${bar.note}` : ""}`}
          >
            <div
              style={{
                width: `${barWidthPercent(bar.value, max)}%`,
                height: 8,
                // One series, one colour. Status colour only where it means one.
                background: bar.statusColor ?? "var(--chart-1)",
                // Pill ends, matching the meters' round caps — the theme's
                // "nothing sharp" applied to a data mark.
                borderRadius: "var(--radius-pill)",
              }}
            />
          </div>

          {bar.note && (
            <p className="has-text-secondary" style={{ fontSize: 12, margin: "3px 0 0" }}>
              {bar.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Section wrapper, so every panel gets the same card treatment and heading. */
export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="card mb-4">
      <h2 className="title is-5 mb-1">{title}</h2>
      {subtitle && (
        <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
          {subtitle}
        </p>
      )}
      {!subtitle && <div style={{ height: 12 }} />}
      {children}
    </div>
  );
}
