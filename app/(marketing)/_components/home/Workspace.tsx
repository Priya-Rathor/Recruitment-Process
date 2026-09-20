import { WORKSPACE_CARDS } from "@/lib/marketing/home";
import { iconFor } from "./icons";
import { Reveal } from "./Reveal";

/**
 * "One workspace" — the first bright band, and the page's hand-off from brand
 * to product.
 *
 * Six cards, one per capability group in content.ts, so this section and the
 * /product/* routes cannot drift apart. The icons are line glyphs at a single
 * stroke weight: the brief rules out "generic giant colorful icons", and mixing
 * weights across a grid is the fastest way to make one look assembled.
 */
export function Workspace() {
  return (
    <section className="mkt-band mkt-band--light" id="product">
      <div className="mkt-shell">
        <div className="mkt-bandhead">
          <p className="mkt-eyebrow mkt-eyebrow--light">The platform</p>
          <h2>One workspace for your entire hiring process.</h2>
          <p className="mkt-bandlead">
            From the first application to the final decision, Scoreboad keeps your
            hiring workflow connected.
          </p>
        </div>

        <ul className="mkt-cardgrid">
          {WORKSPACE_CARDS.map((card, index) => {
            const Icon = iconFor(card.icon);
            return (
              <Reveal as="li" key={card.title} delay={index * 60}>
                <article className="mkt-lcard">
                  <span className="mkt-lcard__icon" aria-hidden="true">
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
