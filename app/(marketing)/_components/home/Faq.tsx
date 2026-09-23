import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HOME_FAQS } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";

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
 *
 * THE SHORT VERSION SINCE MODULE 22. /faq is the canonical FAQ destination and
 * carries these nine plus the rest; it imports HOME_FAQS rather than restating
 * them, so the two cannot drift. The FAQPage structured data lives there, not
 * here — one FAQPage per site.
 */
export function Faq() {
  return (
    <Section tone="light" id="faq">
      <SectionHeading eyebrow="Questions" title="Frequently asked questions." />

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

      <p className="mkt-faqmore">
        <Link href="/faq">
          Read every question about Scoreboad
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </p>
    </Section>
  );
}
