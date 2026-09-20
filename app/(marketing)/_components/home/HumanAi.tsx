import { AI_SIDE, HUMAN_SIDE } from "@/lib/marketing/home";
import { Reveal } from "./Reveal";

/**
 * "AI does the work. You make the decisions."
 *
 * A DEEP BAND, and the second of the page's three. It earns the weight: this is
 * the claim a hiring team is most sceptical about, and it is the one this
 * product's architecture genuinely backs — the Raw Data -> AI -> Validation ->
 * Human Review -> Business Action sequence is a real constraint in the codebase,
 * not a positioning line.
 *
 * THE TONE IS NOT ANTI-AI. Both columns are given the same visual weight and the
 * same card treatment; the AI column is not the villain of the section. What
 * separates them is the seam down the middle, which reads as a hand-off rather
 * than as a wall.
 *
 * The seam is a 1px gradient rule that goes horizontal on a phone, drawn with a
 * pseudo-element so no extra DOM exists purely to be decorative.
 */
export function HumanAi() {
  return (
    <section className="mkt-band mkt-band--dark">
      <div className="mkt-shell">
        <div className="mkt-bandhead mkt-bandhead--dark">
          <p className="mkt-eyebrow">Human + AI</p>
          <h2>
            AI does the work.
            <span className="mkt-bandhead__second">You make the decisions.</span>
          </h2>
          <p className="mkt-bandlead">
            Scoreboad helps recruiters move faster without removing human judgment
            from the hiring process.
          </p>
        </div>

        <div className="mkt-split">
          <Reveal className="mkt-split__col">
            <p className="mkt-split__label">AI</p>
            <ul className="mkt-split__list">
              {AI_SIDE.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal className="mkt-split__col mkt-split__col--human" delay={120}>
            <p className="mkt-split__label mkt-split__label--human">You</p>
            <ul className="mkt-split__list">
              {HUMAN_SIDE.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
