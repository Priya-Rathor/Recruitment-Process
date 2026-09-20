import type { ReactNode } from "react";

/**
 * A page band — the unit the marketing site's rhythm is made of.
 *
 * WHY A COMPONENT WHEN THE CSS CLASSES ALREADY EXIST. The classes stay the
 * single source of styling; this is a typed API over them. Before it, a new
 * section meant remembering `mkt-band mkt-band--light`, nesting a
 * `mkt-shell` inside it, and knowing that two light bands in a row need
 * `--flush` on the second or they double their padding. Three things to know
 * and one of them invisible until you look at the rendered gap.
 *
 * THE TONE CARRIES THE RHYTHM. The site alternates dark and light deliberately
 * — brightness is a relationship, not a value — and a `tone` prop makes that
 * alternation visible when reading a page's composition, instead of being
 * buried in a className on each section.
 */
export type SectionTone = "dark" | "light" | "statement";

export function Section({
  children,
  tone = "light",
  /**
   * Removes the top padding. For a band that shares a ground with the one
   * above it: two light bands in a row are one surface, and the padding
   * between them is the rhythm rather than two paddings meeting.
   */
  flush = false,
  id,
  className = "",
  /** Rendered instead of a plain container — for the hero's ribbons. */
  backdrop,
}: {
  children: ReactNode;
  tone?: SectionTone;
  flush?: boolean;
  id?: string;
  className?: string;
  backdrop?: ReactNode;
}) {
  const classes = [
    "mkt-band",
    `mkt-band--${tone}`,
    flush ? "mkt-band--flush" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} id={id}>
      {backdrop}
      <div className="mkt-shell">{children}</div>
    </section>
  );
}
