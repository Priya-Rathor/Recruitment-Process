# Recruitment OS — working notes for agents

Multi-tenant AI recruitment SaaS, built one module at a time against the spec in
`docs/`. Read `docs/modules/<NN>-*.md` for the module you're building, plus the
code of every module already built, BEFORE writing anything.

**Documentation set** (read the one relevant to your change before you make it):
`docs/PRD.md` · `docs/ARCHITECTURE.md` · `docs/DATABASE.md` · `docs/API.md` ·
`docs/SECURITY.md` · `docs/PRIVACY.md` · `docs/TESTING.md` ·
`docs/DEPLOYMENT.md` · `docs/PRODUCTION_READINESS.md` · `docs/KNOWN_ISSUES.md` ·
`docs/PRODUCTION_AUDIT.md`.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build (also typechecks)
npm run lint         # eslint — must be clean
npm run typecheck    # tsc --noEmit
npm test             # vitest — must be green
```

Bulma emits Sass deprecation warnings from its own internals during builds.
They are not caused by project code; ignore them.

---

# AI coding workflow

Follow this for **every** feature, without exception:

```text
Before implementing any feature:

1. Understand the requirement.
2. Inspect existing code.
3. Check whether the functionality already exists.
4. Check whether the framework/library can solve it.
5. Choose the smallest safe implementation.
6. Check security implications.
7. Implement only what is required.
8. Add/update tests.
9. Run relevant tests/lint/type checks.
10. Update documentation if behavior changed.
11. Review the final diff and remove unnecessary code.
```

Steps 3 and 4 are the ones most often skipped and the ones that save the most
code. This repository already contains a deterministic matcher, a rate limiter,
three signed-token implementations, an activity logger, a notification
pipeline, an integration credential store, and a timezone-correct date library.
Reach for them.

---

# Security rules — non-negotiable

Breaking any of these breaks tenant security, the AI safety model, or the law.
None of them may be relaxed to make code work.

**1. Never expose secrets or API keys.** No secret in source, in a comment, in a
log line, in an error message returned to a client, or in a commit. Only
`NEXT_PUBLIC_SUPABASE_URL` and the RLS-constrained publishable key may carry the
`NEXT_PUBLIC_` prefix.

**2. Never put private credentials in frontend code.** A `"use client"` module
may not reach `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `next/headers`,
or any server-only environment variable. See §Client/server import boundary.

**3. Never trust frontend authorization.** Hiding a button is cosmetic. Every
rule the UI enforces must also be enforced in the API *and* — where it constrains
what a row may become — in the database. `curl` does not run your React.

**4. Always enforce authorization server-side.** Every route handler calls
`requireMembership()` / `requireRole()` / `getCurrentOrganizationId()` from
`lib/tenant.ts`. There are exactly five exceptions in this codebase — the public
form, three coding-token routes, and the Bolna webhook — each authorised by a
signed token or an HMAC signature, each documented in its own file header. Adding
a sixth requires the same standard of justification.

**5. Protect against IDOR and cross-tenant access.** Resolve the tenant from the
SESSION, never from a request body, query param, header, or JWT claim you did not
verify. Every id-addressed query filters `organization_id` as well as `id`, so a
cross-tenant id returns 404 rather than leaking existence.

**6. Validate all external and user input.** Anything from a browser, a webhook,
a form, a resume, or an LLM is untrusted. Narrow types explicitly before use.
Prefer a database `CHECK` constraint for anything that is a rule about the data
rather than about the request.

**7. Secure file uploads.** Private buckets only. Enforce size, MIME type and
extension. Never serve a stored file from a public URL — issue a short-lived
signed URL after checking the caller's tenancy. Never trust a client-supplied
filename or content type as the only gate; the bucket's `allowed_mime_types` is
the real one.

**8. Use least privilege.** `createAdminClient()` bypasses RLS. Use the normal
client if it can do the job. When you must use the admin client, **every query
filters `organization_id` explicitly** — there is no safety net behind you.

**9. Never log passwords, tokens, or sensitive personal data.** Mask recipients
at write time, not at render time. Never store a raw IP — HMAC it. Truncate
third-party error bodies before logging: a rejected email send echoes the
recipient, and an LLM 4xx can echo a candidate's CV.

**10. Use secure authentication and session handling.** Sessions are HTTP-only
cookies refreshed at the edge. Candidate-facing links are HMACs over a row id
with **nothing stored**, compared in constant time, returning an identical
failure for every reason so nobody can probe which rows exist.

**11. Add rate limiting where appropriate.** Any endpoint that is public,
unauthenticated, or spends money needs a cap. Use the existing table-backed
limiter — an in-process counter is meaningless on serverless.

**12. Never disable a security check to make code work.** Not "temporarily", not
behind a flag, not in a comment saying it will be fixed later. If a check is in
the way, the design is wrong.

**13. Database changes must use migrations.** Numbered plain SQL in
`supabase/migrations/`, re-runnable (`if not exists`, `drop policy if exists`,
`create or replace function`), applied in filename order. Never change a schema
by hand in the dashboard. Prefer additive, backward-compatible migrations so code
can roll back independently.

**14. No production change without a deployment and rollback plan.** Apply
migrations before deploying code and keep them backward-compatible. Never drop or
rename a column in the same release that stops using it. Note the rollback target
before you deploy. See `docs/DEPLOYMENT.md` §9.

---

# Code quality rules

**Keep code as small and simple as possible.** When a problem can be solved in
10 good lines instead of 100, use 10.

Before writing custom code, ask:
- Does an existing library already solve this?
- Can this be implemented using the framework's built-in functionality?
- Can the code be significantly simplified?

Then:

1. Prefer a mature, well-maintained library when it genuinely reduces complexity
   and security risk.
2. **Do NOT add a dependency for trivial functionality.** This project
   deliberately has no ORM, no schema library, and no vendor LLM SDK. That is a
   decision, not an oversight.
3. Avoid unnecessary abstractions, wrappers, helpers, classes, and duplicate
   code.
4. Follow existing project patterns instead of introducing new ones.
5. Do not rewrite working code without a clear reason.
6. Keep functions and components focused and small.
7. Prefer readable code over clever code.
8. Do not over-engineer for future requirements.

**The goal is production-ready, secure, maintainable code — not maximum code.**

Two habits this repository already has and expects you to keep:

- **Comments explain *why*, including the near-misses.** The most valuable
  comments here record a failure already suffered or an alternative rejected.
  Preserve them; a comment naming a trap is worth more than the line it sits on.
- **Split the module, not the file.** When a boundary is violated (client/server,
  pure/impure, decision/executor), the fix is two files with one responsibility
  each — not a flag, a parameter, or a lazy import.

---

# Architecture rules (inherited by every module)

**Tenant isolation.** Every table has `organization_id` and RLS. Resolve the
tenant from the session via `lib/tenant.ts` — never from a request body, query
param, or header. Role checks are enforced in the API layer *and* in RLS.

- **API routes**: `requireMembership()` / `requireRole()` /
  `getCurrentOrganizationId()` — these throw `TenantError`, which
  `handleRouteError()` turns into a JSON 401/403.
- **Pages**: `requireMembershipOrRedirect()` — redirects to `/login` or
  `/onboarding` instead of throwing.

**RLS is the real boundary, not the route handler.** The browser holds an
authenticated PostgREST client (`lib/supabase/client.ts`), so any signed-in user
can write directly to the database and skip your API route entirely. A rule that
exists only in a route handler is not enforced. When a rule constrains *what a
row may become* — a role transition, a status change, an ownership transfer —
encode it in the policy's `WITH CHECK` (new row) and `USING` (existing row), or
in a trigger for cross-row invariants. Keep the API check too, for a friendly
error message.

Two traps already hit in Module 1, both worth remembering:

- `organization_members`' SELECT policy intentionally exposes every member row
  of an org the caller belongs to (the team list needs it). Any query asking
  "what is *my* membership?" must filter `user_id` explicitly, or it picks up
  teammates' rows — and their roles.
- Check-then-write across two statements is a TOCTOU race. For invariants like
  "always at least one Owner", lock the parent row inside a trigger instead.

**AI Service Layer.** `lib/ai/` is the only place that talks to an LLM.
`lib/ai/provider.ts` holds the single provider boundary; each feature gets a
named function (`parseResume()`, `matchCandidateToJob()`, …). No generic
`askAI()`. Functions take structured input only — never a database handle — and
return `AiResult<T>` with validated output. AI failures are expected: the manual
workflow must always remain usable.

**AI never writes to trusted tables directly.** Raw Data → AI → Structured
Output → Validation → Human Review → Business Action.

**Treat LLM input as untrusted and LLM output as unvalidated.** Resume text and
public form answers are written by anyone on the internet. Never let a model's
output take an irreversible action on its own, and where a model's output feeds
an automated branch, require a deterministic signal to agree with it.

**Integration adapters.** `lib/integrations/{bolna,calendar,email,llm,n8n}/`
each expose `connect/test/getStatus/disconnect`. Later modules call the adapter;
they never re-implement a provider call. Credentials are AES-GCM encrypted
(`lib/integrations/crypto.ts`) and protected by a column-level REVOKE, so they
can only be read through `lib/supabase/admin.ts` — which BYPASSES RLS, so every
query made with it must filter `organization_id` explicitly.

**Anything that contacts a real person** (calls, emails, SMS) fails closed:
disconnected by default, explicit confirmation in the UI, a hard attempt cap,
and a consent disclosure that cannot be disabled. Recording someone without
telling them is unlawful in many jurisdictions — treat that as a build
constraint, not a later compliance task.

**Client/server import boundary.** A module a `"use client"` component imports
may not reach `lib/supabase/server.ts`, `lib/supabase/admin.ts` or `next/headers`.
Breaking it pulls the service-side client into the browser bundle and the App
Router rejects the build — but the failure is nastier than that sounds: the import
looks harmless (nobody imports a formatter expecting to drag a database client
along), and it can pass `npm run build` while failing `next dev`, so it surfaces
when somebody else pulls the branch.

The fix is always the same shape — split the module, not the file. Types and pure
functions in one file that touches nothing, the read in another. See
`lib/voice/costModel.ts` (client-safe) against `lib/voice/cost.ts` (server), and
`lib/voice/catalog.ts` against `lib/integrations/bolna/agentMapping.ts`. Note that
`import type` is erased and always safe; a value import from the same module is
not, and that distinction is usually the whole bug.
`app/settings/clientBoundary.test.ts` enforces this across the codebase.

**Time.** Every "today"/"this week" calculation uses `lib/time.ts` with the
ORGANIZATION's configured timezone — never the server's or the browser's. Ranges
are half-open `[start, end)`.

**One clock.** Exactly one scheduled caller hits `GET /api/automations/sweep`
every 5 minutes. Stale-stage rules, approval expiry and the `wait_then` delay
queue all drain from that single sweep. Do not add a second cron, a worker, or a
timer — add a pass to the existing sweep.

It is **not** a Vercel cron: the Hobby plan caps those at one run per day, which
would put every time-based automation up to 24h late. `vercel.json` declares no
cron and `.github/workflows/automation-sweep.yml` calls the endpoint instead —
same GET, same `CRON_SECRET`, no code difference. On a Pro plan, restore the
`vercel.json` cron and delete the workflow, in that order. See
`docs/DEPLOYMENT.md` §7 and `docs/KNOWN_ISSUES.md` B-05.

**Building against unbuilt modules.** Modules 2 and 16 read tables that later
modules own. Never let a missing table throw or report a fake `0` — a zero reads
as "nothing happened", which is a false statement to a manager. Degrade to an
explicit pending state and label it (see `lib/dashboard/metrics.ts`). Crucially,
distinguish "table not built" from a real error: an RLS denial or timeout
reported as "not built yet" would hide a genuine bug. Record every such
deferral in a retrofit checklist (see
`docs/modules/02-dashboard-retrofit.md`) — the spec requires the retrofit, and
"added it going forward only" is explicitly not sufficient.

**Tests.** Pure logic gets unit tests (`*.test.ts`, vitest). Where an AI output
must satisfy a hard constraint the spec states — e.g. "the brief never states a
number that contradicts the KPI tiles" — enforce it in code and test the
enforcement, rather than relying on prompt wording. Keep the irreversible
decision a pure function and let the executor do only what it is told.

## Design system — theme: FUTURE WORKFORCE (dark-default)

Tokens live in `app/globals.scss` as CSS custom properties. Use
`var(--color-primary)` etc., **never raw hex** — `app/theme.test.ts` fails the
build on a retired value in any notation, including `rgba()`.

**Dark is the default.** Light is a designed counterpart under
`prefers-color-scheme: light`, not an automatic flip; every role it overrides is
re-declared with its own value. There is no theme toggle in the product.

- **Surfaces**: `--color-background` (deep space) is the ground,
  `--color-card` is a panel, `--color-raised` a modal. The step between them is
  small on purpose — elevation is the glow and the hairline border, not a
  lighter fill.
- **Cards**: 16px radius, 1px `--color-border` (periwinkle at low alpha), 24px
  padding (16px mobile), and `box-shadow: var(--glow-soft)`.
- **Elevation is soft glow only. Never a hard shadow.** Use `--glow-soft`,
  `--glow-raised`, `--glow-accent`; there is a test asserting every
  `box-shadow` is a token, `none`, or an inset accent edge.
- **Radius is 10/12/16px** (`--radius-sm` / `--radius-base` / `--radius-lg`).
  Nothing sharp anywhere.

**THE ONE RULE THAT WILL BITE YOU:** ink on a filled accent is
`var(--color-on-accent)`, **never white**. White on periwinkle is 2.49:1, on
mint 1.49:1, on the warning amber ~1.4:1 — all unusable, and all what you reach
for first. The token flips per mode (deep space on dark, white on light), so a
component never needs to know which mode it is in. Hover on an accent adds
`--glow-accent`; it does **not** darken the fill, because darker reads as
disabled on a dark ground.

**Charts**: the form follows the data's job, and the theme's orbital preference
applies where the two agree. A ratio against a limit is an `OrbitalMeter`; the
funnel is concentric orbits sharing a 12 o'clock start; magnitude across
unordered categories stays **linear** — arcs at differing radii compare badly,
and that was a deliberate exception, not an oversight. Series come from
`--chart-1..5` in fixed order (never cycled) and the ordinal ramp from
`--ramp-0..5`; both were generated in OKLCH and validated with the `dataviz`
skill's `validate_palette.js`. No rainbow palettes, no 3D charts.

Every data-bearing view needs loading (skeletons, never a full-page spinner),
empty, and error states — use `components/states.tsx`. Config edits use an
explicit Save, never silent auto-save.

**Changing the theme again**: the user's theme-command format means FULL
replacement. Wipe the tokens, add the outgoing values to `RETIRED_COLORS` in
`app/theme.test.ts`, and let that test find the leftovers — it has caught, in
one pass, six hard shadows, two `rgba()` washes from a palette two rebrands old,
a token name (`--color-secondary-text`) that never existed in either theme, and
two local marketing tokens left pointing at deleted globals.

## Conventions

- Route handlers return errors via `lib/api.ts` (`handleRouteError`,
  `jsonError`) so error shapes stay consistent and internals never leak.
- `proxy.ts` (Next 16's replacement for `middleware.ts`) refreshes the session
  and enforces auth at the edge. Public paths are allowlisted there;
  everything else is protected by default. **An entry frees its whole subtree** —
  check the near-misses before adding one (`/job` would publish `/jobs`).
- Migrations are plain SQL in `supabase/migrations/`, applied via the Supabase
  SQL Editor or CLI. Keep them re-runnable (`if not exists`, `drop policy if
  exists`).
- Prefer loading data in server components and refreshing after mutations over
  client-side fetch effects.

## Session memory (`docs/Memory.md`)

`docs/Memory.md` is a running, dated log of build sessions. It exists to make
context reconstruction cheap — not to be a polished changelog.

**Start of every session:** read the most recent `docs/Memory.md` entries FIRST,
before re-reading the codebase. Fall back to source files only for what
Memory.md doesn't cover or looks stale on.

**End of every session** (or before context runs low): append a new dated entry
(`## YYYY-MM-DD`, newest at the bottom) with:

- which phase/module/task was worked on
- what was actually completed — files changed, migrations written/applied
- what's left unfinished, if the task didn't land
- decisions not already captured here or in `docs/modules/` — "chose X over Y
  because Z"

Terse bullets, not paragraphs. Don't restate what git history or the module spec
already says.

## Where things are

See the project layout table in `README.md` and `docs/ARCHITECTURE.md` §2.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
