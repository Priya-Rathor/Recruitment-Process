import { AI_CARDS } from "@/lib/marketing/home";
import { iconFor } from "./icons";
import { Reveal } from "./Reveal";

/**
 * "AI that handles the busy work" — eight cards.
 *
 * Every card maps to a named function in lib/ai/ or a built integration; the
 * comments in lib/marketing/home.ts say which. Interview SCHEDULING is
 * deliberately absent from this list even though the brief asked for it: it is
 * a real feature, but no model is involved, and listing it under an AI headline
 * would imply one. It sits in the workspace section instead.
 *
 * A light band with white cards, so the page's centre stays bright. The icons
 * take the periwinkle at full saturation because they are GLYPHS, not text —
 * on a light ground the accent is 2.36:1, which is fine for a 19px line icon
 * beside a heading and would be unreadable as words.
 */
export function AiFeatures() {
  return (
    <section className="mkt-band mkt-band--light" id="ai">
      <div className="mkt-shell">
        <div className="mkt-bandhead">
          <p className="mkt-eyebrow mkt-eyebrow--light">Intelligence</p>
          <h2>AI that handles the busy work.</h2>
          <p className="mkt-bandlead">
            Let AI take care of repetitive recruiting tasks while your team stays
            focused on people and decisions.
          </p>
        </div>

        <ul className="mkt-cardgrid mkt-cardgrid--four">
          {AI_CARDS.map((card, index) => {
            const Icon = iconFor(card.icon);
            return (
              <Reveal as="li" key={card.title} delay={(index % 4) * 60}>
                <article className="mkt-lcard mkt-lcard--ai">
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
