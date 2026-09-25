import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE THEME, ASSERTED.
 *
 * A theme replacement is the one kind of change that is easy to *mostly* do.
 * The tokens get swapped, the obvious screens look right, and three months
 * later somebody finds a card that is still the old blue because it was styled
 * inline in a file nobody opened. This file exists so that cannot happen
 * quietly: it walks the real source and fails the build if a retired value
 * reappears anywhere.
 *
 * It also re-derives the contrast ratios rather than trusting the comments in
 * globals.scss. A comment claiming 7.5:1 is worth nothing after somebody nudges
 * a hex; a test that computes it is worth something.
 *
 * WHY THE BANNED LIST LIVES HERE rather than in the stylesheet: there is then
 * exactly one copy of it, inside the thing that enforces it, so it cannot go
 * stale relative to the check. globals.scss points at this file.
 */

const ROOT = process.cwd();

// -----------------------------------------------------------------------------
// The retired theme
// -----------------------------------------------------------------------------

/**
 * Every value the previous theme owned. Not a stylistic blocklist — each of
 * these was a *token value* of the theme that was replaced, so any occurrence
 * is by definition a leftover.
 */
const RETIRED_COLORS: Record<string, string> = {
  "#004cf5": "old brand blue (primary)",
  "#003ed6": "old primary hover",
  "#012a85": "old brand deep",
  "#010c27": "old brand navy (body ink)",
  "#0099f8": "old brand azure",
  "#00abf8": "old brand sky",
  "#f7faff": "old page background",
  "#e2e8f0": "old border grey",
  "#64748b": "old secondary text",
  "#ecf2fe": "old primary tint",
  "#bfd5ff": "old primary muted",
  "#16a34a": "old success green",
  "#f59e0b": "old warning amber",
  "#dc2626": "old error red",
  "#0067aa": "old info blue",
  "#eff6ff": "old selected-row tint",
  "#dbeafe": "old info chip fill",
  "#bfdbfe": "old info chip border",
  "#1d4ed8": "old info chip ink",
  "#fee2e2": "old error chip fill",
  "#b91c1c": "old error chip ink",
  "#dcfce7": "old connected chip fill",
  "#15803d": "old connected chip ink",
  "#fef3c7": "old attention chip fill",
  "#b45309": "old attention chip ink",
  "#f1f5f9": "old disconnected chip fill",
  "#475569": "old disconnected chip ink",
  "#eef2f7": "old hairline grey",
  "#cbd5e1": "old input hover border",
  "#94a3b8": "old placeholder grey",
  "#f8fafc": "old unmatched-row tint",
  "#fffbeb": "old amber wash",
  "#fdebc8": "old amber hover",
  "#4f46e5": "old spec indigo",
  "#c7d2fe": "old rejected ramp light end",
  "#4338ca": "old rejected ramp dark end",
  "#7ea9ff": "old funnel ramp step",
  "#6292f4": "old funnel ramp step",
  "#4e7ddd": "old funnel ramp step",
  "#3b68c6": "old funnel ramp step",
  "#2853b0": "old funnel ramp step",
  "#163f99": "old funnel ramp step",
  "#25d366": "WhatsApp's own green — replaced by the theme's mint",
  "#061437": "old marketing raised navy",
  "#e9eefc": "old marketing invert hover",
};

/**
 * Retired typefaces. A fallback entry counts: it still renders.
 *
 * Matched on a WORD BOUNDARY, which is not fussiness — a bare substring search
 * for "Inter" hits "Interview", "Interviews" and "interview-brief", and this
 * product is a recruitment tool. The first run of this test reported six
 * offenders and every one of them was the word "Interview".
 */
const RETIRED_FONTS = [/\bInter\b/, /\bBricolage\b/i];

/** Retired CSS token NAMES. A dangling var() resolves to nothing, silently. */
const RETIRED_TOKENS = [
  "--brand-blue",
  "--brand-deep",
  "--brand-navy",
  "--brand-azure",
  "--brand-sky",
  "--color-secondary-text", // the old alias for --color-text-secondary
];

/**
 * Files allowed to name a retired value, and why.
 *
 * Only this one: the list has to be written down somewhere to be enforced.
 */
const ALLOWED = new Set([path.join("app", "theme.test.ts")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|scss|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = [
  ...walk(path.join(ROOT, "app")),
  ...walk(path.join(ROOT, "components")),
  ...walk(path.join(ROOT, "lib")),
].filter((file) => !ALLOWED.has(path.relative(ROOT, file)));

const SOURCE = new Map(FILES.map((file) => [path.relative(ROOT, file), readFileSync(file, "utf8")]));

/**
 * The same colour, written the other way.
 *
 * FOUND BY THIS TEST FAILING TO FIND IT. The first full pass reported the
 * codebase clean, and the SERVED stylesheet still contained the retired navy
 * twice — as `#010c2714`, which is what Sass minifies `rgba(1, 12, 39, 0.08)`
 * down to. Three hard shadows and a sticky-header scrim were carrying retired
 * colours in `rgba()` and `rgb() / %` notation, invisible to a hex search.
 *
 * So the triplets are DERIVED from the hex list rather than typed out beside
 * it: adding a colour to RETIRED_COLORS automatically bans every notation of
 * it, and there is no second list to keep in step.
 */
function rgbForms(hex: string): RegExp[] {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return [
    // rgba(1, 12, 39, 0.08) and rgb(1,12,39)
    new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*[,)]`),
    // The modern space-separated form: rgb(1 12 39 / 8%)
    new RegExp(`rgba?\\(\\s*${r}\\s+${g}\\s+${b}\\s*[/)]`),
  ];
}

/**
 * Compiled ONCE, not per line.
 *
 * Built inside the loop first time round and the test timed out at 5s: ~45
 * colours x 2 notations x every line of every stylesheet is ninety regex
 * compilations per line. Hoisting it takes the check well under a second.
 */
const RGB_PATTERNS: { pattern: RegExp; hex: string; what: string }[] = Object.entries(
  RETIRED_COLORS
).flatMap(([hex, what]) => rgbForms(hex).map((pattern) => ({ pattern, hex, what })));

describe("the retired theme is gone, not overridden", () => {
  it("names no retired colour in any notation, not just as hex", () => {
    const offenders: string[] = [];

    for (const [file, source] of SOURCE) {
      source.split("\n").forEach((line, index) => {
        // Cheap pre-filter: the overwhelming majority of lines have no rgb() at
        // all, and skipping them early is what keeps this linear in practice.
        if (!line.includes("rgb")) return;

        for (const { pattern, hex, what } of RGB_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push(`${file}:${index + 1}  ${hex} as rgb() (${what})`);
          }
        }
      });
    }

    expect(offenders, `retired colours in rgb() form:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("uses no hard shadow — the brief says soft glow only", () => {
    /*
      A hard shadow is a tight offset with an opaque-ish colour: `0 1px 2px …`.
      A glow is wide and faint. Rather than pattern-match that distinction, this
      asserts the rule that makes it unnecessary: every box-shadow is either a
      theme token, `none`, or an inset accent edge.

      This is how three surviving hard shadows were found — a menu, a floating
      panel and two active tabs, all built from the retired ink and all
      invisible on a near-black ground.
    */
    const offenders: string[] = [];
    /*
      Any GLOW token, wherever it is namespaced. The app's are --glow-*; the
      marketing chrome's are --mkt-glow-*, because that scope carries its own
      fixed palette. Matching the shape rather than the exact prefix means a
      future namespace does not need this line edited — while a literal still
      fails, which is the part that matters.
    */
    const ALLOWED_SHADOW =
      /box-shadow:\s*(var\(--[a-z-]*(glow|focus-ring)|none|inset [^;]*var\(--)/;

    /*
      Comments are skipped, and that is not a loophole — it is the difference
      between checking the CSS and checking the prose ABOUT the CSS. This test
      twice reported its own explanatory comments as offenders, because those
      sentences contain the word it greps for. Left alone, the pressure is to
      delete the explanation to make the test pass, which is the wrong thing to
      optimise.

      Block-comment STATE, not a line prefix: a first attempt matched lines
      beginning with `//`, `/*` or `*`, and missed a line inside a block comment
      that happened to begin with a backtick. Tracking the state is the only
      version that is actually right.
    */

    for (const [file, source] of SOURCE) {
      if (!file.endsWith(".scss") && !file.endsWith(".css")) continue;

      let inBlockComment = false;

      source.split("\n").forEach((line, index) => {
        const trimmed = line.trim();

        // Opens and closes can share a line, so closing is checked first.
        if (inBlockComment) {
          if (trimmed.includes("*/")) inBlockComment = false;
          return;
        }
        if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
          inBlockComment = true;
          return;
        }
        if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

        if (!line.includes("box-shadow:")) return;
        if (ALLOWED_SHADOW.test(line)) return;
        offenders.push(`${file}:${index + 1}  ${trimmed}`);
      });
    }

    expect(offenders, `non-token shadows:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("names no retired colour anywhere in app/, components/ or lib/", () => {
    const offenders: string[] = [];

    for (const [file, source] of SOURCE) {
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        for (const [hex, what] of Object.entries(RETIRED_COLORS)) {
          // Case-insensitive: #004CF5 and #004cf5 are the same leftover.
          if (line.toLowerCase().includes(hex)) {
            offenders.push(`${file}:${index + 1}  ${hex} (${what})`);
          }
        }
      });
    }

    expect(offenders, `retired colours found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("references no retired typeface where it would actually render", () => {
    const offenders: string[] = [];

    /*
      SCOPED TO THE LINES THAT RENDER — a `font-family` declaration, a
      `next/font` import, or a Sass `$family-*` seed — rather than to all prose.

      Deliberately NOT a whole-file search. The comments in globals.scss and
      layout.tsx explain that Inter is gone and why keeping it as a fallback
      would resurrect the old theme, and that note is worth more than the
      convenience of a blunter check. A test that forces the removal of its own
      explanation is a test that will be deleted.
    */
    const RENDERS = /font-family|next\/font|\$family-/;

    for (const [file, source] of SOURCE) {
      source.split("\n").forEach((line, index) => {
        if (!RENDERS.test(line)) return;
        for (const font of RETIRED_FONTS) {
          if (font.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    /*
      A fallback counts. `font-family: var(--font-body), Inter, sans-serif` on a
      machine with Inter installed renders the retired theme's body text, and
      nobody testing on a machine without it would ever see the problem.
    */
    expect(offenders, `retired typefaces found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("has no dangling var() pointing at a deleted token", () => {
    const offenders: string[] = [];

    for (const [file, source] of SOURCE) {
      source.split("\n").forEach((line, index) => {
        for (const token of RETIRED_TOKENS) {
          // The declaration itself is gone, so any mention is a reference.
          if (line.includes(token)) offenders.push(`${file}:${index + 1}  ${token}`);
        }
      });
    }

    /*
      This is the failure that bit during the replacement itself:
      app/(marketing)/marketing.scss derived its local tokens from --brand-navy
      and --brand-sky, so deleting those left every dark marketing section
      resolving to an undefined variable — which CSS treats as invalid and drops,
      silently, one page away from the file that changed.
    */
    expect(offenders, `dangling token references:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The new theme's own guarantees
// -----------------------------------------------------------------------------

const GLOBALS = readFileSync(path.join(ROOT, "app/globals.scss"), "utf8");

/** Reads a token out of a `:root`-ish block. First declaration wins (= dark). */
function token(name: string): string {
  const match = GLOBALS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token ${name} is not declared in app/globals.scss`);
  return match[1].trim();
}

// --- WCAG maths, so the ratios in the comments are verified not trusted ------
const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUND = "#0a1128";
const CARD = "#141c39";

describe("Future Workforce — the palette holds up", () => {
  it("uses the specified brand values verbatim", () => {
    // The five the brief named. If one of these drifts, the theme is no longer
    // the theme that was asked for.
    expect(token("--brand-space")).toBe("#0a1128");
    expect(token("--brand-periwinkle")).toBe("#8b9eff");
    expect(token("--brand-white")).toBe("#ffffff");
    expect(token("--brand-mint")).toBe("#7fe7c4");
    expect(token("--brand-lavender")).toBe("#c6b8ff");
  });

  it("defaults to dark", () => {
    // Not a preference — the brief named dark as the default, and the previous
    // theme actively forced light. Both halves are asserted.
    expect(GLOBALS).toMatch(/html\s*\{\s*color-scheme:\s*dark;/);
    expect(GLOBALS).not.toContain("color-scheme: light;\n}");
    expect(token("--color-background")).toBe(GROUND);
  });

  it("clears AA for every text role on the dark ground", () => {
    expect(contrast(token("--color-text"), GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--color-text-secondary"), GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--color-text-muted"), GROUND)).toBeGreaterThanOrEqual(4.5);
    // And on a card, which is the surface most of this text actually sits on.
    expect(contrast(token("--color-text-secondary"), CARD)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--color-text-muted"), CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it("clears AA for every accent used as text", () => {
    for (const name of [
      "--color-primary",
      "--color-success",
      "--color-warning",
      "--color-error",
      "--color-info",
    ]) {
      expect(contrast(token(name), GROUND), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("puts READABLE ink on a filled accent — the theme's easiest mistake", () => {
    /*
      THE ASSERTION THIS FILE MOST EXISTS FOR.

      White on periwinkle is 2.49:1. On mint 1.49:1. On the warning amber about
      1.4:1. All three are what a designer reaches for on a filled button, and
      all three are unusable. --color-on-accent is the deep space blue, and this
      test is what stops someone "fixing" a button back to white.
    */
    const onAccent = token("--color-on-accent");

    for (const fill of ["--color-primary", "--color-success", "--color-warning", "--color-error"]) {
      expect(contrast(onAccent, token(fill)), `${onAccent} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      // And prove the trap is real, so the test documents why the token exists.
      expect(contrast("#ffffff", token(fill)), `white on ${fill} must FAIL`).toBeLessThan(3);
    }
  });

  it("keeps every chart series distinguishable from its surface", () => {
    // Non-text marks need 3:1, not 4.5:1.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(contrast(token(`--chart-${n}`), GROUND), `--chart-${n}`).toBeGreaterThanOrEqual(3);
      expect(contrast(token(`--chart-${n}`), CARD), `--chart-${n}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the ordinal ramp monotone with visible steps", () => {
    const ramp = [0, 1, 2, 3, 4, 5].map((i) => luminance(token(`--ramp-${i}`)));

    for (let i = 1; i < ramp.length; i += 1) {
      // Light -> deep, strictly. A ramp that reverses anywhere encodes nothing.
      expect(ramp[i], `--ramp-${i} must be deeper than --ramp-${i - 1}`).toBeLessThan(ramp[i - 1]);
    }
  });

  it("uses only radii in the 10-16px band the brief specified", () => {
    // Nothing sharp anywhere: the brief's "no sharp corners".
    expect(token("--radius-sm")).toBe("10px");
    expect(token("--radius-base")).toBe("12px");
    expect(token("--radius-lg")).toBe("16px");
    expect(token("--card-radius")).toContain("--radius-lg");
    expect(token("--control-radius")).toContain("--radius-base");
  });

  it("elevates with a soft glow and never a hard shadow", () => {
    const soft = token("--glow-soft");
    const raised = token("--glow-raised");

    // A glow is wide and faint. A hard shadow is tight and opaque — so the
    // test looks for the shape of the thing rather than for a literal value.
    for (const [name, value] of [["--glow-soft", soft], ["--glow-raised", raised]]) {
      expect(value, `${name} should be a multi-layer soft glow`).toContain("rgba");
      expect(value, `${name} should carry a blur radius`).toMatch(/\d+px/);
      // No fully-opaque shadow layer anywhere.
      expect(value, `${name} must not use an opaque shadow`).not.toMatch(/rgba\([^)]+,\s*1\)/);
    }

    // The retired theme's flat rule is gone from the card.
    expect(GLOBALS).not.toMatch(/\.card,\n\.box \{[^}]*box-shadow: none;/);
  });

  it("names the specified typefaces and no others", () => {
    expect(token("--font-heading")).toContain("--font-grotesk");
    expect(token("--font-body")).toContain("--font-jakarta");

    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain("Space_Grotesk");
    // Aeonik is a commercial licence next/font cannot fetch; Plus Jakarta Sans
    // is the licensable stand-in. Asserted so the substitution stays visible
    // rather than becoming folklore — swapping in real Aeonik should fail this
    // test on purpose, as a prompt to update it.
    expect(layout).toContain("Plus_Jakarta_Sans");
  });

  it("defines a light counterpart for every colour role it overrides", () => {
    /*
      A half-overridden palette is how a light mode ends up with one dark border
      nobody can find. The light block must redeclare each role rather than
      inheriting some from the dark set.
    */
    const light = GLOBALS.slice(GLOBALS.indexOf("@media (prefers-color-scheme: light)"));

    for (const name of [
      "--color-background",
      "--color-card",
      "--color-text",
      "--color-text-secondary",
      "--color-primary",
      "--color-on-accent",
      "--color-success",
      "--color-warning",
      "--color-error",
      "--color-info",
      "--chart-1",
      "--ramp-0",
      "--glow-soft",
      "--brand-gradient",
    ]) {
      expect(light, `light mode must redeclare ${name}`).toContain(`${name}:`);
    }
  });

  it("inverts the on-accent ink for light mode", () => {
    // On a light ground the filled accent is DARK, so its ink is white — the
    // exact inverse of the dark rule. A component hard-coding either would be
    // wrong in one mode, which is the whole reason this is a token.
    const light = GLOBALS.slice(GLOBALS.indexOf("@media (prefers-color-scheme: light)"));
    const onAccent = light.match(/--color-on-accent:\s*([^;]+);/)?.[1].trim();
    const primary = light.match(/--color-primary:\s*([^;]+);/)?.[1].trim();

    expect(onAccent).toBe("#ffffff");
    expect(contrast(onAccent as string, primary as string)).toBeGreaterThanOrEqual(4.5);
  });
});

// -----------------------------------------------------------------------------
// Dimmed is not faded
// -----------------------------------------------------------------------------

describe("the marketing site never dims TEXT with opacity", () => {
  const MARKETING = readFileSync(path.join(ROOT, "app/(marketing)/marketing.scss"), "utf8");

  /** The body of the first rule whose selector line matches, braces balanced. */
  function ruleBody(selector: RegExp): string {
    const start = MARKETING.search(selector);
    if (start < 0) throw new Error(`no rule matching ${selector}`);
    const open = MARKETING.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < MARKETING.length; i++) {
      if (MARKETING[i] === "{") depth++;
      if (MARKETING[i] === "}" && --depth === 0) return MARKETING.slice(open + 1, i);
    }
    throw new Error(`unbalanced rule ${selector}`);
  }

  it("keeps the inactive states of every step rail at full opacity", () => {
    // An accessibility audit found 150+ labels at 1.2-3.6:1, every one of them
    // an "off"/"done"/"dim" state or a not-yet-revealed block faded with
    // opacity. Opacity dims ink and ground together; no value low enough to
    // read as "not yet" keeps 12px text at 4.5:1. Quieter tokens or chrome do.
    const states = [...MARKETING.matchAll(/&\[data-state="(?:off|done|dim)"\]\s*\{([^}]*)\}/g)];
    expect(states.length).toBeGreaterThan(10);
    for (const [rule, body] of states) {
      expect(body, rule).not.toMatch(/\bopacity\s*:/);
    }
  });

  it("keeps the scroll-revealed panels that carry text at full opacity", () => {
    for (const selector of [
      /\n  \.ai-flow__block \{/,
      /\n  \.fl-node__btn \{/,
      /\n  \.vi-transcript \{/,
      /\n  \.an-surface \{/,
      /\n  \.pv-rail__item \{/,
    ]) {
      expect(ruleBody(selector), String(selector)).not.toMatch(/\n    opacity\s*:/);
    }
  });
});
