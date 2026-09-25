import type { MetadataRoute } from "next";
import { CAPABILITY_GROUPS } from "@/lib/marketing/content";
import { SITE_URL } from "@/lib/marketing/seo";

/**
 * The sitemap.
 *
 * GENERATED FROM THE SAME CONSTANT THE PAGES ARE. The six product routes come
 * from CAPABILITY_GROUPS, which is also what generateStaticParams uses — so a
 * seventh group appears in the sitemap the moment the page exists, and cannot
 * be forgotten. A hand-listed sitemap is a second inventory of routes, and the
 * two always drift.
 *
 * ONLY PUBLIC, INDEXABLE ROUTES. No application pages (they redirect), no
 * token-authorised candidate routes (see robots.ts), and NO ENTRIES FOR PAGES
 * THAT DO NOT EXIST YET. A sitemap listing /pricing before /pricing is written
 * is a 404 handed to a crawler with a request to come and see it.
 *
 * NO `lastModified`, and that reverses an earlier decision here.
 *
 * It used to be the deploy time, argued as honest on the grounds that any page
 * MAY have changed at a deploy. Module 26's audit rejects that: a deploy that
 * touches one component restamps all seventeen URLs, so a page like /privacy —
 * declared `yearly` two lines below — would claim to have changed today, every
 * deploy, forever. That is exactly the "every page changed daily" signal a
 * crawler learns to ignore, and once ignored the field is worse than absent
 * because it discredits the ones that are real.
 *
 * There is no reliable per-page modification date in this project, so the field
 * is omitted rather than invented. It can be added the day one exists.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]
  ) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });

  return [
    entry("/", 1, "weekly"),
    entry("/how-it-works", 0.8, "monthly"),
    // Product philosophy rather than a company history — it changes about as
    // often as the positioning does, which is rarely.
    entry("/about", 0.5, "yearly"),
    // Higher than About: this is a page people look for when evaluating, and
    // it changes whenever a control does.
    entry("/security", 0.7, "monthly"),
    // The entry point for somebody evaluating the product, so it ranks with
    // the other conversion pages rather than with the reference ones.
    entry("/contact", 0.7, "monthly"),
    // The FAQ answers the questions people search for by name, and it changes
    // whenever the product gains or loses an answer.
    entry("/faq", 0.7, "monthly"),
    /*
      §24 — INCLUDED, at a low priority. These are public, useful and the kind
      of page people look for by name before signing up, so excluding them
      would be hiding them rather than managing crawl budget. Low priority and
      a yearly cadence says what they are: reference, not a landing page.
    */
    entry("/privacy", 0.3, "yearly"),
    entry("/terms", 0.3, "yearly"),
    entry("/cookies", 0.3, "yearly"),
    ...CAPABILITY_GROUPS.map((group) => entry(`/product/${group.slug}`, 0.7, "monthly")),
  ];
  /*
    §9 — /signup AND /login ARE DELIBERATELY ABSENT, reversing an earlier call
    that listed them as "real entry points somebody may search for by name".

    A sitemap is a statement about which pages are this site's CONTENT. An
    auth form is a control, not content: it has nothing to rank for, it carries
    the site's generic description because it sets none of its own, and a
    crawler that indexes it produces a result that helps nobody. Both stay
    crawlable — robots.txt allows them and the navbar and footer link them — so
    nothing is hidden; they are simply not put forward for indexing.
  */
}
