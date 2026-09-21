import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { APPLY_CALLOUTS, APPLY_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { ApplyStory } from "./ApplyStory";
import { iconFor } from "./icons";

/**
 * "Candidate applications" — the public form, and what happens after Submit.
 *
 * A LIGHT BAND, between two deep ones (the pipeline above, Human + AI below in
 * the page's order). The candidate side of this product is the bright,
 * public-facing half and it reads that way; it is also the page's return to
 * light after the pipeline's deep board.
 *
 * A SERVER COMPONENT; only <ApplyStory> ships JavaScript, and that component
 * imports no client of any kind.
 */
export function CandidateApplications() {
  return (
    <Section tone="light" id="applications">
      <SectionHeading
        eyebrow={APPLY_HEAD.eyebrow}
        title={APPLY_HEAD.title}
        lead={APPLY_HEAD.lead}
      />

      <ApplyStory />

      <Stagger as="ul" className="mkt-cardgrid mkt-cardgrid--four ai-callouts" max={4}>
        {APPLY_CALLOUTS.map((card) => {
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
    </Section>
  );
}
