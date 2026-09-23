import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { INTEGRATIONS_CALLOUTS, INTEGRATIONS_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { IntegrationNetwork } from "./IntegrationNetwork";
import { MagneticCta } from "./MagneticCta";
import { iconFor } from "./icons";

/**
 * "Integrations" — five verified connections around the product.
 *
 * NOT A LOGO WALL, and not because the brief says so: there are no logos to
 * wall. Two of the five are generic ("Email", "AI provider") because that is
 * genuinely what they are — a provider you choose — and the other three belong
 * to companies whose marks this site has no licence to print. Naming them in
 * type, with what each one does and what breaks without it, is both the honest
 * treatment and the more useful one.
 *
 * <Reveal> WRAPS THE NETWORK so the connections draw themselves as the section
 * arrives. That is the progressive build §12 asks for, without the sixth
 * sticky scroll track §11 asks for — see the note in IntegrationNetwork.
 *
 * A SERVER COMPONENT; only the network and the CTA's wrapper ship JavaScript.
 */
export function Integrations() {
  return (
    <Section tone="light" id="integrations">
      <SectionHeading
        eyebrow={INTEGRATIONS_HEAD.eyebrow}
        title={INTEGRATIONS_HEAD.title}
        lead={INTEGRATIONS_HEAD.lead}
      />

      <Reveal className="ig-wrap">
        <IntegrationNetwork />
      </Reveal>

      <Stagger as="ul" className="mkt-cardgrid mkt-cardgrid--four ai-callouts" max={4}>
        {INTEGRATIONS_CALLOUTS.map((card) => {
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

      <div className="ig__cta">
        {/*
          There is no /integrations page, so §21's fallback applies:
          /how-it-works is the real walkthrough, and it is where the
          integrations sit inside the flow.
        */}
        <MagneticCta href="/how-it-works">Explore the platform</MagneticCta>
      </div>
    </Section>
  );
}
