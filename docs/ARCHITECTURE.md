# Architecture

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

---

## 1. Technology stack — `IMPLEMENTED`

| Layer | Choice | Version | Notes |
| --- | --- | --- | --- |
| Framework | Next.js App Router | `16.3.0` | Uses Next 16's `proxy.ts`, **not** `middleware.ts`. Read `node_modules/next/dist/docs/` before writing routing code. |
| Runtime | React | `19.2.8` | Server Components by default. |
| Language | TypeScript | `^5`, `strict: true` | `npm run typecheck` is clean. |
| Database / Auth / Storage | Supabase (PostgreSQL) | `@supabase/supabase-js ^2.112`, `@supabase/ssr ^0.12` | RLS on all 51 tables. |
| Styling | Bulma + Sass | `bulma ^1.0.4` | Design tokens as CSS custom properties in `app/globals.scss`. |
| Icons | `lucide-react` | `^1.31` | |
| Resume extraction | `unpdf`, `mammoth`, `word-extractor` | | Server-only; must never reach a client bundle. |
| Code editor | `@uiw/react-codemirror` + language packs | | Live coding round only. |
| QR codes | `qrcode` | `^1.5.4` | |
| Tests | Vitest | `^4.1.10` | 66 files / 1643 tests, all passing. |
| Lint | ESLint 9 + `eslint-config-next` | | Clean. |
| Host | Vercel | | One cron in `vercel.json`. |

**Total application code:** ~117,900 lines across `app/`, `lib/`, `components/`.
**SQL:** ~9,500 lines across 38 migrations.

Notably **absent** and deliberate: no ORM, no validation library (Zod et al.), no
state-management library, no vendor LLM SDK. Validation and the AI provider call
are hand-written so the provider stays swappable and the bundle stays small.

---

## 2. Layout

```
app/
  (marketing)/        public product website
  api/                105 route handlers
  <feature>/          pages + colocated client components
  layout.tsx, error.tsx, globals.scss
components/           shared UI — AppShell, states, nav, ui primitives
lib/
  tenant.ts           THE tenant + role boundary
  api.ts              handleRouteError / jsonError / parsePagination
  time.ts             organization-timezone date math
  types.ts            shared row types
  supabase/           server | client | admin | session | env | errors
  ai/                 the ONLY place an LLM is called
  integrations/       bolna | calendar | email | llm | n8n | whatsapp + crypto + store
  <domain>/           queries + pure logic per module, colocated *.test.ts
supabase/migrations/  38 plain-SQL migrations
proxy.ts              Next 16 edge session refresh + auth allowlist
docs/                 specification, module notes, and this documentation set
```

---

## 3. Request lifecycle

```
Browser
  │
  ├─▶ proxy.ts ──────────────── refresh Supabase session; deny-by-default
  │                              path allowlist (lib/supabase/session.ts)
  │
  ├─▶ Server Component page ─── requireMembershipOrRedirect()
  │        │                      → /login or /onboarding on failure
  │        └─▶ lib/<domain>/queries.ts ─▶ createClient() [RLS enforced]
  │
  ├─▶ Route handler ─────────── requireMembership() / requireRole()
  │        │                      → TenantError → handleRouteError() → JSON 401/403
  │        └─▶ createClient() [RLS] or createAdminClient() [RLS BYPASSED]
  │
  └─▶ Browser Supabase client ─ direct PostgREST, RLS-enforced only
```

**The load-bearing consequence** of that last arrow: any signed-in user holds an
authenticated PostgREST client and can write to the database **without touching
a route handler**. A rule that exists only in a route handler is not enforced.
Rules about what a row may *become* live in the policy's `WITH CHECK`/`USING` or
in a trigger; the route check remains only for a readable error message.

---

## 4. The three Supabase clients

| Client | File | RLS | Use |
| --- | --- | --- | --- |
| Browser | `lib/supabase/client.ts` | Enforced | Client Components only. |
| Server | `lib/supabase/server.ts` | Enforced | Server Components, route handlers, actions. |
| **Admin** | `lib/supabase/admin.ts` | **BYPASSED** | Only where no session exists or a column-level `REVOKE` blocks the session: the cron sweep, the Bolna webhook, public form submission, candidate coding routes, credential read/write, and outbound send. |

`createAdminClient()` returns `null` when no secret key is configured, so the
feature degrades to "not configured" rather than crashing. **Every query made
with it must filter `organization_id` explicitly** — there is no safety net.

Admin client is imported by 16 modules. `RISK` — this is the single largest
concentration of tenant risk in the codebase and has **no automated test**
asserting the `organization_id` filter is present. See `docs/TESTING.md`.

---

## 5. Multi-tenancy — `IMPLEMENTED`

- Every table carries `organization_id` and has RLS enabled (verified: all 51).
- The tenant is resolved **from the session only** (`lib/tenant.ts`). The
  `active_organization_id` cookie is a *hint*, re-validated against real
  `organization_members` rows on every request; a forged value falls back to the
  default org rather than granting access.
- ~40 `enforce_*_tenant_integrity` triggers assert that a child row's
  `organization_id` matches its parent's — closing the gap where RLS alone would
  allow a correctly-tenanted row pointing at another tenant's parent.
- `getUserMemberships()` filters `user_id` explicitly, because
  `organization_members`' SELECT policy intentionally exposes every member row
  of an org you belong to. An unfiltered query would return a teammate's role.

---

## 6. AI service layer — `IMPLEMENTED`

`lib/ai/provider.ts` is the **only** file that talks to an LLM over the wire.
Implemented with `fetch` against an OpenAI-compatible `/chat/completions`
endpoint — no vendor SDK, so the provider is swappable by editing one file.

Every feature is a **named function** taking structured input and returning
`AiResult<T>`:

```
parseResume · matchCandidateToJob · generateScreeningSummary
generateInterviewBrief · generateDailyBrief · generateClientSubmission
explainAnalytics · prioritizePipeline · parseCandidateSearch
structureCandidateText · extractJobFromDescription · draftAutomationRule
adjustMessageTone · summarizeActivity · chatAsAgent · refineAgentPrompt
generateApplicationSummary · generateOnboardingRecommendations
```

There is deliberately **no generic `askAI()`**. Contract:

- Structured input only — never a database handle.
- Output must pass a `validate()` narrowing function or the result is
  `invalid_output`.
- 30-second abort budget; AI must never hang a request.
- `not_configured` is a normal state, not an error — the manual workflow stays
  usable.
- **Raw Data → AI → Structured Output → Validation → Human Review → Business
  Action.** AI never writes to a trusted table directly.
- Where an AI output must satisfy a hard constraint the spec states (e.g. "the
  brief never states a number that contradicts the KPI tiles"), the constraint
  is enforced in code (`lib/ai/numericGuard.ts`) and the enforcement is tested —
  never left to prompt wording.

`MISSING` — no token metering, no cost attribution, no per-tenant budget.
`RISK` — no prompt-injection boundary; see `docs/SECURITY.md` finding **S-04**.

---

## 7. Integration adapters — `IMPLEMENTED`

`lib/integrations/{bolna,calendar,email,llm,n8n,whatsapp}/` each expose
`connect / test / getStatus / disconnect`. Later modules call the adapter and
never re-implement a provider call.

Credentials are **AES-GCM encrypted** (`lib/integrations/crypto.ts`, key from
`INTEGRATION_ENCRYPTION_KEY`, 32+ chars) and protected by a **column-level
`REVOKE`** (migration `0007`), so they can only be read through the admin
client. The UI receives a mask (`••••••4F8A`), never the key.

`INTEGRATION_ENCRYPTION_KEY` is also the signing key for the form token,
unsubscribe token, coding token, OAuth state and the rate-limiter's IP HMAC.
`RISK` — one key, five purposes; rotating it invalidates every outstanding
candidate link at once. See `docs/SECURITY.md` finding **S-06**.

---

## 8. Anything that contacts a real person — `IMPLEMENTED`

Calls, emails and SMS **fail closed**: disconnected by default, explicit
confirmation in the UI, a hard attempt cap, and a consent disclosure that cannot
be disabled. Recording without disclosure is unlawful in many jurisdictions and
is treated as a build constraint, not a compliance task for later.

---

## 9. Client/server import boundary — `IMPLEMENTED`

A module a `"use client"` component imports may not reach
`lib/supabase/server.ts`, `lib/supabase/admin.ts`, or `next/headers`. Breaking
it pulls a service-side client into the browser bundle; worse, it can pass
`npm run build` while failing `next dev`, so it surfaces on someone else's
machine.

The fix is always **split the module, not the file**: pure functions and types
in a file that touches nothing, the read in another. See `lib/voice/costModel.ts`
(client-safe) against `lib/voice/cost.ts` (server), and `lib/voice/catalog.ts`
against `lib/integrations/bolna/agentMapping.ts`. `import type` is erased and
always safe; a value import from the same module is not — that distinction is
usually the whole bug.

`app/settings/clientBoundary.test.ts` enforces this across the codebase.

---

## 10. Time — `IMPLEMENTED`

Every "today"/"this week" calculation uses `lib/time.ts` with the
**organization's** configured timezone — never the server's or the browser's.
Ranges are half-open `[start, end)`. A user's `display_timezone` preference is
display-only and never enters a stored calculation, so a report's numbers cannot
change depending on who opened it.

---

## 11. Scheduling — one clock

`vercel.json` defines exactly **one** cron: `GET /api/automations/sweep` every 5
minutes. It drains stale-stage rules, approval expiry, and the `wait_then` delay
queue in a single pass. The frequency is load-bearing — at hourly, a 30-minute
wait fires 30–90 minutes late and a 15-minute pre-call reminder arrives after the
call. **Do not add a second cron for delays.**

`RISK` — a single sequential sweep across every organization with
`maxDuration = 300`. See `docs/PRODUCTION_READINESS.md` §Scalability.

---

## 12. Error handling and UI states

- Route handlers return errors through `lib/api.ts`; internals never leak.
- `lib/supabase/errors.ts` distinguishes "schema is behind the code" (`42P01`,
  `42703`, `PGRST205`, `PGRST204`) from a real failure, matching on **error
  codes, not message text**, so an RLS denial is never mislabelled as a pending
  migration.
- Every data-bearing view needs loading (skeletons, never a full-page spinner),
  empty, and error states — `components/states.tsx`.
- Config edits use an explicit Save, never silent auto-save.
- `app/error.tsx` is the route-level boundary and shows no stack trace.
  `MISSING` — there is no `app/global-error.tsx` and no `app/not-found.tsx`.

---

## 13. Building against unbuilt modules

Modules 2 and 16 read tables later modules own. A missing table must never throw
and must never report a fake `0` — a zero reads as "nothing happened", which is
a false statement to a manager. Degrade to an explicit *pending* state, label it,
distinguish "table not built" from an RLS denial or timeout, and record the
deferral in `docs/modules/02-dashboard-retrofit.md`. "Added it going forward
only" is explicitly not sufficient.
