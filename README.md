# Recruitment OS

AI-powered, multi-tenant Recruitment Operating System. Built module by module
against the specification in `docs/` — 17 core modules plus two cross-cutting
retrofits (privacy/compliance, AI & calling cost tracking).

## Stack

- **Next.js** (App Router) + TypeScript
- **Bulma** for base styling, themed with the project design tokens
- **Supabase** (PostgreSQL + Auth + Storage) with Row-Level Security
- **n8n** for workflow/automation orchestration (from Module 13)
- **Bolna AI** for outbound/inbound voice screening calls (from Module 8)
- An LLM provider behind an internal **AI Service Layer** (`lib/ai/`, from Module 6)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project, then copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` come from
   **Project Settings → API** in the Supabase dashboard.

3. Apply the database migrations. Paste each file in `supabase/migrations/`, in
   filename order, into the Supabase dashboard's **SQL Editor** and run it
   (or use `supabase db push` if you have the Supabase CLI linked).

4. In **Authentication → Providers**, enable Email, and Google if you want the
   "Continue with Google" button to work. Add
   `http://localhost:3000/auth/callback` to the allowed redirect URLs.

   Migration `0005` also creates a private **`resumes` storage bucket** with
   tenant-scoped policies. If your project blocks `insert into storage.buckets`
   from the SQL editor, create the bucket by hand (Storage → New bucket →
   `resumes`, **not** public, 10 MB limit) and re-run just the policy statements
   at the end of that file.

5. Run the dev server:

   ```bash
   npm run dev
   ```

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Routes — pages and API route handlers |
| `components/` | Shared UI (app shell, loading/empty/error states) |
| `lib/supabase/` | Browser, server, and session Supabase clients |
| `lib/tenant.ts` | Tenant + role resolution. **Every** API route uses this |
| `lib/ai/` | AI Service Layer — the only place an LLM is called |
| `lib/api.ts` | Shared route-handler helpers (errors, pagination) |
| `lib/time.ts` | Organization-timezone date math (all "today" calculations) |
| `lib/dashboard/` | Module 2's read-only aggregation layer |
| `lib/applications/` | Module 5's stage model, timeline, and queries |
| `lib/resumes/` | Module 6's extraction, review diff, and queries |
| `supabase/migrations/` | SQL schema, RLS policies, indexes, RPCs |
| `docs/` | The product specification, split per module |
| `proxy.ts` | Session refresh + auth enforcement at the edge |

## Non-negotiable conventions

These are inherited by every module — breaking one breaks tenant security or
the AI safety model:

- **Never trust a client-supplied `organization_id`.** Call
  `getCurrentOrganizationId()` / `requireMembership()` / `requireRole()` from
  `lib/tenant.ts`. Every table carries `organization_id` and is governed by RLS.
- **Never call an LLM provider outside `lib/ai/`.** Add a named,
  purpose-specific function (`parseResume()`, `matchCandidateToJob()`, …) — never
  a generic `askAI()`.
- **AI proposes, humans confirm.** Follow Raw Data → AI → Structured Output →
  Validation → Human Review → Business Action. AI output never writes straight
  to a trusted table.
- **Use the design tokens** in `app/globals.scss` (`var(--color-*)`), never
  ad-hoc hex values.
- **Every data-bearing view needs loading, empty, and error states** — see
  `components/states.tsx`.

## Scripts

```bash
npm run dev        # dev server
npm run build      # production build (also typechecks)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest (unit tests for pure logic)
```

`npm test` covers the logic that can be verified without a database: timezone
day boundaries across DST, the dashboard's degradation rules, role→scope
mapping, and the AI brief's numeric-consistency guard. Anything needing real
data (RLS, tenant isolation, live counts) has to be tested against a Supabase
project.

## Build progress

- [x] **Module 1** — Authentication & Organization
- [x] **Module 2** — Dashboard (thin by design — see
      `docs/modules/02-dashboard-retrofit.md`)
- [x] **Module 3** — Jobs Management
- [x] **Module 4** — Candidates Management
- [x] **Module 5** — Applications Management
- [x] **Module 6** — Resume AI (Parsing)
- [ ] Module 7 — AI Matching
- [ ] Module 8 — Bolna AI Screening
- [ ] Module 9 — AI Screening Report
- [ ] Module 10 — Advanced Pipeline
- [ ] Module 11 — Interviews
- [ ] Module 12 — Clients
- [ ] Module 13 — Automation Engine
- [ ] Module 14 — Activity & Audit
- [ ] Module 15 — Notifications & Communication
- [ ] Module 16 — Analytics & Reporting
- [ ] Module 17 — Settings & Integrations
- [ ] Cross-cutting: Privacy & Compliance retrofit
- [ ] Cross-cutting: AI & Calling Cost tracking retrofit

See `docs/00-build-order.md` for the dependency order and the forward-stub /
retrofit obligations each module carries.
