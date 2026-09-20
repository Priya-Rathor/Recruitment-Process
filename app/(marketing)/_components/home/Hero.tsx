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
 * THE RIBBONS ARE CSS GRADIENTS, NOT AN IMAGE OR A CANVAS. Three soft radial
 * washes plus two blurred conic shapes, all behind `aria-hidden`. The brief asks
 * for translucent ribbons and layered glass without robots, brains, circuits or
 * WebGL, and the honest way to get depth at zero weight is a few large, very
 * low-opacity shapes. No request, no library, nothing to lazy-load, and it
 * scales to any viewport because it is all percentages.
 *
 * THE PRODUCT VISUAL SITS INSIDE THE HERO rather than in a section of its own.
 * That is what produces the single most important contrast on the page — a
 * bright interface on a dark brand band — and splitting them would put a
 * section boundary through the middle of it.
 */
export function Hero() {
  return (
    <section className="mkt-hero">
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
        <p className="mkt-pill">{HERO.badge}</p>

        <h1 className="mkt-hero__h1">
          {HERO.headlineLead}
          {/*
            The accent half on its own line, and in a gradient rather than a
            flat colour — the brief's one place for a gradient on type. Two
            stops only (periwinkle to lavender): a third would start to read as
            a rainbow, which is explicitly ruled out.

            It is a <span>, not an <em> or a <strong>: this is a visual
            treatment of one phrase in a sentence, not emphasis a screen reader
            should announce.
          */}
          <span className="mkt-hero__accent">{HERO.headlineAccent}</span>
        </h1>

        <p className="mkt-hero__lead">{HERO.lead}</p>

        <div className="mkt-hero__ctas">
          <Link href="/signup" className="mkt-btn mkt-btn--primary">
            Get Started
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/how-it-works" className="mkt-btn mkt-btn--glass">
            See How It Works
          </Link>
        </div>
      </div>

      <DashboardPreview />
    </section>
  );
}
