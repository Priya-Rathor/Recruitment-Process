import { TRUST_CARDS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Card } from "@/components/marketing/Card";
import { Stagger } from "@/components/marketing/Reveal";
import { iconFor } from "./icons";

/**
 * "Built for modern hiring teams."
 *
 * WHERE THE TECHNICAL MATERIAL WENT. The previous homepage led with table
 * counts, row-level security and AI function counts — true, and written for a
 * developer reading a repository rather than a recruiter deciding whether to
 * trust the product with candidate data. It is here instead, phrased as what it
 * protects rather than how it is implemented, and /how-it-works still carries
 * the full detail.
 *
 * Mint icon wells rather than periwinkle, so the trust band reads as its own
 * idea at a glance instead of as a third identical grid.
 */
export function TrustSection() {
  return (
    <Section tone="light" id="trust">
      <SectionHeading
        eyebrow="Trust"
        title="Built for modern hiring teams."
        lead="Hiring decisions affect people's livelihoods, so the guardrails are part of the architecture rather than a policy page."
      />

      <Stagger as="ul" className="mkt-cardgrid">
        {TRUST_CARDS.map((card) => (
          <Card key={card.title} icon={iconFor(card.icon)} title={card.title} accent="mint">
            <p>{card.body}</p>
          </Card>
        ))}
      </Stagger>
    </Section>
  );
}
