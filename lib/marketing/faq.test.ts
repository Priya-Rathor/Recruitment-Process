import { describe, expect, it } from "vitest";
import {
  FAQ_CATEGORIES,
  FAQ_CTA,
  FAQ_HERO,
  FAQ_ITEMS,
  faqCategoriesInUse,
  faqItemsFor,
} from "./faq";
import { HOME_FAQS, INTEGRATIONS } from "./home";
import { INTERNAL_ROUTES } from "./content";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { ORG_ROLES } from "@/lib/types";

/**
 * The FAQ's integrity.
 *
 * AN FAQ IS WHERE A MARKETING SITE GOES WRONG QUIETLY. Every other page is
 * written once and reviewed as a whole; an FAQ grows an answer at a time,
 * usually in response to somebody asking, and each new answer is written
 * without re-reading the twenty-seven above it. That is how a site ends up
 * claiming a certification on one page and denying it on another.
 *
 * So these tests do two jobs: they pin the FAQ to the product's real
 * vocabulary, and they pin it to what the rest of the site already says.
 */

const ALL_TEXT = FAQ_ITEMS.map((item) => `${item.q} ${item.a}`);

describe("the homepage's nine and the FAQ page cannot drift", () => {
  /*
    THE WHOLE REASON faq.ts IMPORTS HOME_FAQS RATHER THAN COPYING IT. Two
    files holding the same nine answers would diverge the first time somebody
    reworded one, and nobody would notice because both pages would still read
    fine on their own.
  */
  it("carries every homepage question, with the identical answer", () => {
    for (const home of HOME_FAQS) {
      const match = FAQ_ITEMS.find((item) => item.q === home.q);
      expect(match, `missing from /faq: "${home.q}"`).toBeDefined();
      expect(match?.a).toBe(home.a);
    }
  });

  it("gives every homepage question a real category and a stable id", () => {
    // A renamed homepage question would fall through to the fallback metadata.
    // This is what catches that, because the fallback still renders fine.
    for (const home of HOME_FAQS) {
      const match = FAQ_ITEMS.find((item) => item.q === home.q);
      expect(match?.id, `"${home.q}" fell back to a derived id`).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(FAQ_CATEGORIES.map((c) => c.key)).toContain(match?.category);
    }
  });
});

describe("the question set", () => {
  it("has a unique, anchor-safe id for every question", () => {
    const ids = FAQ_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("asks each question once", () => {
    const questions = FAQ_ITEMS.map((item) => item.q.toLowerCase());
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("phrases every question as a question", () => {
    for (const item of FAQ_ITEMS) {
      expect(item.q.trim().endsWith("?"), `not a question: "${item.q}"`).toBe(true);
    }
  });

  it("answers every question with something substantial", () => {
    for (const item of FAQ_ITEMS) {
      // A one-line answer on an FAQ is usually a question that should have
      // been left out.
      expect(item.a.trim().length, item.q).toBeGreaterThan(80);
    }
  });

  it("declares no empty category", () => {
    // Step 5: categories come from the content, not the other way round.
    for (const category of faqCategoriesInUse()) {
      expect(faqItemsFor(category.key).length, category.key).toBeGreaterThan(0);
    }
  });

  it("has enough questions to justify search and categories", () => {
    // Step 12 forbids search as decoration. This is the number it was judged
    // against; if the set ever shrinks below it, the search box should go.
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(20);
    expect(faqCategoriesInUse().length).toBeGreaterThanOrEqual(4);
  });
});

describe("no answer claims something the product does not do", () => {
  it("never says Scoreboad conducts AI interviews", () => {
    /*
      THE DISTINCTION MODULE 07 ESTABLISHED AND THE SITE HAS KEPT SINCE. The
      product runs an automated screening CALL; interviews are conducted by the
      team. "AI interview" is the loose phrase a visitor arrives with, so the
      FAQ asks it by name — and the answer's whole job is to say no.

      Checked per item, so the question may contain the phrase while the answer
      denies it.
    */
    const denial = /\bno\b|\bnot\b|\bdoes not\b/i;

    for (const item of FAQ_ITEMS) {
      if (!/\bAI[- ]?(powered )?interview/i.test(item.a)) continue;
      expect(
        denial.test(item.a),
        `claims AI interviews without denying it: "${item.q}"`
      ).toBe(true);
    }
  });

  it("never claims a certification, audit or compliance status", () => {
    const schemes = /SOC\s*2|ISO\s*27001|HIPAA|PCI[\s-]?DSS|CCPA|GDPR/i;
    const denial = /\bno\b|\bnot\b|\bnone\b/i;

    for (const item of FAQ_ITEMS) {
      if (!schemes.test(`${item.q} ${item.a}`)) continue;
      expect(denial.test(item.a), `names a scheme without denying it: "${item.q}"`).toBe(true);
    }

    for (const text of ALL_TEXT) {
      expect(/\b(certified|accredited|compliant with|audited by)\b/i.test(text), text).toBe(false);
    }
  });

  it("makes no blanket encryption claim", () => {
    /*
      /security records why: neither at-rest nor in-transit encryption has been
      verified by this project, and the only cipher in our own source is the
      integration credential store. An FAQ is exactly where that line gets
      crossed, because "is my data encrypted?" is such a natural question.
    */
    const banned = [
      /\bencrypted at rest\b/i,
      /\bencryption at rest\b/i,
      /\bin transit\b/i,
      /\bAES[- ]?256\b/i,
      /\bend[- ]to[- ]end encrypt/i,
    ];

    const offenders: string[] = [];
    for (const text of ALL_TEXT) {
      for (const pattern of banned) {
        if (pattern.test(text)) offenders.push(`${String(pattern)} → "${text.slice(0, 90)}…"`);
      }
    }

    expect(offenders, `unverified encryption claim:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("makes no unmeasured performance or superlative claim", () => {
    const banned = [
      /\b\d+\s*x\s+(faster|better|more)/i,
      /\b\d+%\s*(faster|fewer|less|more)/i,
      /\bguarantee[sd]?\b/i,
      /\b(world|best|industry)[- ](leading|class)\b/i,
      /\bmost advanced\b/i,
      /\b99\.\d+%\b/,
      /\buptime\b/i,
      /\b50\+|\bhundreds of\b|\bthousands of\b/i,
    ];

    const offenders: string[] = [];
    for (const text of ALL_TEXT) {
      for (const pattern of banned) {
        if (pattern.test(text)) offenders.push(`${String(pattern)} → "${text.slice(0, 90)}…"`);
      }
    }

    expect(offenders, `unsupported claim:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("names no customer, rating or free trial", () => {
    for (const text of ALL_TEXT) {
      expect(/\btrusted by\b|\bcustomers? say\b|\bjoin \d+/i.test(text), text).toBe(false);
      expect(/\b\d\.\d\s*\/\s*5\b/.test(text), text).toBe(false);
    }

    // "Free trial" appears once, in the question that says there is not one.
    const trialItems = FAQ_ITEMS.filter((item) => /free trial/i.test(`${item.q} ${item.a}`));
    for (const item of trialItems) {
      expect(/\bno\b|\bnot\b/i.test(item.a), `implies a trial: "${item.q}"`).toBe(true);
    }
  });

  it("does not claim a candidate can be dragged between stages", () => {
    // Module 09's deliberate omission. The FAQ asks it and answers no.
    for (const item of FAQ_ITEMS) {
      if (!/\bdrag\b/i.test(item.a)) continue;
      expect(/\bno\b|\bnot\b|\bcannot\b/i.test(item.a), item.q).toBe(true);
    }
  });

  it("advertises no retired integration", () => {
    // n8n is retired — excluded from CustomerFacingProvider — so it may not be
    // named as something a customer can connect.
    for (const text of ALL_TEXT) {
      expect(/\bn8n\b/i.test(text), text).toBe(false);
    }
    // And the integrations that ARE named on the site still exist.
    expect(INTEGRATIONS.length).toBeGreaterThan(0);
  });
});

describe("answers use the product's own vocabulary", () => {
  it("names only real pipeline stages", () => {
    /*
      PINNED TO THE PRODUCT, not to the copy. The pipeline answer lists stages
      by name; if one is renamed in STAGE_LABELS, the FAQ would otherwise go on
      naming a stage that no longer exists.
    */
    const pipeline = FAQ_ITEMS.find((item) => item.id === "pipeline");
    expect(pipeline).toBeDefined();

    const real = Object.values(STAGE_LABELS);
    for (const named of ["Applied", "Shortlisted", "AI Screening Call", "Director Round", "Hired"]) {
      expect(real, `${named} is not a real stage`).toContain(named);
      expect(pipeline?.a).toContain(named);
    }
  });

  it("names the roles the product actually has", () => {
    const roles = FAQ_ITEMS.find((item) => item.id === "who-is-it-for");
    expect(roles).toBeDefined();
    for (const role of ORG_ROLES) {
      const label = role[0].toUpperCase() + role.slice(1);
      expect(roles?.a, `${label} missing`).toContain(label);
    }
  });

  it("draws every flow from real, named steps", () => {
    for (const item of FAQ_ITEMS) {
      if (!item.flow) continue;
      // A chain of one is not a sequence; a chain of six is a diagram nobody
      // reads on a phone.
      expect(item.flow.length, item.q).toBeGreaterThanOrEqual(3);
      expect(item.flow.length, item.q).toBeLessThanOrEqual(5);
      for (const step of item.flow) expect(step.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the FAQ's links", () => {
  it("points only at routes that exist", () => {
    const known = new Set(INTERNAL_ROUTES);

    for (const item of FAQ_ITEMS) {
      for (const link of item.links ?? []) {
        const path = link.href.split("#")[0] || "/";
        expect(known.has(path), `"${item.q}" links to ${link.href}, which is not a route`).toBe(true);
      }
    }

    for (const href of [FAQ_CTA.primary.href, FAQ_CTA.secondary.href]) {
      expect(known.has(href.split("#")[0] || "/"), href).toBe(true);
    }
  });

  it("uses descriptive anchor text", () => {
    for (const item of FAQ_ITEMS) {
      for (const link of item.links ?? []) {
        expect(/^(click here|here|read more|learn more|more)$/i.test(link.label.trim()), link.label).toBe(false);
        expect(link.label.trim().split(/\s+/).length, link.label).toBeGreaterThan(1);
      }
    }
  });

  it("does not link a question to itself", () => {
    // A link from the FAQ back to /faq is a loop that wastes a click.
    for (const item of FAQ_ITEMS) {
      for (const link of item.links ?? []) {
        expect(link.href.startsWith("/faq"), item.q).toBe(false);
      }
    }
  });
});

describe("the page's own copy", () => {
  it("has a hero that says what the page is", () => {
    expect(FAQ_HERO.title).toMatch(/frequently asked questions/i);
    expect(FAQ_HERO.lead.length).toBeGreaterThan(60);
  });

  it("closes on the route that works", () => {
    // There is no sales inbox, so the primary CTA is the one action the
    // product can honour. Same conclusion /contact and /pricing reached.
    expect(FAQ_CTA.primary.href).toBe("/signup");
  });

  it("promises no reply and invents no contact channel", () => {
    const copy = `${FAQ_HERO.title} ${FAQ_HERO.lead} ${FAQ_CTA.title} ${FAQ_CTA.body} ${ALL_TEXT.join(" ")}`;
    expect(/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(copy), "invented an address").toBe(false);
    expect(/calendly|cal\.com/i.test(copy), "invented a booking link").toBe(false);
    expect(/\bwe(?:'ll| will) (get back|respond|reply)\b/i.test(copy), "promised a reply").toBe(false);
  });
});
