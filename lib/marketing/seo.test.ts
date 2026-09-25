import { describe, expect, it } from "vitest";
import {
  OG_IMAGE_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  breadcrumbJsonLd,
  buildMetadata,
  organizationJsonLd,
  softwareJsonLd,
  websiteJsonLd,
} from "./seo";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES, PRODUCT_SEO_TITLES } from "./content";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

/**
 * The site's technical SEO invariants.
 *
 * WHAT THESE PROTECT. Every assertion here corresponds to something Module 26's
 * audit actually found broken, or to something that was correct and is one
 * careless edit from not being. SEO regressions are invisible in a browser:
 * nothing renders differently when a canonical goes missing, a private route
 * lands in the sitemap, or a social card stops carrying an image.
 */

describe("every page carries a social card", () => {
  it("sets an image on both the Open Graph and Twitter blocks", () => {
    /*
      THE BUG THIS MODULE FOUND. `app/opengraph-image.tsx` is a file convention
      that Next merges into any page which does NOT declare its own openGraph
      object — and this helper has declared one since Module 03, which replaced
      the generated block instead of merging with it. Result: /login and
      /signup carried a card and all fifteen marketing pages did not.
    */
    const meta = buildMetadata({ title: "X", description: "Y", path: "/x" });

    expect(meta.openGraph?.images).toEqual([OG_IMAGE_PATH]);
    expect(meta.twitter?.images).toEqual([OG_IMAGE_PATH]);
    // A summary_large_image card with no image reserves the space and fills it
    // with nothing, which is worse than a small card.
    expect((meta.twitter as { card?: string })?.card).toBe("summary_large_image");
  });

  it("keeps the card path relative so previews point at themselves", () => {
    expect(OG_IMAGE_PATH.startsWith("/")).toBe(true);
    expect(OG_IMAGE_PATH.startsWith("http")).toBe(false);
  });
});

describe("canonicals", () => {
  it("are self-referencing and free of query strings", () => {
    for (const path of ["/", "/about", "/product/screen"]) {
      const meta = buildMetadata({ title: "T", description: "D", path });
      expect(meta.alternates?.canonical).toBe(path);
      expect(String(meta.alternates?.canonical)).not.toContain("?");
    }
  });

  it("strips a trailing slash from a non-root path", () => {
    // Two URLs for one page is the duplicate the canonical exists to resolve.
    const meta = buildMetadata({ title: "T", description: "D", path: "/about/" });
    expect(meta.alternates?.canonical).toBe("/about");
  });
});

describe("the sitemap", () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it("lists only real, public routes", () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE_URL}/`), url).toBe(true);
      const path = url.slice(SITE_URL.length) || "/";
      expect(INTERNAL_ROUTES, `${path} is not a known route`).toContain(path);
    }
  });

  it("contains no private route, query string or non-production host", () => {
    const forbidden = [
      /\/api\//,
      /\/settings\b/,
      /\/dashboard\b/,
      /\/jobs\b/,
      /\/candidates\b/,
      /\/apply\b/,
      /\/coding\b/,
      /\/unsubscribe\b/,
      /\?/,
      /localhost|127\.0\.0\.1|vercel\.app/,
    ];

    for (const url of urls) {
      for (const pattern of forbidden) {
        expect(pattern.test(url), `${url} matched ${pattern}`).toBe(false);
      }
    }
  });

  it("omits the auth surfaces", () => {
    // §9 — a sign-in form is a control, not content. Still crawlable and still
    // linked; simply not put forward for indexing.
    expect(urls).not.toContain(`${SITE_URL}/login`);
    expect(urls).not.toContain(`${SITE_URL}/signup`);
  });

  it("fabricates no last-modified date", () => {
    /*
      §11. Stamping every URL with the deploy time tells a crawler that
      /privacy — declared `yearly` — changed today, on every deploy. Once that
      signal is learned to be noise, it discredits the dates that are real.
    */
    for (const entry of entries) {
      expect(entry.lastModified, `${entry.url} carries a date`).toBeUndefined();
    }
  });

  it("has no duplicates and reaches every product page", () => {
    expect(new Set(urls).size).toBe(urls.length);
    for (const group of CAPABILITY_GROUPS) {
      expect(urls).toContain(`${SITE_URL}/product/${group.slug}`);
    }
  });
});

describe("robots.txt", () => {
  const doc = robots();
  const rule = Array.isArray(doc.rules) ? doc.rules[0] : doc.rules;
  const disallow = [rule?.disallow ?? []].flat();

  it("points at the sitemap on the production host", () => {
    expect(doc.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(String(doc.sitemap)).not.toMatch(/localhost|vercel\.app/);
  });

  it("keeps token-authorised candidate routes out of the index", () => {
    // These are public by design — a candidate has no login — and must never be
    // indexed: a result for one would reveal that somebody's link exists.
    for (const path of ["/apply/", "/coding/", "/unsubscribe"]) {
      expect(disallow, `${path} is crawlable`).toContain(path);
    }
  });

  it("does not disallow any page the sitemap offers", () => {
    /*
      THE CONTRADICTION WORTH CATCHING. Asking a crawler to index a URL in one
      file and refusing it in another is a self-inflicted indexing failure that
      nothing in a browser would reveal.
    */
    for (const url of sitemap().map((e) => e.url)) {
      const path = url.slice(SITE_URL.length) || "/";
      for (const blocked of disallow) {
        if (blocked === "/") continue;
        expect(
          path === blocked || path.startsWith(blocked.endsWith("/") ? blocked : `${blocked}/`),
          `${path} is in the sitemap and disallowed by ${blocked}`
        ).toBe(false);
      }
    }
  });
});

describe("structured data describes only what exists", () => {
  it("gives the Organization no invented contact or company detail", () => {
    // §21 — telephone, address, founding date, founders and headcount are all
    // unknown in this project, so none may appear.
    const org = organizationJsonLd() as Record<string, unknown>;
    for (const key of ["telephone", "address", "foundingDate", "founder", "numberOfEmployees", "sameAs"]) {
      expect(org[key], `Organization.${key} was invented`).toBeUndefined();
    }
    expect(org.name).toBe(SITE_NAME);
  });

  it("declares no sitelinks search box", () => {
    // §22 — there is no site search endpoint, so a SearchAction would be a
    // claim about a URL that does not exist.
    const site = websiteJsonLd() as Record<string, unknown>;
    expect(site.potentialAction).toBeUndefined();
    expect(site["@type"]).toBe("WebSite");
  });

  it("offers no price or rating for the software", () => {
    // Pricing is unpublished and there are no reviews; both are the classic
    // fabricated properties on a SoftwareApplication.
    const app = softwareJsonLd() as Record<string, unknown>;
    expect(app.offers).toBeUndefined();
    expect(app.aggregateRating).toBeUndefined();
    expect(app.review).toBeUndefined();
  });

  it("builds breadcrumbs as absolute production URLs", () => {
    const crumbs = breadcrumbJsonLd([
      { label: "Home", href: "/" },
      { label: "FAQ", href: "/faq" },
    ]) as { itemListElement: { item: string; position: number }[] };

    expect(crumbs.itemListElement).toHaveLength(2);
    expect(crumbs.itemListElement[1].item).toBe(`${SITE_URL}/faq`);
    expect(crumbs.itemListElement[0].position).toBe(1);
  });
});

describe("titles and descriptions", () => {
  it("gives every product page a title that says what it is", () => {
    /*
      The audit found all six titled with their tab word — "Decide ·
      Scoreboad", "Operate · Scoreboad" — which is a browser tab nobody can
      place and a search result nobody clicks.
    */
    for (const group of CAPABILITY_GROUPS) {
      const label = PRODUCT_SEO_TITLES[group.slug];
      expect(label, `no SEO title for /product/${group.slug}`).toBeDefined();
      expect(label).not.toBe(group.tab);
      expect(label.trim().split(/\s+/).length).toBeGreaterThan(1);
    }
  });

  it("keeps the site title and description free of unmeasured claims", () => {
    const copy = `${SITE_TITLE} ${SITE_DESCRIPTION}`;
    expect(/\bbest\b|\b#1\b|\bleading\b|\bguarantee/i.test(copy), copy).toBe(false);
  });

  it("resolves the production origin, not a development host", () => {
    // §29 — only production metadata must resolve to the real domain.
    expect(SITE_URL).not.toMatch(/localhost|127\.0\.0\.1|vercel\.app/);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});
