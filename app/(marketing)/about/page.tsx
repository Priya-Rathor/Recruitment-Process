import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  ABOUT_AI,
  ABOUT_CTA,
  ABOUT_HERO,
  ABOUT_JOURNEY,
  ABOUT_MISSION,
  ABOUT_PRINCIPLES,
} from "@/lib/marketing/about";
import { buildMetadata } from "@/lib/marketing/seo";
import { Breadcrumbs } from "@/components/marketing/Breadcrumbs";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { Logo } from "@/components/Logo";

/**
 * Built by the shared helper, so the canonical, the Open Graph block and the
 * Twitter card are constructed exactly as every other public page's are. The
 * title picks up the "%s · Scoreboad" template from the marketing layout.
 */
export const metadata: Metadata = buildMetadata({
  title: "About",
  description:
    "Scoreboad is an AI-powered recruitment platform that connects candidate " +
    "screening, interviews, evaluation and hiring workflows in one workspace — " +
    "with a person making every decision that matters.",
  path: "/about",
});

/**
 * The About page.
 *
 * NO COMPANY SECTION, NO TEAM, NO TIMELINE — because none of it is verified.
 * package.json has no author; there is no founding year anywhere (the footer
 * prints the CURRENT year, which is a copyright line, and reading it as a
 * founding date would be inventing a fact from a template); no location, no
 * legal entity, no funding, no milestones.
 *
 * §13 says credibility matters more than filling space, and this site has
 * already declined to invent customers, certifications and prices. A founding
 * year would be the smallest of those lies and exactly the same kind.
 *
 * SO THE PAGE IS ABOUT THE PRODUCT, and it has one genuinely unusual fact to
 * build on: it was written module by module against a specification, which is
 * why every other page on this site can be so specific about what exists and
 * so plain about what does not.
 *
 * ENTIRELY SERVER-RENDERED. Nothing here holds state; the only client code in
 * the tree is <Reveal>, the site's existing scroll-reveal primitive.
 */
export default function AboutPage() {
  return (
    <>
      {/* ---- Hero -------------------------------------------------------- */}
      <section className="mkt-band mkt-band--dark ab-hero" aria-labelledby="about-heading">
        <div className="mkt-shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "About", href: "/about" },
            ]}
          />

          <div className="ab-hero__grid">
            <div className="ab-hero__copy">
              {/* The page's own H1 — it is a dedicated route. */}
              <h1 id="about-heading" className="ab-hero__title">
                {ABOUT_HERO.title}
              </h1>
              <p className="ab-hero__lead">{ABOUT_HERO.lead}</p>
            </div>

            {/*
              THE ORB, with the product's real surfaces around it.

              `aria-hidden` because the six labels are a picture of the same
              six things the page names in prose below; a screen reader reading
              them here would hear the contents page twice. No photography and
              no generated illustration — both are ruled out, and neither would
              say anything.
            */}
            <div className="ab-orb" aria-hidden="true">
              <span className="ab-orb__glow" />
              <span className="ab-orb__mark">
                <Logo variant="mark" height={64} priority />
              </span>
              <ul className="ab-orb__ring">
                {ABOUT_HERO.fragments.map((fragment, index) => (
                  <li key={fragment} data-slot={index}>
                    {fragment}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Mission ----------------------------------------------------- */}
      <Section tone="light" id="mission">
        <SectionHeading eyebrow="Why it exists" title={ABOUT_MISSION.title} />

        <Reveal className="ab-mission">
          <p className="ab-mission__body">{ABOUT_MISSION.body}</p>
          {/*
            The line that separates this page from the homepage's challenge
            band: that one shows the fragmentation, this one says what follows
            from it.
          */}
          <p className="ab-mission__pull">{ABOUT_MISSION.pull}</p>
        </Reveal>
      </Section>

      {/* ---- AI and people ----------------------------------------------- */}
      <Section tone="dark" id="ai-position">
        <SectionHeading eyebrow="AI and people" title={ABOUT_AI.title} tone="dark" />

        <Reveal className="ab-split">
          <p className="ab-split__body">{ABOUT_AI.body}</p>

          <div className="ab-split__cols">
            <div className="ab-col" data-side="ai">
              <h3 className="ab-col__title">What the AI does</h3>
              <ul className="ab-col__list">
                {ABOUT_AI.does.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="ab-col" data-side="human">
              <h3 className="ab-col__title">What a person decides</h3>
              <ul className="ab-col__list">
                {ABOUT_AI.decides.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* ---- Principles --------------------------------------------------- */}
      <Section tone="light" id="principles">
        <SectionHeading
          eyebrow="How it is built"
          title="Four things that do not bend."
          lead="Each of these is something the codebase does, rather than something we would like to be true."
        />

        <Stagger as="ul" className="ab-principles" max={4}>
          {ABOUT_PRINCIPLES.map((principle) => (
            <article key={principle.title} className="ab-principle">
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </Stagger>
      </Section>

      {/* ---- The journey --------------------------------------------------- */}
      <Section tone="light" flush id="journey">
        <SectionHeading
          eyebrow="End to end"
          title="One path, seven steps."
          lead="The same sequence every part of the product is built around."
        />

        {/*
          <Stagger as="ol"> already wraps each child in its own <li>, so the
          step itself must NOT be one — an <li> inside an <li> is invalid, and
          the browser's recovery is to close the outer one early, which breaks
          the numbering the ::before counter depends on.
        */}
        <Stagger as="ol" className="ab-journey" max={4}>
          {ABOUT_JOURNEY.map((step) => (
            <div key={step.label} className="ab-step">
              <span className="ab-step__label">{step.label}</span>
              <span className="ab-step__note">{step.note}</span>
            </div>
          ))}
        </Stagger>
      </Section>

      {/* ---- Close --------------------------------------------------------- */}
      <section className="mkt-band mkt-band--dark mkt-band--cta">
        <div className="mkt-shell ab-cta">
          <h2>{ABOUT_CTA.title}</h2>
          <p className="mkt-bandlead">{ABOUT_CTA.body}</p>

          <div className="ab-cta__buttons">
            <Link href={ABOUT_CTA.primary.href} className="mkt-btn mkt-btn--primary">
              {ABOUT_CTA.primary.label}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href={ABOUT_CTA.secondary.href} className="mkt-btn mkt-btn--glass">
              {ABOUT_CTA.secondary.label}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
