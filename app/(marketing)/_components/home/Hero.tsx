import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HERO } from "@/lib/marketing/home";
import { DashboardPreview } from "./DashboardPreview";

/**
 * The hero.
 *
 * DEEP NAVY, and the only section on the page that is allowed to be cinematic.
 * Everything below it is bright; this band is what the brightness is measured
 * against.
 *
 * THE RIBBONS ARE CSS GRADIENTS, NOT AN IMAGE OR A CANVAS. Soft radial washes
 * plus a luminous horizon at the band's foot, all behind `aria-hidden`. The
 * brief asks for translucent ribbons and layered glass without robots, brains,
 * circuits or WebGL, and the honest way to get depth at zero weight is a few
 * large, very low-opacity shapes. No request, no library, nothing to lazy-load,
 * and it scales to any viewport because it is all percentages.
 *
 * THE PRODUCT VISUAL SITS INSIDE THE HERO rather than in a section of its own.
 * That is what produces the single most important contrast on the page — a
 * bright interface on a dark brand band — and splitting them would put a
 * section boundary through the middle of it.
 *
 * ---------------------------------------------------------------------------
 * THE ENTRANCE IS PURE CSS, AND THE ORDER OF THE DELAYS IS AN LCP DECISION.
 *
 * `.mkt-enter` is a keyframe animation with `animation-fill-mode: both`, so an
 * element with a delay sits at opacity 0 until its turn. That is exactly the
 * mechanism that ruins a Largest Contentful Paint score: Chrome does not treat
 * a fully transparent element as a paint candidate, so a 300ms delay on the
 * headline is 300ms added to LCP, measured and reported.
 *
 * So THE H1 AND THE BADGE HAVE NO DELAY. They start fading on the first frame,
 * which costs LCP roughly one frame rather than a third of a second. Only the
 * elements below the fold-defining headline — the lead, the buttons, the
 * dashboard — are staggered.
 *
 * It is CSS rather than the site's <Reveal> for two reasons. Reveal is
 * scroll-driven and needs JavaScript, which means the hero would be invisible
 * until hydration on the one screen where that is least acceptable; and this
 * is a one-off choreography with its own shape (a rise and a settle), not the
 * page's repeating scroll language. Reduced motion is honoured in the
 * stylesheet, where the rest of the site's is.
 */
export function Hero() {
  return (
    /*
      A LABELLED LANDMARK. `aria-labelledby` pointing at the H1 gives the
      section a name in a screen reader's landmark list — "Find the Right
      People Faster with AI, region" — rather than an anonymous "region" a
      reader has to enter to identify.
    */
    <section className="mkt-hero" aria-labelledby="hero-heading">
      {/*
        Decorative only, and hidden from assistive tech. A screen reader
        announcing "image" here would be announcing a gradient.
      */}
      <div className="mkt-hero__aura" aria-hidden="true">
        <span className="mkt-ribbon mkt-ribbon--1" />
        <span className="mkt-ribbon mkt-ribbon--2" />
        <span className="mkt-ribbon mkt-ribbon--3" />
      </div>

      <div className="mkt-shell mkt-hero__inner">
        <p className="mkt-pill mkt-enter">{HERO.badge}</p>

        {/*
          THE ONLY H1 ON THE PAGE. Every other section below opens at h2, and
          the product visual's headings start at h3 so the outline never skips
          a level.

          No `mkt-enter` delay — see the note above. This is the LCP element.
        */}
        <h1 id="hero-heading" className="mkt-hero__h1 mkt-enter">
          {HERO.headlineLead}
          {/*
            AN EXPLICIT SPACE, AND IT IS NOT A FORMATTING NICETY.

            The accent span is `display: block`, so the two halves LOOK like two
            lines either way — but JSX drops the whitespace between an
            expression and an element, and the H1's textContent was
            "Find the Right PeopleFaster with AI". That is the string a crawler
            extracts and the string an accessibility tree builds its name from:
            one word that does not exist, in the single most important heading
            on the site. The space collapses to nothing visually because the
            span breaks the line anyway.
          */}
          {" "}
          {/*
            The accent half on its own line, and in a gradient rather than a
            flat colour — the brief's one place for a gradient on type. Two
            stops only (periwinkle to lavender): a third would start to read as
            a rainbow, which is explicitly ruled out.

            It is a <span>, not an <em> or a <strong>: this is a visual
            treatment of one phrase in a sentence, not emphasis a screen reader
            should announce. The H1 still reads as one continuous sentence.
          */}
          <span className="mkt-hero__accent">{HERO.headlineAccent}</span>
        </h1>

        <p className="mkt-hero__lead mkt-enter" style={{ animationDelay: "90ms" }}>
          {HERO.lead}
        </p>

        {/*
          The second line is quieter than the first on purpose: it carries the
          detail a search engine and a careful reader both want, and a visitor
          skimming for the CTA can skip it without missing the promise.
        */}
        <p className="mkt-hero__detail mkt-enter" style={{ animationDelay: "150ms" }}>
          {HERO.leadDetail}
        </p>

        <div className="mkt-hero__ctas mkt-enter" style={{ animationDelay: "210ms" }}>
          <Link href={HERO.ctaPrimary.href} className="mkt-btn mkt-btn--primary">
            {HERO.ctaPrimary.label}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          {/*
            "Explore the Platform" against /how-it-works, because /platform does
            not exist. The label describes what the destination is — the whole
            platform walked through end to end — rather than naming a route
            somebody would then have to build to match it.
          */}
          <Link href={HERO.ctaSecondary.href} className="mkt-btn mkt-btn--glass">
            {HERO.ctaSecondary.label}
          </Link>
        </div>
      </div>

      <DashboardPreview />

      {/*
        THE HORIZON — the hero's bottom edge, and the transition into the
        bright section below it.

        A wide, very soft light wash sitting on the band's foot. It does two
        jobs the brief asks for separately: it is the "luminous horizon" of the
        background concept, and it stops the navy from meeting the next
        section's near-white at a hard line. Painted last and at low opacity so
        it lifts the dashboard's base rather than competing with it.
      */}
      <div className="mkt-hero__horizon" aria-hidden="true" />
    </section>
  );
}
