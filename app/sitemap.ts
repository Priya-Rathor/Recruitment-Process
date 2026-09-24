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
 * `lastModified` is the deploy time rather than a per-page date. Faking a
 * freshness signal is worse than omitting one, and this is honest: at a deploy,
 * every one of these pages genuinely may have changed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]
  ) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
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
    // Real entry points somebody may search for by name.
    entry("/signup", 0.5, "yearly"),
    entry("/login", 0.3, "yearly"),
  ];
}
