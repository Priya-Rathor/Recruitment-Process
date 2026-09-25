import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The closing ask — the page's third and last deep band.
 *
 * Same ribbon treatment as the hero, at lower opacity, so the page closes where
 * it opened without repeating it at full strength. The buttons are the hero's
 * buttons: a reader who scrolled the whole page and is now deciding should meet
 * the same two choices they were offered at the top, not new ones.
 */
export function FinalCta() {
  return (
    <section className="mkt-band mkt-band--dark mkt-band--cta">
      <div className="mkt-hero__aura mkt-hero__aura--quiet" aria-hidden="true">
        <span className="mkt-ribbon mkt-ribbon--1" />
        <span className="mkt-ribbon mkt-ribbon--2" />
      </div>

      <div className="mkt-shell mkt-ctablock">
        <h2>Build your next team with Scoreboad.</h2>
        <p className="mkt-bandlead">
          Bring your hiring workflow into one intelligent workspace.
        </p>

        <div className="mkt-hero__ctas">
          <Link href="/signup" className="mkt-btn mkt-btn--primary">
            Get started
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link href="/how-it-works" className="mkt-btn mkt-btn--glass">
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
