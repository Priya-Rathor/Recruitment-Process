# Deployment, CI/CD, Backups & Rollback

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

---

## 1. Target platform

**Vercel** (Next.js 16 App Router) + **Supabase** (Postgres, Auth, Storage).
Inferred from `vercel.json`, the `.vercel` entry in `.gitignore`, and the
serverless assumptions documented throughout `lib/` (notably
`lib/forms/rateLimit.ts`, which is table-backed precisely because an in-process
counter is meaningless across cold starts).

`UNKNOWN` — no Vercel project id, region, or environment mapping is recorded in
the repository.

---

## 2. Build & verify

```bash
npm install
npm run lint       # eslint 9 — must be clean
npm run typecheck  # tsc --noEmit — must be clean
npm test           # vitest — must be green
npm run build      # next build (also typechecks)
```

All four are currently clean. Bulma emits Sass deprecation warnings from its own
internals during builds; these are not caused by project code and are ignored.

---

## 3. CI/CD — `MISSING` (P0)

There is **no CI**. No `.github/`, no `.gitlab-ci.yml`, no CircleCI, no
pre-commit hooks (no Husky). Nothing runs `lint`, `typecheck`, `test` or `build`
on a push or a pull request. The four commands above are green only because they
were run by hand while writing this document.

`RISK` — the working tree at the time of this audit has **20 modified files and
16 untracked files uncommitted** (Modules 25 and 26). Whatever is deployed does
not correspond to any commit.

**Fix:** one GitHub Actions workflow, ~30 lines:

```yaml
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Use the framework's own tooling; do not add a test runner, a build orchestrator,
or a release tool to achieve this.

---

## 4. Environment variables

`.env.local.example` is the onboarding contract. A variable it omits is a
variable nobody sets.

### Required
| Variable | Purpose | If unset |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project | App refuses to start with an actionable message |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` *(or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`)* | Browser client, RLS-constrained | Same |
| `SUPABASE_SECRET_KEY` *(or legacy `SUPABASE_SERVICE_ROLE_KEY`)* | Server-only, **bypasses RLS** | Admin-client features degrade to "not configured" |
| `INTEGRATION_ENCRYPTION_KEY` (32+ chars) | Credential encryption **and** all link signing | Integrations refuse to connect; forms refuse to publish; no unsubscribe link is issued |
| **`CRON_SECRET`** | Authenticates the cron sweep | **`GET /api/automations/sweep` returns 503 forever — every time-based automation, delayed action and approval expiry silently never runs** |

### Feature-gated
`OPENAI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `BOLNA_WEBHOOK_SECRET`,
`BOLNA_BASE_URL`, `BOLNA_CATALOG_PATHS`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `EMAIL_API_URL`, `WHATSAPP_API_URL`, `APP_URL`,
`N8N_WEBHOOK_URL`.

### `FIXED` 2026-09-12 — all six are now documented
`CRON_SECRET`, `AI_MODEL`, `AI_BASE_URL`, `BOLNA_CATALOG_PATHS` and the
current-generation names `SUPABASE_SECRET_KEY` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are all in `.env.local.example`.

`CRON_SECRET` remains the dangerous one to skip: a deployment looks entirely
healthy while every delayed action is dead. Nothing surfaces it except that one
endpoint, so check it explicitly after a deploy —
`curl -i https://<domain>/api/automations/sweep` should return **401**, not 503.
A 503 means the variable never reached the deployment.

---

## 5. Database migrations — `PARTIAL`, and currently divergent

Plain SQL in `supabase/migrations/`, applied **in filename order** through the
Supabase SQL Editor or `supabase db push`. Written to be re-runnable.

### `RISK` (P0) — the bundle went stale, and three migrations were never applied

**`supabase/ALL_MIGRATIONS.sql` stopped at `0031`** while nine more had landed.
A workspace built from that bundle is missing privacy settings, forms and public
applications, voice agents, stage workflows, custom fields and the S-01 invite
fix — and every symptom looks like an application bug rather than a missing
table. **Regenerated 2026-09-12; it now carries all 40.** Regenerate it whenever
you add a migration:

```bash
python3 - <<'EOF'
import glob, os
files = sorted(glob.glob("supabase/migrations/*.sql"))
out = ["-- ALL MIGRATIONS, concatenated in order.\n\n"]
for path in files:
    out.append("\n-- " + "#" * 76 + "\n-- ## " + os.path.basename(path) + "\n-- " + "#" * 76 + "\n\n")
    out.append(open(path).read().rstrip("\n") + "\n")
open("supabase/ALL_MIGRATIONS.sql", "w").write("".join(out))
EOF
```

`docs/Memory.md` also records that **`0032`, `0037` and `0038` had not been run**
against the working database. Code that reads
`organization_settings.privacy_settings`, the stage-workflow columns on
`automations`, or `automation_delayed_actions` will fail until they are.

The product handles this as gracefully as anything can: `isSchemaOutOfDate()`
matches on error **codes** (`42P01`, `42703`, `PGRST205`, `PGRST204`) rather than
message text, so a pending migration is never confused with an RLS denial, and
the UI says *"apply the pending files in `supabase/migrations/`"*. That is good
degradation — it is not a substitute for applying them.

### `MISSING` — migration tooling
- No down-migrations, no rollback SQL.
- No applied-migrations ledger for any environment. `docs/Memory.md` is the only
  record, and it is prose.
- ~~No CI check that migrations replay cleanly from empty.~~ **Added
  2026-09-12: `./supabase/tests/replay.sh`** spins up a throwaway Postgres,
  applies a minimal Supabase shim, replays every migration one file at a time
  (so a failure names the file), then runs every `supabase/VERIFY_*.sql`. It is
  not yet wired into CI — there is no CI — but it runs in about a minute
  locally. The first run found `0030` had never been valid SQL.

**Fix:** adopt the Supabase CLI's own migration tracking (`supabase migration
list` / `db push`) rather than manual SQL-Editor paste, and add a CI job that
replays every migration against a scratch database. This is the framework's
built-in mechanism — do not build a custom runner.

---

## 6. Storage setup

Migration `0005` creates the private `resumes` bucket; `0026` creates the
private `onboarding-documents` bucket. Some Supabase projects block
`insert into storage.buckets` from the SQL Editor. If that happens, create the
bucket by hand (Storage → New bucket, **not public**, 10 MB) and re-run only the
policy statements at the end of that file.

---

## 7. Scheduled work

**`vercel.json` declares no cron.** The scheduler is
`.github/workflows/automation-sweep.yml`:

```
*/5 * * * *  →  GET https://<domain>/api/automations/sweep
                Authorization: Bearer $CRON_SECRET
```

**This is the product's only clock.** Stale-stage rules, approval expiry and the
`wait_then` delay queue all drain from this single sweep.
**Do not add a second scheduled caller** — the sweep already drains everything.

### Why it is not a Vercel cron

The **Hobby plan permits one cron invocation per day** and refuses to deploy a
finer schedule. Daily is not "slower", it is off: a 30-minute post-call wait and
a 15-minute pre-call reminder would land up to 24 hours late, silently, with
nothing logged. So the `crons` entry was removed from `vercel.json` rather than
detuned, and an external scheduler drives the same endpoint at the frequency the
product was designed for.

**On a Pro plan, put it back** — restore

```json
{ "crons": [{ "path": "/api/automations/sweep", "schedule": "*/5 * * * *" }] }
```

and delete the workflow, in that order. One clock, never two.

### Required configuration

The endpoint is unchanged; only the caller is new. In GitHub →
**Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CRON_SECRET` | byte-identical to `CRON_SECRET` in the Vercel project |
| Variable | `SWEEP_URL` | `https://<domain>/api/automations/sweep` |

Either one missing fails every run loudly rather than skipping quietly. Verify
with **Actions → Automation sweep → Run workflow**; a green run means the clock
is live. `curl -i https://<domain>/api/automations/sweep` with no header should
still return **401**, not 503.

### What this arrangement costs

- **The schedule is best-effort.** GitHub queues `schedule` events and drops
  them under load; runs are routinely 5–15 minutes late and occasionally
  skipped. Fine for a 30-minute wait, not for anything needing minute accuracy.
- **Scheduled workflows are auto-disabled after 60 days of repository
  inactivity**, silently. First thing to check if automations stop.
- **`CRON_SECRET` now exists in two systems.** Rotation means rotating both, and
  the GitHub copy is only as protected as write access to this repository.
- **The response body is never logged.** It names every organization swept and
  this repository is public; the workflow checks the status code only.

Authenticated by `Authorization: Bearer $CRON_SECRET`. No secret ⇒ `503`, never
open.

---

## 8. Backups — `UNKNOWN` (P0 to establish)

Nothing in this repository addresses backups. Supabase provides automated daily
backups on paid plans with point-in-time recovery on higher tiers, but **the
plan, the retention period, and whether PITR is enabled are not recorded
anywhere**, and no restore has ever been tested.

Storage buckets are a separate question again: object storage is **not** covered
by a Postgres backup. CVs and identity documents have no stated backup at all.

**Must establish and record:**
1. Supabase plan and whether PITR is on; the RPO this implies.
2. A **tested** restore — an untested backup is a belief, not a backup.
3. Storage bucket backup or replication for `resumes` and
   `onboarding-documents`.
4. Where encryption keys are escrowed. `INTEGRATION_ENCRYPTION_KEY` is not in
   the database; a restored database without it yields unreadable credentials
   and dead candidate links.

---

## 9. Rollback — `MISSING` (P0)

| Layer | Rollback story |
| --- | --- |
| Application code | Vercel keeps previous deployments; instant redeploy of a prior build. `IMPLEMENTED` by the platform. |
| Database schema | **None.** No down-migrations. A destructive migration is not reversible without a restore. |
| Data | Depends entirely on §8, which is `UNKNOWN`. |
| Combined | A rollback of code past a migration boundary puts old code against a new schema, with no compatibility statement anywhere. |

**Minimum safe deployment procedure** (adopt this now; it needs no tooling):

1. Verify locally: `lint`, `typecheck`, `test`, `build`.
2. **Commit.** Never deploy from an uncommitted tree.
3. Apply migrations **before** deploying code, and make them
   **backward-compatible** — additive only (new nullable columns, new tables).
   Never drop or rename a column in the same release that stops using it; split
   that across two releases.
4. Note the current Vercel deployment id as the rollback target.
5. Deploy, then trigger **Actions → Automation sweep → Run workflow** and watch
   it go green before walking away. Waiting for the `*/5` schedule proves less:
   a skipped GitHub run looks identical to a broken one (§7).
6. If rolling back: revert the Vercel deployment. Because migrations were
   additive, the old code still runs against the new schema. Remove the column
   in a later, separate release.

---

## 10. Monitoring & error handling — `MISSING` (P1)

- **No error tracking.** No Sentry, Datadog, OpenTelemetry, or equivalent in
  `package.json`. 348 `console.error` calls land in ephemeral Vercel function
  logs and are seen by nobody.
- **No alerting.** Nothing pages anyone if the cron stops, the LLM budget
  vanishes, or the webhook starts rejecting every signature.
- **No health check endpoint.**
- **No uptime monitoring.**
- **No cron failure alert** — the highest-value single alert in this system,
  because a silently dead sweep is invisible by construction.

What *does* exist and is good: consistent error shaping through `lib/api.ts`,
`formatDbError()` producing always-loggable strings, schema-drift detection by
error code, an explicit `AiResult` failure channel, `app/error.tsx` showing no
stack trace, and honest "not configured" states throughout instead of silent
failure.

`MISSING` — `app/global-error.tsx` and `app/not-found.tsx` do not exist.
