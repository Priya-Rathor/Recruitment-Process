# Module 21 — Public product website

The first public, unauthenticated, indexable surface in the product. Everything
before it was either behind a login or authorised by a signed token sent to one
specific person.

Brief: `NewIdeasToWorkOn/publicproductwebsite.txt`. Visual direction: the
alternating dark/light section rhythm, tabbed feature explorer, counted stat
band and native-accordion FAQ pattern used by
`sarvam.ai/products/voice-agents`, rebuilt entirely on this project's own brand
tokens.

## What shipped

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Static | Landing page — hero, stat band, feature explorer, capability grid, trust band, FAQ, CTA |
| `/how-it-works` | Static | The 15-stage end-to-end flow, four role flows, the AI safety model |
| `/product/[slug]` | SSG ×6 | One page per capability group: `source`, `understand`, `screen`, `decide`, `close`, `operate` |

Eight prerendered HTML pages. No public page reads the session, so none of them
is dynamic.

| Path | What it is |
| --- | --- |
| `app/(marketing)/layout.tsx` | Public shell. Imports no app shell, no tenant helper, no Supabase client |
| `app/(marketing)/page.tsx` | Landing page |
| `app/(marketing)/how-it-works/page.tsx` | End-to-end flow |
| `app/(marketing)/product/[slug]/page.tsx` | One template, six pages, `generateStaticParams` + `dynamicParams = false` |
| `app/(marketing)/marketing.scss` | The marketing design layer, scoped under `.mkt` |
| `app/(marketing)/_components/MarketingHeader.tsx` | Sticky header |
| `app/(marketing)/_components/MarketingFooter.tsx` | Footer |
| `app/(marketing)/_components/MarketingWordmark.tsx` | Dark-surface brand lockup (see *Design notes*) |
| `app/(marketing)/_components/FeatureExplorer.tsx` | The tabbed explorer — the only client component on the site |
| `lib/marketing/content.ts` | All copy, typed. Routes are layout only |
| `lib/marketing/content.test.ts` | Content integrity — 70 assertions |
| `lib/supabase/publicPaths.test.ts` | The allowlist as a tested security boundary — 67 assertions |

## The two changes to existing code

Only two files outside the new module were touched. Both are load-bearing.

**1. `app/page.tsx` was deleted.** It redirected `/` → `/dashboard`. A landing
page at `/` collides with it, and Next cannot resolve two files to one route.

*Behaviour change to be aware of:* a signed-in user visiting `/` now sees the
marketing site rather than being bounced to `/dashboard`. That is how a normal
SaaS site behaves, and the alternative costs more than it returns — deciding
where to send them requires reading the session at `/`, which makes the most
crawled page on the site dynamic. The header's "Sign in" already solves it in
one click: `updateSession()` redirects `/login` → `/dashboard` for an
authenticated user. If the old behaviour is wanted back, that is the trade-off
being bought.

**2. `lib/supabase/session.ts` — three entries added to `PUBLIC_PATHS`,** plus
`isPublicPath()` exported so the rule can be tested.

`"/"`, `"/product"`, `"/how-it-works"`.

### Why `"/"` in the allowlist is not a hole

This looks like it opens the entire application, because every path starts with
a slash. It does not. The matcher is:

```ts
pathname === p || pathname.startsWith(`${p}/`)
```

For `p = "/"` the second arm compiles to `startsWith("//")`, which no normalised
pathname satisfies. So `"/"` grants the landing page and nothing else.

That is a subtle guarantee resting on a template literal, so
`publicPaths.test.ts` pins it explicitly — including the case where someone
"simplifies" the matcher and drops the trailing slash, which would publish every
route in the app.

`"/product"` and `"/how-it-works"` *are* prefix entries and do free their
subtrees, which is intended. That is safe only because no private route begins
with either string. **Before adding an entry here, check the near misses:** an
entry of `"/job"` would silently publish `/jobs`, and this is exactly why
`/coding` (public) does not publish `/coding-sessions` (private).

## Verified

Checks, all green:

```
npm run lint        clean
npm run typecheck   clean
npm test            54 files, 1291 tests passed
npm run build       succeeded, 8 marketing pages prerendered
```

Live checks against `npm start`, anonymous:

- All 8 public routes return **200**.
- All 18 private routes return **307 → /login**, with the `next` parameter
  preserved. `/coding-sessions` stays private while `/coding` is public.
- No horizontal page scroll at 320, 390, 768, 1280 or 1920px.
- Exactly one `h1` per page.

## Design notes

**Why the marketing site looks different from the app.** The internal design
system is flat white cards, 1px borders, no shadows — correct for a dense data
tool somebody stares at for six hours, where every gradient competes with the
data. A landing page is read once, for ninety seconds, by somebody who does not
yet know what the product is. Different register, same tokens: the dark sections
are `--brand-navy` sampled from the logo, the accent is the same
`--color-primary` the app's buttons use. Nothing here invents a colour.

**The gradient is decoration only.** `globals.scss` records that contrast across
its stops runs from ~6:1 to under 3:1, so text on it is readable over one end and
invisible over the other. It appears here only as a blurred glow behind the hero
and as accent rules. No text sits on it.

**The dark-surface wordmark, and the bug that forced it.** The app's `Logo`
compact lockup paints the wordmark in two flat brand colours — "My" in
`#004cf5`, "Recruiter" in `#010c27`. On the navy header that second colour is
the background, so half the company's name rendered at roughly 1:1 contrast and
simply vanished. Caught by screenshotting the header, not by reading the CSS.

`MarketingWordmark` puts the monogram on a small white plate — the light ground
the gradient was drawn for — and sets the name as real text in the display face.
Better than the raster lockup here regardless: selectable, scalable, available to
a screen reader as text, and no image request. The app's `Logo` is untouched.

**Mobile header.** Below 30rem the wordmark text, "Sign in" and "Get started"
together exceeded the viewport and pushed the body 17px sideways. The text is
hidden and the mark kept — both calls to action matter more on a phone than the
name does when it is already in the title and the footer.

**Accessibility.** The feature explorer implements the full ARIA tabs pattern:
only the selected tab is in the tab order, arrow keys move between tabs with
focus following selection, Home/End jump to the ends. The FAQ is native
`<details>`, so it is keyboard accessible and findable by in-page search with no
JavaScript. The 15-stage flow is a real `<ol>` with CSS decoration rather than an
image of text. `prefers-reduced-motion` disables every transition.

## The no-fiction rule

Every capability named on the site maps to code in this repository. There are no
customer logos, no testimonials, no invented pricing tiers and no security
certifications, because there are no customers to quote and no certifications
held. The FAQ says so in as many words rather than staying silent, since an
omission on that question reads as a yes.

The stat band carries figures **counted from the repo** — 20 modules, 41 tables
under RLS, 16 named AI functions — with the derivation in a comment beside each
one. The tempting hero stat is "cuts time-to-hire by 70%"; there is no
measurement behind a number like that, and inventing one is the same class of
error as a dashboard reporting a fake zero. `content.test.ts` enforces the shape
that keeps these countable and rejects the vocabulary of an unmeasured
performance claim, so a future editor has to argue for such a stat rather than
slip it in.

## Not built yet

Phases from the brief that this module deliberately does not cover. None is
started, and nothing links to a missing page — a footer "Privacy" link that 404s
is worse than no link, because a visitor reads it as a policy that was withdrawn.

- **Contact / lead capture.** The largest remaining piece and the one with real
  risk: an unauthenticated write to a multi-tenant database. Needs a leads table
  whose RLS permits anonymous `INSERT` but makes anonymous `SELECT`/`UPDATE`/
  `DELETE` impossible, server-side validation, rate limiting, a honeypot,
  length caps, store-then-notify, and notification through the existing
  `lib/integrations/` adapters. Until it exists, both CTAs point at `/signup`.
- **Screenshots and demo visuals.** Requires a seeded demo organization with
  fictional data first. A screenshot of this product contains real candidate
  names, resumes, salary expectations and AI assessments; publishing any of that
  is an irreversible breach the moment it deploys. See
  `docs/00-privacy-compliance.md`.
- **Legal pages** — privacy, terms, DPA, candidate privacy notice. Drafts for a
  lawyer, not generated text presented as sufficient.
- **Public documentation section** (getting started, per-module guides, FAQ,
  changelog).
- **Pricing page** — blocked on a real pricing decision.
- **`sitemap.xml`, `robots.txt`, JSON-LD, OG preview image.** The sitemap must
  contain only public URLs.
- **A guard that no public page imports a tenant helper or session client.**
  Currently a convention held by review; it should be a test.
- **Lighthouse numbers.** Not yet measured, so not claimed.
