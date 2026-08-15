// =============================================================================
// Chart primitives.
//
// Plain HTML/CSS and inline SVG — no charting library. The spec asks for a
// funnel and two focused bar charts, and a dependency would be more code than
// the charts.
//
// COLOR DECISIONS, and why they are what they are:
//
// - The funnel uses an ORDINAL ramp: one hue, monotonically lighter. Funnel
//   stages have a natural order, which is exactly when a ramp is correct (a
//   value-ramp on unordered categories would be wrong — it double-encodes bar
//   length as hue and burns the only free channel).
//
//   The steps were generated in OKLCH at a fixed hue and VALIDATED, not
//   eyeballed: monotone lightness, adjacent ΔL ≥ 0.06, and the lightest step
//   clearing 2:1 contrast against the white card. The obvious ramp
//   (#C7D2FE…#4338CA, straight from the Tailwind indigo scale) FAILS both the
//   step-gap and light-end checks — its lightest step sits at 1.49:1 on white,
//   effectively invisible.
//
// - Bar charts are SINGLE-SERIES, so every bar is the same colour. Colouring
//   bars darker-where-bigger would double-encode the length.
//
// - Status colours (warning, error) appear only where the value MEANS a status,
//   never as decoration, and always beside a text label so the meaning is not
//   carried by colour alone.
//
// - No dual axis anywhere. Two measures of different scale get two charts.
// =============================================================================

/**
 * The validated funnel ramp, LIGHT → DARK down the funnel.
 *
 * Generated at OKLCH hue 274, L from 0.74 to 0.40. Regenerate and re-validate
 * (skill `dataviz`, scripts/validate_palette.js --ordinal) before changing it.
 *
 * The direction was chosen after rendering it. Dark→light looked conventional
 * but compounded two weaknesses: bars get SHORTER down a funnel, so the last
 * steps ended up both smallest and palest — and those last steps (Offers,
 * Hired) are the ones anyone actually cares about. Reversed, the large top
 * bars are a calm light wash and the small outcome bars carry the most weight,
 * which is both more legible and the right emphasis.
 */
export const FUNNEL_RAMP = [
  "#98A7E6",
  "#8190D9",
  "#6B7ACB",
  "#5664BD",
  "#424DAF",
  "#3135A1",
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
        <p style={{ fontSize: 13, margin: "6px 0 0", color: trend.color ?? "var(--color-secondary-text)" }}>
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
// Funnel
// -----------------------------------------------------------------------------

export type FunnelBar = {
  label: string;
  count: number;
  conversion: string | null;
  conversionNote: string | null;
};

/**
 * Horizontal funnel bars.
 *
 * Horizontal rather than the classic tapering trapezoid: a trapezoid encodes
 * value in AREA, which people read badly, and the spec says "avoid 3D funnels".
 * Bar length is the one encoding everyone reads accurately.
 *
 * Widths are relative to the FIRST step, so the shape of the drop-off is the
 * visible thing. Every bar is direct-labelled with its count, because there are
 * six of them and the numbers are the point — this is the case where labelling
 * every mark is right rather than noise.
 */
export function FunnelChart({ bars }: { bars: FunnelBar[] }) {
  const max = Math.max(...bars.map((bar) => bar.count), 1);

  return (
    <div>
      {bars.map((bar, index) => {
        const width = barWidthPercent(bar.count, max);

        return (
          <div key={bar.label} style={{ marginBottom: index === bars.length - 1 ? 0 : 14 }}>
            <div
              className="is-flex is-justify-content-space-between"
              style={{ fontSize: 13, marginBottom: 4 }}
            >
              <span style={{ fontWeight: 600 }}>{bar.label}</span>
              <span className="has-text-secondary">
                {bar.conversion ? `${bar.conversion} from previous` : ""}
                {bar.conversionNote ? bar.conversionNote : ""}
              </span>
            </div>

            <div
              style={{ display: "flex", alignItems: "center", gap: 8 }}
              // The hover layer: an accessible name carrying the same facts the
              // visual does, for keyboard and screen-reader users.
              title={`${bar.label}: ${bar.count}${
                bar.conversion ? `, ${bar.conversion} conversion from the previous step` : ""
              }`}
            >
              <div
                style={{
                  width: `${width}%`,
                  height: 22,
                  background: rampStep(index),
                  // 4px rounded data-end, anchored square to the baseline.
                  borderRadius: "2px 4px 4px 2px",
                  minWidth: bar.count > 0 ? 4 : 0,
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{bar.count}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Single-series bar chart
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
            style={{ background: "var(--color-border)", borderRadius: 4, height: 8 }}
            title={`${bar.label}: ${bar.displayValue ?? bar.value}${bar.note ? ` — ${bar.note}` : ""}`}
          >
            <div
              style={{
                width: `${barWidthPercent(bar.value, max)}%`,
                height: 8,
                // One series, one colour. Status colour only where it means one.
                background: bar.statusColor ?? "var(--color-primary)",
                borderRadius: 4,
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
