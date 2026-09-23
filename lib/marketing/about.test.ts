import { describe, expect, it } from "vitest";
import {
  ABOUT_AI,
  ABOUT_CTA,
  ABOUT_HERO,
  ABOUT_JOURNEY,
  ABOUT_MISSION,
  ABOUT_PRINCIPLES,
} from "./about";
import { INTERNAL_ROUTES } from "./content";
import {
  PRICING_HEAD,
  PRICING_PANELS,
  SECURITY_NOTE,
  USE_CASES_NOTE,
} from "./home";

/**
 * The About page's content integrity.
 *
 * WHY THIS PAGE NEEDS ITS OWN TEST, AND A STRICTER ONE THAN THE REST. An About
 * page is where invented facts go. Every other page on this site describes
 * software that either exists or does not, and a false claim there is
 * checkable against the codebase in a minute. "Founded in 2023 by a team of
 * ex-recruiters in Berlin" is checkable against nothing, reads as ordinary,
 * and is the single easiest lie on a marketing site to tell by accident —
 * because the template has a slot for it and the slot looks empty.
 *
 * There is no founder, no team, no founding year, no location, no legal
 * entity, no funding and no customer anywhere in this project. So the tests
 * below are mostly about ABSENCE, which is the unusual thing this page is
 * asserting and the thing a later edit would quietly undo.
 */

/** Every string the page renders, flattened once. */
const ALL_COPY: string[] = [
  ABOUT_HERO.title,
  ABOUT_HERO.lead,
  ...ABOUT_HERO.fragments,
  ABOUT_MISSION.title,
  ABOUT_MISSION.body,
  ABOUT_MISSION.pull,
  ABOUT_AI.title,
  ABOUT_AI.body,
  ...ABOUT_AI.does,
  ...ABOUT_AI.decides,
  ...ABOUT_PRINCIPLES.flatMap((p) => [p.title, p.body]),
  ...ABOUT_JOURNEY.flatMap((s) => [s.label, s.note]),
  ABOUT_CTA.title,
  ABOUT_CTA.body,
  ABOUT_CTA.primary.label,
  ABOUT_CTA.secondary.label,
];

describe("the About page invents no company", () => {
  it("states no founding date, age or origin story", () => {
    /*
      THE FOOTER PRINTS THE CURRENT YEAR. That is a copyright line, and reading
      it as a founding date would be inventing a fact out of a template — which
      is exactly how this kind of claim gets onto a site without anybody
      deciding to put it there.

      A bare four-digit year is banned outright rather than only in the company
      that would make it a date: there is no sentence on this page that needs
      one, so the cheapest rule is also the right one.
    */
    const banned = [
      /\bfounded\b/i,
      /\bfounder(s|ed)?\b/i,
      /\bsince\s+\d{4}\b/i,
      /\b(19|20)\d{2}\b/,
      /\b(started|launched|began)\s+(in|out of)\b/i,
      /\bour (story|journey|mission began)\b/i,
      /\byears? (of experience|in business|old)\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `invented company history:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("names no team, headcount, office or legal entity", () => {
    /*
      package.json has no `author`. There is no team page, no employee record
      and no address anywhere in this project — so any of these words on this
      page would be describing people who, as far as anything checkable goes,
      do not exist.
    */
    const banned = [
      /\bour team\b/i,
      /\bthe team behind\b/i,
      /\bwe are a (team|group|company) of\b/i,
      /\b\d+\s*(people|employees|engineers|staff)\b/i,
      /\bheadquarter(s|ed)\b/i,
      /\boffices?\s+in\b/i,
      /\b(inc|ltd|llc|gmbh|pvt)\b\.?/i,
      /\b(investor|funding|seed round|series [a-d])\b/i,
      /\b(award|prize)[- ]?(winning)?\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `invented organisation:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("names no customer and quotes nobody", () => {
    for (const line of ALL_COPY) {
      expect(
        /\btrusted by\b|\bcustomers? say\b|\bjoin \d+|\bour clients\b/i.test(line),
        line
      ).toBe(false);
    }
  });

  it("makes no unmeasured performance claim", () => {
    // Same bar as the homepage: nothing here has been measured, so nothing
    // here may carry a number that implies it has been.
    const banned = [
      /\b\d+\s*x\s+(faster|better|more)/i,
      /\b\d+%\s*(faster|fewer|less|more|reduction|increase)/i,
      /\bsave[sd]?\s+\d+\s*(hours|days|weeks)/i,
      /\bguarantee[sd]?\b/i,
      /\bbest[- ]in[- ]class\b/i,
      /\bindustry[- ]leading\b/i,
      /\bworld[- ]class\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `unmeasured claims:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the AI position", () => {
  it("never says the AI decides, scores a person, or removes bias", () => {
    /*
      THE PAGE'S CENTRAL CLAIM IS ALSO THE CODEBASE'S RULE — AI proposes, a
      person applies — so the claim is worth enforcing rather than trusting to
      whoever edits this copy next.

      "Removes bias" is banned separately because it is the specific AI claim
      this product cannot support: nothing here has been audited for bias, and
      an unaudited claim of fairness is worse than no claim at all.
    */
    const banned = [
      /\bai (decides|selects|chooses|rejects|hires|picks)\b/i,
      /\b(removes?|eliminates?|reduces?)\s+bias\b/i,
      /\b(unbiased|bias[- ]free|objective)\s+(hiring|screening|decisions?)\b/i,
      /\bautomatically (rejects?|hires?|decides?)\b/i,
      /\bbetter (hires|hiring outcomes)\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `overclaims about AI:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps every irreversible action on the human side of the split", () => {
    /*
      The two columns are the page's argument, so the words that name a
      decision must appear on the right one. A future edit that moved "stage
      move" or "rejection" into the AI column would invert the site's position
      while still reading fluently.
    */
    const decisive = /\b(reject|offer|hire|stage move|decides?|worth a conversation|fits the role)\b/i;

    for (const line of ABOUT_AI.does) {
      expect(decisive.test(line), `AI column claims a decision: "${line}"`).toBe(false);
    }

    // And the human column is actually about deciding, not a second feature list.
    expect(ABOUT_AI.decides.some((line) => decisive.test(line))).toBe(true);
  });

  it("gives both sides of the split real content", () => {
    expect(ABOUT_AI.does.length).toBeGreaterThanOrEqual(3);
    expect(ABOUT_AI.decides.length).toBeGreaterThanOrEqual(3);
    for (const line of [...ABOUT_AI.does, ...ABOUT_AI.decides]) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the principles", () => {
  it("has four, each with a title and a body", () => {
    expect(ABOUT_PRINCIPLES).toHaveLength(4);
    for (const principle of ABOUT_PRINCIPLES) {
      expect(principle.title.length).toBeGreaterThan(0);
      expect(principle.body.length).toBeGreaterThan(0);
    }
  });

  /*
    THE ONE TEST ON THIS PAGE THAT CHECKS A CLAIM AGAINST THE REST OF THE SITE.

    "Says what it does not have" asserts that three specific denials — no
    certification, no customers, no price — are published elsewhere in as many
    words. That is a claim about other files, and it is the kind that rots
    silently: someone adds a pricing table in a year's time and this principle
    becomes a lie that no build catches.

    So it is pinned to the actual copy those pages render.
  */
  it("only claims the candour the rest of the site actually shows", () => {
    const principle = ABOUT_PRINCIPLES.find((p) => /does not have/i.test(p.title));
    expect(principle, "the candour principle was renamed or removed").toBeDefined();

    // 1. No certification is held — and the security section says so.
    expect(SECURITY_NOTE).toMatch(/no certification is held/i);

    // 2. There are no customers to name — and the use-case index says so.
    expect(USE_CASES_NOTE).toMatch(/no customers to name/i);

    // 3. Pricing is not set — and the pricing section says so, with no plans.
    const pricing = `${PRICING_HEAD.lead} ${PRICING_PANELS.map((p) => p.label).join(" ")}`;
    expect(pricing).toMatch(/no plans|not published|no price/i);
  });
});

describe("the journey", () => {
  it("runs from a job to a decision, once each", () => {
    expect(ABOUT_JOURNEY).toHaveLength(7);
    expect(ABOUT_JOURNEY[0].label).toBe("Job");
    expect(ABOUT_JOURNEY[ABOUT_JOURNEY.length - 1].label).toBe("Decision");

    const labels = ABOUT_JOURNEY.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ends on a decision that belongs to a person", () => {
    // The last step is the whole page's argument in seven words. If it ever
    // stops naming a person, the page has changed its position.
    expect(ABOUT_JOURNEY[ABOUT_JOURNEY.length - 1].note).toMatch(/person|who made it/i);
  });
});

describe("the page's links", () => {
  it("points only at routes that exist", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const href of [ABOUT_CTA.primary.href, ABOUT_CTA.secondary.href]) {
      expect(known.has(href), `${href} is not a real route`).toBe(true);
    }
  });

  it("is itself a route the site knows about", () => {
    // A page missing from the inventory is a page the link tests cannot
    // protect — and, in practice, one nothing ever links to.
    expect(INTERNAL_ROUTES).toContain("/about");
  });

  it("has descriptive link text rather than 'learn more'", () => {
    for (const label of [ABOUT_CTA.primary.label, ABOUT_CTA.secondary.label]) {
      expect(/^(learn more|read more|click here|here)$/i.test(label.trim()), label).toBe(false);
      expect(label.trim().length).toBeGreaterThan(4);
    }
  });
});

describe("the hero", () => {
  it("names six real product surfaces in the orb", () => {
    expect(ABOUT_HERO.fragments).toHaveLength(6);
    // Six distinct labels — a repeat would draw two chips at the same point on
    // the ring and read as a rendering bug.
    expect(new Set(ABOUT_HERO.fragments as readonly string[]).size).toBe(6);
  });

  it("has exactly one H1's worth of title", () => {
    expect(ABOUT_HERO.title.length).toBeGreaterThan(0);
    expect(ABOUT_HERO.title.length).toBeLessThan(70);
  });
});
