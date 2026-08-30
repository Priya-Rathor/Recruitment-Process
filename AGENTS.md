# Recruitment OS — working notes for agents

Multi-tenant AI recruitment SaaS, built one module at a time against the spec in
`docs/`. Read `docs/modules/<NN>-*.md` for the module you're building, plus the
code of every module already built, BEFORE writing anything.

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

## Architecture rules (inherited by every module)

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
enforcement, rather than relying on prompt wording.

## Design system

Tokens live in `app/globals.scss` as CSS custom properties. Use
`var(--color-primary)` etc., never raw hex. Cards are flat: white, 1px
`--color-border`, 12px radius, 24px padding (16px mobile). No drop shadows, no
rainbow palettes, no 3D charts.

Every data-bearing view needs loading (skeletons, never a full-page spinner),
empty, and error states — use `components/states.tsx`. Config edits use an
explicit Save, never silent auto-save.

## Conventions

- Route handlers return errors via `lib/api.ts` (`handleRouteError`,
  `jsonError`) so error shapes stay consistent and internals never leak.
- `proxy.ts` (Next 16's replacement for `middleware.ts`) refreshes the session
  and enforces auth at the edge. Public paths are allowlisted there;
  everything else is protected by default.
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

See the project layout table in `README.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
