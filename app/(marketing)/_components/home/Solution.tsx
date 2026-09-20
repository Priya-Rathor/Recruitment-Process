import { SOLUTION_HEAD, WORKFLOW_PIECES } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { ButtonLink } from "@/components/marketing/Button";
import { Reveal } from "@/components/marketing/Reveal";
import { Logo } from "@/components/Logo";
import { iconFor } from "./icons";

/**
 * "The solution" — the turn, and the answer to the band above it.
 *
 * DEEP NAVY, AND THAT IS THE ARGUMENT RATHER THAN A PREFERENCE. The problem
 * band is the pale, ordinary ground where the scattered chips sit; this one is
 * the brand's own deep space, lit, with the same six pieces joined on a single
 * rail. The reader scrolls from one to the other and the transformation is the
 * scroll. Doing both states in one band, side by side, would make it a diagram
 * to compare rather than a thing that happens.
 *
 * WHAT THIS BAND DELIBERATELY DOES NOT DO: restate the workflow. The brief's
 * sketch has it listing Job → Candidates → Screening → Interview → Evaluation →
 * Hiring decision, which is exactly WORKFLOW_STEPS, rendered by <HiringWorkflow>
 * two bands below. Six numbered stages twice on one page is not storytelling,
 * it is a page that repeats itself. So this shows the same six OBJECTS as the
 * band above — not stages — moving from a tool to a Scoreboad screen, and hands
 * the stages off to the section that already owns them.
 *
 * THE RAIL ANIMATES OFF THE SITE'S EXISTING REVEAL. No second animation system:
 * <Reveal> adds `.is-shown` when the element lands, and the stylesheet keys the
 * rail's line growth and the nodes' settle off that same class. Reduced motion
 * neutralises it in the same block as everything else.
 */
export function Solution() {
  return (
    <Section tone="dark">
      <SectionHeading
        eyebrow={SOLUTION_HEAD.eyebrow}
        title={SOLUTION_HEAD.title}
        lead={SOLUTION_HEAD.lead}
        tone="dark"
      />

      <Reveal className="mkt-railwrap">
        {/*
          THE CONNECTED STATE.

          A <ul> rather than an <ol>: these six are not a sequence to be
          performed in order, they are the six places the same work now lives.
          The rail is drawn by CSS behind them, and is `aria-hidden` along with
          every other decorative part — the list itself carries the content, so
          a screen reader gets the six pairs and none of the scaffolding.
        */}
        <div className="mkt-rail">
          {/*
            A PANEL HEADER, WHICH IS WHERE THE MARK BELONGS.

            The rail had to say whose workspace these six things moved into, and
            the first attempt floated the mark over the line as a "hub" — which
            collided with the middle two nodes and read as a sticker. Giving the
            connected state a product-panel header instead answers the same
            question, gives the mark a legitimate home, and makes the whole
            thing read as a surface rather than a diagram.

            The mark is `aria-hidden` because the word "Scoreboad" is already in
            the text beside it; without that a screen reader says the name
            twice.
          */}
          <div className="mkt-rail__head">
            <span aria-hidden="true" className="mkt-rail__mark">
              <Logo variant="mark" height={20} />
            </span>
            <p className="mkt-rail__title">Scoreboad — one workspace</p>
          </div>

          <div className="mkt-rail__body">
            <span className="mkt-rail__line" aria-hidden="true" />

            <ul className="mkt-rail__nodes">
              {WORKFLOW_PIECES.map((item, index) => {
                const Icon = iconFor(item.icon);
                return (
                  <li
                    key={item.piece}
                    className="mkt-rail__node"
                    style={{ transitionDelay: `${120 + index * 70}ms` }}
                  >
                    <span className="mkt-rail__dot" aria-hidden="true">
                      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    {/*
                      The piece, then the screen that holds it. The arrow is
                      `aria-hidden` and the relationship is carried by the
                      visually hidden "in" — so the graphic reads as an arrow and
                      a screen reader hears "Resumes in Candidate record", which
                      is the sentence the arrow is standing in for.
                    */}
                    <span className="mkt-rail__text">
                      <strong>{item.piece}</strong>
                      <span className="mkt-rail__surface">
                        <span aria-hidden="true" className="mkt-rail__arrow">
                          →
                        </span>
                        {/* Bulma's own helper, already loaded via globals.scss
                            and already used elsewhere in the app — not a second
                            visually-hidden utility invented for this section. */}
                        <span className="is-sr-only">in </span>
                        {item.surface}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Reveal>

      <div className="mkt-solution__cta">
        {/*
          ONE CONTEXTUAL LINK, to a page that exists. The brief offers /platform
          and /solutions/ai-recruitment; lib/marketing/navigation.ts declares
          both as `planned`, so neither is a destination yet. /how-it-works is
          the real walkthrough of the connected workflow this band is claiming,
          which makes it the honest target rather than a substitute for one.
        */}
        <ButtonLink href="/how-it-works" variant="secondary">
          See the full hiring workflow
        </ButtonLink>
      </div>
    </Section>
  );
}
