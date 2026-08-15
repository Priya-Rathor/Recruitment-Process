# UI quality audit — all 17 modules

Conducted before any code changed. Findings are from reading the component
layer **and** from rendering six representative screens in a real browser at
1440×900, because several of these are invisible in source.

## The headline finding

**There is no shared component layer.** Four files in `components/` serve 109
page components:

| | |
| --- | --- |
| Files in `components/` | 4 (`AppShell`, `states`, `ActivityTimeline`, `SignOutButton`) |
| Page/component files in `app/` | 109 |
| Raw `<button>` | 115 |
| Raw `<input>` | 75 |
| Raw `<select>` | 36 |
| Raw `<table>` | 19 |
| Inline `style={{…}}` blocks | **679** |
| Distinct hard-coded `fontSize` values | **8** (10, 11, 12, 13, 14, 15, 30, 44) |

Every module re-implements its own buttons, tables and chips with Bulma classes
plus inline styles. That is the root cause of nearly everything below, and it is
why the brief's "fix once, inherit everywhere" instruction is the right shape:
the fixes have nowhere to live yet.

---

## A. Unstyled / default elements

- **A1. Every `<table>` is raw Bulma.** 19 of them, each with its own inline
  cell padding. No shared row height, no hover state on clickable rows, no
  right-alignment on numeric columns — counts, percentages and money all sit
  left-aligned next to text.
- **A2. Every `<select>` is a browser default** inside a Bulma `.select`
  wrapper. 36 of them. No consistent height with the adjacent inputs.
- **A3. Checkboxes are entirely unstyled.** The "Show archived" control on
  `/jobs` is a raw browser checkbox, visibly misaligned with its label
  (confirmed in the render, not just the source).
- **A4. Focus rings are browser defaults.** `globals.scss` contains **two**
  `:focus` rules in the entire product, both for Bulma button hover. There is
  no `:focus-visible` treatment anywhere — a keyboard user gets whatever the
  browser draws.

## B. Spacing inconsistency

- **B1. Card padding is tokenised but section rhythm is not.** `--card-padding`
  exists and is used, which is good. But the gap between a page heading and its
  first card is `mb-5` on some pages, `mb-4` on others, and a raw
  `style={{ marginBottom: 24 }}` elsewhere.
- **B2. Vertical rhythm between stacked cards varies** — `mb-4` and `mb-5` are
  mixed within single pages (e.g. `/analytics` uses both).
- **B3. KPI tile gaps are inline** (`gap: "1rem"`) rather than from a scale, and
  differ from the dashboard's tile gap.

## C. Weak visual hierarchy — the flatness problem

- **C1. ONE typeface for everything.** `Inter` is loaded and used for page
  headings, table cells, buttons and captions alike. The brief names this
  exactly: *"Do not use the exact same font weight/family for a page heading and
  a table cell — that flatness is the #1 tell of an unstyled AI build."* This is
  present throughout.
- **C2. Eight ad-hoc font sizes**, none of them tokens. `fontSize: 13` appears
  **248 times** as an inline literal.
- **C3. Heading sizes come from Bulma's `.title is-4` / `is-5` / `is-6`**, which
  do not match the specified scale, and are applied inconsistently — some
  section headings are `is-5`, others `is-6`, others a raw `<h2>` with inline
  styles.
- **C4. On `/jobs`, every text element is within ~2px of the same size** apart
  from the page title. Nothing directs the eye to the primary action.

## D. Generic / templated copy

- **D1. `/jobs` subtitle reads "Draft · Open · On hold · Closed"** — a list of
  states masquerading as a description. It tells the user nothing.
- **D2. Empty states are one long sentence**, not a headline plus a helper line:
  *"No jobs yet. Create your first requisition — you can paste a job description
  and let AI structure it."* — two ideas in one run-on line.
- **D3. Mixed action naming.** `/jobs` has **"New job"** in the header and
  **"Create a job"** in the empty state, for the same destination. The brief is
  explicit that an action keeps its name.
- **D4. Bare `<option>` values are shown raw** — the Role select renders
  `owner / admin / recruiter / viewer` in lowercase, relying on a CSS
  `text-transform` in one place and not in others.

## E. Missing interaction states

- **E1. No `transition` property anywhere in `globals.scss`** (0 occurrences).
  Every hover is an instant colour snap.
- **E2. No active/pressed state** on any button.
- **E3. Disabled buttons rely on Bulma's default opacity** with no
  `cursor: not-allowed`. Visible on the disabled Calendar **Connect** button.
- **E4. No hover state on table rows**, including rows that navigate.

## F. Empty and error states

- **F1. `components/states.tsx` is 76 lines** and provides `EmptyState`,
  `ErrorState`, `Skeleton`. They are used, which is genuinely good — but:
- **F2. `EmptyState` renders a centred grey sentence and nothing else.** No
  icon, no bold headline. The brief asks for icon + short bold headline + one
  helper sentence + optional action.
- **F3. `ErrorState` is a red sentence plus a small "Retry".** No icon, no
  headline.
- **F4. Several error surfaces bypass the component** and render a bare red
  `<p>` — e.g. the Google Calendar warning on `/settings/integrations`.

## G. Looks like default AI scaffolding — highest priority

These are the ones that read as "generated", flagged as the brief requires:

- **G1. Zero icons in the entire product.** No icon library is installed. Status
  chips, nav, empty states and destructive actions are all text-only. This is
  the single strongest "unfinished" signal.
- **G2. Single font, single weight rhythm** (C1) — the classic tell.
- **G3. The top navigation is visibly broken at 1440px.** "Audit log" wraps onto
  two lines, the organization name "Acme Talent Partners" wraps onto **three**,
  and the user's email is clipped mid-word at the right edge (`au…`). This is a
  real layout defect, not a polish item — it appears on every page in the
  product.
- **G4. Centred grey text as an empty state** is the default output shape for
  this kind of brief.
- **G5. No motion of any kind**, so skeleton→content swaps pop.

---

## Scope note

679 inline style blocks across 109 files cannot all be migrated by hand in one
pass without touching business logic. The plan is therefore: build the missing
token layer and component library, migrate the shared shell and the highest-
traffic surfaces onto it, and record honestly which modules still carry inline
styles so they can be finished incrementally.
