import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VOICE_CALLOUTS, VOICE_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { VoiceStory } from "./VoiceStory";
import { iconFor } from "./icons";

/**
 * "AI screening calls" — the automated first conversation, demonstrated.
 *
 * A DEEP BAND, AND IT SHARES ITS GROUND WITH THE ONE BELOW IT. Human + AI
 * follows immediately and is also deep; rendering both with full padding would
 * put a seam through the middle of one dark region. `flush` on that band is
 * not available from here, so this one is the flush-ended half: the story ends
 * on a recruiter reading the report, and Human + AI is the argument for why
 * that is the design. They read as one movement because they are one.
 *
 * WHY THIS BAND IS DARK WHEN THE AI SCREENING BAND ABOVE IT IS LIGHT. That
 * section is about reading documents and its product shot is a bright
 * interface. This one is a live call — the brief asks for #0A1128 behind it,
 * and a call interface glowing on deep navy is both the right mood and the
 * page's established treatment for a moment rather than a list.
 *
 * A SERVER COMPONENT. Only <VoiceStory>, which observes scroll and follows the
 * cursor, is a client component; the heading and the three callouts ship no
 * JavaScript at all.
 */
export function VoiceInterview() {
  return (
    <Section tone="dark" id="voice">
      <SectionHeading
        eyebrow={VOICE_HEAD.eyebrow}
        title={VOICE_HEAD.title}
        lead={VOICE_HEAD.lead}
        tone="dark"
      />

      <VoiceStory />

      <Stagger as="ul" className="vi-callouts" max={3}>
        {VOICE_CALLOUTS.map((card) => {
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
