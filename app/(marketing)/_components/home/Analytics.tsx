import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ANALYTICS_CALLOUTS, ANALYTICS_CLOSING, ANALYTICS_HEAD } from "@/lib/marketing/home";
import { ButtonLink } from "@/components/marketing/Button";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { AnalyticsShowcase } from "./AnalyticsShowcase";
import { iconFor } from "./icons";

/**
 * "Analytics" — the data layer under everything the page has shown.
 *
 * A LIGHT BAND, and this one has a reason beyond rhythm: the analytics surface
 * is a bright product screen, and the application's own chart components draw
 * with a light palette. Putting them on navy would mean either recolouring the
 * product's charts for a marketing page — which is how a screenshot starts
 * lying — or an unreadable one.
 *
 * A SERVER COMPONENT; only <AnalyticsShowcase> ships JavaScript.
 *
 * NO FINAL CTA HERE. §23 is explicit that the homepage's closing ask belongs
 * to a later module, so this ends on a sentence and one link.
 */
export function Analytics() {
  return (
    <Section tone="light" id="analytics">
      <SectionHeading
        eyebrow={ANALYTICS_HEAD.eyebrow}
        title={ANALYTICS_HEAD.title}
        lead={ANALYTICS_HEAD.lead}
      />

      <AnalyticsShowcase />

      <Stagger as="ul" className="mkt-cardgrid ai-callouts an-callouts" max={3}>
        {ANALYTICS_CALLOUTS.map((card) => {
          const Icon = iconFor(card.icon);
          return (
            <Link key={card.title} href={card.href} className="ai-callout">
              <span className="ai-callout__icon" aria-hidden="true">
                <Icon size={19} strokeWidth={1.6} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <span className="ai-callout__more" aria-hidden="true">
                Read more
                <ArrowRight size={14} />
              </span>
            </Link>
          );
        })}
      </Stagger>

      {/*
        The shared tertiary button, not a one-off link style: the same CTA
        appears three times on this page, and each now uses a variant from
        the one button system — secondary in the hero, primary alone in
        Integrations, tertiary here where it closes a sentence.
      */}
      <p className="an-close">
        {ANALYTICS_CLOSING}{" "}
        <ButtonLink href="/how-it-works" variant="tertiary" icon={ArrowRight}>
          Explore the platform
        </ButtonLink>
      </p>
    </Section>
  );
}
