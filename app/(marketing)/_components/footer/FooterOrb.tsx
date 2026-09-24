// =============================================================================
// THE FOOTER'S SIGNATURE VISUAL — the hiring workflow converging on the mark.
//
// §24's continuity idea, drawn at the smallest size that still reads: five
// stage labels on the left, five thin lines gathering into one point, and the
// Scoreboad mark at the focus. It is the same sequence the homepage's bands
// walk through, so the footer closes the narrative rather than starting a new
// one.
//
// A SERVER COMPONENT, inline SVG and CSS. No library, no canvas, no WebGL and
// no image to download — the whole thing is a few hundred bytes of markup.
//
// THE LINES ARE DRAWN, NOT ANIMATED INTO EXISTENCE. Every keyframe lives behind
// `prefers-reduced-motion: no-preference` in the stylesheet, so the default
// rendering is the finished diagram. §6 also says explicitly that this must
// stay subtle: it is decoration under a navigation block, not a second hero.
//
// aria-hidden, because the five labels are the product's stages named again —
// a screen reader reaching the footer wants the links, not a list of words that
// go nowhere.
// =============================================================================

import { Logo } from "@/components/Logo";
import { FOOTER_BRAND } from "@/lib/marketing/footer";

export function FooterOrb() {
  const stages = FOOTER_BRAND.converge;

  return (
    <div className="ft-orb" aria-hidden="true">
      <ul className="ft-orb__stages">
        {stages.map((stage, index) => (
          <li key={stage} style={{ "--i": index } as React.CSSProperties}>
            {stage}
          </li>
        ))}
      </ul>

      {/*
        The convergence. A viewBox rather than fixed pixels so it scales with
        the column, and `preserveAspectRatio="none"` is deliberately NOT set —
        the lines should keep their angle rather than shear.
      */}
      <svg className="ft-orb__lines" viewBox="0 0 120 120" role="presentation" focusable="false">
        {stages.map((stage, index) => {
          // Five evenly spaced origins on the left edge, all meeting the focus.
          const y = 12 + index * 24;
          /*
            pathLength={1} normalises each path to one unit, so a single
            dash/offset pair draws all five identically however different their
            real lengths are. It is an SVG ATTRIBUTE — the same name is not a
            CSS property, and setting it in the stylesheet silently does
            nothing, which is how the draw-on animation was briefly a no-op.
          */
          return (
            <path
              key={stage}
              className="ft-orb__line"
              style={{ "--i": index } as React.CSSProperties}
              d={`M0 ${y} C 52 ${y}, 62 60, 112 60`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              pathLength={1}
            />
          );
        })}
      </svg>

      <span className="ft-orb__mark">
        <span className="ft-orb__glow" />
        <Logo variant="mark" height={38} />
      </span>
    </div>
  );
}
