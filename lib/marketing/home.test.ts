import { describe, expect, it } from "vitest";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES } from "@/lib/marketing/content";
import {
  AI_CARDS,
  AI_SIDE,
  BRAND_STATEMENT,
  DASHBOARD,
  HERO,
  HOME_FAQS,
  HOME_FOOTER_SECTIONS,
  HUMAN_SIDE,
  PIPELINE_PREVIEW,
  TRUST_CARDS,
  WORKFLOW_STEPS,
  WORKSPACE_CARDS,
} from "@/lib/marketing/home";
import { ICONS } from "@/app/(marketing)/_components/home/icons";

/**
 * THE LANDING PAGE'S CLAIMS, ASSERTED.
 *
 * A marketing page is the one surface where a wrong sentence is not a bug that
 * throws — it is a promise the product then has to keep on the first call. So
 * the things that can quietly go wrong here get a test:
 *
 *   1. Every link resolves. A 404 in a shared header appears on every page.
 *   2. No claim uses the vocabulary of an unmeasured outcome ("10x faster",
 *      "reduce time to hire by 40%"), because this product has measured none
 *      of that and has no customers to measure it on.
 *   3. No certification is claimed anywhere.
 *   4. Every icon name in the content resolves to a real icon, so a typo fails
 *      the build rather than rendering a hole in a card grid.
 */

// -----------------------------------------------------------------------------
// Links
// -----------------------------------------------------------------------------

describe("the landing page's internal links", () => {
  /**
   * INTERNAL_ROUTES is the inventory of pages that exist. Anything linked that
   * is not in it is a 404 shipped into the shared chrome.
   *
   * THIS IS THE TEST THAT KEPT THE FOOTER HONEST. The brief asked for eleven
   * footer links across Company / Resources / Legal; most of those pages do not
   * exist, and this assertion is why they were not shipped as dead links.
   *
   * The NAVBAR's equivalent moved to lib/marketing/navigation.test.ts when the
   * nav moved to its own module.
   */
  const known = new Set(INTERNAL_ROUTES);

  it("footer links all resolve to a real route", () => {
    for (const section of HOME_FOOTER_SECTIONS) {
      for (const link of section.links) {
        // The fragment is stripped: /how-it-works#ai-safety resolves to a real
        // page, and the anchor itself is checked separately below.
        const path = link.href.split("#")[0] || "/";
        expect(known.has(path), `footer → ${link.href}`).toBe(true);
      }
    }
  });

  it("only uses fragments a page actually renders", () => {
    /*
      Set on real sections: #product, #ai, #trust and #faq are ids in the home
      components; #ai-safety is on /how-it-works. A fragment that matches
      nothing scrolls nowhere and looks like a dead link to the reader, which is
      worse than an obvious 404 because nothing reports it.
    */
    const rendered = new Set(["product", "ai", "trust", "faq", "ai-safety", "main"]);

    for (const link of HOME_FOOTER_SECTIONS.flatMap((s) => s.links)) {
      const [, fragment] = link.href.split("#");
      if (!fragment) continue;
      expect(rendered.has(fragment), `${link.href} → #${fragment}`).toBe(true);
    }
  });

  it("uses no absolute or off-site href in the shared chrome", () => {
    // A hardcoded https:// link to our own domain breaks on preview deployments
    // and skips the client-side router.
    for (const link of HOME_FOOTER_SECTIONS.flatMap((s) => s.links)) {
      expect(link.href.startsWith("/"), link.href).toBe(true);
    }
  });

  it("has a product link for every capability group", () => {
    // Guards the inverse of the generated column: a group that never becomes a
    // link is an orphan page nothing points at.
    const product = HOME_FOOTER_SECTIONS.find((section) => section.title === "Product");
    expect(product?.links).toHaveLength(CAPABILITY_GROUPS.length);
  });
});

// -----------------------------------------------------------------------------
// Claims
// -----------------------------------------------------------------------------

/** Every piece of prose the landing page renders, in one array. */
const ALL_COPY: string[] = [
  HERO.headlineLead,
  HERO.headlineAccent,
  HERO.lead,
  HERO.badge,
  ...WORKSPACE_CARDS.flatMap((c) => [c.title, c.body]),
  ...AI_CARDS.flatMap((c) => [c.title, c.body]),
  ...TRUST_CARDS.flatMap((c) => [c.title, c.body]),
  ...WORKFLOW_STEPS.flatMap((s) => [s.title, s.body]),
  ...AI_SIDE.flatMap((s) => [s.title, s.body]),
  ...HUMAN_SIDE.flatMap((s) => [s.title, s.body]),
  ...HOME_FAQS.flatMap((f) => [f.q, f.a]),
];

/** The FAQ's own strings, so the certification check can treat them as pairs. */
const FAQ_LINES = new Set(HOME_FAQS.flatMap((faq) => [faq.q, faq.a]));

describe("the landing page makes no claim the product cannot keep", () => {
  it("states no unmeasured performance outcome", () => {
    /*
      "40% faster", "10x", "cut time-to-hire in half" — the standard vocabulary
      of a recruitment landing page, and this product has measured none of it
      and has no customers to measure it on. The hero says "Faster with AI",
      which is a description of the mechanism; a NUMBER attached to it would be
      a fabricated outcome metric.
    */
    const banned = [
      /\b\d+\s*x\s+(faster|better|more)/i,
      /\b\d+%\s*(faster|fewer|less|more|reduction|increase)/i,
      /\bcut\b.*\bin half\b/i,
      /\bsave[sd]?\s+\d+\s*(hours|days|weeks)/i,
      /\bguarantee[sd]?\b/i,
      /\bbest[- ]in[- ]class\b/i,
      /\bindustry[- ]leading\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `unmeasured claims:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("claims no certification it does not hold", () => {
    /*
      The FAQ MENTIONS SOC 2 and ISO 27001 — in order to say plainly that
      neither is held. So this cannot be a bare keyword search.

      CHECKED AS Q+A PAIRS, not as separate strings. The first run of this test
      failed on the QUESTION "Do you hold SOC 2 or ISO 27001 certification?",
      which names both and denies neither — because the denial is in the answer
      beneath it. A reader never meets one without the other, so the pair is the
      honest unit to assert on.
    */
    const blocks = [
      ...HOME_FAQS.map((faq) => `${faq.q} ${faq.a}`),
      ...ALL_COPY.filter((line) => !FAQ_LINES.has(line)),
    ];

    for (const block of blocks) {
      if (!/SOC\s*2|ISO\s*27001|HIPAA|PCI[- ]DSS/i.test(block)) continue;
      expect(
        /\bnot\b|\bno certification\b|\bwould rather say so\b/i.test(block),
        `names a certification without denying it: "${block}"`
      ).toBe(true);
    }
  });

  it("names no customer, logo or testimonial", () => {
    // There are none. The hero's badge says where the product actually stands
    // instead, which is the honest substitute for a logo wall.
    for (const line of ALL_COPY) {
      expect(/\btrusted by\b|\bcustomers? say\b|\bjoin \d+/i.test(line), line).toBe(false);
    }
  });

  it("labels the product mock's figures as illustrative, not live", () => {
    /*
      The dashboard and the pipeline table carry invented numbers. That is fine
      for a product shot and NOT fine if it reads as a live readout, so both
      components render a caption saying so. This asserts the data stayed
      plausible for a small team rather than drifting into impressive: a
      248-candidate pipeline is a real situation, 50,000 would be a claim about
      scale nobody has tested.
    */
    const total = Number(DASHBOARD.tiles[0].value);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1000);

    // The funnel only ever narrows, which is what makes it a funnel.
    const pcts = DASHBOARD.funnel.map((row) => row.pct);
    for (let i = 1; i < pcts.length; i += 1) {
      expect(pcts[i], `stage ${i} must not exceed the one before it`).toBeLessThanOrEqual(
        pcts[i - 1]
      );
    }
    expect(pcts[0]).toBe(100);

    // Match scores are percentages.
    for (const row of PIPELINE_PREVIEW.rows) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
    }
  });
});

// -----------------------------------------------------------------------------
// Structure
// -----------------------------------------------------------------------------

describe("the landing page's structure", () => {
  it("resolves every icon name to a real icon", () => {
    // A typo would otherwise render the fallback glyph silently, and a card grid
    // with one wrong icon is easy to miss in review.
    for (const card of [...WORKSPACE_CARDS, ...AI_CARDS, ...TRUST_CARDS]) {
      expect(ICONS[card.icon], `${card.title} → ${card.icon}`).toBeDefined();
    }
  });

  it("keeps the card grids at the counts their layouts assume", () => {
    // Six in a 3-column grid, eight in a 4-column grid. A seventh workspace
    // card would leave one orphan on the last row at every breakpoint.
    expect(WORKSPACE_CARDS).toHaveLength(6);
    expect(TRUST_CARDS).toHaveLength(6);
    expect(AI_CARDS).toHaveLength(8);
    expect(WORKFLOW_STEPS).toHaveLength(6);
  });

  it("numbers the workflow steps in order", () => {
    expect(WORKFLOW_STEPS.map((s) => s.step)).toEqual(["01", "02", "03", "04", "05", "06"]);
  });

  it("balances the Human + AI columns", () => {
    // Three against three. An uneven split would make one side look like the
    // afterthought, which is the opposite of the section's point.
    expect(AI_SIDE).toHaveLength(HUMAN_SIDE.length);
  });

  it("keeps the brand phrase to three words", () => {
    expect(BRAND_STATEMENT).toHaveLength(3);
  });

  it("shows the application's real top-level navigation in the mock", () => {
    // What makes the picture a picture of THIS product rather than of a generic
    // SaaS dashboard. These are real routes.
    expect(DASHBOARD.nav).toContain("Candidates");
    expect(DASHBOARD.nav).toContain("Pipeline");
    expect(DASHBOARD.nav).toContain("Interviews");
  });
});
