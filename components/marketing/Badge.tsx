import type { ReactNode } from "react";

/**
 * A small status pill — the hero's "in active development" line, and whatever
 * later pages need to label honestly.
 *
 * `tone` exists so a badge can say something is NOT ready without that being
 * communicated by colour alone: the text always carries the meaning, and the
 * tone only reinforces it.
 */
export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent";
}) {
  return <p className={`mkt-pill${tone === "accent" ? " mkt-pill--accent" : ""}`}>{children}</p>;
}
