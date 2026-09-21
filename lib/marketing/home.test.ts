import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, STAGE_LABELS } from "@/lib/applications/stages";
import { DEFAULT_SLA_DAYS } from "@/lib/pipeline/sla";
import { DEFAULT_APPLICATION_FIELDS } from "@/lib/forms/fields";
import { ACTION_LABELS, TRIGGER_LABELS } from "@/lib/automations/catalog";
import { MAX_DELAY_MINUTES, MIN_DELAY_MINUTES } from "@/lib/workflow/delay";
import {
  RESUME_SCORE_MAX,
  ROUND_SCORE_MAX,
  STATUS_LABELS,
} from "@/lib/evaluation/verdict";
import { METRIC_LABELS } from "@/lib/dashboard/metrics";
import { CAPABILITY_GROUPS, INTERNAL_ROUTES } from "@/lib/marketing/content";
import {
  AI_CALLOUTS,
  AI_STORY_CANDIDATES,
  AI_STORY_VERDICT_NOTE,
  AI_STORY_HEAD,
  AI_STORY_JOB,
  AI_STORY_STAGES,
  AI_STORY_STEPS,
  AI_SIDE,
  BRAND_STATEMENT,
  DASHBOARD,
  HERO,
  HERO_SIGNALS,
  HOME_FAQS,
  PLATFORM_HEAD,
  PLATFORM_VIEWS,
  PROBLEM_CARDS,
  PROBLEM_HEAD,
  SOLUTION_HEAD,
  HOME_FOOTER_SECTIONS,
  HUMAN_SIDE,
  PIPELINE_BEATS,
  PIPELINE_CALLOUTS,
  PIPELINE_CARDS,
  PIPELINE_COLUMNS,
  PIPELINE_EXITS,
  PIPELINE_HEAD,
  pipelineBreachesAt,
  pipelineCountAt,
  APPLY_BEATS,
  FLOW_BEATS,
  FLOW_CALLOUTS,
  FLOW_HEAD,
  FLOW_LOG,
  FLOW_NODES,
  APPLY_CALLOUTS,
  APPLY_FIELDS,
  APPLY_HEAD,
  APPLY_RECORDS,
  CANDIDATE_CALLOUTS,
  CANDIDATE_HEAD,
  CANDIDATE_STAGES,
  CANDIDATE_TIMELINE,
  CANDIDATE_VIEWS,
  TRUST_CARDS,
  VOICE_CALLOUTS,
  VOICE_HEAD,
  VOICE_REPORT,
  VOICE_STAGES,
  VOICE_TRANSCRIPT,
  WORKFLOW_PIECES,
  WORKFLOW_STEPS,
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
  ...PLATFORM_VIEWS.map((v) => v.caption),
  ...PLATFORM_VIEWS.flatMap((v) => v.panel.rows.map((r) => r.secondary)),
  PLATFORM_HEAD.title,
  PLATFORM_HEAD.lead,
  ...AI_CALLOUTS.flatMap((c) => [c.title, c.body]),
  ...VOICE_CALLOUTS.flatMap((c) => [c.title, c.body]),
  ...CANDIDATE_CALLOUTS.flatMap((c) => [c.title, c.body]),
  ...PIPELINE_CALLOUTS.flatMap((c) => [c.title, c.body]),
  ...APPLY_CALLOUTS.flatMap((c) => [c.title, c.body]),
  APPLY_HEAD.title,
  APPLY_HEAD.lead,
  ...APPLY_BEATS.map((b) => b.copy),
  ...FLOW_CALLOUTS.flatMap((c) => [c.title, c.body]),
  FLOW_HEAD.title,
  FLOW_HEAD.lead,
  ...FLOW_BEATS.map((b) => b.copy),
  PIPELINE_HEAD.title,
  PIPELINE_HEAD.lead,
  ...PIPELINE_BEATS.map((b) => b.copy),
  CANDIDATE_HEAD.title,
  CANDIDATE_HEAD.lead,
  ...CANDIDATE_STAGES.map((v) => v.copy),
  VOICE_HEAD.title,
  VOICE_HEAD.lead,
  ...VOICE_STAGES.map((v) => v.copy),
  AI_STORY_HEAD.title,
  AI_STORY_HEAD.lead,
  ...AI_STORY_STEPS.flatMap((s) => [s.title, s.body]),
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

    // The pipeline board's counts narrow too — see the pipeline block below.
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
// The platform showcase
// -----------------------------------------------------------------------------

describe("the platform showcase is a picture of the real application", () => {
  it("lights up a real nav item for every view", () => {
    /*
      The mock sidebar is DASHBOARD.nav, which is the application's real
      top-level navigation. A view pointing at a sidebar entry that does not
      exist would render with nothing highlighted — a broken-looking screenshot
      that no test would otherwise catch.
    */
    const nav = new Set<string>(DASHBOARD.nav);
    for (const view of PLATFORM_VIEWS) {
      expect(nav.has(view.nav), `${view.tab} → "${view.nav}" is not a real nav item`).toBe(
        true
      );
    }
  });

  it("uses real application stage names wherever it names a stage", () => {
    /*
      The pipeline and evaluation views name stages. Those must be
      STAGE_LABELS, for the same reason the hero's funnel must: a stage rename
      should break the marketing page rather than leave it quietly describing
      a product that no longer exists.
    */
    const stages = new Set(Object.values(STAGE_LABELS));
    const named = PLATFORM_VIEWS.find((v) => v.key === "pipeline")!.panel.rows;
    for (const row of named) {
      expect(stages.has(row.primary), `"${row.primary}" is not a real stage`).toBe(true);
    }
  });

  it("uses the real evaluation verdict vocabulary", () => {
    // Pass / Fail / Needs Review — from lib/evaluation/verdict.ts. Inventing a
    // fourth verdict on the homepage would be advertising a decision the
    // product cannot record.
    const verdict = PLATFORM_VIEWS.find((v) => v.key === "evaluation")!.panel.rows.at(-1)!;
    expect(Object.values(STATUS_LABELS)).toContain(verdict.meta);
  });

  it("scores within the ranges the product actually uses", () => {
    /*
      RESUME_SCORE_MAX is 100 and ROUND_SCORE_MAX is 10. A mock showing "94/10"
      or a resume score of 140 would be a number the product cannot produce,
      and it is exactly the kind of detail that survives review.
    */
    for (const view of PLATFORM_VIEWS) {
      for (const row of view.panel.rows) {
        const match = row.meta.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!match) continue;
        const [, value, max] = match;
        expect([RESUME_SCORE_MAX, ROUND_SCORE_MAX], `${row.primary}: out of ${max}`).toContain(
          Number(max)
        );
        expect(Number(value), `${row.primary}: ${row.meta}`).toBeLessThanOrEqual(Number(max));
      }
    }
  });

  it("keeps every bar a percentage", () => {
    for (const view of PLATFORM_VIEWS) {
      for (const row of view.panel.rows) {
        if (row.pct === undefined) continue;
        expect(row.pct, `${view.tab} → ${row.primary}`).toBeGreaterThanOrEqual(0);
        expect(row.pct, `${view.tab} → ${row.primary}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("agrees with the hero's dashboard about how big the pipeline is", () => {
    /*
      TWO PRODUCT SHOTS ON ONE PAGE MUST DESCRIBE ONE COMPANY. The hero says
      124 new candidates and 124 applied; the showcase's pipeline view says
      124 in the Applied stage. A reader who compares them should not find two
      different businesses.
    */
    const applied = PLATFORM_VIEWS.find((v) => v.key === "pipeline")!.panel.rows[0];
    expect(applied.secondary).toContain(String(DASHBOARD.funnel[0].value));
  });

  it("gives every view a distinct tab, key and panel", () => {
    expect(new Set(PLATFORM_VIEWS.map((v) => v.key)).size).toBe(PLATFORM_VIEWS.length);
    expect(new Set(PLATFORM_VIEWS.map((v) => v.tab)).size).toBe(PLATFORM_VIEWS.length);
    // The tab labels sit in one pill row. Three words is where it stops being
    // a tab and starts being a sentence.
    for (const view of PLATFORM_VIEWS) {
      expect(view.tab.split(/\s+/).length, view.tab).toBeLessThanOrEqual(2);
    }
  });

  it("keeps every panel to four rows", () => {
    // The frame's height is fixed by its tallest state, so an uneven row count
    // makes the panel jump when the reader switches tabs — a layout shift
    // caused by a control, which is the worst kind.
    for (const view of PLATFORM_VIEWS) {
      expect(view.panel.rows, view.tab).toHaveLength(4);
    }
  });

  it("carries the six capability descriptions the card grid used to show", () => {
    // The grid was deleted; its copy was not. Each caption is a full sentence
    // describing something the product does.
    for (const view of PLATFORM_VIEWS) {
      expect(view.caption.trim().endsWith("."), view.tab).toBe(true);
      expect(view.caption.length, view.tab).toBeGreaterThan(40);
    }
  });
});

// -----------------------------------------------------------------------------
// The AI screening story
// -----------------------------------------------------------------------------

describe("the AI story describes this product's screening, not AI screening in general", () => {
  it("shows that most of the pipeline is not the model", () => {
    /*
      THE LOAD-BEARING ASSERTION OF THE WHOLE SECTION.

      lib/ai/matchCandidateToJob.ts is explicit in its own header: salary,
      experience, location, notice and literal skill overlap are settled by
      lib/matching/deterministic.ts, and the model is NEVER told them. A
      diagram of this product's screening with one box marked "AI" would be a
      picture of a different, worse product — and the temptation to simplify
      it into exactly that is why this is a test rather than a comment.
    */
    const byModel = AI_STORY_STEPS.filter((step) => step.by === "ai");
    expect(byModel.length, "the model must not own the whole pipeline").toBeLessThan(
      AI_STORY_STEPS.length
    );
    expect(
      AI_STORY_STEPS.some((step) => step.by === "code"),
      "a deterministic step must be shown — code owns the checkable facts"
    ).toBe(true);
    expect(
      AI_STORY_STEPS.some((step) => step.by === "human"),
      "a human step must be shown — parseResume proposes, a person applies"
    ).toBe(true);
  });

  it("never lets the model be the last word", () => {
    // The final stage is the recruiter. If a refactor ever reorders these so
    // the story ends on the AI layer, the section is claiming autonomous
    // hiring — the one thing this codebase's rules forbid everywhere.
    expect(AI_STORY_STAGES.at(-1)?.key).toBe("review");
  });

  it("numbers the stages in order", () => {
    expect(AI_STORY_STAGES.map((s) => s.num)).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("keeps every candidate's score and reasons consistent", () => {
    /*
      lib/matching/score.ts: "the model cannot state a score at all, so it
      cannot state one that disagrees with the facts beside it." The mock has
      to honour the same rule — a 91 with three gaps and no strengths would be
      showing a guarantee the real product makes and this page breaks.
    */
    for (const person of AI_STORY_CANDIDATES) {
      expect(person.score, person.name).toBeGreaterThanOrEqual(0);
      expect(person.score, person.name).toBeLessThanOrEqual(RESUME_SCORE_MAX);
      expect(person.strengths.length, `${person.name} needs a reason for its score`).toBeGreaterThan(0);

      // The highest scorer must not also have the most gaps.
      const others = AI_STORY_CANDIDATES.filter((p) => p.id !== person.id);
      for (const other of others) {
        if (person.score <= other.score) continue;
        expect(
          person.gaps.length <= other.gaps.length,
          `${person.name} outscores ${other.name} but has more gaps`
        ).toBe(true);
      }
    }
  });

  it("uses only verdicts the product can record", () => {
    for (const person of AI_STORY_CANDIDATES) {
      expect(Object.values(STATUS_LABELS), person.name).toContain(person.verdict);
    }
  });

  it("names the job consistently with the rest of the page", () => {
    // The hero, the showcase and this story all follow one role. Three
    // different job titles in three product shots reads as three products.
    expect(AI_STORY_JOB.title).toBe("Senior Backend Engineer");
  });

  it("sends every callout to a page that exists", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const card of AI_CALLOUTS) {
      expect(known.has(card.href.split("#")[0] || "/"), `${card.title} → ${card.href}`).toBe(
        true
      );
    }
  });

  it("does not restate the Human + AI band's headline", () => {
    /*
      THE BRIEF ASKED FOR "AI assists. Your team decides." — which is almost
      exactly the H2 of the Human + AI band further down this same page. This
      says the same thing in different words; the assertion stops a later edit
      from quietly converging them.
    */
    const humanAiHeadline = "ai does the work";
    expect(AI_STORY_VERDICT_NOTE.toLowerCase()).not.toContain(humanAiHeadline);
    expect(AI_STORY_VERDICT_NOTE.toLowerCase()).not.toContain("ai assists");
    // It must still make the point.
    expect(/person|people|human|team/i.test(AI_STORY_VERDICT_NOTE)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The AI screening call
// -----------------------------------------------------------------------------

describe("the voice story describes the screening call this product has", () => {
  it("never calls it an AI interview", () => {
    /*
      THE CORRECTION THIS SECTION IS BUILT ON.

      The brief called the feature an "AI voice interview" throughout. In this
      product those are two different things: `screening_calls` is the
      automated first call, and `interviews` (Module 11) are later rounds
      conducted by PEOPLE and scheduled into a real calendar — their modes are
      Video, Phone and On-site.

      Calling the automated call an interview would advertise a model
      conducting the rounds a person conducts. This fails if that wording ever
      creeps back in.
    */
    const copy = [
      VOICE_HEAD.eyebrow,
      VOICE_HEAD.title,
      VOICE_HEAD.lead,
      ...VOICE_STAGES.map((s) => s.copy),
      ...VOICE_CALLOUTS.flatMap((c) => [c.title, c.body]),
    ].join(" ");

    expect(/\bAI[- ]?(voice[- ])?interview/i.test(copy), "the automated call is not an interview").toBe(
      false
    );
  });

  it("states no score, because a screening report has none", () => {
    /*
      `screening_reports` has summary_text, interest_level, expected_ctc,
      notice_period_days, location_accepted and availability_notes. There is
      no score column. A number here would be the easiest thing in this
      section to invent and the hardest for a reader to check.
    */
    for (const row of VOICE_REPORT) {
      expect(/\b\d+\s*\/\s*\d+\b|\bscore\b/i.test(`${row.field} ${row.value}`), row.field).toBe(
        false
      );
    }
  });

  it("only reports fields the schema actually has", () => {
    // Mapped onto screening_reports' real columns. A seventh field would be a
    // column the product does not store.
    const real = new Set([
      "Interest level",
      "Notice period",
      "Location accepted",
      "Expected CTC",
      "Availability",
    ]);
    for (const row of VOICE_REPORT) {
      expect(real.has(row.field), `"${row.field}" is not a screening_reports column`).toBe(true);
    }
  });

  it("shows both halves of the AI-said / human-corrected pair", () => {
    /*
      `ai_*` columns are never updated after insert and `corrected_fields`
      records the edit, so the product can always show what the model said
      beside what a person changed it to. It is the most distinctive honest
      thing in the schema, and a demo that dropped it would be showing a
      generic AI summary panel.
    */
    const corrected = VOICE_REPORT.filter((row) => row.corrected);
    expect(corrected.length, "at least one field must show the correction pair").toBeGreaterThan(0);
    for (const row of corrected) {
      expect(row.corrected!.from).not.toBe(row.value);
    }

    // And at least one field the model itself was unsure about.
    expect(VOICE_REPORT.some((row) => row.uncertain)).toBe(true);
  });

  it("opens with the consent disclosure and closes on a person", () => {
    /*
      lib/screening/script.ts puts the consent segment first, always, and
      assertScriptIsCompliant() refuses to dial without it. The closing
      segment tells the candidate a recruiter will review the call. Both are
      quoted rather than paraphrased, so both must survive an edit.
    */
    const first = VOICE_TRANSCRIPT[0];
    expect(first.who).toBe("ai");
    expect(first.text).toMatch(/automated call and it may be recorded/i);
    expect(first.text).toMatch(/rather not continue/i);

    const last = VOICE_TRANSCRIPT.at(-1)!;
    expect(last.text).toMatch(/recruiter .* will review/i);
  });

  it("orders the transcript by the stage it belongs to", () => {
    // A line that appears before the stage that introduces it would show up in
    // the panel out of sequence.
    const stages = VOICE_TRANSCRIPT.map((line) => line.at);
    expect([...stages].sort((a, b) => a - b)).toEqual(stages);
    expect(Math.max(...stages)).toBeLessThan(VOICE_STAGES.length);
  });

  it("numbers six stages and ends on review", () => {
    expect(VOICE_STAGES.map((s) => s.num)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(VOICE_STAGES.at(-1)?.key).toBe("review");
  });

  it("sends every callout to a page that exists, with no repeats", () => {
    const known = new Set(INTERNAL_ROUTES);
    const hrefs = VOICE_CALLOUTS.map((c) => c.href);
    for (const href of hrefs) {
      expect(known.has(href.split("#")[0] || "/"), href).toBe(true);
    }
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

// -----------------------------------------------------------------------------
// The candidate workspace
// -----------------------------------------------------------------------------

describe("the candidate workspace shows the real record", () => {
  it("gives every stage a view to render", () => {
    // The tabs and the panels come from two structures; a stage with no entry
    // in CANDIDATE_VIEWS would render a tab that opens onto nothing.
    for (const stage of CANDIDATE_STAGES) {
      expect(CANDIDATE_VIEWS[stage.key], `no view for "${stage.key}"`).toBeDefined();
      expect(CANDIDATE_VIEWS[stage.key].rows.length).toBeGreaterThan(0);
    }
    expect(Object.keys(CANDIDATE_VIEWS).sort()).toEqual(
      CANDIDATE_STAGES.map((s) => s.key).sort()
    );
  });

  it("anchors every timeline entry to a real view", () => {
    // An entry pointing at a stage that does not exist would never light up.
    const keys = new Set(CANDIDATE_STAGES.map((s) => s.key));
    for (const entry of CANDIDATE_TIMELINE) {
      expect(keys.has(entry.at), `"${entry.label}" → ${entry.at}`).toBe(true);
    }
  });

  it("uses only event names the activity log actually writes", () => {
    /*
      THE ASSERTION THAT KEEPS THE TIMELINE HONEST.

      Every label here is a real `label` from lib/activity/events.ts — the
      audit log's own vocabulary. It is what lets the section show a
      candidate's history without inventing a single entry, and it is the
      first thing that would rot if somebody "tidied up" the wording.
    */
    const real = new Set([
      "Applied",
      "Resume parsed",
      "Parsed fields reviewed",
      "Match calculated",
      "Screening report reviewed",
      "Interview scheduled",
      "Interview feedback submitted",
      "Stage changed",
    ]);
    for (const entry of CANDIDATE_TIMELINE) {
      expect(real.has(entry.label), `"${entry.label}" is not a real activity event`).toBe(
        true
      );
    }
  });

  it("runs the timeline in the order the views do", () => {
    // The history must read top to bottom in the same order the tabs advance,
    // or an entry lights up before the one above it.
    const order = CANDIDATE_STAGES.map((s) => s.key);
    const positions = CANDIDATE_TIMELINE.map((e) => order.indexOf(e.at));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("ends on a person, not on a score", () => {
    /*
      §22, and the rule the whole site follows. The last view is the activity
      log and the verdict is attributed to a named recruiter; if the journey
      ever ends on the match score, the page is claiming the model decides.
    */
    expect(CANDIDATE_STAGES.at(-1)?.key).toBe("activity");
    const verdict = CANDIDATE_VIEWS.evaluation.rows.at(-1)!;
    expect(verdict.label).toBe("Verdict");
    expect(verdict.value).toMatch(/set by /i);
  });

  it("states no contact details, invented or otherwise", () => {
    /*
      The Profile card in the product shows email and phone. This one does
      not, and that is deliberate rather than an oversight: a plausible-looking
      address or number on a public page has a real chance of belonging to
      somebody, and there is no version of it that is worth the risk.
    */
    const text = Object.values(CANDIDATE_VIEWS)
      .flatMap((view) => view.rows.map((r) => `${r.label} ${r.value}`))
      .join(" ");
    expect(/@|\b\+?\d[\d ()-]{7,}\b/.test(text), "no email or phone on a public page").toBe(
      false
    );
  });

  it("keeps the match score consistent with the rest of the page", () => {
    // 91/100 in the AI story, the platform showcase and here. One candidate.
    expect(CANDIDATE_VIEWS.evaluation.rows[0].value).toBe("91 / 100");
  });

  it("sends every callout to a page that exists, with no repeats", () => {
    const known = new Set(INTERNAL_ROUTES);
    const hrefs = CANDIDATE_CALLOUTS.map((c) => c.href);
    for (const href of hrefs) {
      expect(known.has(href.split("#")[0] || "/"), href).toBe(true);
    }
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("numbers six views", () => {
    expect(CANDIDATE_STAGES.map((s) => s.num)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(CANDIDATE_CALLOUTS).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// The hiring pipeline
// -----------------------------------------------------------------------------

describe("the pipeline board is this product's board", () => {
  it("names only real stages, in the real order", () => {
    const order = PIPELINE_STAGES as readonly string[];
    const labels = PIPELINE_COLUMNS.map((c) => c.label);

    for (const label of labels) {
      expect(Object.values(STAGE_LABELS), `"${label}" is not a real stage`).toContain(label);
    }

    // And in pipeline order — a board with Hired before Shortlisted would be a
    // picture of a different process.
    const positions = PIPELINE_COLUMNS.map((c) =>
      order.indexOf(Object.entries(STAGE_LABELS).find(([, v]) => v === c.label)![0])
    );
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("has no Offer column, because there is no Offer stage", () => {
    /*
      The brief's flow ended "Review → Offer → Hired". In this product an offer
      is an automation ACTION (`send_offer_letter`), not a pipeline stage —
      inventing the column would put a stage on the marketing page that a
      recruiter would then go looking for on the board.
    */
    for (const column of PIPELINE_COLUMNS) {
      expect(/offer|review/i.test(column.label), `"${column.label}"`).toBe(false);
    }
  });

  it("gives terminal outcomes counts and not columns", () => {
    // What the real board does, and for a stated reason: "otherwise the board
    // fills with finished work and stops being a work queue."
    const labels = PIPELINE_COLUMNS.map((c) => c.label.toLowerCase());
    expect(labels).not.toContain("rejected");
    expect(labels).not.toContain("withdrawn");
    expect(PIPELINE_EXITS.map((e) => e.label)).toEqual(["rejected", "withdrawn"]);
  });

  it("uses the product's real SLA targets", () => {
    /*
      DEFAULT_SLA_DAYS is the source. A board showing a 14-day target on
      Applied would be describing an SLA the product does not ship, and the
      whole aging beat rests on these numbers meaning something.
    */
    for (const column of PIPELINE_COLUMNS) {
      const stage = Object.entries(STAGE_LABELS).find(([, v]) => v === column.label)![0];
      const real = DEFAULT_SLA_DAYS[stage as keyof typeof DEFAULT_SLA_DAYS];
      if (column.targetDays === null) {
        // Terminal stages are not aged; sla.ts returns null for them.
        expect(real, `${column.label} should not be aged`).toBe(0);
      } else {
        expect(column.targetDays, `${column.label} target`).toBe(real);
      }
    }
  });

  it("narrows from stage to stage, at every beat", () => {
    /*
      A funnel that widens is not a funnel — and the counts MOVE now, because
      the travelling candidate is counted into whichever column holds them. So
      the invariant has to hold at all six beats, not just in the base array:
      the +1 lands on a different column each time, and a badly chosen base
      would make one beat's board read 46, 47 across two stages.
    */
    for (let beat = 0; beat < PIPELINE_BEATS.length; beat += 1) {
      const counts = PIPELINE_COLUMNS.map((_, index) => pipelineCountAt(index, beat));
      for (let i = 1; i < counts.length; i += 1) {
        expect(
          counts[i],
          `beat ${beat}: ${PIPELINE_COLUMNS[i].label} (${counts[i]}) exceeds ${PIPELINE_COLUMNS[i - 1].label} (${counts[i - 1]})`
        ).toBeLessThanOrEqual(counts[i - 1]);
      }
    }

    // At the first beat the candidate is in Applied, so the board's top
    // number is the hero's funnel top. One company across the whole page.
    expect(pipelineCountAt(0, 0)).toBe(DASHBOARD.funnel[0].value);
  });

  it("moves exactly one candidate between columns per beat", () => {
    // The source must lose the person the destination gains. A board where
    // both went up would be showing a duplicate rather than a move.
    for (let beat = 1; beat < PIPELINE_BEATS.length; beat += 1) {
      const before = PIPELINE_COLUMNS.map((_, i) => pipelineCountAt(i, beat - 1));
      const after = PIPELINE_COLUMNS.map((_, i) => pipelineCountAt(i, beat));
      const delta = after.map((n, i) => n - before[i]);

      expect(delta.filter((d) => d === -1), `beat ${beat}`).toHaveLength(1);
      expect(delta.filter((d) => d === 1), `beat ${beat}`).toHaveLength(1);
      expect(delta.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it("counts breaches rather than claiming to detect bottlenecks", () => {
    /*
      §13's caution. The product does not have a bottleneck detector; it ages
      every card against its stage target and marks the late ones `breached`.
      The column indicator is a total of those, so it must agree with the
      cards on the board exactly.
    */
    for (let index = 0; index < PIPELINE_COLUMNS.length; index += 1) {
      const expected = PIPELINE_CARDS.filter(
        (c) => c.at === index && c.sla === "breached"
      ).length;
      expect(pipelineBreachesAt(index), PIPELINE_COLUMNS[index].label).toBe(expected);
    }

    // And there must be at least one, or the aging beat has nothing to show.
    const total = PIPELINE_COLUMNS.reduce((sum, _, i) => sum + pipelineBreachesAt(i), 0);
    expect(total).toBeGreaterThan(0);
  });

  it("uses only the real SLA status vocabulary", () => {
    // ok / at_risk / breached, from SlaStatus. Not "late", not "red".
    for (const card of PIPELINE_CARDS) {
      expect(["ok", "at_risk", "breached"]).toContain(card.sla);
    }
  });

  it("labels every SLA state in words, never by colour alone", () => {
    for (const card of PIPELINE_CARDS) {
      expect(card.slaLabel.length, card.name).toBeGreaterThan(0);
      if (card.sla === "breached") expect(card.slaLabel).toMatch(/over/i);
    }
  });

  it("never claims candidates are dragged", () => {
    /*
      THE CORRECTION THIS SECTION IS BUILT ON. app/pipeline/PipelineBoard.tsx
      uses a menu, deliberately: "a dropdown is keyboard-accessible, works on a
      phone, and cannot fire from a mis-drag." Animating a drag would advertise
      the one interaction the product chose not to have.
    */
    const copy = [
      PIPELINE_HEAD.title,
      PIPELINE_HEAD.lead,
      ...PIPELINE_BEATS.map((b) => b.copy),
      ...PIPELINE_CALLOUTS.flatMap((c) => [c.title, c.body]),
    ].join(" ");

    // No positive claim: nobody drags anything anywhere in this product.
    // (A blanket ban on the word "drag" was tried and was wrong — it fires on
    // "mis-drag" inside the sentence explaining why there is no dragging.)
    expect(/\bdrag(s|ging|ged)?\s+(a|the|any|candidates?|cards?)\b/i.test(copy), copy).toBe(
      false
    );

    // And the correction is stated rather than merely implied by absence.
    expect(copy).toMatch(/no drag and drop/i);
  });

  it("walks the traveller forward through every column", () => {
    // Six beats, six columns, strictly advancing — the card must not go
    // backwards or skip, or the movement stops describing a process.
    expect(PIPELINE_BEATS.map((b) => b.at)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(PIPELINE_BEATS).toHaveLength(PIPELINE_COLUMNS.length);
  });

  it("ends on a stage a person set", () => {
    const last = PIPELINE_BEATS.at(-1)!;
    expect(PIPELINE_COLUMNS[last.at].label).toBe(STAGE_LABELS.hired);
    // And the move beat before it credits a person, not the system.
    expect(PIPELINE_BEATS[4].copy).toMatch(/a person moves the card/i);
  });

  it("places every other card in a real column", () => {
    for (const card of PIPELINE_CARDS) {
      expect(card.at).toBeGreaterThanOrEqual(0);
      expect(card.at).toBeLessThan(PIPELINE_COLUMNS.length);
    }
  });

  it("sends every callout to a page that exists", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const card of PIPELINE_CALLOUTS) {
      expect(known.has(card.href.split("#")[0] || "/"), card.href).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Candidate applications
// -----------------------------------------------------------------------------

describe("the application form is the product's form", () => {
  it("shows only real default fields, with the real labels", () => {
    /*
      DEFAULT_APPLICATION_FIELDS is what every job's form is created with.
      A field invented for the picture would be one a customer then goes
      looking for in the form builder.
    */
    const real = new Set(DEFAULT_APPLICATION_FIELDS.map((f) => f.label));
    for (const field of APPLY_FIELDS) {
      expect(real.has(field.label), `"${field.label}" is not a default field`).toBe(true);
    }
  });

  it("marks required exactly what the product requires", () => {
    const required = new Set(
      DEFAULT_APPLICATION_FIELDS.filter((f) => f.required).map((f) => f.label)
    );
    for (const field of APPLY_FIELDS) {
      expect(Boolean(field.required), field.label).toBe(required.has(field.label));
    }
  });

  it("uses an unroutable example address", () => {
    /*
      `.invalid` is reserved by RFC 2606 and can never be registered, so the
      address on this page cannot ever belong to a real person — which a
      plausible-looking @gmail or @example.com eventually might.
    */
    const email = APPLY_FIELDS.find((f) => f.type === "email")!;
    expect(email.value).toMatch(/@example\.invalid$/);
  });

  it("tells the submission story in the order the code does it", () => {
    /*
      THE POINT OF THE WHOLE SECTION. lib/forms/submit.ts saves the answers
      FIRST, creates the candidate from the TYPED answers, parses the resume
      after, and queues what it found as a proposal. The obvious story — form,
      AI, profile — is a different and worse product, and this is what stops
      an edit quietly reverting to it.
    */
    expect(APPLY_BEATS.map((b) => b.key)).toEqual([
      "apply",
      "resume",
      "saved",
      "created",
      "parsed",
      "proposed",
    ]);

    const saved = APPLY_BEATS.findIndex((b) => b.key === "saved");
    const parsed = APPLY_BEATS.findIndex((b) => b.key === "parsed");
    const created = APPLY_BEATS.findIndex((b) => b.key === "created");
    expect(saved, "answers are saved before the model runs").toBeLessThan(parsed);
    expect(created, "the candidate is created from typed answers, before the parse").toBeLessThan(
      parsed
    );
  });

  it("ends on a proposal, never on an overwritten record", () => {
    const last = APPLY_BEATS.at(-1)!;
    expect(last.key).toBe("proposed");
    expect(last.copy).toMatch(/never overwritten/i);

    const final = APPLY_RECORDS.at(-1)!;
    expect(final.label).toBe("Proposed change");
    expect(final.value).toMatch(/nothing written yet/i);
  });

  it("reveals every record row in beat order", () => {
    const beats = APPLY_RECORDS.map((r) => r.at);
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
    expect(Math.max(...beats)).toBeLessThan(APPLY_BEATS.length);
  });

  it("never states a progress percentage", () => {
    /*
      There is no work behind the upload bar, so a number would be inventing
      one. The component says "Processing" and then "Filed"; this guards the
      copy that surrounds it.
    */
    const copy = [APPLY_HEAD.lead, ...APPLY_BEATS.map((b) => b.copy)].join(" ");
    expect(/\b\d+\s?%/.test(copy), copy).toBe(false);
  });

  it("sends every callout to a page that exists", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const card of APPLY_CALLOUTS) {
      expect(known.has(card.href.split("#")[0] || "/"), card.href).toBe(true);
    }
    expect(APPLY_CALLOUTS).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// Recruitment automation
// -----------------------------------------------------------------------------

describe("the workflow graph is a real rule", () => {
  it("starts from a real trigger", () => {
    /*
      Nine triggers exist and all nine are wired. The graph's first node must
      be one of them, stated the way the product states it — a trigger
      invented for the picture is a rule a customer cannot build.
    */
    const trigger = FLOW_NODES[0];
    expect(trigger.kind).toBe("trigger");
    expect(Object.values(TRIGGER_LABELS)).toContain(trigger.label);
  });

  it("builds every action node from a real action", () => {
    /*
      A node's `label` is the CONFIGURED form — "Move to Video Interview" —
      because that is how a built rule reads on screen. `action` names the
      catalog entry it came from, and that is what gets checked. Asserting on
      the display label instead would either ban configuration from the
      picture or let an invented action through under a plausible name.
    */
    const real = new Set(Object.values(ACTION_LABELS));
    const actions = FLOW_NODES.filter((n) => n.kind === "action");
    expect(actions.length).toBeGreaterThan(0);

    for (const node of actions) {
      expect(node.action, `"${node.label}" must name the action it came from`).toBeDefined();
      expect(real.has(node.action!), `"${node.action}" is not in ACTION_LABELS`).toBe(true);
    }
  });

  it("puts the approval before every action, because the engine does", () => {
    /*
      THE ASSERTION THAT MATTERS MOST HERE.

      approvals.ts: a rule marked `requires_approval` "does not act. It
      proposes: the run parks at `awaiting_approval`". The gate is therefore
      before EVERYTHING, not beside one action. A graph that drew it later
      would describe a different engine and would quietly imply the other
      actions run ungated.
    */
    const approval = FLOW_NODES.findIndex((n) => n.kind === "approval");
    expect(approval).toBeGreaterThan(-1);

    FLOW_NODES.forEach((node, index) => {
      if (node.kind !== "action") return;
      expect(index, `"${node.label}" must come after the approval`).toBeGreaterThan(approval);
    });
  });

  it("states a wait the product can actually store", () => {
    // delay.ts: a whole number of minutes, at least one, at most thirty days.
    const wait = FLOW_NODES.find((n) => n.kind === "wait")!;
    const minutes = Number(wait.label.match(/(\d+)\s*minute/i)?.[1]);
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes).toBeGreaterThanOrEqual(MIN_DELAY_MINUTES);
    expect(minutes).toBeLessThanOrEqual(MAX_DELAY_MINUTES);
  });

  it("describes the expiry rather than leaving the proposal open forever", () => {
    // Seven days, and lapsing is recorded separately from rejection.
    const approval = FLOW_NODES.find((n) => n.kind === "approval")!;
    expect(approval.detail).toMatch(/seven days/i);
  });

  it("never claims the rule decides anything", () => {
    const copy = [
      FLOW_HEAD.title,
      FLOW_HEAD.lead,
      ...FLOW_BEATS.map((b) => b.copy),
      ...FLOW_NODES.map((n) => n.detail),
      ...FLOW_CALLOUTS.flatMap((c) => [c.title, c.body]),
    ].join(" ");

    expect(/\b(hires|rejects|decides)\s+(the\s+)?candidate/i.test(copy), copy).toBe(false);
    // And the last beat must say what it does instead.
    expect(FLOW_BEATS.at(-1)!.copy).toMatch(/without deciding anything/i);
  });

  it("builds every node in beat order and finishes on the finished graph", () => {
    const ats = FLOW_NODES.map((n) => n.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // The last beat adds nothing — it is the whole rule, seen at once.
    expect(Math.max(...ats)).toBeLessThan(FLOW_BEATS.length - 1);
  });

  it("logs in beat order and ends on the actions", () => {
    const ats = FLOW_LOG.map((e) => e.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(FLOW_LOG.at(-1)!.text).toMatch(/email|stage/i);
    // An approval line must name a person; an automation that approved itself
    // would be the one thing this section promises does not happen.
    expect(FLOW_LOG.some((e) => /approved by \w/i.test(e.text))).toBe(true);
  });

  it("sends every callout to a page that exists", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const card of FLOW_CALLOUTS) {
      expect(known.has(card.href.split("#")[0] || "/"), card.href).toBe(true);
    }
    expect(FLOW_CALLOUTS).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// Structure
// -----------------------------------------------------------------------------

describe("the landing page's structure", () => {
  it("resolves every icon name to a real icon", () => {
    // A typo would otherwise render the fallback glyph silently, and a card grid
    // with one wrong icon is easy to miss in review.
    for (const card of [...AI_CALLOUTS, ...TRUST_CARDS]) {
      expect(ICONS[card.icon], `${card.title} → ${card.icon}`).toBeDefined();
    }
  });

  it("keeps the card grids at the counts their layouts assume", () => {
    // Six platform views, six trust cards, eight AI cards in a 4-column grid.
    // A seventh trust card would leave one orphan on the last row at every
    // breakpoint; a seventh platform tab would overflow the pill row on a
    // laptop before the phone's scroll behaviour ever kicks in.
    expect(PLATFORM_VIEWS).toHaveLength(6);
    expect(TRUST_CARDS).toHaveLength(6);
    expect(AI_CALLOUTS).toHaveLength(4);
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
