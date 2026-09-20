import { Logo } from "@/components/Logo";

/**
 * The brand lockup for a DARK surface.
 *
 * WHY THIS EXISTS RATHER THAN REUSING <Logo variant="compact" />.
 *
 * The compact lockup is a RASTER asset painted in two flat colours — one for
 * "My", a dark one for "Recruiter" — and it was drawn for a light ground.
 *
 * Under the previous light theme that was fine everywhere except the marketing
 * site's dark band, where the dark half of the wordmark landed on a dark ground
 * and "Recruiter Partner" dropped to roughly 1:1 and simply disappeared: a
 * screenshot showed a blue "My" followed by nothing.
 *
 * FUTURE WORKFORCE MADE THAT THE DEFAULT CASE RATHER THAN THE EXCEPTION. The
 * whole product is dark now, so the asset's dark half is on a dark ground on
 * every screen, not just this one. Re-drawing the PNGs is a brand-asset job
 * (see docs/Memory.md) — but this component was already the right answer and is
 * now the right answer everywhere.
 *
 * Three ways out, and why this one:
 *
 *   - Filter or invert the PNG in CSS. Cheap, and wrong: it shifts every colour
 *     in the monogram's gradient too, so the mark stops being the brand's blue.
 *   - Generate a second light-on-dark asset. Correct, but that is a new brand
 *     asset and a design decision to take deliberately, not something to mint
 *     inside a marketing component.
 *   - Use the MONOGRAM on the light ground it was drawn for, and set the
 *     wordmark as real text in the display face.
 *
 * The third is what this does, and it beats the raster lockup here for reasons
 * past the contrast fix: the name becomes selectable text, it scales without
 * resampling, a screen reader gets it as text rather than as alt on an image,
 * and it costs no image request.
 *
 * The monogram is hidden from assistive tech on purpose. Its alt text is the
 * company's name — correct in the app, where the image IS the name — but here
 * the name sits beside it as real text, so leaving it exposed would announce
 * "MyRecruiter Partner MyRecruiter Partner". Hiding it at the wrapper is
 * preferable to widening the shared Logo component's props for one caller.
 *
 * Sizing and the mobile behaviour live in marketing.scss under .mkt-wordmark,
 * because the text has to be hidden below 30rem to keep the header from
 * overflowing and a media query cannot be written as an inline style.
 */
export function MarketingWordmark({ height = 30 }: { height?: number }) {
  return (
    <span className="mkt-wordmark" style={{ ["--mkt-mark-size" as string]: `${height}px` }}>
      {/*
        THE MARK GETS A LIGHT PLATE, and it is not decoration.

        The monogram is a gradient running blue → navy core → azure. Two of
        those three stops are the same family as this header's ground, so placed
        directly on the navy the M and the left stroke of the R read fine while
        the dark core of the R sinks into the background — the mark renders as a
        blue fragment rather than a monogram.

        Rather than recolour the brand, it is given the light surface it was
        drawn for. The plate is sized from the mark itself so it reads as a
        badge rather than a box, and every stop in the gradient lands at the
        contrast it was sampled at.
      */}
      <span className="mkt-wordmark__plate" aria-hidden="true">
        <Logo variant="mark" height={height} priority />
      </span>
      <span className="mkt-wordmark__text">
        MyRecruiter <span className="mkt-wordmark__qualifier">Partner</span>
      </span>
    </span>
  );
}
