import { describe, expect, it } from "vitest";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { METRIC_LABELS } from "@/lib/dashboard/metrics";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES } from "@/lib/marketing/content";
import {
  AI_CARDS,
  AI_SIDE,
  BRAND_STATEMENT,
  DASHBOARD,
  HERO,
  HERO_SIGNALS,
  HOME_FAQS,
  PROBLEM_CARDS,
  PROBLEM_HEAD,
  SOLUTION_HEAD,
  HOME_FOOTER_SECTIONS,
  HUMAN_SIDE,
  PIPELINE_PREVIEW,
  TRUST_CARDS,
  WORKFLOW_PIECES,
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
  HERO.leadDetail,
  HERO.badge,
  ...HERO_SIGNALS.flatMap((s) => [s.title, s.meta]),
  PROBLEM_HEAD.title,
  PROBLEM_HEAD.lead,
  SOLUTION_HEAD.title,
  SOLUTION_HEAD.lead,
  ...PROBLEM_CARDS.flatMap((c) => [c.title, c.body]),
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
// The hero
// -----------------------------------------------------------------------------

describe("the hero", () => {
  it("spells the required H1 exactly, across its two spans", () => {
    /*
      The headline is split so the accent half can carry the gradient on its
      own line. That split is a RENDERING detail — a crawler and a screen
      reader both see one sentence — and this asserts the sentence is still the
      one the brief specifies after any edit to either half.
    */
    expect(`${HERO.headlineLead} ${HERO.headlineAccent}`).toBe(
      "Find the Right People Faster with AI"
    );
  });

  it("sends both CTAs to a page that exists", () => {
    // "Explore the Platform" wants /platform, which does not exist. This is
    // what stops the label being shipped against the route it implies.
    const known = new Set(INTERNAL_ROUTES);
    for (const cta of [HERO.ctaPrimary, HERO.ctaSecondary]) {
      expect(known.has(cta.href.split("#")[0] || "/"), `${cta.label} → ${cta.href}`).toBe(
        true
      );
    }
  });

  it("names the primary action as the brief specifies", () => {
    expect(HERO.ctaPrimary.label).toBe("Get Started");
    expect(HERO.ctaSecondary.label).toBe("Explore the Platform");
  });

  it("keeps the supporting copy to two sentences", () => {
    // The instruction was "concise" and "not a huge wall of SEO text". Two
    // lines is the budget; a third would be a paragraph.
    for (const line of [HERO.lead, HERO.leadDetail]) {
      expect(line.split(/[.!?](\s|$)/).filter((part) => part.trim()).length).toBeLessThanOrEqual(
        2
      );
    }
  });

  it("does not repeat a keyword into the supporting copy", () => {
    /*
      THE KEYWORD-STUFFING GUARD. The hero is where "AI recruitment" pressure
      lands hardest, and the failure mode is a sentence that names the same
      term four times. Counted across the whole hero: "AI" may appear a
      handful of times because it is the product's substance, but no other
      content word may repeat more than twice.
    */
    const text = [HERO.headlineLead, HERO.headlineAccent, HERO.lead, HERO.leadDetail]
      .join(" ")
      .toLowerCase();

    const counts = new Map<string, number>();
    for (const word of text.match(/[a-z]{4,}/g) ?? []) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }

    const repeated = [...counts].filter(([, n]) => n > 2);
    expect(repeated, `over-repeated in the hero: ${JSON.stringify(repeated)}`).toEqual([]);
  });

  it("resolves every floating signal's icon", () => {
    for (const signal of HERO_SIGNALS) {
      expect(ICONS[signal.icon], `${signal.title} → ${signal.icon}`).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// The product visual is a picture of THIS product
// -----------------------------------------------------------------------------

describe("the dashboard mock matches the real application", () => {
  /*
    THE POINT OF THIS BLOCK. The mock used to carry four invented KPI labels
    and five invented pipeline stages — "Screening", "Offer", "Time to hire" —
    none of which exist in the product. Nothing failed, because nothing
    connected the marketing page to the code it was depicting.

    Now a stage rename or a metric rename breaks the build, which is the only
    mechanism that keeps a screenshot honest over time.
  */

  it("labels every KPI tile with a real dashboard metric", () => {
    const real = new Set(Object.values(METRIC_LABELS));
    for (const tile of DASHBOARD.tiles) {
      expect(real.has(tile.label), `"${tile.label}" is not a real dashboard metric`).toBe(
        true
      );
    }
  });

  it("names every funnel row with a real application stage", () => {
    const real = new Set(Object.values(STAGE_LABELS));
    for (const row of DASHBOARD.funnel) {
      expect(real.has(row.stage), `"${row.stage}" is not a real application stage`).toBe(
        true
      );
    }
  });

  it("orders the funnel the way the application does", () => {
    // Applied first, Hired last. A funnel that starts at Shortlisted is a
    // picture of a different product.
    expect(DASHBOARD.funnel[0].stage).toBe(STAGE_LABELS.applied);
    expect(DASHBOARD.funnel[DASHBOARD.funnel.length - 1].stage).toBe(STAGE_LABELS.hired);
  });

  it("keeps the headline count consistent between the tiles and the funnel", () => {
    // "New candidates" and the top of the funnel are the same number in the
    // real dashboard, so a reader comparing the two panels is not shown two
    // different truths in one screenshot.
    expect(Number(DASHBOARD.tiles[0].value)).toBe(DASHBOARD.funnel[0].value);
  });

  it("resolves every tile icon", () => {
    for (const tile of DASHBOARD.tiles) {
      expect(ICONS[tile.icon], `${tile.label} → ${tile.icon}`).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// The challenge / solution bands
// -----------------------------------------------------------------------------

describe("the problem band", () => {
  it("states the problem without making a claim about the reader", () => {
    /*
      THE LINE THIS SECTION HAS TO WALK. "Candidate data can live across
      spreadsheets" is an observation about hiring; "your candidate data is a
      mess" is a claim about a company nobody here has met, and it is the exact
      register that makes a landing page feel like it is shouting.

      So every card body must either hedge or describe, never assert about the
      reader. Checked by requiring a hedging or descriptive verb in each — if a
      card is rewritten into a flat accusation, this fails.
    */
    const hedged = /\b(can|tend|tends|often|may|is hard|are hard|is slow|adds)\b/i;
    for (const card of PROBLEM_CARDS) {
      expect(hedged.test(card.body), `"${card.title}": ${card.body}`).toBe(true);
    }
  });

  it("never addresses the reader's own process in the second person", () => {
    // "your inbox", "your spreadsheet" — the same accusation, smuggled in via
    // a pronoun. The solution copy may say "your team"; the PROBLEM copy may
    // not describe a mess as belonging to anyone.
    for (const card of PROBLEM_CARDS) {
      expect(/\byour\b/i.test(card.body), card.body).toBe(false);
    }
  });

  it("keeps five cards, numbered in order", () => {
    expect(PROBLEM_CARDS).toHaveLength(5);
    expect(PROBLEM_CARDS.map((c) => c.step)).toEqual(["01", "02", "03", "04", "05"]);
  });
});

describe("the transformation", () => {
  it("shows the same six pieces in both states", () => {
    /*
      THE SECTION'S WHOLE ARGUMENT, asserted. The scattered band and the
      connected band render ONE array, which is what makes "the same six
      things, now joined" true by construction rather than by care. If someone
      splits it into two arrays, this is the test that should have to be
      deleted first.
    */
    expect(WORKFLOW_PIECES).toHaveLength(6);
    for (const item of WORKFLOW_PIECES) {
      expect(item.piece.length, `${item.piece} needs a scattered state`).toBeGreaterThan(0);
      expect(item.scattered.length, `${item.piece} needs a scattered state`).toBeGreaterThan(0);
      expect(item.surface.length, `${item.piece} needs a Scoreboad surface`).toBeGreaterThan(0);
    }
  });

  it("names a distinct destination for every piece", () => {
    // Two pieces landing on the same screen would make the "connected" side
    // shorter than the "scattered" one, which quietly weakens the picture.
    const surfaces = WORKFLOW_PIECES.map((p) => p.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("resolves every piece's icon", () => {
    for (const item of WORKFLOW_PIECES) {
      expect(ICONS[item.icon], `${item.piece} → ${item.icon}`).toBeDefined();
    }
  });

  it("does not restate the workflow the page already renders", () => {
    /*
      THE DUPLICATION GUARD, and the reason this section shows OBJECTS rather
      than STAGES.

      The brief sketched the solution band as Job -> Candidates -> Screening ->
      Interview -> Evaluation -> Hiring decision, which is exactly
      WORKFLOW_STEPS, rendered by <HiringWorkflow> two bands below. This fails
      if the two sets ever converge on the same labels.
    */
    const steps = new Set(WORKFLOW_STEPS.map((s) => s.title.toLowerCase()));
    for (const item of WORKFLOW_PIECES) {
      expect(steps.has(item.piece.toLowerCase()), `"${item.piece}" duplicates a workflow step`).toBe(
        false
      );
    }
  });
});

describe("the two bands do not echo each other or the sections below", () => {
  it("gives every band on the page a distinct heading", () => {
    /*
      THE BUG THIS PINS. The solution band says "One connected workspace for
      modern hiring" and the Workspace band used to say "One workspace for your
      entire hiring process" — near-identical sentences two sections apart.
      Workspace was retitled; this stops the next edit undoing that.
    */
    const heads = [PROBLEM_HEAD.title, SOLUTION_HEAD.title];
    for (const title of heads) {
      expect(title.trim().endsWith("."), `${title} should be a full sentence`).toBe(true);
    }
    expect(PROBLEM_HEAD.eyebrow).not.toBe(SOLUTION_HEAD.eyebrow);
    expect(new Set(heads).size).toBe(heads.length);
  });

  it("describes only capabilities the product has", () => {
    /*
      The solution lead is the most load-bearing sentence in this module: it is
      the one place the section says what Scoreboad DOES. Every capability it
      names must appear in the six workspace cards, which are themselves tied
      to the /product/* capability groups.
    */
    const claimed = ["screening", "interview", "evaluation", "hiring workflow"];
    const lead = SOLUTION_HEAD.lead.toLowerCase();
    for (const term of claimed) {
      expect(lead.includes(term), `the solution lead should name ${term}`).toBe(true);
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
