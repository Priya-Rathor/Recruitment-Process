import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  THEME_ATTRIBUTE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  preferenceFrom,
  resolveTheme,
  type ThemePreference,
} from "./theme";

describe("theme preference", () => {
  it("defaults to LIGHT — not system — when nothing, or nonsense, is stored", () => {
    expect(preferenceFrom(null)).toBe("light");
    expect(preferenceFrom(undefined)).toBe("light");
    expect(preferenceFrom("sepia")).toBe("light");
    expect(preferenceFrom("dark")).toBe("dark");
    expect(preferenceFrom("system")).toBe("system");
  });

  it("resolves system from the OS, and never lets the OS override an explicit choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("THEME_INIT_SCRIPT — the pre-paint script agrees with the toggle", () => {
  function run(stored: string | null, systemDark: boolean, storageThrows = false) {
    const attributes: Record<string, string> = {};
    const localStorage = {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    const window = { matchMedia: () => ({ matches: systemDark }) };
    const document = { documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) } };
    new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(localStorage, window, document);
    return attributes[THEME_ATTRIBUTE];
  }

  it("produces exactly what resolveTheme() would, for every stored value and OS setting", () => {
    // A disagreement here is a visible flash: one theme painted, then the other.
    for (const stored of [null, "light", "dark", "system", "garbage"]) {
      for (const systemDark of [true, false]) {
        const expected = resolveTheme(preferenceFrom(stored) as ThemePreference, systemDark);
        expect(run(stored, systemDark), `${stored} / os dark=${systemDark}`).toBe(expected);
      }
    }
  });

  it("fails quietly to the server-rendered light theme when storage is blocked", () => {
    expect(() => run(null, true, true)).not.toThrow();
    expect(run(null, true, true)).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// The theme layer's colour pairs, read from the stylesheet itself — so the
// ratios in its comments are checked, not trusted, and an edit to a remap that
// drops a pair below AA fails here instead of on somebody's screen.
// -----------------------------------------------------------------------------
const SCSS = readFileSync(path.join(process.cwd(), "app/(marketing)/marketing.scss"), "utf8");

function mixin(name: string): Record<string, string> {
  const body = SCSS.match(new RegExp(`@mixin ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!body) throw new Error(`mixin ${name} not found`);
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()])
  );
}

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function expectPairs(tokens: Record<string, string>, text: string[], grounds: string[], min: number) {
  for (const t of text) {
    for (const g of grounds) {
      expect(tokens[t], `--${t} is not a hex in the mixin`).toBeDefined();
      expect(tokens[g], `--${g} is not a hex in the mixin`).toBeDefined();
      expect(contrast(tokens[t], tokens[g]), `--${t} on --${g}`).toBeGreaterThanOrEqual(min);
    }
  }
}

describe("theme layer contrast", () => {
  it("keeps every text token AA on every ground when the dark family is rendered light", () => {
    expectPairs(
      mixin("mkt-dark-family-on-light"),
      ["mkt-on-dark", "mkt-on-dark-muted", "mkt-on-dark-faint", "mkt-accent-on-dark", "mkt-mint", "mkt-lavender"],
      ["mkt-dark", "mkt-dark-2", "mkt-dark-3"],
      4.5
    );
  });

  it("keeps every text token AA on every ground when the light family is rendered dark", () => {
    expectPairs(
      mixin("mkt-light-family-on-dark"),
      [
        "mkt-ink",
        "mkt-ink-muted",
        "mkt-accent-ink",
        "mkt-mint-ink",
        "mkt-lavender-ink",
        "mkt-amber-ink",
        "mkt-error-ink",
      ],
      ["mkt-light", "mkt-white", "mkt-light-2"],
      4.5
    );
  });

  it("pairs the primary button fill with an ink that reads, in both palettes", () => {
    for (const palette of ["mkt-app-tokens-light", "mkt-app-tokens-dark"]) {
      const t = mixin(palette);
      expect(contrast(t["color-on-accent"], t["color-primary"]), palette).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["color-text"], t["color-card"]), palette).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["color-text-secondary"], t["color-card"]), palette).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not pair a theme-dependent fill with a fixed navy label", () => {
    // The trap the theme layer fixed in five places: var(--color-primary) is
    // #515f9e in the light theme, and navy on it is 2.94:1.
    const rules = SCSS.split("\n");
    rules.forEach((line, index) => {
      if (!/color:\s*var\(--mkt-on-accent\)/.test(line) || /background/.test(line)) return;
      const context = rules.slice(Math.max(0, index - 5), index).join("\n");
      expect(context, `line ${index + 1}`).not.toMatch(/background(-color)?:\s*var\(--color-primary\)/);
    });
  });
});
