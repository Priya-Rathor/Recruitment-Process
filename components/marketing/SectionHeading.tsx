import type { ReactNode } from "react";

/**
 * The eyebrow / heading / lead group that opens a band.
 *
 * THE HEADING LEVEL IS A PROP, AND DEFAULTS TO h2, because heading order is
 * structure rather than size. A page has one h1 — the hero — and every band
 * below it opens an h2. Before this component that was a convention; now the
 * wrong level has to be typed deliberately.
 *
 * The eyebrow is a <p>, NOT an h3 or a small h2. It reads as a heading and is
 * not one: promoting it would put an empty level in the outline and a screen
 * reader would announce two headings where a reader sees one.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  as: Tag = "h2",
  tone = "light",
  /** Centres the group. For the closing CTA, where the band is centred. */
  centered = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  as?: "h1" | "h2";
  tone?: "light" | "dark";
  centered?: boolean;
}) {
  return (
    <div
      className={`mkt-bandhead${tone === "dark" ? " mkt-bandhead--dark" : ""}`}
      style={centered ? { marginInline: "auto", textAlign: "center" } : undefined}
    >
      {eyebrow && (
        <p className={`mkt-eyebrow${tone === "light" ? " mkt-eyebrow--light" : ""}`}>
          {eyebrow}
        </p>
      )}
      <Tag>{title}</Tag>
      {lead && <p className="mkt-bandlead">{lead}</p>}
    </div>
  );
}
