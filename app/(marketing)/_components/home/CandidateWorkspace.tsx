import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CANDIDATE_CALLOUTS, CANDIDATE_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { CandidateJourney } from "./CandidateJourney";
import { iconFor } from "./icons";

/**
 * "Candidate workspace" — one candidate, six real views.
 *
 * A LIGHT BAND, following two deep ones. The screening-call story and Human +
 * AI are both dark and read as one movement; this is where the page comes back
 * up, and a bright workspace is the right surface for a record-keeping screen
 * anyway — it is the same light-product-on-a-light-band treatment the platform
 * showcase uses.
 *
 * A SERVER COMPONENT. The heading, the four callouts and their links carry no
 * JavaScript; only <CandidateJourney>, which holds the selected view, is a
 * client component.
 */
export function CandidateWorkspace() {
  return (
    <Section tone="light" id="candidates">
      <SectionHeading
        eyebrow={CANDIDATE_HEAD.eyebrow}
        title={CANDIDATE_HEAD.title}
        lead={CANDIDATE_HEAD.lead}
      />

      <CandidateJourney />

      <Stagger as="ul" className="mkt-cardgrid mkt-cardgrid--four cw-callouts" max={4}>
        {CANDIDATE_CALLOUTS.map((card) => {
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
