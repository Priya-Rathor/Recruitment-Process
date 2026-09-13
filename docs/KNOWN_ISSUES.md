# Known Issues

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

Verified against the repository on 2026-08-30. Each entry names the file so it
can be re-checked. Sources: direct code inspection, `docs/Memory.md`, and
independent confirmation of items in `docs/QA-MANUAL-TESTING-GUIDE.md`.

---

## Blockers

### B-01 · Migrations `0032`, `0037`, `0038` are written but not applied — `RISK`
`supabase/migrations/`, recorded in `docs/Memory.md`.

The deployed schema is behind the code. Anything reading
`organization_settings.privacy_settings` (Module 22 privacy), the stage-workflow
columns on `automations`, or `automation_delayed_actions` (the `wait_then` delay
queue) fails until they run.

Handled gracefully — `isSchemaOutOfDate()` matches on error codes and the UI
says which files to apply — but the features are simply absent until then.

**Fix:** apply `0032`, `0037`, `0038` in order in the Supabase SQL Editor.

### B-02 · No CI, and 36 uncommitted files — `MISSING`
No hooks, and no CI: `.github/workflows/` now exists but holds only the
scheduler (B-05), which builds nothing and tests nothing. `lint`, `typecheck`,
`test` and `supabase/tests/replay.sh` still run only when a human remembers.
At audit time the tree carried 20 modified and 16 untracked files (Modules 25
and 26). Nothing deployed corresponds to a commit.

### B-03 · Backups and rollback are unverified — `UNKNOWN`
No backup plan, retention period, PITR setting, storage-bucket backup, or tested
restore is recorded anywhere. No down-migrations exist. See
`docs/DEPLOYMENT.md` §8–9.

### B-04 · No error tracking — `MISSING`
348 `console.error` calls into ephemeral Vercel logs. No Sentry/Datadog/OTel, no
alerting, no health check. A production failure is invisible.

### B-05 · The clock lives outside Vercel — `PARTIAL`
`vercel.json`, `.github/workflows/automation-sweep.yml`, 2026-09-13.

The Vercel **Hobby plan allows one cron invocation per day** and refuses to
deploy anything finer. The sweep is the product's only clock — the `wait_then`
delay queue, stale-stage rules and approval expiry all drain from it — so a
daily pass would put every time-based rule up to 24h late, silently. The `crons`
entry was therefore removed from `vercel.json` (not detuned to daily) and a
GitHub Actions workflow calls `GET /api/automations/sweep` every 5 minutes with
the `CRON_SECRET` bearer token. No code changed; the endpoint never knew who was
calling it.

Residual risk, in order:

1. **GitHub's scheduler is best-effort** — `*/5` is a ceiling. Runs are commonly
   5–15 minutes late under load and are sometimes skipped outright. Acceptable
   for a 30-minute wait; not equivalent to Vercel Cron.
2. **Scheduled workflows are auto-disabled after 60 days of repository
   inactivity.** Nothing announces this. A quiet repo stops the clock.
3. **`CRON_SECRET` now exists in two systems**, so rotation is a two-place
   operation and the GitHub copy inherits repo write-access as its blast radius.
4. A failed run is an email to the repo owner and a red tick — still no paging.
   Related: B-04.

**Fix:** upgrade to Vercel Pro, restore the `vercel.json` cron, delete the
workflow. See `docs/DEPLOYMENT.md` §7.

---

## Security

### S-01 · Invite tokens are not identity-bound — `FIXED` 2026-09-12
Fixed by `supabase/migrations/0040_bind_invite_to_identity.sql`.
`accept_invite()` now proves the caller is the invited address (read from
`auth.users`, **not** the user-writable `public.users`) and no longer re-grades
an existing member. Full analysis in `docs/SECURITY.md` §S-01; proof in
`supabase/VERIFY_0040.sql`.

**Not closed until the migration is applied.** The code ships correct against
both the old and new function, so deploying before applying it is safe — but the
hole stays open until 0040 runs.

### S-07 · Rate limiting exists on exactly one endpoint — `MISSING` (P1)
`lib/forms/rateLimit.ts` is used only by `lib/forms/submit.ts`. Uncapped:
`PUT /api/coding/[token]/draft` (public, autosaving), `GET /api/coding/[token]`,
`POST /api/coding/[token]/submit`, `POST /api/webhooks/bolna`, and ~30
authenticated AI endpoints that each cost money.

### S-04 · No prompt-injection boundary — `RISK` (P1)
Attacker-controlled resume and form text enters LLM prompts undelimited, and
`lib/workflow/shortlist.ts` branches an application on the resulting score with
no human in the loop.

### S-02 · Service-role client is unverified — `RISK` (P1)
16 modules bypass RLS. Correct where inspected; no test or lint rule asserts the
`organization_id` filter.

### No Content-Security-Policy — `MISSING` (P2, was P1)
**Partly fixed 2026-09-12, before the first deploy.** `next.config.ts` now sends
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Strict-Transport-Security` (2 years,
subdomains, no preload) and a `Permissions-Policy` denying camera, microphone,
geolocation, payment and USB. Verified against `npm start`, not assumed.

**A CSP is still missing**, deliberately rather than by oversight. This product
inlines `style` objects throughout the design system, loads fonts through
`next/font`, and runs CodeMirror; a policy worth having needs `unsafe-inline`
for styles, a nonce pipeline for scripts and a pass over every external origin.
A wrong CSP breaks production silently rather than failing a build, so it needs
its own test plan. `frame-ancestors` is covered in the meantime by
`X-Frame-Options`.

### S-06 · One encryption key, five purposes — `RISK` (P2)
`INTEGRATION_ENCRYPTION_KEY` signs form tokens, unsubscribe tokens, coding
tokens and OAuth state, HMACs rate-limit sources, **and** encrypts credentials.
Rotating it invalidates every live candidate link, so it will never be rotated.

### S-05 · Webhook replay — `RISK` (P2)
`app/api/webhooks/bolna/route.ts` has no timestamp or nonce check.

### S-08 · Provider error bodies logged verbatim — `RISK` (P2)
`lib/integrations/calendar/oauth.ts:135`, `lib/integrations/email/index.ts:361`,
`lib/ai/provider.ts:110`. Can carry candidate PII into logs.

### `CRON_SECRET` undocumented — `FIXED` 2026-09-12
All six are now in `.env.local.example`: `CRON_SECRET` (with the consequence of
leaving it unset stated in the file), `AI_MODEL`, `AI_BASE_URL`,
`BOLNA_CATALOG_PATHS`, and the current-generation Supabase names
`SUPABASE_SECRET_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` alongside the
legacy pair.

Still true and worth keeping in mind: unset, the cron endpoint is a permanent
503 and **no time-based automation ever fires**, with nothing in the product
saying so except that endpoint. Documenting it does not make it self-evident on
a deployment where somebody skipped it.

### No upload content sniffing — `RISK` (P2)
Extension and MIME are checked; bytes are not. Impact limited — files are never
executed and never served from our origin.

---

## Privacy

### P-01 · Retention is configurable but never executed — `PARTIAL` (P0)
`lib/privacy/retention.ts` is a complete, tested planner with **zero callers**.
No recording, transcript or AI evaluation is ever deleted.
`app/settings/security/page.tsx` says "nothing is deleted yet";
`app/settings/privacy/PrivacyForm.tsx` — where retention is actually configured
— does not, so an admin configuring a 30-day period will believe it takes
effect.

### P-02 · Automated shortlisting has no Art. 22 notice — `PARTIAL` (P1)
Structurally reversible (a flag, never a rejection; `needs_review` takes neither
branch), but no candidate notice and no stated human-review route.

### P-03 · No data-region, DPA, or sub-processor record — `UNKNOWN` (P1)
Candidate voice data reaches Bolna and the LLM provider with no documented
boundary.

### P-04 · No candidate access/portability channel — `MISSING` (P2)

### P-05 · Consent on a dropped call is ambiguous — `RISK` (P2)
No signal distinguishes "disclosed and accepted" from "never disclosed".

---

## Testing

### T-01 · No RLS or tenant-isolation test — `MISSING` (P0)
The core security property of a multi-tenant product has zero automated
coverage across 51 tables and ~110 policies.

### T-02 · No API route test — `MISSING` (P0)
105 handlers. Nothing asserts 401/403/404 behaviour or that a new route has a
guard at all.

### T-03 · No admin-client tenant-filter test — `MISSING` (P1)

### No E2E, component, coverage, or migration tests — `MISSING` (P1–P2)
The public application flow — the one a stranger on the internet can reach — is
untested end to end.

---

## Performance & scalability

### PERF-01 · The cron sweep does not scale — `RISK` (P1)
`app/api/automations/sweep/route.ts` + `lib/automations/sweep.ts`. One
**sequential** pass over every organization, `maxDuration = 300`, every 5
minutes. A slow tenant delays every tenant behind it; at 300 s the whole sweep
dies with partial work done and no resumption. No queue, no per-org isolation,
no backpressure. `UNKNOWN` — the organization count at which this breaks.

### PERF-02 · List views truncate silently — `PARTIAL` (P2)
`lib/pipeline/queries.ts` caps at 500, `lib/applications/queries.ts` at 200.
A board with 501 applications shows 500 and says nothing.

### PERF-03 · No query plans, no bundle measurement — `UNKNOWN` (P2)
No `EXPLAIN ANALYZE` evidence anywhere. Bundle size unmeasured despite
CodeMirror plus five language packs.

### PERF-04 · Resume extraction is unbounded — `MISSING` (P2)
No timeout or memory limit around `unpdf` / `mammoth` / `word-extractor`.

---

## Functional gaps carried in `docs/Memory.md`

| Gap | Detail |
| --- | --- |
| `schedule_interview` has no trigger | The action stores and renders as a manual-trigger button, but the application-side button that opens Module 11's scheduling flow was never wired. Carried from Module 25 into Module 26. |
| No manual-trigger runner | Manual actions are stored and skipped by the engine as designed; no route executes one on demand. |
| Video Interview has no pass/fail branches | It records a written verdict, not a score, so `stageBranches("video_interview")` is false. The PASS message is attached to Director Round entry; the FAIL template is created for manual send. **Correctly not faked with an invented score.** |
| `provider.ts` ignores the per-org LLM key | The `llm` adapter stores and reports a per-organization key, but `lib/ai/provider.ts` still reads `OPENAI_API_KEY` from the environment. `getStatus()` reports this honestly rather than claiming "connected". |

---

## Documentation drift

- `README.md` lists 17 modules and shows the privacy retrofit unchecked, but
  Modules 18–26 exist in the code and privacy is partially built.
- `README.md`'s setup step names only the legacy Supabase key variables.
- `docs/QA-MANUAL-TESTING-GUIDE.md` is thorough but has no recorded run.

---

## Deliberate decisions that look like bugs

Recorded so nobody "fixes" them:

- **`/` is in the public-path allowlist.** `matches()` compiles the subtree case
  to `startsWith("//")`, which no normalised pathname satisfies, so `/` grants
  the landing page and nothing else. Pinned by `publicPaths.test.ts`.
- **The rate limiter fails open.** A database error allows the submission. The
  cost of a broken limiter is spam a recruiter deletes; the cost of failing
  closed is a real person unable to apply for a job.
- **`activity_events.entity_id` has no foreign key.** A log entry must outlive
  its subject — "this record was erased on this date by this person" is exactly
  the row that has to survive an erasure.
- **No unique constraint on one live coding session per interview.** A round
  genuinely gets re-run; a unique constraint would make the recovery path
  "delete the evidence of the first attempt".
- **`candidates."current_role"` is quoted.** `current_role` is a reserved word
  in PostgreSQL. Only raw SQL must quote it; PostgREST and TypeScript do not.
- **Nested `wait_then` actions are frozen at schedule time.** An admin editing a
  rule mid-wait must not be able to turn a queued email into a phone call.
- **`needs_review` takes neither shortlist branch.** A job with no passing mark
  has not decided anything; treating that as a fail would flag every applicant
  to every half-configured job.
