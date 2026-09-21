import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FLOW_CALLOUTS, FLOW_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Stagger } from "@/components/marketing/Reveal";
import { AutomationStory } from "./AutomationStory";
import { MagneticCta } from "./MagneticCta";
import { iconFor } from "./icons";

/**
 * "Recruitment automation" — one rule, building itself as you scroll.
 *
 * A DEEP BAND. The brief asks for the workflow to sit on #0A1128 and read as
 * an operating system, and the page's rhythm wants dark here: the applications
 * band above it is light, and the closing CTA further down is the next deep
 * one.
 *
 * A SERVER COMPONENT. Only <AutomationStory> and the CTA's magnetic wrapper
 * ship JavaScript; the heading and the four callouts are static.
 */
export function RecruitmentAutomation() {
  return (
    <Section tone="dark" id="automation">
      <SectionHeading
        eyebrow={FLOW_HEAD.eyebrow}
        title={FLOW_HEAD.title}
        lead={FLOW_HEAD.lead}
        tone="dark"
      />

      <AutomationStory />

      <Stagger as="ul" className="vi-callouts fl-callouts" max={4}>
        {FLOW_CALLOUTS.map((card) => {
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

      <div className="fl__cta">
        {/*
          /solutions/recruitment-automation is `planned` in navigation.ts.
          /product/operate is the real capability page for exactly this —
          "Measure it, automate it, and know who changed what."
        */}
        <MagneticCta href="/product/operate">
          Explore recruitment automation
        </MagneticCta>
      </div>
    </Section>
  );
}
