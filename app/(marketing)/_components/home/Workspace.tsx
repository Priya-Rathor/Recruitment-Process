import { WORKSPACE_CARDS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Card } from "@/components/marketing/Card";
import { Stagger } from "@/components/marketing/Reveal";
import { iconFor } from "./icons";

/**
 * "One workspace" — the first bright band, and the page's hand-off from brand
 * to product.
 *
 * Six cards, one per capability group in content.ts, so this section and the
 * /product/* routes cannot drift apart.
 *
 * Built from the shared marketing primitives rather than from raw classes: the
 * rendered markup is identical, and the next page that needs a card grid now
 * has one obvious way to make one.
 */
export function Workspace() {
  return (
    <Section tone="light" id="product">
      <SectionHeading
        eyebrow="The platform"
        title="One workspace for your entire hiring process."
        lead="From the first application to the final decision, Scoreboad keeps your hiring workflow connected."
      />

      <Stagger as="ul" className="mkt-cardgrid">
        {WORKSPACE_CARDS.map((card) => (
          <Card key={card.title} icon={iconFor(card.icon)} title={card.title}>
            <p>{card.body}</p>
          </Card>
        ))}
      </Stagger>
    </Section>
  );
}
