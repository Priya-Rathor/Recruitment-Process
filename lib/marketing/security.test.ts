import { describe, expect, it } from "vitest";
import {
  SECURITY_ACCESS,
  SECURITY_AI,
  SECURITY_ARCHITECTURE,
  SECURITY_AUDIT,
  SECURITY_CONTENTS,
  SECURITY_DATA,
  SECURITY_ISOLATION,
  SECURITY_PAGE_HERO,
  SECURITY_PILLARS,
  SECURITY_PRINCIPLES,
  SECURITY_PRIVACY,
  SECURITY_STATUS,
} from "./security";
import { INTERNAL_ROUTES } from "./content";
import { ORG_ROLES } from "@/lib/types";

/**
 * The Security page's claim integrity.
 *
 * WHY THIS IS THE STRICTEST TEST FILE ON THE SITE. Everywhere else, an
 * overstated line is marketing that reads badly. Here it is a security claim a
 * customer may rely on — a statement about certification, encryption or
 * auditing that somebody could reasonably take to their own compliance review.
 *
 * The brief's §2 requires every statement to be classified before it is
 * written, and `lib/marketing/security.ts` records that classification against
 * docs/SECURITY.md and the source it cites. These tests pin the classification's
 * OUTCOME: the claims that may never appear, and the absences that must not
 * quietly disappear when somebody tidies the copy.
 */

/** Every string the page renders. */
const ALL_COPY: string[] = [
  SECURITY_PAGE_HERO.title,
  SECURITY_PAGE_HERO.lead,
  ...SECURITY_PAGE_HERO.flow.flatMap((f) => [f.label, f.note]),
  ...SECURITY_PILLARS.flatMap((p) => [p.label, p.question, p.body]),
  ...SECURITY_ARCHITECTURE.flatMap((a) => [a.label, a.detail]),
  SECURITY_ACCESS.title,
  SECURITY_ACCESS.lead,
  ...SECURITY_ACCESS.layers.flatMap((l) => [l.label, l.body]),
  SECURITY_ISOLATION.title,
  SECURITY_ISOLATION.lead,
  ...SECURITY_ISOLATION.points.flatMap((p) => [p.label, p.body]),
  SECURITY_DATA.title,
  SECURITY_DATA.lead,
  ...SECURITY_DATA.groups.flatMap((g) => [g.label, ...g.points]),
  SECURITY_AI.title,
  SECURITY_AI.lead,
  ...SECURITY_AI.chain.flatMap((c) => [c.label, c.note]),
  ...SECURITY_AI.bounds.flatMap((b) => [b.label, b.body]),
  SECURITY_AI.note,
  SECURITY_AUDIT.title,
  SECURITY_AUDIT.lead,
  ...SECURITY_AUDIT.record.flatMap((r) => [r.label, r.value]),
  ...SECURITY_AUDIT.points,
  SECURITY_AUDIT.note,
  SECURITY_PRIVACY.title,
  SECURITY_PRIVACY.lead,
  ...SECURITY_PRIVACY.points.flatMap((p) => [p.label, p.body]),
  SECURITY_PRIVACY.note,
  ...SECURITY_PRINCIPLES.flatMap((p) => [p.title, p.body]),
  SECURITY_STATUS.title,
  SECURITY_STATUS.lead,
  ...SECURITY_STATUS.absent.flatMap((a) => [a.label, a.body]),
  SECURITY_STATUS.docs.title,
  ...SECURITY_STATUS.docs.links.flatMap((l) => [l.label, l.note]),
];

describe("claims that may never appear", () => {
  it("claims no certification, compliance status or audit", () => {
    /*
      CHECKED AS WHOLE ENTRIES, not as bare keyword hits. The page NAMES SOC 2,
      ISO 27001, HIPAA, PCI DSS and CCPA — in one sentence, in order to say that
      none is held. A keyword search would fail on the denial itself, and the
      pressure would then be to delete the most useful line on the page.

      So a line may mention a scheme only if it also denies it.
    */
    const schemes = /SOC\s*2|ISO\s*27001|HIPAA|PCI[\s-]?DSS|CCPA|GDPR/i;
    const denial = /\bno\b|\bnone\b|\bnot\b|\bdoes not have\b/i;

    for (const line of ALL_COPY) {
      if (!schemes.test(line)) continue;
      expect(denial.test(line), `names a scheme without denying it: "${line}"`).toBe(true);
    }

    // And these may not appear at all, in any framing.
    for (const line of ALL_COPY) {
      expect(
        /\b(certified|accredited|attested|compliant with|audited by)\b/i.test(line),
        line
      ).toBe(false);
    }
  });

  it("makes no blanket encryption claim", () => {
    /*
      THE CLAIM §9 SINGLES OUT. Supabase and Vercel both encrypt at rest and in
      transit and both document it, but this project has verified neither, so
      the page does not say it.

      The ONE permitted encryption statement is the integration credential
      store, because that cipher is in our own source (lib/integrations/crypto).
      It is allowed by naming the thing it applies to, not by an exception.
    */
    const banned = [
      /\bencrypted at rest\b/i,
      /\bencryption at rest\b/i,
      /\bin transit\b/i,
      /\bAES[- ]?256\b/i,
      /\bend[- ]to[- ]end encrypt/i,
      /\bbank[- ]grade\b/i,
      /\bmilitary[- ]grade\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `unverified encryption claims:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("promises nothing and guarantees nothing", () => {
    const banned = [
      /\bguarantee[sd]?\b/i,
      /\b100%\s*(secure|safe|private)\b/i,
      /\bfully secure\b/i,
      /\bunbreakable\b/i,
      /\bimpenetrable\b/i,
      /\bcannot be (hacked|breached)\b/i,
      /\bzero[- ]trust\b/i,
      /\bbank[- ]level\b/i,
      /\benterprise[- ]grade\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `absolute claims:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("makes none of the four AI claims §10 forbids", () => {
    const banned = [
      /\bunbiased\b/i,
      /\b(removes?|eliminates?)\s+bias\b/i,
      /\bobjective (decisions?|hiring|assessment)\b/i,
      /\balways (accurate|correct)\b/i,
      /\bai (decides|selects|rejects|hires)\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        // The disclaimer names these in order to disclaim them.
        if (line === SECURITY_AI.note) continue;
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `AI overclaims:\n${offenders.join("\n")}`).toEqual([]);
    // And the disclaimer is actually present and actually disclaims.
    expect(SECURITY_AI.note).toMatch(/not.*(unbiased|audited for bias)/i);
  });

  it("names no customer and quotes no security posture of one", () => {
    for (const line of ALL_COPY) {
      expect(/\btrusted by\b|\bcustomers? (say|trust)\b/i.test(line), line).toBe(false);
    }
  });
});

describe("secrets and infrastructure stay off the page (§33)", () => {
  it("exposes no key, credential, identifier or internal address", () => {
    /*
      Nothing on this page should resemble a secret, a project id, an internal
      host or a policy fragment. This is a shape check rather than a value
      check — the point is that no future edit can paste one in while
      "explaining the architecture more concretely".
    */
    const banned = [
      /service[_ -]?role/i,
      /\bSUPABASE_[A-Z_]+/,
      /\bOPENAI_[A-Z_]+/,
      /\b[A-Z][A-Z0-9_]{6,}_KEY\b/,
      /\bsk-[A-Za-z0-9]/,
      /\beyJ[A-Za-z0-9_-]{6,}/,      // a JWT
      /https?:\/\/(?!scoreboad\.com)/i,
      /\b\d{1,3}(\.\d{1,3}){3}\b/,   // an IP address
      /\bcreate policy\b|\bgrant\s+select\b|\busing\s*\(/i,
      /\.supabase\.co\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `possible exposure:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the absences stay on the page", () => {
  /*
    THE MOST IMPORTANT TEST HERE. Every other assertion stops something being
    added; this one stops something being REMOVED. The gaps are the page's
    credibility, and they are exactly what a future tidy-up would delete first
    because each one reads like a weakness in isolation.
  */
  it("still says there is no certification, audit, MFA, CSP, scanning or contact", () => {
    const text = SECURITY_STATUS.absent.map((a) => `${a.label} ${a.body}`).join(" ");

    expect(text).toMatch(/SOC\s*2/i);
    expect(text).toMatch(/ISO\s*27001/i);
    expect(text).toMatch(/penetration test/i);
    expect(text).toMatch(/multi-factor|MFA/i);
    expect(text).toMatch(/Content-Security-Policy|CSP/i);
    expect(text).toMatch(/scann?ed|scanning/i);
    expect(text).toMatch(/security (address|contact)/i);
  });

  it("invents no security contact address", () => {
    // §19: no contact exists, so none may be published. An email address
    // anywhere in this content would be a fabricated reporting channel.
    for (const line of ALL_COPY) {
      expect(/[\w.+-]+@[\w-]+\.[\w.]+/.test(line), `invented address: "${line}"`).toBe(false);
    }
  });

  it("still says there is no published privacy policy", () => {
    // §16 forbids creating a fake policy route, so the page says the gap out
    // loud instead. If a real /privacy page is ever added, this test is the
    // reminder to replace the sentence with a link.
    expect(SECURITY_PRIVACY.note).toMatch(/no published privacy policy/i);
    expect(INTERNAL_ROUTES).not.toContain("/privacy");
  });
});

describe("the page's structure", () => {
  it("points every content entry at a section the page renders", () => {
    // A table of contents with a dead anchor is worse than none: it silently
    // does nothing when clicked. These ids are the ones the page sets.
    const rendered = [
      "overview",
      "architecture",
      "access",
      "isolation",
      "data",
      "ai",
      "audit",
      "privacy",
      "principles",
      "status",
    ];
    expect(SECURITY_CONTENTS.map((c) => c.id)).toEqual(rendered);
  });

  it("links only to routes that exist", () => {
    const known = new Set(INTERNAL_ROUTES);
    for (const link of SECURITY_STATUS.docs.links) {
      // An in-page anchor on a real route is still that route.
      const path = link.href.split("#")[0] || "/";
      expect(known.has(path), `${link.href} is not a real route`).toBe(true);
    }
  });

  it("names the roles the product actually has", () => {
    /*
      PINNED TO THE PRODUCT, not to the copy. If a fifth role is ever added, or
      one renamed, this page would otherwise go on describing four — which on a
      security page is a statement about the access model being wrong.
    */
    const declared = SECURITY_ACCESS.roles.map((r) => r.toLowerCase());
    expect(declared).toEqual([...ORG_ROLES]);
  });

  it("runs the architecture from the person to the decision", () => {
    expect(SECURITY_ARCHITECTURE[0].key).toBe("user");
    expect(SECURITY_ARCHITECTURE[SECURITY_ARCHITECTURE.length - 1].key).toBe("review");

    // Every layer is one of the four the diagram labels.
    for (const step of SECURITY_ARCHITECTURE) {
      expect(["edge", "server", "database", "human"]).toContain(step.layer);
    }
  });

  it("ends the AI chain on a person, not on the model", () => {
    const last = SECURITY_AI.chain[SECURITY_AI.chain.length - 1];
    expect(last.by).toBe("human");
    expect(last.label).toMatch(/decision/i);

    // And a human step comes after every AI step — the ordering IS the control.
    const lastAi = SECURITY_AI.chain.map((c) => c.by).lastIndexOf("ai");
    const firstHuman = SECURITY_AI.chain.map((c) => c.by).indexOf("human");
    expect(firstHuman).toBeGreaterThan(lastAi);
  });

  it("keeps the audit section from overclaiming", () => {
    // §15 names this exact overclaim, so the correction is pinned.
    expect(SECURITY_AUDIT.note).toMatch(/not.*tamper-evident|not claimed/i);
  });

  it("gives every section real content", () => {
    expect(SECURITY_PILLARS).toHaveLength(5);
    expect(SECURITY_PRINCIPLES).toHaveLength(6);
    expect(SECURITY_DATA.groups.length).toBeGreaterThanOrEqual(3);
    expect(SECURITY_ISOLATION.records.length).toBeGreaterThanOrEqual(3);

    for (const line of ALL_COPY) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});
