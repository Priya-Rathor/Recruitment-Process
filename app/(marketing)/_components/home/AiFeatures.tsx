import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AI_CALLOUTS, AI_STORY_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { ButtonLink } from "@/components/marketing/Button";
import { Stagger } from "@/components/marketing/Reveal";
import { AiStory } from "./AiStory";
import { iconFor } from "./icons";

/**
 * "AI-powered recruitment" — the section that shows how screening works.
 *
 * WHAT THIS REPLACED. Eight cards, each an icon, a heading and a paragraph.
 * The band named every AI capability in the product and demonstrated none of
 * them, on the one subject where a reader's real question is "yes, but what
 * does it actually DO?". It is now a scroll-driven demonstration of the
 * screening pipeline with four supporting capabilities underneath.
 *
 * FOUR CALLOUTS, DOWN FROM EIGHT. The other four — voice screening, interview
 * briefs, candidate messaging, pipeline automation — are real, and each is
 * owned by a later module of this redesign. Keeping them made this band a
 * summary of the whole product rather than of screening.
 *
 * A SERVER COMPONENT. The heading, the callouts and their links are static, so
 * they are rendered on the server and carry no JavaScript; only <AiStory>, the
 * part that observes scroll and holds the selected candidate, is a client
 * component. The brief's rule and this repository's — do not turn a page into
 * a client tree for an animation.
 *
 * THE BAND IS LIGHT, THE STORY IS DARK. The brief asks for the demonstration
 * to sit on deep navy, and the page's rhythm has a dark band immediately after
 * this one (Human + AI). A dark band here would merge the two into one long
 * dark stretch, so the navy is an inset panel inside a light band instead —
 * which also gives the section the "product lit on a dark ground" treatment the
 * hero uses, without spending a band on it.
 */
export function AiFeatures() {
  return (
    <Section tone="light" id="ai">
      <SectionHeading
        eyebrow={AI_STORY_HEAD.eyebrow}
        title={AI_STORY_HEAD.title}
        lead={AI_STORY_HEAD.lead}
      />

      <AiStory />

      {/*
        The supporting capabilities. Each is a real named function or a real
        step, and each links to the page that documents it — so the section
        ends by handing the reader somewhere rather than stopping.

        <article> inside a link, not a div with an onClick: these navigate.
      */}
      <Stagger as="ul" className="mkt-cardgrid mkt-cardgrid--four ai-callouts" max={4}>
        {AI_CALLOUTS.map((card) => {
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

      <div className="ai-cta">
        {/*
          /product/screen is the capability page for exactly this pipeline. The
          brief offered /solutions/ai-recruitment, /platform/candidates and
          /platform/screening; lib/marketing/navigation.ts declares all three
          as planned, so none of them is a destination yet.
        */}
        <ButtonLink href="/product/screen" variant="primary" icon={ArrowRight}>
          See how screening works
        </ButtonLink>
      </div>
    </Section>
  );
}
