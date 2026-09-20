import { describe, expect, it } from "vitest";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES, ROLE_FLOWS } from "@/lib/marketing/content";
import {
  NAVIGATION,
  isEntryActive,
  liveHrefs,
  liveNavigation,
  type NavEntry,
} from "@/lib/marketing/navigation";

/**
 * THE NAVIGATION, ASSERTED.
 *
 * The navbar is the one component on every public page, so a broken link in it
 * is a broken link everywhere — and unlike a broken link in body copy, nothing
 * reports it. These tests exist so that shipping one is a failing build.
 *
 * THE LOAD-BEARING ONE IS THE FIRST: every destination marked "live" must
 * resolve to a page that exists. That is what makes the live/planned split
 * safe. A later module flipping "planned" → "live" before writing the page
 * fails here rather than in production.
 */

const known = new Set(INTERNAL_ROUTES);

/** Every leaf in the architecture, live or not. */
function allLeaves() {
  return NAVIGATION.flatMap((entry) =>
    entry.kind === "link"
      ? [{ label: entry.label, href: entry.href, status: entry.status, description: undefined }]
      : entry.groups.flatMap((group) => group.items)
  );
}

// -----------------------------------------------------------------------------
// Link integrity
// -----------------------------------------------------------------------------

describe("every rendered navigation link resolves", () => {
  it("points every live destination at a page that exists", () => {
    const broken = liveHrefs().filter((href) => !known.has(href.split("#")[0] || "/"));
    expect(broken, `live nav links with no page behind them:\n${broken.join("\n")}`).toEqual([]);
  });

  it("only uses fragments a page actually renders", () => {
    /*
      A fragment that matches no id scrolls nowhere. It is WORSE than a 404,
      because the page loads, nothing moves, and the reader concludes the site
      is broken rather than the link.

      #product / #ai / #trust / #faq are ids on the home page's sections;
      #ai-safety is on /how-it-works; and the #for-* ids are the role cards,
      checked against ROLE_FLOWS below so a renamed role fails here.
    */
    const rendered = new Set([
      "product",
      "ai",
      "trust",
      "faq",
      "main",
      "ai-safety",
      ...ROLE_FLOWS.map((flow) => flow.anchor),
    ]);

    for (const href of liveHrefs()) {
      const [, fragment] = href.split("#");
      if (!fragment) continue;
      expect(rendered.has(fragment), `${href} → #${fragment}`).toBe(true);
    }
  });

  it("keeps the Who It's For menu in step with the role sections it links to", () => {
    /*
      The menu's four items ARE the four role cards on /how-it-works. Adding a
      fifth role without a menu item — or the reverse — means the nav and the
      page disagree about what the product is for.
    */
    const linked = liveHrefs()
      .filter((href) => href.startsWith("/how-it-works#for-"))
      .map((href) => href.split("#")[1]);

    expect(new Set(linked)).toEqual(new Set(ROLE_FLOWS.map((flow) => flow.anchor)));
  });

  it("has a Products item for every capability page", () => {
    /*
      The inverse of the link check: a /product/* page that no menu item points
      at is an orphan, reachable only from the footer and a crawl of the
      sitemap. Six pages, six items.
    */
    const linked = liveHrefs().filter((href) => href.startsWith("/product/"));
    expect(new Set(linked)).toEqual(
      new Set(CAPABILITY_GROUPS.map((group) => `/product/${group.slug}`))
    );
  });

  it("uses no absolute or off-site href", () => {
    // A hardcoded https:// link to our own domain breaks on preview deployments
    // and skips the client-side router.
    for (const leaf of allLeaves()) {
      expect(leaf.href.startsWith("/"), leaf.href).toBe(true);
    }
  });

  it("points at each destination exactly once", () => {
    // The same page under two labels in one navbar is a reader deciding which
    // of two identical doors to open, and it splits the internal link signal.
    const hrefs = liveHrefs();
    expect(new Set(hrefs).size, `duplicate destinations in:\n${hrefs.join("\n")}`).toBe(
      hrefs.length
    );
  });
});

// -----------------------------------------------------------------------------
// What is rendered vs what is declared
// -----------------------------------------------------------------------------

describe("the planned architecture stays out of the DOM", () => {
  it("renders no planned item", () => {
    for (const entry of liveNavigation()) {
      expect(entry.status, `${entry.label} is a rendered menu`).toBe("live");
      if (entry.kind === "menu") {
        for (const group of entry.groups) {
          for (const item of group.items) {
            expect(item.status, `${entry.label} → ${item.label}`).toBe("live");
          }
        }
      }
    }
  });

  it("drops a menu whose every destination is planned", () => {
    // An empty mega panel is worse than an absent menu: it opens onto nothing
    // and advertises the gap.
    const rendered = new Set(liveNavigation().map((entry) => entry.label));
    for (const label of ["Solutions", "Integrations", "Pricing"]) {
      expect(rendered.has(label), `${label} has no live destination and must not render`).toBe(
        false
      );
    }
  });

  it("still declares the whole architecture, so a later module only flips a flag", () => {
    // The point of the module. If someone "tidies up" the planned entries, the
    // structure the brief specified is lost and the next module re-derives it.
    const declared = new Set(NAVIGATION.map((entry) => entry.label));
    for (const label of [
      "Products",
      "Solutions",
      "Who It's For",
      "Integrations",
      "Resources",
      "Pricing",
    ]) {
      expect(declared.has(label), `${label} must stay declared`).toBe(true);
    }
  });

  it("marks a planned destination for every page the architecture still needs", () => {
    const planned = allLeaves().filter((leaf) => leaf.status === "planned");
    expect(planned.length).toBeGreaterThan(0);

    // A planned href that ALREADY resolves is a page someone wrote without
    // turning its menu item on — a real page nothing links to.
    const shippable = planned.filter((leaf) => known.has(leaf.href.split("#")[0] || "/"));
    expect(
      shippable.map((leaf) => leaf.href),
      "these pages exist but are still marked planned — flip them to live"
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Copy
// -----------------------------------------------------------------------------

describe("the navigation's wording", () => {
  it("gives every rendered destination descriptive anchor text", () => {
    /*
      A nav label is the anchor text of a site-wide internal link, which makes
      it the strongest single description a crawler gets of the page behind it.
      "Screen" is not one. Two words minimum, and no bare verb.
    */
    for (const entry of liveNavigation()) {
      if (entry.kind !== "menu") continue;
      for (const group of entry.groups) {
        for (const item of group.items) {
          expect(item.label.trim().split(/\s+/).length, `"${item.label}" is too thin`).toBeGreaterThan(
            1
          );
        }
      }
    }
  });

  it("keeps descriptions to one line", () => {
    // Two lines in a mega menu column turns a scannable list into a page of
    // prose, and the reader stops reading any of it.
    for (const leaf of allLeaves()) {
      if (!leaf.description) continue;
      expect(leaf.description.length, leaf.description).toBeLessThanOrEqual(80);
    }
  });

  it("claims nothing the product has not measured", () => {
    // Same rule as the landing page's copy, applied to the nav, because a mega
    // menu description is marketing copy wherever it happens to live.
    const banned = /\b\d+\s*x\b|\b\d+%|\bguarantee|\bbest[- ]in[- ]class|\bindustry[- ]leading/i;
    for (const leaf of allLeaves()) {
      if (!leaf.description) continue;
      expect(banned.test(leaf.description), leaf.description).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// Active state
// -----------------------------------------------------------------------------

describe("the active state", () => {
  const products = NAVIGATION.find((e) => e.label === "Products") as NavEntry;
  const resources = NAVIGATION.find((e) => e.label === "Resources") as NavEntry;

  it("marks the menu that owns the current page", () => {
    expect(isEntryActive(products, "/product/screen")).toBe(true);
    expect(isEntryActive(resources, "/how-it-works")).toBe(true);
  });

  it("does not mark a menu that does not own it", () => {
    expect(isEntryActive(products, "/how-it-works")).toBe(false);
  });

  it("marks nothing on the home page", () => {
    /*
      THE BUG THIS PINS. Every menu holds at least one "/#..." anchor, so a
      naive prefix match on "/" lights up all of them at once — three
      simultaneous "you are here" underlines, which tells the reader nothing.
    */
    for (const entry of NAVIGATION) {
      expect(isEntryActive(entry, "/"), entry.label).toBe(false);
    }
  });

  it("marks at most one menu for any real page", () => {
    for (const href of liveHrefs()) {
      const path = href.split("#")[0];
      if (!path || path === "/") continue;
      const active = NAVIGATION.filter((entry) => isEntryActive(entry, path));
      expect(active.map((e) => e.label), `${path} lights up more than one menu`).toHaveLength(1);
    }
  });
});
