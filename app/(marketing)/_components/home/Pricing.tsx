import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PRICING_CTA, PRICING_HEAD, PRICING_PANELS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal } from "@/components/marketing/Reveal";
import { Logo } from "@/components/Logo";

/**
 * "What Scoreboad costs today."
 *
 * THERE IS NO BILLING SYSTEM. No Stripe, no subscriptions, no plans, no
 * checkout, no trial. So there are no plan cards, no billing toggle, no
 * recommended plan, no comparison table and no enterprise tier — each of those
 * would have been a number or a promise with nothing behind it.
 *
 * WHAT THERE IS, AND WHY THIS SECTION EARNS ITS PLACE: the site currently
 * answers the pricing question NOWHERE. lib/marketing/content.ts has an answer
 * ("Pricing is not published yet") in an array that nothing renders — its only
 * reference is its own test — and the FAQ that does render has no pricing
 * question. Somebody wondering what this costs finds silence.
 *
 * So this is the answer, in the place people look for it. A young product
 * saying "nothing yet, and here is why" is more useful than an absent section
 * and more honest than a table of invented tiers.
 *
 * A LIGHT BAND, FLUSH with the FAQ above it. Two light bands in a row are one
 * surface, and these belong together: the awkward questions, then the most
 * awkward one, then the ask.
 *
 * ENTIRELY SERVER-RENDERED. Nothing here has state — there is no toggle to
 * hold, because there is no second billing period to toggle to.
 */
export function Pricing() {
  return (
    <Section tone="light" flush id="pricing">
      <SectionHeading
        eyebrow={PRICING_HEAD.eyebrow}
        title={PRICING_HEAD.title}
        lead={PRICING_HEAD.lead}
      />

      <Reveal className="pr">
        {/*
          The mark sits between the two panels rather than behind the copy —
          §10 asks for it as a quiet signature and warns it must not compete
          with the prices. There are no prices to compete with, but a logo
          floating behind a paragraph about money would still read as spin.
        */}
        <div className="pr__panels">
          {PRICING_PANELS.map((panel) => (
            <article key={panel.key} className="pr-panel" data-key={panel.key}>
              <p className="pr-panel__label">{panel.label}</p>
              <h3 className="pr-panel__title">{panel.title}</h3>

              <ul className="pr-panel__points">
                {panel.points.map((point) => (
                  <li key={point}>
                    {/*
                      The tick is decorative — every point is a full sentence
                      that reads correctly without it, so a screen reader is
                      not told "check mark" four times per panel.
                    */}
                    <Check size={15} strokeWidth={2.25} aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}

          <span className="pr__mark" aria-hidden="true">
            <Logo variant="mark" height={30} />
          </span>
        </div>

        <div className="pr__cta">
          <Link href={PRICING_CTA.primary.href} className="mkt-btn mkt-btn--primary">
            {PRICING_CTA.primary.label}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          {/*
            No "talk to sales" and no "request a demo": no contact route
            exists, and a button that opens nothing is worse than no button.
          */}
          <Link href={PRICING_CTA.secondary.href} className="mkt-btn mkt-btn--ghost">
            {PRICING_CTA.secondary.label}
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}
