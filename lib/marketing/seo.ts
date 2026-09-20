// =============================================================================
// SEO FOUNDATION — the metadata every public page is built from.
//
// WHY A HELPER RATHER THAN A `metadata` OBJECT PER PAGE.
//
// There are four public routes today and the architecture is meant to carry
// /solutions/*, /platform/*, /for/* and /integrations later. Four hand-written
// metadata objects already disagreed in small ways — one set an Open Graph
// block, two did not; one set a canonical, one forgot. At twenty pages that is
// not a style problem, it is pages that quietly do not appear in search.
//
// So a page states what it IS — title, description, path — and this builds the
// canonical, the Open Graph block and the Twitter card from that. A page can
// still override anything by spreading its own fields after the call.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//
//   - No keyword stuffing, and no `keywords` field at all. Google has ignored
//     the meta keywords tag since 2009; emitting one signals an SEO plugin
//     rather than a maintained site.
//   - No hidden text, no doorway copy, no invented review or rating markup.
//     Structured data that describes something the page does not show is a
//     manual-action risk, not an optimisation.
//   - No per-page og:image yet. There is no image pipeline for them, and a
//     card pointing at a 404 is worse than one falling back to the site
//     default.
// =============================================================================
import type { Metadata } from "next";

/**
 * The production origin.
 *
 * Read from APP_URL so a preview deployment canonicalises to ITSELF rather than
 * telling a crawler that production is the original of the page it is looking
 * at — which is how a staging URL ends up indexed and a production one does
 * not. `metadataBase` in the root layout reads the same variable.
 */
export const SITE_URL = (process.env.APP_URL ?? "https://scoreboad.com").replace(/\/+$/, "");

export const SITE_NAME = "Scoreboad";

/** The default title and description, per the brand's own positioning. */
export const SITE_TITLE = "Scoreboad — AI-Powered Recruitment Platform";

export const SITE_DESCRIPTION =
  "Scoreboad helps hiring teams screen candidates, manage interviews, evaluate " +
  "applicants, and streamline recruitment with AI — all in one workspace.";

export type PageSeo = {
  /** The page's own title, WITHOUT the brand suffix — the template adds it. */
  title: string;
  description: string;
  /** Root-relative, with a leading slash: "/how-it-works". */
  path: string;
  /**
   * Set only on a page that should not be indexed — a thank-you page, a
   * duplicate, a utility route. Never set to hide thin content: the fix for
   * thin content is content.
   */
  noindex?: boolean;
  /**
   * Overrides the Open Graph title when the social card should read
   * differently from the browser tab. Rare, and worth a reason when used.
   */
  ogTitle?: string;
};

/**
 * Builds a page's metadata.
 *
 * The canonical is absolute because `metadataBase` resolves it — a bare "/" is
 * not a canonical URL, and Next warns about exactly that at build time.
 */
export function buildMetadata({
  title,
  description,
  path,
  noindex = false,
  ogTitle,
}: PageSeo): Metadata {
  /*
    THE ROOT CANONICAL RENDERS WITHOUT A TRAILING SLASH, AND THAT IS NEXT, NOT
    THIS.

    Module 03 asked for `https://scoreboad.com/`. Passing the absolute URL with
    the slash was tried and is INERT: Next normalises trailing slashes out of
    every resolved metadata URL, which is why `og:url` — built from the same
    "/" a few lines below and never touched — comes out identical. Forcing it
    would mean bypassing the metadata API for one character.

    It is also the same URL. RFC 3986 6.2.3 makes an empty path equivalent to
    "/", and Google documents the two as one address. So the relative form
    stays, because it is what keeps a preview deployment canonicalising to
    ITSELF rather than declaring production the original of the page being
    looked at.
  */
  const url = path === "/" ? "/" : path.replace(/\/+$/, "");

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      // The social card carries the FULL brand title: a card reading only
      // "Pricing" tells a reader nothing about whose pricing it is.
      title: ogTitle ?? `${title} · ${SITE_NAME}`,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle ?? `${title} · ${SITE_NAME}`,
      description,
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

// -----------------------------------------------------------------------------
// Structured data
//
// JSON-LD as a plain object, injected by the caller through a <script> tag.
// No dependency: schema.org markup is JSON, and a library to emit JSON is a
// library to emit JSON.
//
// EVERY HELPER BELOW DESCRIBES SOMETHING THE PAGE ACTUALLY RENDERS. That is not
// a nicety — structured data claiming FAQs, ratings or products a visitor
// cannot see is what a manual action is issued for.
// -----------------------------------------------------------------------------

/** The organization, for the home page only. One per site. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon.png`,
    description: SITE_DESCRIPTION,
  };
}

/**
 * The software itself.
 *
 * NO `offers` BLOCK AND NO `aggregateRating`. Pricing is not published, and
 * there are no reviews — emitting either would be describing something that
 * does not exist. They can be added the day those things are true.
 */
export function softwareJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
  };
}

/**
 * An FAQ block.
 *
 * ONLY valid when the questions and answers are visible on the page. Pass the
 * same array the page renders — never a longer one written for the crawler.
 */
export function faqJsonLd(faqs: readonly { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}

/** A breadcrumb trail. Pass the same items the <Breadcrumbs> component shows. */
export function breadcrumbJsonLd(items: readonly { label: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `${SITE_URL}${item.href}`,
    })),
  };
}
