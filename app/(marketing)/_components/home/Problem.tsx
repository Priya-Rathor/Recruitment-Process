import { PROBLEM_CARDS, PROBLEM_HEAD, WORKFLOW_PIECES } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal, Stagger } from "@/components/marketing/Reveal";
import { iconFor } from "./icons";

/**
 * "The challenge" — the half of the argument the page was missing.
 *
 * The hero promises faster hiring and the bands below list what the product
 * does. Between them there was no sentence explaining what any of it is FOR.
 * This is that sentence, five supporting points, and a picture of the thing
 * being described.
 *
 * A SERVER COMPONENT. Nothing here holds state; the only client code in the
 * subtree is <Reveal>, which is the site's existing scroll-reveal primitive.
 *
 * THE SCATTER IS THE ARGUMENT, so it is built from the same array the solution
 * band renders connected — see WORKFLOW_PIECES. Six chips, each tilted and
 * offset by a FIXED amount chosen per index. Fixed, not random: a random tilt
 * computed at render differs between the server and the client and produces a
 * hydration mismatch, which is a genuinely stupid way to break a page for a
 * decoration nobody would notice was regular.
 *
 * THEY DO NOT FLOAT. The brief suggests the scattered elements "gently move
 * independently" and, two clauses later, rules out constant movement and
 * infinite animation. The prohibition wins: a section explaining that hiring is
 * chaotic does not need six things drifting while somebody tries to read it,
 * and perpetual transform animation on six elements is six compositor layers
 * held forever. They arrive, they settle, they stay put.
 */
export function Problem() {
  return (
    <Section tone="light" id="problem">
      <SectionHeading
        eyebrow={PROBLEM_HEAD.eyebrow}
        title={PROBLEM_HEAD.title}
        lead={PROBLEM_HEAD.lead}
      />

      {/*
        An <ol>, because these are numbered and the numbers are rendered. The
        markers themselves are `aria-hidden` and the count comes from the list
        semantics, so a screen reader hears "list of 5 items, 1, Scattered
        candidate data" rather than hearing "01" read out as a separate string
        before every heading.
      */}
      <Stagger as="ol" className="mkt-problems" step={70}>
        {PROBLEM_CARDS.map((card) => (
          <article key={card.step} className="mkt-lcard mkt-lcard--numbered">
            <span className="mkt-problems__num" aria-hidden="true">
              {card.step}
            </span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </Stagger>

      {/*
        THE SCATTERED STATE.

        `aria-hidden` and paired with a real sentence underneath, because the
        picture is the only place this information would otherwise exist and a
        diagram is not readable. The caption is not a caption in the decorative
        sense — it is the content, and the graphic is the illustration of it.
      */}
      <Reveal className="mkt-scatterwrap">
        <ul className="mkt-scatter" aria-hidden="true">
          {WORKFLOW_PIECES.map((item, index) => {
            const Icon = iconFor(item.icon);
            return (
              <li
                key={item.piece}
                className="mkt-scatter__chip"
                // Fixed per index — see the note above on hydration.
                data-tilt={index}
              >
                <span className="mkt-scatter__icon">
                  <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span className="mkt-scatter__text">
                  <strong>{item.piece}</strong>
                  <span>{item.scattered}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mkt-scatter__caption">
          Six parts of one hire — resumes, applications, screening answers,
          interview times, interviewer feedback and the decision itself — each
          sitting in a different tool.
        </p>
      </Reveal>
    </Section>
  );
}
