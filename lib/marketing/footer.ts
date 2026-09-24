// =============================================================================
// The global footer's navigation.
//
// -----------------------------------------------------------------------------
// §2's ROUTE AUDIT — WHAT EXISTS, AND WHAT THE BRIEF ASKED FOR THAT DOES NOT
// -----------------------------------------------------------------------------
//
// Every public destination this site has, verified against the files in
// app/(marketing), the PUBLIC_PATHS allowlist in lib/supabase/session.ts and
// INTERNAL_ROUTES:
//
//   /                    /about        /contact      /faq
//   /how-it-works        /security     /signup       /login
//   /product/{source,understand,screen,decide,close,operate}
//
// THAT IS THE WHOLE LIST. The brief's suggested columns name eighteen more —
// /platform, /solutions, /who-its-for, /integrations, /resources, /pricing,
// /demo, /blog, /documentation, /guides, /careers, /privacy, /terms, case
// studies, product tour, hiring resources, cookie preferences and a social
// row. None of them is a route in this project, and §22 is explicit that a
// footer link must resolve. So they are absent rather than stubbed:
//
//   * NO SOCIAL LINKS. §15 requires verified accounts. There is no LinkedIn,
//     X, GitHub, Instagram or YouTube account named anywhere in this project —
//     the only "linkedin" strings in the codebase are a CANDIDATE profile
//     field on an application form, which is somebody else's account entirely.
//   * NO PRIVACY, TERMS OR COOKIE LINKS. §16 requires the pages to exist. They
//     do not; app/settings/privacy is an in-product admin screen behind auth,
//     not a published policy. There is no cookie mechanism to offer
//     preferences for.
//   * NO CAREERS, BLOG, GUIDES, DOCUMENTATION OR CASE STUDIES. Module 17
//     established there is no CMS and nothing to put in them.
//   * NO "BOOK A DEMO". Module 21 established there is no scheduler and no
//     inbox; /contact is the honest destination and says so itself.
//
// -----------------------------------------------------------------------------
// ANCHOR TEXT IS THE POINT (§10)
// -----------------------------------------------------------------------------
//
// The previous footer labelled the six product pages with their tab words —
// "Source", "Understand", "Screen", "Decide", "Close", "Operate". Those are
// good tabs and poor links: they are meaningless out of context to a reader and
// to a crawler alike. Each one now carries what the page is actually about,
// taken from that page's own heading rather than invented for SEO.
// =============================================================================

import { CAPABILITY_GROUPS } from "@/lib/marketing/content";

export type FooterLink = { label: string; href: string };

export type FooterSection = { title: string; links: FooterLink[] };

/**
 * Descriptive anchor text for each product page, keyed by slug.
 *
 * Each is a plain description of what that page covers — checked against its
 * own `heading` in content.ts, not written to hit a keyword. The test asserts
 * every capability group has one, so a seventh group cannot be added without a
 * label and quietly inherit a slug as its link text.
 */
const PRODUCT_LABELS: Record<string, string> = {
  source: "Jobs and applications",
  understand: "AI resume screening",
  screen: "AI screening calls",
  decide: "Hiring pipeline and evaluation",
  close: "Offers and onboarding",
  operate: "Analytics and automation",
};

export const FOOTER_SECTIONS: FooterSection[] = [
  {
    title: "Product",
    /*
      GENERATED FROM THE GROUPS, so a new product page appears here the day it
      exists and an orphan page is impossible — home.test.ts asserts the count
      matches CAPABILITY_GROUPS.
    */
    links: CAPABILITY_GROUPS.map((group) => ({
      label: PRODUCT_LABELS[group.slug] ?? group.tab,
      href: `/product/${group.slug}`,
    })),
  },
  {
    title: "Explore",
    links: [
      { label: "How Scoreboad works", href: "/how-it-works" },
      { label: "The AI safety model", href: "/how-it-works#ai-safety" },
      { label: "Platform overview", href: "/#platform" },
      { label: "Recruitment integrations", href: "/#integrations" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Scoreboad", href: "/about" },
      { label: "Security and data isolation", href: "/security" },
      { label: "Contact and next steps", href: "/contact" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Frequently asked questions", href: "/faq" },
      { label: "What Scoreboad costs", href: "/#pricing" },
      { label: "Create an account", href: "/signup" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

/**
 * The brand block.
 *
 * ONE ACTION, NOT A CTA BAND — see the component for why. §4 offered two
 * straplines; this is the longer one, because it names the surfaces the product
 * actually has rather than asserting a quality.
 */
export const FOOTER_BRAND = {
  description:
    "Candidates, screening, interviews, evaluation and hiring workflow in one " +
    "connected workspace — with a person making every decision that matters.",
  action: { label: "Create an account", href: "/signup" },
  /**
   * §24's convergence, and every label is a real stage of the product's own
   * workflow — the same sequence the homepage bands walk through.
   */
  converge: ["Job", "Candidate", "Screening", "Interview", "Evaluation"],
  /** The honest status line the footer has carried since Module 01. */
  note: "In active development · pricing not yet published",
} as const;

/**
 * §26 — the legal row, in the footer's bottom bar rather than as a fifth
 * column.
 *
 * WHY THE BOTTOM BAR. These are reference documents somebody goes looking for
 * deliberately; they are not part of the site's navigation the way the product
 * pages are. Giving them a column of their own would put them at the same
 * weight as "Product", which is not what they are — and the bottom bar beside
 * the copyright line is exactly where a reader expects to find them.
 *
 * Added only now that all three pages exist. The footer carried no legal links
 * for 24 modules because there was nothing real to link to.
 */
export const FOOTER_LEGAL: FooterLink[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookies", href: "/cookies" },
  { label: "Security", href: "/security" },
];
