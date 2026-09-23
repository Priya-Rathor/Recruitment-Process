import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FAQ_CTA, FAQ_HERO, FAQ_ITEMS } from "@/lib/marketing/faq";
import { buildMetadata, faqJsonLd } from "@/lib/marketing/seo";
import { Breadcrumbs } from "@/components/marketing/Breadcrumbs";
import { FaqBrowser } from "../_components/faq/FaqBrowser";

/**
 * §14 — the dedicated FAQ route's metadata, built by the shared helper so the
 * canonical, Open Graph and Twitter blocks match every other public page's.
 */
export const metadata: Metadata = buildMetadata({
  title: "FAQ — AI Recruitment & Hiring Software Questions",
  description:
    "Answers about Scoreboad, AI recruitment, candidate screening, AI screening " +
    "calls, hiring workflows, candidate evaluation, security and getting started.",
  path: "/faq",
});

/**
 * The FAQ page — the site's canonical FAQ destination.
 *
 * WHY A PAGE RATHER THAN LEAVING IT ON THE HOMEPAGE. The navigation has listed
 * "Frequently Asked Questions" under Resources since Module 02, and the footer's
 * own comment records that a Resources column was dropped because its pages —
 * Documentation, FAQ, Blog — did not exist. This makes one of them exist, on the
 * same pattern as /about, /security and /contact: the homepage section stays as
 * the short version and this is the long one.
 *
 * ONE FAQPage IN THE WHOLE SITE, and it is here. The homepage used to emit
 * faqJsonLd(HOME_FAQS); with a canonical FAQ route that would be two FAQPage
 * entities describing overlapping content, which is the duplicate schema Step 16
 * rules out. The block moved rather than being added.
 *
 * SERVER-RENDERED apart from <FaqBrowser>, which holds the filter. Every
 * question and answer is in the HTML regardless of the filter's state.
 */
export default function FaqPage() {
  return (
    <>
      {/*
        §16 — built from FAQ_ITEMS, the same array the page renders, so the
        markup cannot describe a question a visitor is unable to see. Nothing
        here is hidden FAQ content written for a crawler.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd(FAQ_ITEMS.map((item) => ({ q: item.q, a: item.a })))),
        }}
      />

      <section className="mkt-band mkt-band--dark faq-hero" aria-labelledby="faq-heading">
        <div className="mkt-shell">
          {/*
            §17 — Home → FAQ, and NOT Home → Resources → FAQ: there is no
            /resources route, and a breadcrumb through a page that does not
            exist is a broken trail in the structured data as well as on screen.
            The component emits the BreadcrumbList itself, so there is one.
          */}
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "FAQ", href: "/faq" },
            ]}
          />

          <h1 id="faq-heading" className="faq-hero__title">
            {FAQ_HERO.title}
          </h1>
          <p className="faq-hero__lead">{FAQ_HERO.lead}</p>
        </div>
      </section>

      <section className="mkt-band mkt-band--light faq-body">
        <div className="mkt-shell">
          <h2 className="is-sr-only">Questions and answers</h2>
          <FaqBrowser />
        </div>
      </section>

      {/* ---- §23 · Close ------------------------------------------------- */}
      <section className="mkt-band mkt-band--dark mkt-band--cta">
        <div className="mkt-shell faq-cta">
          <h2>{FAQ_CTA.title}</h2>
          <p className="mkt-bandlead">{FAQ_CTA.body}</p>

          <div className="faq-cta__buttons">
            <Link href={FAQ_CTA.primary.href} className="mkt-btn mkt-btn--primary">
              {FAQ_CTA.primary.label}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href={FAQ_CTA.secondary.href} className="mkt-btn mkt-btn--glass">
              {FAQ_CTA.secondary.label}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
