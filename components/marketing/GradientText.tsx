import type { ReactNode } from "react";

/**
 * A phrase in the brand gradient.
 *
 * THE FALLBACK IS THE WHOLE REASON THIS IS A COMPONENT. `background-clip: text`
 * needs a transparent fill, and if the gradient does not paint — an old engine,
 * a forced-colors mode, a printed page — transparent text is INVISIBLE text,
 * not merely unstyled text. So the CSS sets a solid colour first and only
 * clips inside an `@supports`, and wrapping that in a component means nobody
 * has to remember it at the next call site.
 *
 * Two stops only. A third starts to read as a rainbow.
 */
export function GradientText({
  children,
  /** `display` makes it its own line — for a headline's second clause. */
  as: Tag = "span",
  block = false,
}: {
  children: ReactNode;
  as?: "span" | "strong";
  block?: boolean;
}) {
  return (
    <Tag className={`mkt-gradient${block ? " mkt-gradient--block" : ""}`}>{children}</Tag>
  );
}
