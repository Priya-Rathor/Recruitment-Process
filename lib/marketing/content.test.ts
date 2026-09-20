import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GROUPS,
  END_TO_END_FLOW,
  FAQS,
  ROLE_FLOWS,
  STATS,
  TRUST_POINTS,
  getGroup,
} from "./content";

/**
 * Content integrity for the public website.
 *
 * WHY MARKETING COPY HAS A TEST. Because the failure modes here are silent and
 * embarrassing rather than loud. A missing eyebrow renders as a gap. A capability
 * label two words too long wraps to a fourth line and breaks the grid alignment
 * on every card beside it. A footer link to a page that was renamed is a 404 on
 * every page of the site. None of that throws, so none of it shows up in a build
 * — it shows up when somebody visits.
 *
 * The project's own convention is that where a hard constraint exists, it gets
 * enforced in code and the enforcement gets tested, rather than left to whoever
 * edits the file next remembering it. These are those constraints.
 */
describe("capability groups", () => {
  it("has the six groups the tab strip and product routes both assume", () => {
    expect(CAPABILITY_GROUPS).toHaveLength(6);
  });

  it("has unique slugs", () => {
    const slugs = CAPABILITY_GROUPS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    for (const group of CAPABILITY_GROUPS) {
      expect(group.slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it.each(CAPABILITY_GROUPS)("$slug has every field the template renders", (group) => {
    // The product page and the explorer panel both read all of these. A blank
    // one renders as an empty heading rather than an error.
    expect(group.tab.length).toBeGreaterThan(0);
    expect(group.eyebrow.length).toBeGreaterThan(0);
    expect(group.heading.length).toBeGreaterThan(0);
    expect(group.summary.length).toBeGreaterThan(0);
    expect(group.audience.length).toBeGreaterThan(0);
    expect(group.problem.length).toBeGreaterThan(0);
    expect(group.modules.length).toBeGreaterThan(0);
  });

  it.each(CAPABILITY_GROUPS)("$slug has exactly three capability lines", (group) => {
    // The .mkt-caps grid is built for three. Two leaves a hole beside the
    // heading; four makes the panel taller than the column next to it, and the
    // tab strip then jumps as you move between tabs.
    expect(group.capabilities).toHaveLength(3);
  });

  it.each(CAPABILITY_GROUPS)("$slug keeps capability text within the cell", (group) => {
    for (const cap of group.capabilities) {
      // Measured against the rendered cell: the label is one or two lines at
      // 360px, the detail two. Past these the cells stop aligning.
      expect(cap.label.length).toBeLessThanOrEqual(48);
      expect(cap.detail.length).toBeLessThanOrEqual(96);
      expect(cap.label.length).toBeGreaterThan(0);
      expect(cap.detail.length).toBeGreaterThan(0);
    }
  });

  it.each(CAPABILITY_GROUPS)("$slug keeps the tab label short enough to scan", (group) => {
    // Six tabs share one row on desktop before the strip starts scrolling.
    expect(group.tab.length).toBeLessThanOrEqual(12);
  });

  it.each(CAPABILITY_GROUPS)("$slug links only to groups that exist", (group) => {
    // A connectsTo typo would render a card linking to a 404.
    for (const slug of group.connectsTo) {
      expect(getGroup(slug), `${group.slug} → ${slug}`).toBeDefined();
    }
  });

  it.each(CAPABILITY_GROUPS)("$slug does not link to itself", (group) => {
    expect(group.connectsTo).not.toContain(group.slug);
  });

  it.each(CAPABILITY_GROUPS)("$slug states both halves of the AI boundary", (group) => {
    // The boundary block is the site's central honesty claim. Half of it
    // present and half missing would read as "AI proposes" with no counterpart
    // — the exact impression the product is built to avoid.
    if (group.aiBoundary === null) return;
    expect(group.aiBoundary.proposes.length).toBeGreaterThan(0);
    expect(group.aiBoundary.confirms.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown slug rather than throwing", () => {
    // generateStaticParams plus dynamicParams=false should make this
    // unreachable, but the page still calls notFound() on it.
    expect(getGroup("does-not-exist")).toBeUndefined();
  });
});

/*
  The "internal links" suite moved to lib/marketing/home.test.ts along with the
  nav and footer constants it asserted on. It is not weaker for moving: it now
  runs against the constants the shared chrome actually renders.
*/

describe("stats", () => {
  it("shows three figures, matching the three-column band", () => {
    expect(STATS).toHaveLength(3);
  });

  it("states a plain counted figure, not a fabricated outcome metric", () => {
    /**
     * THE POINT OF THIS TEST.
     *
     * The tempting hero stat is "cuts time-to-hire by 70%". There is no
     * measurement behind a number like that, and a marketing page that invents
     * one is the same error as a dashboard reporting a fake zero: it tells a
     * human something untrue that they will act on.
     *
     * So the band carries figures counted from the repository. This test pins
     * the format that keeps them countable — a bare integer, no percentage, no
     * "+", no "x" multiplier, no "faster"/"better" claim. If a future editor
     * reaches for a growth statistic, the shape itself fails here and they have
     * to justify it rather than slip it in.
     */
    for (const stat of STATS) {
      expect(stat.value).toMatch(/^\d+$/);
      expect(stat.label.length).toBeGreaterThan(0);
      expect(stat.note.length).toBeGreaterThan(0);
    }
  });

  it("does not use the vocabulary of an unmeasured performance claim", () => {
    const banned = /\b(faster|cheaper|better|%|percent|x faster|roi|guarantee)\b/i;
    for (const stat of STATS) {
      expect(banned.test(`${stat.value} ${stat.label}`)).toBe(false);
    }
  });
});

describe("flows", () => {
  it("covers the end-to-end flow", () => {
    expect(END_TO_END_FLOW.length).toBeGreaterThanOrEqual(10);
  });

  it.each(END_TO_END_FLOW)("'$stage' belongs to a group that exists", (step) => {
    // Each flow row links to its stage's product page.
    expect(getGroup(step.group), step.stage).toBeDefined();
  });

  it("touches every capability group at least once", () => {
    // A group with no flow step is a stage the how-it-works page silently
    // skips, which makes the flow look shorter than the product is.
    const covered = new Set(END_TO_END_FLOW.map((s) => s.group));
    for (const group of CAPABILITY_GROUPS) {
      expect(covered.has(group.slug), `${group.slug} missing from the flow`).toBe(true);
    }
  });

  it("gives every role flow at least four steps", () => {
    for (const flow of ROLE_FLOWS) {
      expect(flow.steps.length).toBeGreaterThanOrEqual(4);
      expect(flow.role.length).toBeGreaterThan(0);
      expect(flow.summary.length).toBeGreaterThan(0);
    }
  });

  it("includes the candidate, who is not a user of the product", () => {
    // Easy to forget precisely because they never log in — and they are the
    // person with the least power and the most at stake in the whole flow.
    expect(ROLE_FLOWS.map((f) => f.role)).toContain("Candidate");
  });
});

describe("trust and FAQ", () => {
  it("states the trust points with their supporting lines", () => {
    expect(TRUST_POINTS.length).toBeGreaterThanOrEqual(3);
    for (const point of TRUST_POINTS) {
      expect(point.title.length).toBeGreaterThan(0);
      expect(point.body.length).toBeGreaterThan(0);
      expect(point.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("answers the certification question honestly rather than omitting it", () => {
    /**
     * A buyer evaluating an AI recruitment tool will ask about SOC 2 and ISO
     * 27001. The reference page this design borrows from can answer yes. This
     * product cannot, and the FAQ has to say so — an omission reads as a yes,
     * and a claimed certification that was never audited is fraud rather than
     * marketing.
     */
    const certQuestion = FAQS.find((f) => /SOC 2|ISO 27001/i.test(f.q));
    expect(certQuestion, "the certification question must be answered").toBeDefined();
    expect(certQuestion!.a).toMatch(/not today|no certification|not been completed/i);
  });

  it("does not claim a certification the product does not hold", () => {
    const claimsCertified = FAQS.some((f) =>
      /\b(we are|is) (SOC ?2|ISO ?27001)[- ]?(type ?ii )?certified\b/i.test(f.a)
    );
    expect(claimsCertified).toBe(false);
  });

  it("says plainly that AI does not make the hiring decision", () => {
    const joined = FAQS.map((f) => `${f.q} ${f.a}`).join(" ");
    expect(joined).toMatch(/human|person|recruiter/i);
  });

  it("discloses that pricing is not published", () => {
    // Rather than showing invented plan tiers, which is the default failure of
    // a generated pricing page.
    const joined = FAQS.map((f) => f.a).join(" ");
    expect(joined).toMatch(/pricing is not published|not published yet/i);
  });

  it("has non-empty questions and answers", () => {
    for (const faq of FAQS) {
      expect(faq.q.trim().length).toBeGreaterThan(0);
      expect(faq.a.trim().length).toBeGreaterThan(0);
      expect(faq.q.endsWith("?")).toBe(true);
    }
  });
});
