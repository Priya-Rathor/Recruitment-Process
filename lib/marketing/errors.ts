// =============================================================================
// Copy and recovery routes for the public error surfaces.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A DATA MODULE AND NOT JSX IN THE PAGES
// -----------------------------------------------------------------------------
//
// A 404 is the one page on the site nobody reviews. It renders for URLs that do
// not exist, so it is never visited deliberately, never screenshotted and never
// checked after a route is renamed — which is exactly when its recovery links
// go stale. Keeping them here means `errors.test.ts` can assert every one
// resolves against INTERNAL_ROUTES, the same way every other surface is
// checked.
//
// -----------------------------------------------------------------------------
// RECOVERY, NOT A SECOND SITEMAP (§5)
// -----------------------------------------------------------------------------
//
// Five destinations. Somebody who landed on a dead URL wants out, and the
// footer two screens below already carries the full navigation — repeating it
// here would bury the one link that actually helps.
// =============================================================================

export const NOT_FOUND = {
  eyebrow: "404",
  title: "This page isn't in the hiring workflow.",
  lead:
    "The page you were looking for may have moved, been renamed, or never " +
    "existed. Nothing is wrong with your account or your data.",
  /** The one obvious way out. */
  primary: { label: "Back to Scoreboad", href: "/" },
  /*
    §3's diagram, as text. The five stages the product actually runs, with the
    fourth marked as the one that lost its connection — which is the picture,
    and is also the only thing a screen reader needs from it.
  */
  stages: ["Job", "Candidate", "Screening", "Interview", "Decision"],
  /** Index of the stage drawn detached, then reconnecting. */
  detached: 3,
} as const;

export type RecoveryLink = { label: string; href: string };

/**
 * Where a lost visitor most plausibly wanted to go.
 *
 * Ordered by how likely each is to be the answer rather than by the site's own
 * hierarchy: the walkthrough first, because a mistyped or stale URL is usually
 * somebody exploring the product.
 */
export const RECOVERY_LINKS: RecoveryLink[] = [
  { label: "How Scoreboad works", href: "/how-it-works" },
  { label: "AI resume screening", href: "/product/understand" },
  { label: "Hiring pipeline and evaluation", href: "/product/decide" },
  { label: "Frequently asked questions", href: "/faq" },
  { label: "Create an account", href: "/signup" },
];

/**
 * The public error boundary's copy.
 *
 * SAYS NOTHING ABOUT WHAT BROKE, and that is the security requirement rather
 * than vagueness for its own sake (§8, §18): the only honest thing a browser
 * can be told is that the page did not load. What actually failed belongs in
 * the server log, where it cannot be read by whoever triggered it.
 */
export const PUBLIC_ERROR = {
  eyebrow: "Something went wrong",
  title: "Scoreboad couldn't load this page.",
  lead:
    "Something unexpected happened on our side. Trying again usually works — " +
    "if it does not, the rest of the site is still available.",
  retry: "Try again",
  home: { label: "Back to Scoreboad", href: "/" },
} as const;
