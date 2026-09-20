import { HOME_FAQS } from "@/lib/marketing/home";

/**
 * The FAQ.
 *
 * NATIVE <details>/<summary>, which is why there is no client component here:
 * open/close, keyboard operation and the screen-reader announcement all come
 * from the browser. A hand-built accordion would need state, ARIA and a key
 * handler to reach the same place, and would ship JavaScript to do it.
 *
 * The ninth answer says no certification is held. Keeping it is a deliberate
 * choice — it is the first question a procurement team asks, and answering it
 * plainly is worth more than leaving it out and being asked anyway.
 */
export function Faq() {
  return (
    <section className="mkt-band mkt-band--light" id="faq">
      <div className="mkt-shell">
        <div className="mkt-bandhead">
          <p className="mkt-eyebrow mkt-eyebrow--light">Questions</p>
          <h2>Frequently asked questions.</h2>
        </div>

        <div className="mkt-faqlist">
          {HOME_FAQS.map((faq) => (
            <details key={faq.q} className="mkt-faqitem">
              <summary className="mkt-faqitem__q">
                <span>{faq.q}</span>
                {/*
                  A CSS-rotated chevron rather than the default marker, which
                  cannot be styled consistently across browsers. `list-style:
                  none` on the summary removes the native triangle.
                */}
                <span className="mkt-faqitem__mark" aria-hidden="true" />
              </summary>
              <p className="mkt-faqitem__a">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
