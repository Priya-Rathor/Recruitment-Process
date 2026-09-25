import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The marketing card, in the variants the site actually uses.
 *
 * NOT SEVEN SEPARATE COMPONENTS. A brief asking for Light / Dark / Glass /
 * Feature / Product / Metric / Interactive cards is describing appearances,
 * not seven different things — they share a radius, a border, a padding and a
 * hover, and differ in surface and content. One component with a `variant` and
 * an optional icon covers all of them, and a card that needs genuinely
 * different structure is better written as itself than bent into a prop.
 *
 * `interactive` is a behaviour rather than a variant: any surface can be a
 * link, and whether it lifts on hover is independent of what colour it is.
 */
export type CardVariant = "light" | "dark" | "glass";

export function Card({
  children,
  variant = "light",
  icon: Icon,
  /** The icon well's tint. Mint marks a trust or safety point. */
  accent = "primary",
  title,
  /** The title's heading level. 4 when the grid sits under its own h3. */
  level = 3,
  interactive = false,
  className = "",
}: {
  children?: ReactNode;
  variant?: CardVariant;
  icon?: LucideIcon;
  accent?: "primary" | "mint";
  title?: string;
  level?: 3 | 4;
  interactive?: boolean;
  className?: string;
}) {
  const classes = [
    "mkt-lcard",
    variant === "dark" ? "mkt-lcard--dark" : "",
    variant === "glass" ? "mkt-lcard--glass" : "",
    interactive ? "mkt-lcard--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const Heading = level === 4 ? "h4" : "h3";

  return (
    <article className={classes}>
      {Icon && (
        <span
          className={`mkt-lcard__icon${accent === "mint" ? " mkt-lcard__icon--mint" : ""}`}
          aria-hidden="true"
        >
          {/*
            1.6 stroke everywhere. Mixing icon weights across a grid is the
            fastest way to make one look assembled rather than designed.
          */}
          <Icon size={19} strokeWidth={1.6} />
        </span>
      )}
      {title && <Heading>{title}</Heading>}
      {children}
    </article>
  );
}

/**
 * A figure and its label. The one card that is genuinely a different shape:
 * the number leads, and there is no icon well competing with it.
 */
export function MetricCard({
  value,
  label,
  note,
}: {
  /** Pre-formatted. A metric card never does arithmetic. */
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <article className="mkt-metric">
      <strong className="mkt-metric__value">{value}</strong>
      <span className="mkt-metric__label">{label}</span>
      {note && <span className="mkt-metric__note">{note}</span>}
    </article>
  );
}
