import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PIPELINE_CALLOUTS, PIPELINE_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { PipelineStory } from "./PipelineStory";
import { iconFor } from "./icons";

/**
 * "Hiring pipeline" — the board, with one candidate crossing it.
 *
 * THIS REPLACED <PipelinePreview>, a static candidate table under the heading
 * "See your hiring pipeline at a glance". That section was flagged as the
 * page's redundant third product shot when the platform showcase landed; this
 * is the module that owns the area, so it is also the module that resolves it.
 *
 * A DARK BAND. The board is a bright product surface and it wants the deep
 * ground behind it — the same treatment the hero gives the dashboard, and the
 * strongest frame available for the one visual on this page where something
 * genuinely moves. It also breaks up the run of light bands that the candidate
 * workspace started.
 *
 * A SERVER COMPONENT; only <PipelineStory> ships JavaScript.
 */
export function HiringPipeline() {
  return (
    <Section tone="dark" id="pipeline">
      <SectionHeading
        eyebrow={PIPELINE_HEAD.eyebrow}
        title={PIPELINE_HEAD.title}
        lead={PIPELINE_HEAD.lead}
        tone="dark"
      />

      <PipelineStory />

      <Stagger as="ul" className="vi-callouts" max={3}>
        {PIPELINE_CALLOUTS.map((card) => {
          const Icon = iconFor(card.icon);
          return (
            <Link key={card.title} href={card.href} className="vi-callout">
              <span className="vi-callout__icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.6} />
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <span className="vi-callout__more" aria-hidden="true">
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
