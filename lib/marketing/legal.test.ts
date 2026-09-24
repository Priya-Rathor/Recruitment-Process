import { describe, expect, it } from "vitest";
import {
  COOKIES_DOC,
  LEGAL_DOCS,
  LEGAL_REVIEW_NOTICE,
  PRIVACY_DOC,
  TERMS_DOC,
  legalPlaceholders,
  type LegalDoc,
} from "./legal";
import { INTERNAL_ROUTES } from "./content";

/**
 * The legal documents' integrity.
 *
 * WHY THIS FILE IS THE STRICTEST ON THE SITE. Every other page can be wrong in
 * a way that costs credibility. A legal page can be wrong in a way that is
 * relied upon — a stated retention period that nothing enforces, a compliance
 * claim nobody verified, a governing law nobody chose. And unlike marketing
 * copy, a plausible-sounding legal sentence is indistinguishable from a real
 * one to everybody except a lawyer.
 *
 * So the tests below enforce two things above all: that no compliance or
 * certification claim can appear, and that the unfinished values stay visibly
 * unfinished.
 */

const textOf = (doc: LegalDoc): string[] => [
  doc.title,
  doc.lead,
  doc.updated,
  ...doc.sections.flatMap((section) => [
    section.title,
    ...section.blocks.flatMap((block) => {
      if (block.kind === "p" || block.kind === "note") return [block.text];
      if (block.kind === "list") return block.items;
      if (block.kind === "link") return [block.text, block.label];
      return block.rows.flat();
    }),
  ]),
];

const ALL_TEXT = LEGAL_DOCS.flatMap(textOf);

describe("no compliance, certification or legal-review claim (§33)", () => {
  it("claims no compliance with any regime", () => {
    /*
      THE CLAIM THIS MODULE MOST HAD TO AVOID. "GDPR compliant" is one word
      away from every honest sentence about data protection, and it is a legal
      representation nobody in this project is in a position to make.

      A regime may be NAMED — the documents describe behaviour that regulation
      cares about — but never with a compliance verb attached.
    */
    const banned = [
      /\b(GDPR|CCPA|DPDP|HIPAA|PCI[\s-]?DSS|SOC\s*2|ISO\s*27001)[\s-]*(compliant|certified|ready|approved)\b/i,
      /\b(fully|legally)\s+(compliant|certified)\b/i,
      /\bwe (are|remain) compliant\b/i,
      /\bcomplies with\b/i,
      /\blegally (reviewed|vetted|approved)\b/i,
      /\bcertified\b/i,
    ];

    const offenders: string[] = [];
    for (const text of ALL_TEXT) {
      for (const pattern of banned) {
        if (pattern.test(text)) offenders.push(`${String(pattern)} → "${text.slice(0, 90)}…"`);
      }
    }

    expect(offenders, `compliance claim:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("says plainly that it has not been legally reviewed", () => {
    // The notice is what keeps the rest of the document honest. If it is ever
    // removed, these pages start reading as an agreement.
    expect(LEGAL_REVIEW_NOTICE).toMatch(/not been reviewed by a lawyer/i);
    expect(LEGAL_REVIEW_NOTICE).toMatch(/not.*legal agreement|not as a legal agreement/i);
  });

  it("makes no guarantee about security, accuracy or availability", () => {
    const banned = [
      /\bguarantee[sd]?\b/i,
      /\b100%\b/,
      /\buptime\b/i,
      /\bfully secure\b/i,
      /\bencrypted at rest\b/i,
      /\bin transit\b/i,
      /\bAES[- ]?256\b/i,
      /\bbank[- ]grade\b/i,
    ];

    const offenders: string[] = [];
    for (const text of ALL_TEXT) {
      for (const pattern of banned) {
        // The availability section says no uptime level is OFFERED, which is
        // the denial rather than the claim.
        if (pattern.test(text) && !/no uptime level is offered/i.test(text)) {
          offenders.push(`${String(pattern)} → "${text.slice(0, 90)}…"`);
        }
      }
    }

    expect(offenders, `unsupported guarantee:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("asserts no data-protection role (§12)", () => {
    // "Scoreboad is the processor and the customer is the controller" is the
    // exact sentence §12 forbids, and nothing in the architecture establishes
    // it. The documents say the question is open instead.
    for (const text of ALL_TEXT) {
      expect(
        /\b(we|scoreboad) (are|is) the (data )?(processor|controller)\b/i.test(text),
        text.slice(0, 90)
      ).toBe(false);
    }
  });
});

describe("the unfinished values stay visibly unfinished (§3, §31)", () => {
  it("has a non-empty checklist, every entry in capitals", () => {
    const outstanding = legalPlaceholders();
    expect(outstanding.length).toBeGreaterThan(0);

    for (const item of outstanding) {
      // Upper-case is what makes a marker unmistakeable on the page. A
      // sentence-case placeholder reads as ordinary prose.
      expect(item, `not upper-case: ${item}`).toBe(item.toUpperCase());
      expect(item.length).toBeGreaterThan(8);
    }
  });

  it("marks every value a lawyer or the business still has to supply", () => {
    /*
      PINNED BY SUBJECT, not by count. Each of these is a fact that does not
      exist anywhere in this project, and each is one somebody could plausibly
      fill in with a guess while tidying the copy. If a marker disappears, it
      should be because the real value replaced it — and then this test is
      where that gets noticed.
    */
    const checklist = legalPlaceholders().join(" | ");

    for (const subject of [
      "EFFECTIVE DATE",
      "LEGAL ENTITY",
      "GOVERNING LAW",
      "SUB-PROCESSOR",
      "DATA RESIDENCY",
      "DATA PROTECTION ROLES",
      "LIABILITY",
    ]) {
      expect(checklist, `no placeholder covers ${subject}`).toContain(subject);
    }
  });

  it("states no effective date it has not been given", () => {
    // §20 — a silently invented date is the most convincing wrong thing on a
    // legal page, because every reader assumes somebody chose it.
    for (const doc of LEGAL_DOCS) {
      expect(doc.updated).toMatch(/^\{\{.*\}\}$/);
    }
  });

  it("invents no retention period", () => {
    // docs/PRIVACY.md records the P0: retention is configurable but never
    // executed. Naming a number of days here would be describing behaviour the
    // software does not have.
    const retention = PRIVACY_DOC.sections.find((s) => s.id === "retention");
    expect(retention).toBeDefined();

    const text = textOf({ ...PRIVACY_DOC, sections: [retention!] }).join(" ");
    expect(/\b\d+\s*(days|months|years)\b/i.test(text), "a retention period was stated").toBe(false);
    expect(text).toMatch(/not yet acted on automatically|nothing is deleted on a schedule/i);
  });
});

describe("contact details and branding", () => {
  it("invents no email address or phone number", () => {
    // §21 — privacy@, legal@ and support@ do not exist. /contact is the route.
    for (const text of ALL_TEXT) {
      expect(/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(text), `address: "${text.slice(0, 80)}"`).toBe(false);
      expect(/\+?\d[\d\s()-]{9,}\d/.test(text), `phone: "${text.slice(0, 80)}"`).toBe(false);
    }
  });

  it("carries no old product name (§30)", () => {
    for (const text of ALL_TEXT) {
      expect(/myrecruiter|hirflix/i.test(text), text.slice(0, 80)).toBe(false);
    }
  });

  it("exposes no infrastructure detail (§29)", () => {
    /*
      The documents describe WHAT happens to information, never the names of
      the systems it happens in. A privacy page is a plausible place for
      somebody to add "stored in our Supabase instance at…", which is an
      internal detail a reader cannot use and an attacker can.
    */
    const banned = [
      /\bsupabase\b/i,
      /\bvercel\b/i,
      /\bservice[_ -]?role\b/i,
      /\b[A-Z][A-Z0-9_]{6,}_(KEY|SECRET|URL)\b/,
      /https?:\/\/(?!scoreboad\.com)/i,
      /\b\d{1,3}(\.\d{1,3}){3}\b/,
    ];

    const offenders: string[] = [];
    for (const text of ALL_TEXT) {
      for (const pattern of banned) {
        if (pattern.test(text)) offenders.push(`${String(pattern)} → "${text.slice(0, 80)}…"`);
      }
    }

    expect(offenders, `infrastructure detail:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("structure", () => {
  it("links only to routes that exist", () => {
    const known = new Set(INTERNAL_ROUTES);

    for (const doc of LEGAL_DOCS) {
      for (const section of doc.sections) {
        for (const block of section.blocks) {
          if (block.kind !== "link") continue;
          const path = block.href.split("#")[0] || "/";
          expect(known.has(path), `${doc.slug} → ${block.href}`).toBe(true);
        }
      }
    }
  });

  it("gives every section a unique anchor id", () => {
    for (const doc of LEGAL_DOCS) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size, `${doc.slug} has duplicate ids`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("has the three documents at their real routes", () => {
    expect(LEGAL_DOCS).toHaveLength(3);
    for (const doc of [PRIVACY_DOC, TERMS_DOC, COOKIES_DOC]) {
      expect(INTERNAL_ROUTES).toContain(`/${doc.slug}`);
      expect(doc.sections.length).toBeGreaterThan(2);
    }
  });

  it("describes the cookies the product actually sets", () => {
    /*
      VERIFIED WITH `curl -I`: an anonymous request to the public site returns
      no Set-Cookie at all. Two cookies exist once signed in, both necessary.
      If tracking is ever added, this page has to change first — and this
      assertion is the tripwire for the sentence that would then be false.
    */
    const text = textOf(COOKIES_DOC).join(" ");
    expect(text).toMatch(/public website sets no cookies|sets nothing on your device/i);
    expect(text).toMatch(/no analytics/i);
    expect(text).toMatch(/no cookie banner|consent prompt/i);
  });
});
