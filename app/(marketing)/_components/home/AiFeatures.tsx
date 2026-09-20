import { AI_CARDS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Card } from "@/components/marketing/Card";
import { Stagger } from "@/components/marketing/Reveal";
import { iconFor } from "./icons";

/**
 * "AI that handles the busy work" — eight cards.
 *
 * Every card maps to a named function in lib/ai/ or a built integration; the
 * comments in lib/marketing/home.ts say which. Interview SCHEDULING is
 * deliberately absent even though the brief asked for it: it is a real feature,
 * but no model is involved, and listing it under an AI headline would imply
 * one. It sits in the workspace section instead.
 *
 * The stagger caps at four, matching the widest row — so the second row starts
 * with the first card rather than continuing to count upward and arriving late.
 */
export function AiFeatures() {
  return (
    <Section tone="light" id="ai">
      <SectionHeading
        eyebrow="Intelligence"
        title="AI that handles the busy work."
        lead="Let AI take care of repetitive recruiting tasks while your team stays focused on people and decisions."
      />

      <Stagger as="ul" className="mkt-cardgrid mkt-cardgrid--four" max={4}>
        {AI_CARDS.map((card) => (
          <Card key={card.title} icon={iconFor(card.icon)} title={card.title}>
            <p>{card.body}</p>
          </Card>
        ))}
      </Stagger>
    </Section>
  );
}
