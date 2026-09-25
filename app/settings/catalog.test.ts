import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_LINKS,
  firstVisibleHref,
  visibleCategories,
  visibleLinks,
} from "@/app/settings/catalog";
import { PROVIDER_DESCRIPTORS } from "@/lib/settings/integrations";
import type { OrgRole } from "@/lib/types";

const APP = path.join(process.cwd(), "app");

/**
 * Resolves a route to the page file that serves it.
 *
 * THIS IS THE POINT OF THE FILE. The brief's own test is "every link on every
 * card routes to a real, existing settings page (no dead links, no placeholder
 * categories)" — and that is checkable against the filesystem rather than by
 * clicking, so it is checked here and will keep being checked after somebody
 * renames a route.
 */
function routeExists(href: string): boolean {
  // A trailing #anchor is a position WITHIN a page, not a route. Stripped here —
  // and validated separately below, because an anchor pointing at a card that no
  // longer renders is its own kind of dead link.
  // NOT named `path` — that would shadow the node:path import used just below.
  const route = href.split("#")[0];
  const segments = route.replace(/^\//, "").split("/").filter(Boolean);

  // A static file path first: /settings/organization -> app/settings/organization/page.tsx
  if (existsSync(path.join(APP, ...segments, "page.tsx"))) return true;

  // Then allow a dynamic segment at any depth, e.g. /settings/forms/[id].
  // Not needed by today's catalogue, but a link added to a detail route should
  // pass rather than fail confusingly.
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) return existsSync(path.join(dir, "page.tsx"));

    const [head, ...tail] = rest;
    if (existsSync(path.join(dir, head))) return walk(path.join(dir, head), tail);

    for (const dynamic of [`[${head}]`, "[id]", "[slug]", "[token]"]) {
      if (existsSync(path.join(dir, dynamic))) return walk(path.join(dir, dynamic), tail);
    }
    return false;
  };

  return walk(APP, segments);
}

describe("the settings catalogue", () => {
  it("points every link at a page that exists", () => {
    const dead = SETTINGS_LINKS.filter((link) => !routeExists(link.href));
    expect(dead.map((link) => `${link.label} -> ${link.href}`)).toEqual([]);
  });

  it("proves the check works by rejecting a route that does not exist", () => {
    // Without this, a broken routeExists() that returned true for everything
    // would make the test above pass silently and forever.
    expect(routeExists("/settings/job-board-hub")).toBe(false);
    expect(routeExists("/settings/marketplace")).toBe(false);
  });

  /*
    THE GRID'S LAYOUT DEPENDS ON THIS, so it is a test rather than a hope.

    Card heights are content-driven — no masonry, no forced height matching — and
    that only looks deliberate while the cards hold similar amounts. One card at
    six items beside cards of two set its whole row's height and left a well of
    white space; splitting it is what fixed the page.

    Two or three items per card. A fourth is probably fine; a sixth is the bug
    coming back, and this fails before anyone sees it in a browser.
  */
  /*
    RAISED FROM THREE TO FOUR BY 0042, and the trade is worth recording rather
    than quietly widening.

    The cap existed so cards in a row stay a similar height. Communications now
    carries four — templates, email, WhatsApp and the auto-reply agent — because
    that is one workflow: what candidates are told, through which channel, and by
    whom. Filing the agent under "AI & automation" (which has room) would have
    put it beside resume parsing and matching, neither of which talks to anybody,
    and away from the only three pages that do.

    Safe because `.settings-grid` uses `align-items: start` with auto row
    heights, so a taller card does not stretch its neighbours — it just ends
    lower. Four is the new ceiling, not an invitation: a fifth item in any card
    is the point at which the grouping itself is wrong.
  */
  it("keeps every card within two to four items, so heights stay balanced", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.links.length, `${category.label} has ${category.links.length} items`)
        .toBeGreaterThanOrEqual(2);
      expect(category.links.length, `${category.label} has ${category.links.length} items`)
        .toBeLessThanOrEqual(4);
    }
  });

  it("totals 22 settings in 8 categories", () => {
    /*
      Pinned so a regrouping cannot silently drop a link.

      History: 19 in 6 → 19 in 7 (the Integrations card split, which moved links
      without adding any) → 20 in 8 (Communication & AI split into Communications
      and AI & automation, plus Automations added — the one genuinely new link)
      → 21 in 8 (Module 27's Custom fields, added to Data & activity because
      Recruitment defaults was already at the three-item cap below)
      → 22 in 8 (0042's auto-reply agent, which took Communications to four and
      raised the per-card cap — see the test above for why that was the right
      trade rather than filing it elsewhere) → still 22 in 8 (0043's Agents
      added to AI & automation; the Voice agent console shortcut it replaces
      removed from Calling & scheduling).
      The grid's counter is computed from these, so this test and the visible
      "22 settings in 8 categories" cannot disagree.
    */
    expect(SETTINGS_LINKS).toHaveLength(22);
    expect(SETTINGS_CATEGORIES).toHaveLength(8);
  });

  it("has no empty category", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.links.length, `${category.label} is empty`).toBeGreaterThan(0);
    }
  });

  it("lists no href twice", () => {
    // Two cards offering the same page is the duplication the grouping brief
    // asked to avoid — notably a second "Data retention" beside Security.
    const hrefs = SETTINGS_LINKS.map((link) => link.href);
    expect(hrefs).toEqual([...new Set(hrefs)]);
  });

  it("gives every link a label and a one-line description", () => {
    for (const link of SETTINGS_LINKS) {
      expect(link.label.trim().length, link.href).toBeGreaterThan(0);
      expect(link.description.trim().length, link.href).toBeGreaterThan(0);
    }
  });

  /*
    ANCHORS MUST NAME A CARD THAT ACTUALLY RENDERS.

    The Integrations card deep-links to each integration's card by id. Those ids
    are minted from the provider key, so this asserts two things at once: the
    anchor is not a typo, and it does not point at a provider the detail page no
    longer shows — which is exactly how an "n8n" row would come back.
  */
  it("anchors every deep link at an integration that has a card", () => {
    const anchored = SETTINGS_LINKS.filter((link) => link.href.includes("#"));
    expect(anchored.length).toBeGreaterThan(0);

    for (const link of anchored) {
      const [, anchor] = link.href.split("#");
      expect(anchor, link.href).toMatch(/^integration-[a-z]+$/);

      const provider = anchor.replace("integration-", "");
      expect(
        Object.keys(PROVIDER_DESCRIPTORS),
        `${link.label} anchors at "${provider}", which has no card`
      ).toContain(provider);
    }
  });

  it("offers every customer-facing integration somewhere in the grid", () => {
    /*
      Derived from ALL links rather than from one named card.

      It used to look for a category called "Integrations". That card has since
      been split in two to balance the grid — so the old assertion broke on a
      layout change, which is the wrong thing for it to be sensitive to. What
      matters is that every integration is reachable, not which card lists it.
    */
    const anchored = SETTINGS_LINKS.filter((link) => link.href.includes("#"))
      .map((link) => link.href.split("#")[1].replace("integration-", ""))
      .sort();

    // Not a hardcoded five: derived from the descriptors, so adding a provider
    // makes this fail until it is offered here too.
    expect(anchored).toEqual(Object.keys(PROVIDER_DESCRIPTORS).sort());
  });

  it("offers no link to n8n anywhere in the grid", () => {
    for (const link of SETTINGS_LINKS) {
      expect(link.href.toLowerCase(), link.label).not.toContain("n8n");
      expect(link.label.toLowerCase(), link.href).not.toContain("n8n");
      expect(link.description.toLowerCase(), link.href).not.toContain("n8n");
    }
  });

  it("marks exactly the links that leave the settings area", () => {
    for (const link of SETTINGS_LINKS) {
      const outside = !link.href.startsWith("/settings");
      expect(Boolean(link.external), `${link.href} external flag`).toBe(outside);
    }
  });

  it("includes no category for something this product has not built", () => {
    const labels = SETTINGS_CATEGORIES.map((category) => category.label.toLowerCase());
    expect(labels).not.toContain("job board hub");
    expect(labels).not.toContain("marketplace");
  });
});

describe("role filtering", () => {
  const ROLES: OrgRole[] = ["owner", "admin", "recruiter", "viewer"];

  it("never offers a role a link it is not allowed", () => {
    for (const role of ROLES) {
      for (const link of visibleLinks(role)) {
        if (!link.roles) continue;
        expect(link.roles, `${role} was offered ${link.href}`).toContain(role);
      }
    }
  });

  it("drops a category rather than rendering it empty", () => {
    for (const role of ROLES) {
      for (const category of visibleCategories(role)) {
        expect(category.links.length, `${role} sees empty ${category.label}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives an Owner everything", () => {
    expect(visibleLinks("owner")).toHaveLength(SETTINGS_LINKS.length);
  });

  it("gives a Recruiter exactly what is genuinely theirs", () => {
    /*
      Their own team view, their own notification preferences, and Forms — the one
      configuration surface a recruiter owns, because a form is how they fill their
      own pipeline. Plus the two links that leave the settings area and are open to
      every role.

      /automations is in this list on purpose: the page uses
      requireMembershipOrRedirect() and gates only EDITING to Owner/Admin, and the
      top nav shows it to every role. Hiding it here would hide a page the same
      person reaches from the nav bar.
    */
    expect(visibleLinks("recruiter").map((link) => link.href).sort()).toEqual([
      "/analytics",
      "/automations",
      /*
        0043. Read-only for a Recruiter: which agents call and message their
        candidates is theirs to know; creating and pausing them is not.
      */
      "/settings/agents",
      /*
        Module 27. A Recruiter fills custom field VALUES in on jobs and
        applications, so the vocabulary is genuinely theirs to read; the page
        itself gates defining and editing to Owner/Admin.
      */
      "/settings/custom-fields",
      "/settings/forms",
      "/settings/notifications",
      "/settings/users",
    ]);
  });

  it("shows a Viewer nothing they cannot use", () => {
    const hrefs = visibleLinks("viewer").map((link) => link.href);
    expect(hrefs).not.toContain("/settings/organization");
    expect(hrefs).not.toContain("/settings/integrations");
    expect(hrefs).not.toContain("/audit-log");
  });

  it("always has somewhere to send a role that can open anything", () => {
    for (const role of ROLES) {
      const first = firstVisibleHref(role);
      if (visibleLinks(role).length === 0) {
        expect(first).toBeNull();
      } else {
        expect(first).toBe(visibleLinks(role)[0].href);
      }
    }
  });
});
