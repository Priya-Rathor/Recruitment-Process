import { TRUST_CARDS } from "@/lib/marketing/home";
import { iconFor } from "./icons";
import { Reveal } from "./Reveal";

/**
 * "Built for modern hiring teams."
 *
 * WHERE THE TECHNICAL MATERIAL WENT. The previous homepage led with table
 * counts, row-level security and AI function counts — true, and written for a
 * developer reading a repository rather than a recruiter deciding whether to
 * trust the product with candidate data. The brief asks for that material to be
 * moved down rather than deleted, so it is here, phrased as what it protects
 * instead of how it is implemented.
 *
 * NOTHING HERE IS ASPIRATIONAL. Every card names a capability that exists, and
 * no certification is claimed — the FAQ immediately below says plainly that
 * none is held, which is a stronger trust signal than a badge would be.
 *
 * The /how-it-works page still carries the full architectural detail for anyone
 * who wants it, and it is linked from here.
 */
export function TrustSection() {
  return (
    <section className="mkt-band mkt-band--light" id="trust">
      <div className="mkt-shell">
        <div className="mkt-bandhead">
          <p className="mkt-eyebrow mkt-eyebrow--light">Trust</p>
          <h2>Built for modern hiring teams.</h2>
          <p className="mkt-bandlead">
            Hiring decisions affect people&apos;s livelihoods, so the guardrails are
            part of the architecture rather than a policy page.
          </p>
        </div>

        <ul className="mkt-cardgrid">
          {TRUST_CARDS.map((card, index) => {
            const Icon = iconFor(card.icon);
            return (
              <Reveal as="li" key={card.title} delay={index * 60}>
                <article className="mkt-lcard mkt-lcard--trust">
                  <span className="mkt-lcard__icon mkt-lcard__icon--mint" aria-hidden="true">
                    <Icon size={19} strokeWidth={1.6} />
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
