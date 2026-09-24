import { describe, expect, it } from "vitest";
import { FOOTER_BRAND, FOOTER_LEGAL, FOOTER_SECTIONS } from "./footer";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES } from "./content";
import { liveHrefs } from "./navigation";

/**
 * The footer's link contract.
 *
 * THE FOOTER IS THE EASIEST PLACE ON A SITE TO BREAK QUIETLY. It renders on
 * every public page, nobody reads it during review, and a dead link in it is a
 * dead link forty times over. It is also where the pressure to add a route that
 * "will exist soon" is strongest, because an empty column looks unfinished.
 *
 * These tests are what stands in the way of that.
 */

const ALL_LINKS = FOOTER_SECTIONS.flatMap((section) => section.links);

describe("every footer link goes somewhere real", () => {
  it("resolves to a route in the inventory", () => {
    const known = new Set(INTERNAL_ROUTES);

    for (const link of ALL_LINKS) {
      const path = link.href.split("#")[0] || "/";
      expect(known.has(path), `footer → ${link.href}`).toBe(true);
    }
  });

  it("uses no placeholder, external or protocol-relative href", () => {
    for (const link of ALL_LINKS) {
      // `#` and `` are the two shapes a placeholder takes, and both look like
      // a working link until somebody clicks one.
      expect(link.href, "placeholder href").not.toBe("#");
      expect(link.href.length).toBeGreaterThan(1);
      // A hardcoded absolute URL to our own domain breaks preview deployments
      // and skips the client router.
      expect(link.href.startsWith("/"), link.href).toBe(true);
      expect(link.href.startsWith("//"), link.href).toBe(false);
    }
  });

  it("links no private or API route", () => {
    /*
      §21. The footer is crawled on every page, so a private route named here
      would be offered to search engines as a landing page — and then redirect
      every visitor who clicked it to the login screen.
    */
    const forbidden = [
      /^\/api\b/,
      /^\/dashboard\b/,
      /^\/admin\b/,
      /^\/settings\b/,
      /^\/jobs\b/,
      /^\/candidates\b/,
      /^\/applications\b/,
      /^\/interviews\b/,
      /^\/pipeline\b/,
      /^\/onboarding\b/,
    ];

    for (const link of ALL_LINKS) {
      for (const pattern of forbidden) {
        expect(pattern.test(link.href), `private route in footer: ${link.href}`).toBe(false);
      }
    }
  });

  it("points every fragment at a section some page renders", () => {
    // Verified against the id each component sets: #platform on
    // PlatformOverview, #integrations on Integrations, #pricing on Pricing,
    // #ai-safety on /how-it-works.
    const rendered = new Set(["platform", "integrations", "pricing", "ai-safety"]);

    for (const link of ALL_LINKS) {
      const [, fragment] = link.href.split("#");
      if (!fragment) continue;
      expect(rendered.has(fragment), `${link.href} → #${fragment}`).toBe(true);
    }
  });

  it("names each destination once", () => {
    // The same page twice under two labels splits its internal link equity and
    // reads as a mistake.
    const hrefs = ALL_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size, `duplicates: ${hrefs.join(", ")}`).toBe(hrefs.length);
  });
});

describe("anchor text does the work (§10)", () => {
  it("is descriptive rather than generic", () => {
    for (const link of ALL_LINKS) {
      expect(/^(click here|here|read more|learn more|more|link)$/i.test(link.label.trim()), link.label).toBe(false);
      // A one-word label in a footer is almost always a tab name that escaped —
      // "Source" and "Decide" tell a reader nothing about where they lead.
      expect(link.label.trim().split(/\s+/).length, `too thin: "${link.label}"`).toBeGreaterThan(1);
    }
  });

  it("gives every product page a label describing what it covers", () => {
    /*
      GUARDS THE FALLBACK. FOOTER_SECTIONS falls back to `group.tab` when a slug
      has no descriptive label — which renders fine and silently reintroduces
      the one-word anchors this module replaced. A seventh capability group
      without a label fails here instead.
    */
    const product = FOOTER_SECTIONS.find((section) => section.title === "Product");
    expect(product?.links).toHaveLength(CAPABILITY_GROUPS.length);

    for (const group of CAPABILITY_GROUPS) {
      const link = product?.links.find((l) => l.href === `/product/${group.slug}`);
      expect(link, `no footer link for /product/${group.slug}`).toBeDefined();
      expect(link?.label).not.toBe(group.tab);
    }
  });

  it("keeps no empty column", () => {
    // §3: do not force a category. A heading with nothing under it is the
    // "coming soon" a footer should never imply.
    for (const section of FOOTER_SECTIONS) {
      expect(section.links.length, section.title).toBeGreaterThan(0);
      expect(section.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("nothing is invented (§15, §16, §25)", () => {
  const TEXT = [
    FOOTER_BRAND.description,
    FOOTER_BRAND.note,
    FOOTER_BRAND.action.label,
    ...FOOTER_BRAND.converge,
    ...ALL_LINKS.flatMap((link) => [link.label, link.href]),
  ];

  it("publishes no social account", () => {
    // There is no verified Scoreboad account on any platform. The only
    // "linkedin" strings in this codebase are a CANDIDATE profile field on an
    // application form, which is somebody else's account entirely.
    for (const text of TEXT) {
      expect(
        /linkedin|twitter|x\.com|instagram|facebook|youtube|github/i.test(text),
        `social reference: "${text}"`
      ).toBe(false);
    }
  });

  it("links legal pages only now that they exist", () => {
    /*
      THIS GUARD INVERTED IN MODULE 25, and the inversion is the point rather
      than a loosening. It used to assert that no legal link appeared anywhere,
      because /privacy, /terms and /cookies did not exist and linking them
      would have been the fabrication the footer must never commit.

      They exist now, so what has to be guarded is the other direction: every
      legal link resolves, and the row stays pinned to the real routes.
    */
    const known = new Set(INTERNAL_ROUTES);

    for (const link of FOOTER_LEGAL) {
      expect(known.has(link.href), `legal row → ${link.href}`).toBe(true);
      expect(link.href.startsWith("/"), link.href).toBe(true);
    }

    // Still no page for any of these, so still no link to one.
    for (const link of [...ALL_LINKS, ...FOOTER_LEGAL]) {
      expect(/\/(gdpr|dpa|subprocessors|legal-notice)\b/i.test(link.href), link.href).toBe(false);
    }
  });

  it("invents no address, phone number or demo booking", () => {
    for (const text of TEXT) {
      expect(/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(text), `address: "${text}"`).toBe(false);
      expect(/calendly|cal\.com/i.test(text), `booking link: "${text}"`).toBe(false);
      expect(/\bbook a demo\b/i.test(text), `demo promise: "${text}"`).toBe(false);
    }
  });

  it("carries no old product name", () => {
    for (const text of TEXT) {
      expect(/myrecruiter|hirflix/i.test(text), `old branding: "${text}"`).toBe(false);
    }
  });

  it("makes no unmeasured claim in the brand line", () => {
    const copy = `${FOOTER_BRAND.description} ${FOOTER_BRAND.note}`;
    expect(/\bguarantee|\b\d+%|\b\d+x\b|best|leading|trusted by/i.test(copy), copy).toBe(false);
  });
});

describe("the footer completes the site's link graph (§31)", () => {
  it("reaches every public marketing page from the footer or the navbar", () => {
    /*
      THE ORPHAN CHECK, and it is the whole point of Module 23. A page nothing
      links to is a page nobody and no crawler finds, however good it is — and
      this site has added four dedicated routes in as many modules.

      /login is reachable from the navbar; everything else should be in the
      footer. The union is what matters, so the test takes it.
    */
    const reachable = new Set([
      ...FOOTER_SECTIONS.flatMap((s) => s.links.map((l) => l.href.split("#")[0] || "/")),
      ...liveHrefs().map((href) => href.split("#")[0] || "/"),
      ...FOOTER_LEGAL.map((link) => link.href),
      FOOTER_BRAND.action.href,
      // The footer sits on every page, so the site root is always one click up
      // via the navbar's own logo.
      "/",
    ]);

    for (const route of INTERNAL_ROUTES) {
      expect(reachable.has(route), `orphaned: ${route}`).toBe(true);
    }
  });

  it("offers the account route as the one conversion action", () => {
    expect(FOOTER_BRAND.action.href).toBe("/signup");
  });
});
