import { describe, expect, it } from "vitest";
import { NOT_FOUND, PUBLIC_ERROR, RECOVERY_LINKS } from "./errors";
import { INTERNAL_ROUTES } from "./content";

/**
 * The error surfaces' content.
 *
 * WHY A 404'S LINKS NEED A TEST MORE THAN ANY OTHER PAGE'S. Nobody visits this
 * page on purpose. It is never screenshotted, never reviewed and never clicked
 * through after a route is renamed — so a dead link here survives indefinitely,
 * on the one page whose entire job is to get somebody unstuck. A 404 whose
 * recovery links 404 is the worst version of this page there is.
 */

describe("the recovery links", () => {
  it("all resolve to real routes", () => {
    const known = new Set(INTERNAL_ROUTES);

    for (const link of [...RECOVERY_LINKS, NOT_FOUND.primary, PUBLIC_ERROR.home]) {
      const path = link.href.split("#")[0] || "/";
      expect(known.has(path), `${link.href} is not a real route`).toBe(true);
    }
  });

  it("uses no placeholder or off-site href", () => {
    for (const link of [...RECOVERY_LINKS, NOT_FOUND.primary, PUBLIC_ERROR.home]) {
      expect(link.href).not.toBe("#");
      expect(link.href.startsWith("/"), link.href).toBe(true);
    }
  });

  it("offers a way out without becoming a second sitemap", () => {
    // §5. Enough to be useful, few enough to scan while annoyed.
    expect(RECOVERY_LINKS.length).toBeGreaterThanOrEqual(3);
    expect(RECOVERY_LINKS.length).toBeLessThanOrEqual(6);
    expect(NOT_FOUND.primary.href).toBe("/");
  });

  it("names each destination once, descriptively", () => {
    const hrefs = RECOVERY_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const link of RECOVERY_LINKS) {
      expect(/^(click here|here|link|page)$/i.test(link.label.trim()), link.label).toBe(false);
      expect(link.label.trim().split(/\s+/).length, link.label).toBeGreaterThan(1);
    }
  });
});

describe("the wording blames nobody and explains nothing technical", () => {
  const COPY = [
    NOT_FOUND.title,
    NOT_FOUND.lead,
    PUBLIC_ERROR.title,
    PUBLIC_ERROR.lead,
    PUBLIC_ERROR.retry,
  ];

  it("exposes no technical detail (§8, §18)", () => {
    /*
      A GUARD ON THE COPY, not on the runtime. The components already never
      render the error object — this stops the words themselves drifting into
      "the database returned…" or "check the console", which is the shape these
      messages take when somebody writes them while debugging.
    */
    const banned = [
      /\bstack\b|\btrace\b/i,
      /\bexception\b|\bstack overflow\b/i,
      /\bdatabase\b|\bSQL\b|\bsupabase\b/i,
      /\bAPI key\b|\btoken\b|\bcredential\b/i,
      /\bconsole\b|\blocalhost\b|\bport \d+/i,
      /\b5\d\d\b|\bECONN|\bENOENT/i,
    ];

    const offenders: string[] = [];
    for (const line of COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `technical detail in user copy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("does not tell the reader they broke something", () => {
    // §12's tone rule, applied to errors: "Nothing here" and "you did X wrong"
    // are the two reflexes worth blocking.
    for (const line of COPY) {
      expect(/\byou (did|entered|typed|broke)\b/i.test(line), line).toBe(false);
      expect(/^nothing here/i.test(line.trim()), line).toBe(false);
    }
  });

  it("reassures rather than alarms on the 404", () => {
    // The one sentence that matters on a 404 a signed-in customer reaches:
    // their data is fine. Losing it would be easy in a copy tidy-up.
    expect(NOT_FOUND.lead).toMatch(/nothing is wrong with your account|your data/i);
  });

  it("keeps the H1 short enough to read at a glance", () => {
    expect(NOT_FOUND.title.length).toBeLessThan(60);
    expect(PUBLIC_ERROR.title.length).toBeLessThan(60);
  });
});

describe("the workflow diagram", () => {
  it("names five real stages with one detached", () => {
    expect(NOT_FOUND.stages).toHaveLength(5);
    expect(NOT_FOUND.detached).toBeGreaterThanOrEqual(0);
    expect(NOT_FOUND.detached).toBeLessThan(NOT_FOUND.stages.length);
  });

  it("is decoration the page does not depend on (§17)", () => {
    /*
      The error has to be comprehensible with the diagram removed, because it is
      aria-hidden and because it is the first thing that disappears on a narrow
      screen or a slow connection. Both the heading and the paragraph have to
      carry it on their own.
    */
    expect(NOT_FOUND.title.length).toBeGreaterThan(10);
    expect(NOT_FOUND.lead.length).toBeGreaterThan(40);
    expect(`${NOT_FOUND.title} ${NOT_FOUND.lead}`).toMatch(/page/i);
  });
});
