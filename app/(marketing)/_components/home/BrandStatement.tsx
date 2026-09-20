import { BRAND_STATEMENT } from "@/lib/marketing/home";

/**
 * People × Intelligence × Opportunity.
 *
 * A narrow band between the product sections and the closing ask — a beat of
 * quiet rather than another grid of cards. The page has a lot of information in
 * it; this is where a reader is allowed to stop reading for a moment.
 *
 * THE MULTIPLICATION SIGNS ARE `aria-hidden`. "People multiplication sign
 * Intelligence" is not a sentence, so the visible glyphs are decorative and the
 * accessible name on the container carries the phrase as words.
 *
 * `×` is U+00D7, not a lowercase x. At this size the difference is the whole
 * effect.
 */
export function BrandStatement() {
  return (
    <section className="mkt-band mkt-band--statement">
      <div className="mkt-shell">
        <p
          className="mkt-statement"
          aria-label={BRAND_STATEMENT.join(", ")}
        >
          {BRAND_STATEMENT.map((word, index) => (
            <span key={word} className="mkt-statement__part">
              {index > 0 && (
                <span className="mkt-statement__x" aria-hidden="true">
                  ×
                </span>
              )}
              <span className="mkt-statement__word">{word}</span>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
