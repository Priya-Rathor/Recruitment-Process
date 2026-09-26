// =============================================================================
// The public website's light / dark / system theme.
//
// CLIENT-SAFE and pure. One attribute carries the RESOLVED theme —
// <html data-mkt-theme="light|dark"> — and app/(marketing)/marketing.scss is
// the only reader. It is deliberately not the application's mechanism: the app
// follows the OS (prefers-color-scheme) with no toggle, and nothing here
// changes that. The attribute is ignored outside `.mkt`.
//
// LIGHT IS THE DEFAULT, not "system". A first-time visitor sees the light site
// whatever their OS says; only an explicit choice changes it. And the default
// needs no script at all: an absent attribute IS light, so the server-rendered
// HTML is already correct for everyone who has not chosen dark.
//
// NO FLASH OF THE WRONG THEME. THEME_INIT_SCRIPT runs inline, before the first
// band is parsed, and sets the attribute from the stored choice. It is the one
// render-blocking script on the site and is a few hundred bytes. No library:
// next-themes would solve a larger problem (class strategies, multiple
// attributes, forced themes per page) than this site has.
// =============================================================================

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

/** localStorage key. A preference, not personal data, and not a cookie. */
export const THEME_STORAGE_KEY = "scoreboad-theme";
export const THEME_ATTRIBUTE = "data-mkt-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** What a stored value means. Anything unrecognised — or nothing — is the default. */
export function preferenceFrom(stored: string | null | undefined): ThemePreference {
  return isThemePreference(stored) ? stored : "light";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Inline, before paint. Mirrors preferenceFrom() + resolveTheme() exactly —
 * theme.test.ts evaluates it against them, because a script that disagreed
 * with the toggle would flash one theme and then switch to the other.
 *
 * Wrapped in try/catch: storage can throw (a private window, blocked site
 * data), and a throw here must mean "light", never a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE
)},"dark");else document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},"light")}catch(e){}})();`;
