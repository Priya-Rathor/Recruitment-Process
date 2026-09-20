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
      {/*
        RETITLED WHEN THE CHALLENGE / SOLUTION BANDS LANDED ABOVE IT.

        This used to say "One workspace for your entire hiring process." The
        solution band now says "One connected workspace for modern hiring." two
        sections earlier, and the two read as the same sentence twice. This band
        is not the claim any more — it is the ITEMISATION of the claim — so the
        heading now says what the six cards under it actually are.
      */}
      <SectionHeading
        eyebrow="The platform"
        title="What's in the workspace."
        lead="Six parts of the hiring process, on one set of records — from the first application to the final decision."
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
