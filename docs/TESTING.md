# Testing

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

---

## 1. Current state — measured, not estimated

```
$ npm test        →  66 files, 1643 tests, all passing, 2.2s
$ npm run typecheck →  clean (tsc --noEmit, strict)
$ npm run lint      →  clean (eslint 9)
```

Runner: **Vitest 4**, `environment: "node"`, `include: ["**/*.test.ts"]`. The
`@/*` alias mirrors `tsconfig.json`.

**Every one of the 33 `lib/` domains has at least one test file.** That is
unusual and worth protecting.

---

## 2. What is tested — `IMPLEMENTED`

Pure logic, tested well. The suite runs in ~2 seconds because it touches no
database, which is exactly why it gets run.

| Area | Files | What it pins |
| --- | --- | --- |
| Time | `lib/time.test.ts` | Organization-timezone day boundaries **across DST**, half-open ranges |
| Tenancy edge | `lib/supabase/publicPaths.test.ts` | The public-path allowlist — including `/` granting only the landing page, and the near-miss names of real private routes (`/apply` must not free `/applications`) |
| Client boundary | `app/settings/clientBoundary.test.ts` | No `"use client"` module reaches `server.ts` / `admin.ts` / `next/headers` |
| Signed tokens | `forms/token`, `coding/token`, `communications/optout` | Signature verification, tamper rejection, version revocation |
| Rate limiting | `lib/forms/forms.test.ts` | The off-by-one that matters — *is the third attempt allowed or refused?* — tested without a database |
| Pipeline | `applications/stages`, `stageTimings`, `effectiveStages` | Transition legality, timing arithmetic |
| Matching | `matching/deterministic`, `score`, `prompt` | Deterministic scoring, score combination |
| Workflow | `workflow/workflow`, `defaultFlow` | 75 tests over branching, delays, the 8-stage invariant |
| AI guards | `ai/generateDailyBrief`, `numericGuard` (via callers), `parseResume`, … | **The constraint, not the prompt** — e.g. the brief cannot state a number contradicting the KPI tiles |
| Degradation | `lib/dashboard/metrics.test.ts` | "Table not built" vs. a real error; never a fake `0` |
| Privacy | `lib/privacy/privacy.test.ts` | Retention arithmetic: expiry on the exact boundary, recording expiring while transcript does not, a period shortened after capture |
| Resume formats | `lib/resumes/formats.test.ts` | Real `.pdf` / `.doc` / `.docx` fixtures in `lib/resumes/__fixtures__/` |

The pattern that makes this work: **the irreversible decision is a pure
function, and the executor only does what it is told.** Retention is the clearest
example — deleting candidate voice data early is evidence destroyed, so the
decision is separated from the deletion and the decision is what has tests.

---

## 3. What is not tested

### T-01 · `MISSING` (P0) — no test exercises RLS or tenant isolation

The single most important security property of a multi-tenant product — that
org A cannot read org B's rows — has **zero automated coverage**. RLS policies,
the ~20 `enforce_*_tenant_integrity` triggers, `prevent_self_role_change`,
`enforce_owner_remains`, and the append-only guard on `activity_events` are all
verified only by reading the SQL.

`README.md` acknowledges this: *"Anything needing real data (RLS, tenant
isolation, live counts) has to be tested against a Supabase project."* That
sentence has been true for 38 migrations.

**Fix:** a `supabase/tests/` suite run against a local `supabase start`
instance. Two signed-in users in two organizations, then assert every table
denies cross-tenant `SELECT`, `INSERT`, `UPDATE` and `DELETE`. This is
mechanical — one parameterised test over the table list — and it is the highest-
value test this project could add.

### T-02 · `MISSING` (P0) — no test covers any of the 105 route handlers

No integration tests. Nothing asserts that a route returns 401 without a
session, 403 for the wrong role, or 404 across tenants. Role gating on 105
handlers is verified by reading them.

**Fix:** the cheapest high-value version is a **static** test, not a runtime one
— parse every `app/api/**/route.ts` and assert each exported handler calls a
tenant helper, with an explicit allowlist for the five public routes. That is
~40 lines, needs no server, runs in the existing suite, and would catch the
class of mistake that actually happens (a new route added without a guard).

### T-03 · `MISSING` (P1) — no test asserts the admin client is tenant-filtered

Per `docs/SECURITY.md` **S-02**, the service-role client bypasses RLS in 16
modules. Nothing checks that each of its ~60 queries carries
`.eq("organization_id", …)`. A static test over those files would close it.

### `MISSING` (P1) — no end-to-end tests

No Playwright, no Cypress. Not one of the ten core user flows in `docs/PRD.md`
is exercised end to end. The public application flow — a stranger on the
internet submitting a form that creates a candidate, an application, a resume
and dispatches automations — is entirely untested as a flow.

### `MISSING` (P2) — no component tests

66 `.tsx` client components and zero render tests. `vitest.config.mts` uses
`environment: "node"` and `include: ["**/*.test.ts"]`, so `.tsx` tests would not
even be collected today.

### `MISSING` (P2) — no coverage reporting

`/coverage` is gitignored but no coverage script exists, so "every domain has a
test file" is the only coverage signal available. It says nothing about how much
of each domain is covered.

### `MISSING` (P2) — no migration testing

Migrations are re-runnable by convention. Nothing verifies that: applying them
in order from an empty database succeeds, re-running them is idempotent, or that
a migration's assumptions about earlier ones hold. Given that **three migrations
are currently written but unapplied**, this gap has already produced a real
divergence between code and database.

### `MISSING` (P3) — no load or performance test

The 5-minute cron sweeps every organization sequentially with `maxDuration=300`.
Nobody knows what N breaks it. No `EXPLAIN ANALYZE` evidence exists for any
query.

---

## 4. Manual testing — `IMPLEMENTED`

`docs/QA-MANUAL-TESTING-GUIDE.md` is 6,411 lines and genuinely thorough — a
per-module test-case register with IDs, expected results, an endpoint auth
matrix, and a risk register. Several findings in this documentation set were
independently confirmed against it.

It is, however, **manual**. It has no CI hook, no pass/fail record in the repo,
and no evidence of a completed run. It documents intent, not verified state.

---

## 5. Recommended strategy

**Do not** add a testing framework, a mocking library, or a fixture generator.
The existing setup is fast and adequate; what is missing is coverage of a
different *kind*, and most of it can be added as plain Vitest files.

| Priority | Add | Effort | Kind |
| --- | --- | --- | --- |
| **P0** | Static test: every route handler calls a tenant helper (allowlist the 5 public ones) | ~40 lines | Vitest, no infra |
| **P0** | RLS cross-tenant suite against local Supabase | ~1 day | New `supabase/tests/` |
| **P1** | Static test: every admin-client query filters `organization_id` | ~40 lines | Vitest, no infra |
| **P1** | Migration replay from empty + idempotency check in CI | ~half day | CI + local Supabase |
| **P1** | Playwright smoke: signup → job → candidate → application → stage move | ~1 day | New dependency, justified |
| **P2** | Coverage reporting with a ratchet on `lib/` | ~1 hour | `vitest --coverage` |
| **P2** | Component tests for the review-diff and workflow-builder UIs | ~1 day | `jsdom` env, second Vitest project |

Existing rule that must be kept: **where an AI output must satisfy a hard
constraint the spec states, enforce it in code and test the enforcement** —
never rely on prompt wording.
