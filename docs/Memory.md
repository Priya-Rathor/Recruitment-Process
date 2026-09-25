# Memory

Running session log. Newest entries at the bottom. Read the most recent entries at
the start of a session to reconstruct context before re-reading the codebase.

Each entry: phase/task worked on · what was completed (files, migrations) ·
what's left unfinished · decisions not already captured in AGENTS.md or the
module specs. Bullets, not prose.

---

## 2026-08-30

- Set up the Memory.md protocol; this file starts here, empty.
- Protocol recorded in `AGENTS.md` ("Session memory") so every session picks it up.
- Note: `docs/Phases.md`, `Rules.md`, `Architecture.md` don't exist in this repo —
  phases live in `docs/00-build-order.md` + `docs/modules/`, rules/architecture in
  `AGENTS.md` + `README.md`. Entries reference those instead.

## 2026-08-30 (later)

**Module 25 — Stage Workflow Builder.** Unifies Modules 13/15/23/24 into a
per-stage visual builder on the job page, plus AI resume shortlisting with
pass/fail branching and internal-staff messaging.

Built:
- Migration `0037_stage_workflow_builder.sql` — `automations.{job_id, stage_key,
  branch, source}` + partial unique slot index; `automation_runs.branch`;
  `message_log.internal_recipient_user_id`; `applications.not_shortlisted_*`
  (4 cols) + a trigger clearing the flag on entry to a terminal stage.
- `lib/workflow/` — `recipients.ts` (pure), `resolveRecipients.ts` (server),
  `stages.ts` (pure), `shortlist.ts`, `queries.ts`, `options.ts`.
- Catalogue: 3 new actions (`ai_resume_shortlist`, `request_form`,
  `schedule_interview`); `start_screening_call` gained `agent_id`;
  `send_templated_message`/`request_form` gained `recipients`; MAX_ACTIONS 5→10.
- Engine: branch dispatch, job/stage/branch filtering, manual-trigger short
  circuit above the action switch.
- UI: `StageWorkflowBuilder.tsx` + `WorkflowActionEditor.tsx` on the job page.
- Routes: `PUT/GET /api/jobs/[id]/workflow`, `DELETE
  /api/applications/[id]/shortlist`.
- 39 new tests in `lib/workflow/workflow.test.ts`; suite 1607 green, lint clean,
  build passes.

Decisions worth keeping:
- **Stage workflows are automations ROWS, not a parallel system.** Provenance
  columns rather than a `stage_workflows` table — a separate table would have
  meant a second executor and a second run log to keep in step.
- **Branch lists live on Shortlisted, not Applied**, because the brief says so
  twice and because "what happens when somebody isn't shortlisted" is filed by
  meaning there. Consequence: a FAILED screen leaves the application in Applied,
  so `dispatch()` needed `branchStage` to override the stage filter.
- **Applied wires to `application_created`, not `application_stage_changed`** —
  nothing ever "changes stage into" Applied, so the obvious wiring would have
  produced a rule that validates, activates, shows green and never fires.
- **`needs_review` takes neither branch.** No threshold configured or no score =
  no decision. Treating it as a fail would flag every applicant to every
  half-configured job.
- **Not Shortlisted is a flag, never a stage.** Application keeps its stage and
  its board card; reversal is one UPDATE to NULL. 8-stage structure untouched
  (asserted in `workflow.test.ts`).
- **"Notify internal team" is a recipient option, not an action type** — the
  brief's own instruction, and it keeps one templating system. Internal sends
  skip the candidate opt-out and the unsubscribe footer; WhatsApp-to-colleague is
  refused loudly (no phone column on `users`, and falling back to the
  candidate's number would deliver internal mail to the candidate).
- Dropped `automations_organization_id_name_key` for two partial indexes: a
  generated workflow name collides across jobs otherwise.

Unfinished / follow-ups:
- Migration 0037 is **written but not applied** — 0032 is also still unapplied on
  this database (`organization_settings.privacy_settings` missing). Both need
  running in the Supabase SQL Editor.
- `schedule_interview` stores and renders as a manual-trigger button but the
  application-side button that opens Module 11's scheduling flow is not wired.
- The manual-trigger runner (a route that executes one manual action on demand)
  is not built; manual actions are stored and skipped by the engine as designed.

## 2026-08-30 (later still)

**Module 26 — Default Recruitment Flow + two new primitives.**

Built:
- Migration `0038_default_recruitment_flow.sql` — `automation_delayed_actions`
  (the wait queue) + a `before update of stage` trigger on `applications` that
  cancels pending waits; `organization_settings.office_address`.
- `lib/workflow/delay.ts` (pure), `delayQueue.ts` (server), `formAnswers.ts`,
  `defaultFlow.ts`, `applyFlow.ts`.
- Catalogue: `wait_then` action with nested actions; `surface_field_key` /
  `surface_label` on `request_form`.
- Engine: `wait_then` handler (schedules only, never executes);
  `executeQueuedActions()` for the sweep to call.
- Sweep: `drainDueActions()` pass added to `sweepOrganization`.
- **`vercel.json` cron raised from hourly to `*/5 * * * *`.**
- UI: `ApplyFlowTemplate.tsx`, `WaitEditor` inside `WorkflowActionEditor`,
  `SurfacedAnswers.tsx` on the application page, office address field in
  Settings → Organization.
- Route: `POST /api/jobs/[id]/workflow/apply-template`.
- 36 new tests in `lib/workflow/defaultFlow.test.ts`; suite 1643 green.

Decisions worth keeping:
- **The delay reuses the ONE existing clock.** No new cron, endpoint, worker or
  timer — `drainDueActions()` is a pass inside `sweepOrganization()`. The cron
  FREQUENCY had to change (hourly → 5 min) or a 30-minute wait would fire 30–90
  min late and a 15-min reminder would arrive after its call.
- **Cancellation is a DB trigger, not a poll.** In the trigger the move and the
  cancellation are atomic; in the sweep they would race. The trigger only cancels
  waits whose `stage_at_schedule` matches the stage being LEFT — otherwise a pass
  branch that both moves and waits would cancel its own wait.
- **Nested actions are frozen at schedule time**, so an admin editing a rule
  mid-wait can't turn a queued email into a phone call.
- **No session-only action may be nested in a wait** — the sweep drains with the
  service-role client; RLS would deny it 30 min later with nobody watching.
- **Form answers surface BY REFERENCE.** No column, no table, no copy: the
  `request_form` action stores a pointer (`surface_field_key` + `surface_label`)
  and `loadSurfacedAnswers()` reads `form_responses.raw_answers` at render time.
- **Availability forms use `radio`, not a calendar** — checked
  `lib/forms/fields.ts` first; Module 18 has no time picker and `date` loses the
  time. Options are windows ("Weekday mornings"), not timestamps that go stale.
- **Applying the flow is idempotent by NAME for templates/forms and never
  overwrites existing copy**; it DOES replace the job's stage lists (confirmed
  in the UI first).
- Everything ships off: templates inactive (column default, not overridden),
  forms draft, automations draft.

Known gap, reported to the user:
- Video Interview has **no pass/fail branches** — it records a written verdict,
  not a score, so `stageBranches("video_interview")` is false. The PASS message
  is attached to Director Round entry (where it genuinely fires); the FAIL
  template is created for manual send. Not faked with an invented score.

Unfinished:
- Migrations **0032, 0037 and 0038 are all still unapplied** on this database.
- `schedule_interview` still has no application-side button (carried over from
  Module 25); the Video Interview list places the manual action but nothing
  renders its trigger yet.

## 2026-08-30 (documentation foundation)

**No application code changed.** Full-repo audit + production documentation set.

Written:
- `docs/{PRD,ARCHITECTURE,DATABASE,API,SECURITY,PRIVACY,TESTING,DEPLOYMENT,
  PRODUCTION_READINESS,KNOWN_ISSUES,PRODUCTION_AUDIT}.md`
- `AGENTS.md` rewritten — existing architecture rules kept verbatim, plus the
  14 non-negotiable security rules, the 10 code-quality rules, and the 11-step
  AI coding workflow.

Verified during the audit (ground truth, not inference):
- `npm test` 1643/1643 green · `typecheck` clean · `lint` clean.
- 105 API routes; **all** call a tenant helper except the 5 intentionally public
  ones (apply-submit, 3 coding-token routes, bolna webhook).
- RLS enabled on all 51 tables; ~198 indexes; ~64 functions/triggers.
- No secrets in git; no `dangerouslySetInnerHTML`; no `eval`; no `console.log`.

New findings worth acting on (full detail in `docs/PRODUCTION_AUDIT.md` §8):
- **S-01 (P0)** `accept_invite` never compares the invite's email to the
  accepting user's, and ends `on conflict … do update set role = excluded.role`.
  A forwarded invite token = joining with that role; an existing member
  presenting an admin token escalates themselves.
- **P-01 (P0)** `lib/privacy/retention.ts` has **zero callers** — retention is
  configured and displayed but never executed. The Security page says "nothing
  is deleted yet"; the Privacy page, where it is configured, does not.
- **S-07 (P1)** rate limiting exists on one endpoint only; the 3 public coding
  routes (one autosaving) and ~30 AI endpoints are uncapped.
- **S-04 (P1)** no prompt-injection boundary, and `shortlist.ts` branches on the
  LLM score with no human in the loop.
- No CI, no error tracking, no verified backups, no security headers.
- `CRON_SECRET` is undocumented in `.env.local.example` — unset means the sweep
  is a permanent 503 and no time-based automation ever fires.

Still true from previous sessions: migrations **0032, 0037, 0038 unapplied**.

## 2026-09-06 (Module 27 — Custom Fields)

Built the whole module. `npm test` 1707/1707 green · typecheck clean · lint clean
· `next build` compiles.

**Numbering:** the brief said "Module 19", which is Onboarding & Documents
(migration 0026). Took 27, the next free. The brief's "Module 18's form_fields"
is actually Module 23 (0033) — right taxonomy, wrong number, no code impact.

Created:
- `supabase/migrations/0039_module27_custom_fields.sql` — **unapplied** (see below)
- `lib/customFields/{definitions,values,queries,publicForm,publicFormQueries,placeholders}.ts`
  + 4 test files (62 new tests)
- `app/api/custom-fields/definitions/route.ts`, `definitions/[id]/route.ts`,
  `values/route.ts` (PUT + GET)
- `app/settings/custom-fields/{page,CustomFieldsManager,FieldEditor}.tsx`
- `components/{CustomFieldsSection,CustomColumns,FieldInput}.tsx`
- `docs/modules/27-custom-fields.md`

Changed: settings catalog (+ its pinned counts), job page/form/new/edit,
candidate form/new/detail, applications page (table extracted to
`ApplicationTable.tsx`), candidates page/list, templates page/library/editor,
HiringStages + StageConfigModal, StageWorkflowBuilder + WorkflowActionEditor,
`lib/forms/{public,submit}.ts`, `lib/hiring-stages/placeholders.ts`.

Decisions worth keeping:
- **`field_type` is `public.form_field_type`**, Module 23's existing enum — not a
  new one. `CUSTOM_FIELD_TYPES` is `FORM_FIELD_TYPES.filter(...)`, derived so a
  new forms type cannot be silently missed. email/phone/file_upload excluded.
- **Reserved keys live in BOTH the migration and TS**, and
  `definitions.test.ts` parses the SQL to assert they match. The DB copy is the
  real boundary (PostgREST); the TS copy is so the editor can say "reserved"
  while somebody is still typing.
- **`custom_field_values.organization_id` added** (not in the brief's schema):
  RLS + rule 8 need it. A trigger checks it against the definition.
- **One permitted entity_type mismatch**: a `show_on_public_form` job definition
  carries `application` values. Encoded in the integrity trigger, nowhere else.
  This is the brief's "confirm this distinction is handled correctly".
- **`TOKEN_PATTERN` widened** to 2-or-3 segments + digits. Backward-compatible;
  unknown tokens still render verbatim. `{{custom.<entity>.<key>}}`.
- **A public-form job token prefers the APPLICATION's answer**, job value as
  fallback — the message is written to the candidate.
- **`FieldInput` extracted** from `app/apply/[token]/ApplyForm.tsx` to
  `components/FieldInput.tsx` and reused. Moved, not copied: a job field on the
  public form is rendered by both paths, and two renderers would drift.
- **Custom columns**: definitions server-loaded, VALUES fetched client-side via
  `GET /api/custom-fields/values`. Because the candidates table swaps rows on
  client-side search, a preloaded map would render "—" for every search result —
  a lie about the data rather than a gap in it.
- **Column choice is per-viewer localStorage**, read via `useSyncExternalStore`
  (React 19 lint forbids setState-in-effect; the loading flag is derived from an
  answered-key, not stored).
- **Settings card went under "Data & activity", not "Recruitment defaults"** —
  that category was at the 3-item cap `catalog.test.ts` enforces.
- **DELETE soft-deletes**; permanent erase refused server-side if any value
  exists. Brief's "re-add with the same key" reworded to "turn it back on",
  which is what soft delete actually does.

Unfinished / carried:
- **Migration 0039 is UNAPPLIED**, along with 0032, 0037, 0038. The Supabase
  project (`jjcwwotdkoojqdifwdwx`) is NXDOMAIN — paused or deleted — so nothing
  could be applied or exercised against a real database this session. All
  verification was typecheck/lint/vitest/build only.
- `supabase/RESET_DATA.sql` written earlier this session (wipe data, keep
  schema); also unrun for the same reason.
- `supabase/ALL_MIGRATIONS.sql` is stale — stops at 0031, missing 0032-0039.

## 2026-09-12 (pre-deploy verification + security headers)

Goal was a Vercel deploy. Verified first, fixed two real gaps, found one blocker.

**Green, all re-run from clean:** `lint` clean · `typecheck` clean · `npm test`
1785/1785 across 72 files · `next build` compiles, 60+ routes.

Also smoke-tested the PRODUCTION build (`npm start`), not just the build:
- all five new security headers present on `/login`
- `/dashboard` signed out → 307 `/login?next=%2Fdashboard`
- `GET /api/jobs` signed out → **401 JSON**, not a redirect (TC-AUTH-028 holds)

**THE BLOCKER — the Supabase project in `.env.local` no longer exists.**
`jjcwwotdkoojqdifwdwx.supabase.co` returns **NXDOMAIN** from both the local
resolver and 8.8.8.8, while `supabase.com` resolves and outbound HTTPS works
(github.com → 200). So it is a dead project, not a network problem. Nothing
database-backed can run until a new project is created and **all 39 migrations**
are applied in filename order. This also makes the old "0032/0037/0038/0039 not
applied" note moot — a fresh project needs every file.

**Fixed:**
- `next.config.ts` was empty → now sends `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS (2y, subdomains, **no
  preload** — preload is the domain owner's call and is irreversible), and
  `Permissions-Policy` denying camera/mic/geo/payment/USB. Verified by curl.
  **No CSP**, deliberately: inline styles throughout the design system, next/font
  and CodeMirror mean a policy worth having needs `unsafe-inline` for styles, a
  nonce pipeline and an origin audit. A wrong CSP breaks production silently.
  KNOWN_ISSUES entry downgraded P1 → P2 and rewritten to say exactly that.
- `.env.local.example` gained the six undocumented variables — `CRON_SECRET`
  (with the "nothing time-based ever fires" consequence written into the file),
  `AI_BASE_URL`, `AI_MODEL`, `BOLNA_CATALOG_PATHS`, and the current-generation
  Supabase key names beside the legacy pair.

**Noticed, not fixed (no scope to):**
- `docs/DEPLOYMENT.md` §7 claims the sweep's bearer secret is "compared in
  constant time". It is a plain `!==` in `app/api/automations/sweep/route.ts:46`.
  Either the doc or the code should move; `crypto.timingSafeEqual` is ~3 lines.
- S-01 (invite tokens not identity-bound, P0) is still open. Deploying a
  multi-tenant product with a known privilege-escalation path is a decision, not
  an accident — flagged to the user rather than silently shipped.

**Unrelated, still unfinished:** the documentation centre (Module 25). `lib/docs/*`
and `docs/QA-SUPPLEMENT-MODULES.md` are committed and tested (78 new tests), but
**no `app/docs/` UI exists yet**, so none of it is reachable and nothing imports
it. It is inert — safe to deploy, but it is half a module.

## 2026-09-12 (S-01 fixed — invite tokens bound to identity)

`supabase/migrations/0040_bind_invite_to_identity.sql`. **Written, NOT applied**
— the Supabase project is gone (see the entry above), so nothing has executed
this. It is reviewed, not proven.

**The fix, two parts:**
1. `accept_invite()` compares the invite's email to the caller's, raising a
   custom `INV01` before writing anything — a refusal leaves the invite
   `pending` so a forwarded link cannot become a denial of service against the
   real recipient.
2. `on conflict … do update set role = excluded.role` is gone. Three explicit
   branches: new member inserts; **already-active member keeps their role**
   (this was the escalation half); removed member rejoins at the invite's role.

**THE DECIDING DETAIL — read auth.users, never public.users.** `users_update_self`
(0001) has no column restriction and the browser holds a PostgREST client, so
any user can `update public.users set email = '<the invited address>'` on their
own row. A check against the profile table would have looked right and done
nothing. `VERIFY_0040.sql` check 3 is that exact attack.

**Had to touch 0036's trigger.** `prevent_self_role_change` fires `before update
of role`, and the rejoin branch changes the accepting user's own role — a Viewer
re-invited as Admin would have been refused on a legitimate link. Exempted
`old.status='removed' → new.status='active'` only. Not a hole:
`org_members_update_owner_admin` needs `has_org_role()`, which needs an ACTIVE
row, and there is at most one row per (org, user) — so a member whose own row is
removed cannot reach that transition through PostgREST at all.

**Error mapping is a pure function** (`lib/invites/acceptErrors.ts`, 4 tests),
matched on SQLSTATE rather than message text. The mismatch case is told plainly
— the reader already holds a valid token, so genericising teaches them nothing
and costs them the one fact they need — but it never names the invited address.
Everything else stays one indistinguishable sentence.

**Backward-compatible on purpose:** the old function never raises `INV01`, so the
route is correct against both. Migration and deploy can happen in either order,
though the hole stays open until 0040 runs.

**Also regenerated `supabase/ALL_MIGRATIONS.sql`** — it had stopped at 0031 while
nine more landed. Anyone building a workspace from that bundle got a database
with no privacy settings, forms, voice agents, workflows or custom fields, and
every symptom would have looked like an application bug.

`lint` clean · `typecheck` clean · **1789/1789** · `build` compiles.

**Still to do:** run `supabase/VERIFY_0040.sql` against a real database. Six
checks, self-cleaning, rolls back. Until it has run, S-01 is fixed-by-reading.

## 2026-09-12 (S-01 VERIFIED on a real database — and a migration that never worked)

Started Rancher Desktop, ran Postgres 16 in Docker, wrote a minimal Supabase shim
(auth.users, auth.uid(), storage.buckets/objects/foldername, the three roles) and
replayed the migration set. S-01 is no longer fixed-by-reading.

**FOUND: `0030_module15_candidate_messaging.sql` was never valid SQL.** A 4-byte
truncated file containing the word `writ`. `0035` was written later as the real
Module 15 schema and its header even documents the truncation — but 0030 was left
in place, so **any replay from empty died there and took 0031-0040 with it**:
live coding, privacy, forms, voice agents, workflows, custom fields, and the S-01
fix. A new Supabase project built from this repo was broken and nothing said so.
This would have hit the Vercel deploy squarely. Replaced its body with a comment
pointing at 0035; number kept, because filename order is apply order and a gap
invites "was something lost?".

**All 40 migrations now replay cleanly from empty. First time that has ever been
true here.**

**S-01, measured rather than argued** — and the audit was half wrong:

| | Pre-0040 | Post-0040 |
| --- | --- | --- |
| Stranger with a forwarded token joins as admin | **WORKED** | refused (INV01) |
| Existing member re-grades self via the invite | already blocked | still blocked, deliberately |

The second half had been closed since **0036** (`prevent_self_role_change`),
which was written for an unrelated reason — an Admin demoting themselves on the
Team page. So the escalation was never live after 0036; the identity hole was,
and it was the serious one. Proved by restoring 0001's function *and* 0036's
trigger and running both probes. SECURITY.md §S-01 corrected to say this.

Still worth removing from accept_invite: the block was incidental, the error was
wrong ("You cannot change your own role" when nobody was trying to), and anyone
relaxing 0036 later would have silently re-opened it.

**Negative control done** — VERIFY_0040.sql fails with exactly the right message
against the original function, so the test is not vacuous.

**Added `supabase/tests/replay.sh` + `supabase_shim.sql`** — closes the "no CI
check that migrations replay cleanly" gap DEPLOYMENT.md had carried for months.
Runs every migration one file at a time (a failure names the file) then every
`supabase/VERIFY_*.sql`. ~1 minute, self-cleaning. Not wired to CI; there is no CI.

`lint` clean · `typecheck` clean · 1789/1789 · containers removed.

---

## 2026-09-13

**Vercel deploy was failing on the cron schedule.** Hobby plan permits one cron
invocation per day; `*/5 * * * *` is rejected at deploy time, so nothing shipped.

- First pass: `vercel.json` schedule `*/5 * * * *` → `0 0 * * *`. **Superseded
  the same day** — see below. Kept in the log because the reasoning for why
  daily is unacceptable is the reason the second pass exists.
- **This makes time-based automation non-functional, not merely slower.** The
  sweep is the only clock, so `wait_then` delays, stale-stage rules and approval
  expiry are all up to 24h late. The 15-minute pre-call reminder and 30-minute
  post-call wait in the default flow are dead on this schedule. Nothing errors —
  it just never happens on time, which is the failure shape DEPLOYMENT.md §10
  already calls invisible by construction.
- Recorded as `KNOWN_ISSUES.md` **B-05** (`RISK`); DEPLOYMENT.md §7 rewritten
  with the three exits (Pro plan → restore `*/5`; external scheduler hitting the
  endpoint with `CRON_SECRET`; or daily + say so in the UI, pilot only);
  AGENTS.md "One clock" annotated so the next agent doesn't read `0 0 * * *` as
  intended design and build on it.
- Rejected: deleting the cron entry entirely. The sweep is load-bearing —
  removing it turns "late" into "never" and orphans the delay queue rows.
- Rejected: a second cron / a worker / an in-process timer. Same rule as before,
  and the plan limit is per-account anyway.

**Second pass — the cron left Vercel entirely.** Daily was accepted as a deploy
unblocker, not as a design. Replaced with:

- **`vercel.json` is now `{}`** — the `crons` entry removed outright, not
  detuned. Hobby deploys fine with no cron at all. Chose an empty object over
  deleting the file: Vercel rejects unknown top-level keys, so the "why" could
  not live in a `//` comment there, and a deleted file leaves no anchor for the
  doc cross-references.
- **`.github/workflows/automation-sweep.yml`** is the clock: `*/5 * * * *` →
  `GET $SWEEP_URL` with `Authorization: Bearer $CRON_SECRET`. No checkout,
  `permissions: {}`, `concurrency` group so a late run cannot overlap the next.
- **No application code changed.** The route already authenticated by shared
  secret and never cared who called it. Only the header comment naming "Vercel
  Cron" was corrected.
- **The workflow prints the status code and never the body.** `runCronSweep()`
  returns `organizationName` for every tenant swept, and this repo is public —
  Actions logs are world-readable. Checked repo visibility before writing it;
  that is the whole reason for `--output /dev/null`.
- Distinct exit codes per status (401 = secret mismatch, 503 = endpoint
  unconfigured) so a red run says which of the two systems is wrong.

Requires manual setup before it does anything: repo **secret** `CRON_SECRET`
(matching Vercel) and repo **variable** `SWEEP_URL`. Missing either fails the
run loudly rather than passing vacuously.

Caveats recorded in KNOWN_ISSUES B-05, not solved: GitHub's schedule is
best-effort (5–15 min late under load, sometimes skipped); scheduled workflows
auto-disable after 60 days of repo inactivity; `CRON_SECRET` now lives in two
systems. Correct fix remains Vercel Pro → restore the `vercel.json` cron →
delete the workflow, in that order.

**Noticed, not changed:** `docs/API.md` claimed the `CRON_SECRET` check is a
constant-time compare; `route.ts:47` uses `!==`. Corrected the doc rather than
the code — the code change was outside what was asked, and a timing oracle on a
bearer token over HTTP is not a practical attack. Worth doing anyway if anyone
is in there: the file already imports nothing from `node:crypto`, and
`lib/integrations/` has the constant-time helper pattern to copy.

**Auth emails were linking to `localhost:3000` in production.** Not a code bug —
the three auth forms all build `emailRedirectTo`/`redirectTo` from
`window.location.origin`, which is correct. Supabase drops a `redirect_to` that
is not on the **Redirect URLs** allow-list and silently falls back to the
project's **Site URL**, still `http://localhost:3000` on a new project. No error
is raised at any layer; the first sign it is wrong is a candidate staring at
ERR_CONNECTION_REFUSED.

Fix is dashboard-only (Authentication → URL Configuration): Site URL = the
production domain, Redirect URLs = `https://<domain>/**` plus
`http://localhost:3000/**`. Documented as DEPLOYMENT.md §6.1 — the repo had this
nowhere; the only mention of redirect URLs was a local-dev aside in the QA guide
(§Recommended setup, step 5), which is why it was missed at deploy time.

Worth knowing for support: an email already sent cannot be repaired by fixing
the setting, because `redirect_to` is baked into the link. If the signup
happened on the production origin, editing the host in the address bar works
(the PKCE verifier cookie lives on that origin); otherwise `npm run dev`. One
attempt — the code is single-use.

---

## 2026-09-20

**WhatsApp inbox — the inbound half of Module 15.** Built the two-pane
`/messages` inbox and, underneath it, the webhook this product never had. Until
today message_log was a one-way pipe: what we said, never what they said back.

**Migration 0041** (`supabase/migrations/0041_whatsapp_inbox.sql`), replays
clean from empty — 41/41 — with `supabase/VERIFY_0041.sql` proving six schema
guarantees no unit test can reach. Bundle regenerated.

- `whatsapp_conversations`, keyed on **(organization_id, phone_number)**, not on
  the candidate. The number is all Meta gives us and all that exists when a
  stranger texts in; `candidate_id` is an annotation, nullable, filled by the
  matcher or by a human. Keying on the candidate would have left nowhere to put
  an unmatched message, which is the case the table mostly exists for.
- `message_log` **extended, not duplicated**: `direction` (default `outbound`,
  which is the correct backfill) and `conversation_id`. A second table would
  have made every "what passed between us and this person" read a UNION that
  two future authors write differently, one of them forgetting organization_id.
- **`message_log_has_a_subject` relaxed** to admit a conversation. An unmatched
  inbound message has no candidate AND no application; the constraint's real
  invariant — every row is reachable from some page — is unchanged.
- `'received'` added to `message_status`. Not `'delivered'`: every existing
  status describes how far something WE sent got, and a green "Delivered" chip
  on a candidate's own reply reads as a claim about our sending.
- Idempotency is a **partial unique index**, inbound only. Outbound cannot join
  it because `sendWhatsApp()` stores the literal `'unknown'` when Meta returns
  no id — a unique index over outbound would fail the second such send, i.e. a
  message that had already reached a real person. (That `'unknown'` fallback is
  still worth fixing; not touched here.)
- `bump_whatsapp_conversation()` RPC: one statement, because read-count-add-one
  loses a message when Meta delivers a batch. `last_message_at` only moves
  forward (`greatest`), so a redelivered old event cannot reorder the inbox.
  NOT security definer — the org id is a filter, not the authorisation.

**Tenancy from `phone_number_id` — the only place this product resolves a tenant
from something in a payload.** It is a lookup key into
`organization_integrations` (a table only we write), not a claim; organization_id
comes off our row, same shape as the Bolna webhook finding a screening_call by
the id we generated.

**The body is parsed BEFORE the signature is verified**, and that needs stating
because it looks wrong. The app secret can be per-organization, and the only
thing naming the organization is inside the body. Nothing is written and no
candidate table is read until `verifyWebhookSignature()` returns true; an
unsigned request costs one indexed SELECT.

**Per-org app secret + env fallback**, rather than env only. Meta's app secret
belongs to a Meta app: one app per deployment (Tech Provider model) → env; an
org that brought its own app → its own secret, encrypted beside the access
token. Env-only would have silently rejected tenant #2's every reply. The verify
token stays deployment-wide — the GET handshake carries nothing to resolve a
tenant from, so there is no choice there.

**STOP list deliberately shorter than the industry one.** No CANCEL/END/QUIT:
all three are plausible replies to "shall I book you in for Thursday?", and an
opt-out is effectively irreversible by the candidate (the unsubscribe token
cannot re-subscribe). Whole-message match only — "please stop by the office at
3" is not an opt-out. Tested both directions.

**Outbound messages join the thread too**, attached in `sendOnChannel()` — the
one place every send passes through — so an automatic template, a manual
compose and an inbox reply all land in one timeline without knowing the inbox
exists. Without it the thread would show the candidate's half and the replies
typed here, and a recruiter would read "nobody told them" off true rows.
**Skipped sends deliberately get no conversation_id**: the inbox is what passed
between us and a person, and "we decided not to say this" belongs in the log.

**The reply route sends nothing.** It resolves the recipient and calls
`sendOnChannel()`. Two enforcement decisions worth keeping:

- opt-out and role are OURS → enforced server-side (409 + `acknowledge_opt_out`,
  the same two-step the compose panel uses);
- the 24-hour window is META's, judged from our own `last_inbound_at` → NOT
  enforced server-side. A webhook delivery we dropped would make a repliable
  thread look closed and turn our bug into the recruiter's dead end. The
  composer greys out as guidance; the adapter surfaces Meta's own answer.

**Replying needs a linked candidate** (409 `unlinked_conversation`). Everything
`sendOnChannel()` does is anchored to one — whose opt-out to check, whose
history to file it under. Messaging a number we cannot attribute would mean
sending to somebody whose opt-out we are structurally unable to honour.

**Recruiter scoping is a SCOPE, not a boundary, and the code says so.** Same
rule as `getBoard()`, applied in the query; both tables grant SELECT to every
member. Unmatched threads are shown to recruiters too — nobody owns them, and
hiding them from the people most likely to recognise the number means they are
never linked.

- **Nav:** ninth item, back to the width measured as fitting 1440px exactly.
  Badge counts THREADS, null on a failed read (never a fake 0).
- **Polling, not Realtime.** 15s, paused on a hidden tab. A websocket would
  authenticate the browser directly against message_log, whose whole design is
  that no browser writes it; polling a scoped route reuses the boundary that
  exists.
- **Delivery/read receipts now real.** Meta's status callbacks map
  sent→delivered→read(`opened`), ranked so out-of-order arrivals cannot move a
  message backwards. 0035's "`opened` — email only; WhatsApp gives us no read
  signal we trust" was only true because nothing was listening.

`lint` clean · `typecheck` clean · `build` clean · 1826/1826 (+37) · migrations
41/41 · VERIFY_0040 and VERIFY_0041 both pass.

**Not done, deliberately:** text messages only (an image/location is counted and
logged, not stored as a blank bubble); no inbound for email; re-linking a
already-linked thread is refused rather than offered (it would move the record
of what was said onto a different person).

**Noticed, not changed:** `lib/notifications/queries.ts` contains a byte that
makes `grep`/`file` treat it as binary (`grep -a` works). Harmless to the build;
confusing to search.

---

## 2026-09-20 (second session)

**WhatsApp auto-reply agent** — an AI that answers candidate messages from their
real application data. Built on top of the same day's 0041 inbox.

**Migration 0042**, replays clean (42/42) with `supabase/VERIFY_0042.sql` proving
seven schema guarantees. Bundle regenerated.

**Treated as the highest-stakes AI surface in the product, and the schema carries
that rather than the prose.** Every other lib/ai/ function produces something a
human accepts or discards — the platform's Raw Data → AI → Validation → HUMAN
REVIEW → Business Action has a person in the middle. This one does not, and **a
WhatsApp message cannot be unsent**. So:

- `organization_settings.auto_reply_master_enabled` **DEFAULTS FALSE**. Applying
  a migration must never be able to start messaging candidates. Proved in
  VERIFY_0042 check 1.
- A separate boolean from `auto_reply_config.enabled`, deliberately not a
  duplicate: collapsing them would make the fastest way to stop the agent
  "go and edit its settings".
- `message_log.auto_replied` on the row, so the UI labels it from data rather
  than inference. Three distinct authorship labels now: a name (colleague),
  "Auto-reply" (agent), "Automatic" (templated send).
- `whatsapp_conversations.needs_human` + reason + timestamp. An agent that
  declines and tells nobody silently drops candidates.

**SIX GATES, every one able only to stop a message** (lib/autoReply/run.ts):
master switch → linked candidate → 30-min human cooldown → config precedence →
deterministic escalation guard → the model and its own refusal. Every gate is
**re-checked at send time**, which is what makes the kill switch stop replies
that were already queued half an hour ago.

**The deterministic escalation guard is the AGENTS.md rule with teeth.** "Where a
model's output feeds an automated branch, require a deterministic signal to agree
with it" — nothing else here sends model output to a person unreviewed. Keyword
guard runs BEFORE the model, so a salary question never reaches it; the model is
*also* asked to escalate; either saying escalate escalates. Asymmetric on
purpose: a false escalation costs 30 seconds, a false confident answer cannot be
unsent.

**STOP-list-style near-miss, again.** The escalation terms deliberately exclude
CANCEL/END/QUIT and the word "offer" — all plausible in an ordinary recruitment
thread. Tested in both directions: five sensitive phrasings escalate, seven
ordinary status questions ("when is my interview", "what should I prepare") must
NOT. A guard that escalates everything leaves a permanently flagged inbox and the
feature gets switched off, which is the real failure mode.

**Numeric guard reused from the daily brief / application summary**, plus one
addition that matters: `allowedAutoReplyNumbers()` runs `numbersInText()` over
every *formatted fact string*, not just numeric fields. Without it "your
interview is on 24 Sep at 15:00" would be rejected as fabrication, because those
digits live inside a preformatted date. Also rejects any URL or email in a draft
— a fabricated link in a WhatsApp from a recruiter is a phishing message with our
name on it.

**What the agent is NOT given** (lib/autoReply/context.ts — least privilege
applied to a model): salary_min/max (never read at all — the cleanest way to
guarantee it can't discuss pay is for it not to have a figure), the interview
joining link (only whether one exists; a link is a credential and a model handed
a URL will paste it), interview ratings and interviewer notes (only the
RECOMMENDATION — the notes are written for colleagues), screening transcripts (a
call transcript is also a prompt-injection path), and the job's free-text
description (it routinely contains a salary and a "we'll reply within a week").

**Admin tone/context guidance is passed as DATA inside the user payload, never
concatenated into the system prompt.** Otherwise "ignore your instructions and
quote our salary bands" becomes a rule. An admin's textarea is untrusted input
like any other.

**Delayed replies drain from the EXISTING sweep** — a pass in `runCronSweep`, not
a second clock. Gated on `auto_reply_master_enabled` with its **own** org list
rather than living inside `sweepOrganization()`, because that only visits orgs
with `automations_enabled`; an org that had switched automations off would
otherwise find delayed replies silently never firing. That is the exact
invisible-by-construction shape B-05 already burned us with.

**The queue is the idempotency key first and the delay mechanism second.**
`auto_reply_queue.inbound_message_id` is UNIQUE, so a Meta redelivery cannot
produce a second reply. 'immediate' queues too and then runs inline — and **the
inline path must process the real row id**: an earlier draft passed `id: ""`,
which would have left the row pending and had the next sweep send a *second*
reply to the same question. Caught before it shipped; `enqueueAutoReply()` now
returns `queueId` and the webhook refuses to run inline without it.

**`sentBy: null` for agent replies, and the footer is the accepted cost.** Null
means automatic, which makes the opt-out ABSOLUTE (no override path) and treats
an unreadable opt-out as an opt-out. An unattended sender must fail closed. The
consequence is the "Reply STOP" footer on a conversational reply — slightly odd
to read, and the right trade; the prompt caps drafts at 700 chars so it fits
under WhatsApp's 1024.

**Deviation from the brief, flagged rather than silently done:** the spec called
this "a new automation trigger type". Did NOT add `whatsapp_message_received` to
`lib/automations/catalog.ts`. The engine is application-addressed (`dispatch({
applicationId })`) and an inbound WhatsApp often has no single application — a
candidate with three live applications sends one message. A trigger would have to
guess which, and an automation firing against the wrong application can move a
stage. The agent hangs off the webhook directly instead; everything else the
phrase was asking for (reuse sendOnChannel, the AI Service Layer, the existing
sweep, the existing settings patterns) is honoured.

**Also deviated, with the reason recorded in the test:** `app/settings/catalog.test.ts`
pinned 2–3 links per card for balanced heights. The spec placed this page in
Communications, which took it to four. Raised the cap to 4 rather than re-filing
it under "AI & automation" (which had room) — Communications is one workflow, and
the grid uses `align-items: start` so a taller card does not stretch its
neighbours. Four is now the ceiling, not an invitation.

`lint` clean · `typecheck` clean · 1864/1864 (+38) · migrations 42/42 ·
VERIFY_0040/0041/0042 all pass.

**Owed from the 0041 session and now paid:** `webhookHandshakeMatches()` had no
test because Next 16 refuses a second dev server in the same directory, so the
correct-verify-token path could not be exercised locally without restarting the
running server. Five unit tests now cover it, including the whitespace-only-token
and no-token-configured cases.

---

## 2026-09-20 (third session)

**FULL THEME REPLACEMENT: "Future Workforce".** Not a patch — the previous theme
is gone, and `app/theme.test.ts` (new, 17 assertions) fails the build if any of
it comes back.

**Tokens.** `app/globals.scss` `:root` rewritten end to end. Given values used
verbatim: deep space `#0a1128`, periwinkle `#8b9eff`, white `#ffffff`, mint
`#7fe7c4`, lavender `#c6b8ff`. Radius 10/12/16px. Soft-glow elevation, no hard
shadow anywhere. Space Grotesk headings, Plus Jakarta Sans body.

**DARK IS NOW THE DEFAULT, which is a reversal.** The old theme actively FORCED
light (`color-scheme: light` plus pinned Bulma vars) because its tokens were
light-only and Bulma's auto-dark flipped underneath them. That whole block is
replaced: tokens are dark, so Bulma and the design system agree by default.
Light is a designed counterpart under `prefers-color-scheme: light` with every
role re-declared — not an inversion. No toggle, because none was asked for and
there is no switcher in the product.

**THE FINDING THAT SHAPED THE COMPONENT LAYER.** Computed, not eyeballed:
white on periwinkle is **2.49:1**, on mint 1.49:1, on the warning amber ~1.4:1.
All three are what you reach for on a filled button. Deep space on those fills
gives 7.50 / 12.57 / 10.41:1. So `--color-on-accent` exists and **flips per
mode** (deep space on dark, white on light) — a component hard-coding either is
wrong in one mode. Fixed ~14 sites that said `color: #fff` on an accent or
status fill, including Bulma's own `.button.is-primary` (Bulma derives its
invert at build time and was choosing white for a light accent).

**Accent hover goes LIGHTER, plus a glow.** On a dark ground "darker" reads as
disabled — the inverse of the old rule, and exactly the kind of thing that
survives a rebrand by accident.

**Charts: orbital where it is also CORRECT, linear where it is not.** Loaded the
`dataviz` skill first. Split by data job:
- ratio against a limit → new `OrbitalMeter` (radial arc, hero number inside).
  Replaced three `BarChart` rate usages; `rateBar()` → `rateMeter()`. A rate in
  a relative-scaled bar made 40% next to 45% look nearly full.
- ordered part-to-whole → `FunnelChart` as **concentric orbits**, every ring
  starting at 12 o'clock so the comparison is end-angle against a common
  origin, every ring direct-labelled. That shared start angle is what makes a
  radial funnel legitimate where a pie is not.
- **magnitude across unordered categories stayed LINEAR** ("days in stage",
  "candidates by source"). Arcs at differing radii compare badly and a longer
  arc at a smaller radius can be the smaller value; the skill's anti-pattern
  list names it outright. Restyled instead. Flagged to the user rather than
  done quietly.

**Chart palette had to be DERIVED, not reused.** The five brand accents cluster
at OKLCH L 0.73–0.88 — outside the dark-mode band [0.48, 0.67] — and lavender
sits exactly on the 0.10 chroma floor; the validator FAILED them. Re-derived
keeping each hue (drift ≤0.2°) and snapping L into the band, spread across it so
lightness carries separation too. Now passes all six checks (worst adjacent CVD
ΔE 12.5 deutan / 8.0 tritan, normal-vision 19.6, all ≥3:1 on both surfaces).
Ordinal ramp re-derived at ΔL 0.068 — the old ramp's 0.06 is below the
validator's gate, which is why it was re-generated rather than re-tinted.
Ramp/series now live in tokens; `charts.tsx` holds `var(--ramp-N)` only. Its
colour maths moved to `theme.test.ts`, closer to the values.

**Two bugs in my own tooling, worth recording.** The OKLCH snapper first
maximised chroma (periwinkle → electric blue) and then returned LINEAR rgb
without the sRGB gamma encode, so every step came out dark and oversaturated.
Fixed both; hue drift went to 0.0–0.2° and L landed on target.

**WHAT THE ENFORCEMENT TEST CAUGHT — the argument for writing it.** The
codebase looked clean by hex search while the SERVED stylesheet still carried
the retired navy twice, as `#010c2714` (Sass minifying `rgba(1,12,39,.08)`). So
the test now derives rgb()/rgb-slash notations from the retired hex list. Total
haul, all pre-existing or newly exposed:
- 6 hard shadows built from retired ink, invisible on a near-black ground
- 2 `rgba()` washes from a palette **two** rebrands old (an avatar, an error
  hover) — one sitting directly below a comment describing the last time
  exactly this happened
- `--color-secondary-text` referenced in 6 files: **a token that never existed
  in either theme**, silently resolving to nothing all along
- `app/(marketing)/marketing.scss` deriving its local tokens from `--brand-navy`
  / `--brand-sky`, so deleting those left every dark marketing section resolving
  to an undefined variable — the failure mode of a local token derived from a
  global one
- a sticky-header scrim hard-coded to the retired navy at 88%, which would have
  put a near-black bar over a light page in light mode. Now `color-mix()` on the
  live token.

Test-writing notes: the font check needs a WORD BOUNDARY (`Inter` matches
"Interview" — this is a recruitment product, six false positives first run), it
is scoped to lines that actually render (`font-family` / `next/font` / `$family-`)
so the explanatory comments about Inter being gone can survive, and the rgb
patterns must be compiled ONCE (90 regexes/line timed out at 5s).

**Substitution, named rather than buried: Aeonik → Plus Jakarta Sans.** Aeonik
is a commercial licence; `next/font` cannot fetch it and the repo has no
licensed files. Closest licensable neo-grotesque. `theme.test.ts` asserts the
substitution so it stays visible — swapping in real Aeonik should fail that test
on purpose, as a prompt to update it. One-line change in `app/layout.tsx`.

**Kept deliberately, not leftovers:** three white plates behind RASTER assets —
the coding-round QR (a phone camera needs the quiet zone), the marketing
wordmark plate, and a logo preview. The PNG brand assets were drawn for a light
ground and the product is now dark everywhere, so **re-drawing them is an
outstanding brand-asset job**; until then the plates are the honest fix.

**Not changed, and why:** the type SIZE scale and the spacing scale. The brief
specified families, colour, radius and shadow; it gave no scale values, and
inventing them would be a change nobody asked for. `themeColor` in `viewport`
now has per-mode entries so the browser chrome matches whichever ground is live.

`lint` clean · `typecheck` clean · `build` clean · 1880/1880 (+16) · served
stylesheet verified to contain **zero** retired values in any notation.

---

## 2026-09-20 (fourth session)

**REBRAND: "MyRecruiter Partner" / "Recruitment OS" → "Scoreboad".** New logo
(blue swirl) and lockup supplied as two PNGs; tagline is now "Smarter Hiring.
Brighter Teams."

**Source assets inspected before use, and it mattered.** Wrote a dependency-free
PNG decoder (`zlib` + un-filtering, ~40 lines) because there is no PIL here.
Both sources are genuinely transparent RGBA — the black behind them was only the
preview — so they sit on the deep-space ground directly. Content bboxes measured
rather than guessed: mark 981x1000 inside 1254², lockup 1731x637 inside 2172x724
with ~200px of empty margin.

**Generated with `sips`** (macOS built-in; no ImageMagick needed):
- `app/icon.png` 512² — the favicon. Square crop centred on the mark's content.
- `app/apple-icon.png` 180²
- `public/brand/mark.png` 256²
- `public/brand/logo.png` 489x180 (full lockup, with tagline)
- `public/brand/logo-compact.png` 499x120 (**no** tagline)

**The compact crop needed measuring, not eyeballing.** Row-coverage analysis of
the wordmark half only (x 700..1950, so the mark's tall glow does not mask the
gap) put the wordmark at y≈280–445 and the tagline at y≈480–512. Cropping at
y=465 drops the tagline cleanly. Result is 4.16:1 against the retired compact's
4.22:1, so the nav's measured widths are unaffected — that bar has no spare room
(see navItems.ts).

**`app/favicon.ico` WAS the override the user suspected.** It existed alongside
`app/icon.png`, and Next emits BOTH as `<link rel="icon">`; browsers requesting
`/favicon.ico` by convention got the old one. Regenerated it from the new mark
as a 2-entry **PNG-in-ICO** (32px + 64px) — an .ico entry may hold a whole PNG,
which every browser in use supports and which avoids writing a BMP encoder and
an alpha mask. `file` confirms both entries. Deleting it instead would have left
`/favicon.ico` 404ing for legacy requests.

`ASSETS` in `components/Logo.tsx` updated to the new intrinsic sizes — wrong
numbers there cause layout shift, since width is derived from the ratio.

**THE WHITE PLATE IS GONE, and that closes the item flagged last session.**
`MarketingWordmark` existed because the retired lockup was painted for a light
ground: on the dark marketing band its dark half dropped to ~1:1 and "Recruiter
Partner" vanished. The Scoreboad mark is light-on-transparent with its own glow,
so it needs no plate — removed, along with `.mkt-wordmark__plate`.

**The component stays anyway**, and the reasons that were secondary are now the
whole case: selectable text, no resampling at the hero's fluid sizes, a screen
reader gets text not alt, no image request on first paint — and the supplied
wordmark raster has visible edge artefacts that are obvious at hero size. Set in
Space Grotesk it is simply clean. `.mkt-wordmark__qualifier` (muted "Partner")
became `.mkt-wordmark__accent`: "Score" in the highlight, "boad" in periwinkle
at 7.50:1, **same weight** — one word in two colours, not a name plus a
qualifier, so lightening it would break the word in half.

Renamed across `app/`, `components/`, `lib/`, README, AGENTS.md and four docs.
Served HTML on `/` and `/login` verified to contain **zero** occurrences of
either old name. Metadata now `Scoreboad — Smarter Hiring. Brighter Teams.`
with template `%s · Scoreboad`; the marketing hero headline and its own title
took the new tagline too.

Also noted in `layout.tsx`: there is deliberately **no `icons` key** in
`metadata` — the icons are file-convention based, and adding the key back would
create a second declaration where whichever one the browser preferred would be
the one nobody edited.

**Spelling**: "Scoreboad" is used verbatim as supplied — it is what the logo
raster itself renders and what the user wrote consistently, including the
domain. If it was meant to be "Scoreboard" it is a one-line change plus new
assets.

`lint` clean · `typecheck` clean · `build` clean · 1880/1880 · brand assets
backed up to the session scratchpad before overwriting.

**Follow-up, same day — the full lockup is now actually ON the marketing site.**

The supplied lockup was already wired to `variant="full"` (auth pages, apply and
coding pages). What it was NOT on was the marketing site, which still composed
the mark plus a TEXT wordmark — so the artwork never appeared there.

Verified the asset before trusting it: `logo.png` peaks at alpha 255 with
"Score" at pure `#ffffff` and "boad" at `#868fff` — near-identical to the
theme's periwinkle `#8b9eff`, which is why the lockup sits on the palette
without adjustment. It only LOOKED washed out in a preview composited on white.

- **Header → `variant="compact"`** at 30px. A size decision, not a preference:
  the full lockup is 2.72:1 and its strapline is ~5% of the height, so in a 30px
  sticky header the strapline is 1.5px — invisible, not small.
- **Footer → `variant="full"`** at 56px, strapline included. The one place on
  the marketing site with the vertical room. Even there the strapline is ~3px
  and reads as texture; the sentence beneath carries the message.
- **`MarketingWordmark.tsx` DELETED** along with `.mkt-wordmark*`. Its whole
  reason was that the retired raster was painted for light and its dark half
  vanished on the dark band; the new lockup is light-on-transparent, so the
  component and its white plate were both solving a problem that no longer
  exists. Removing a wrapper that just forwards to `<Logo>` also satisfies the
  "no unnecessary wrappers" rule.

**One thing the deletion nearly lost.** The removed block carried a real fix: below
30rem the wordmark plus "Sign in" and "Get started" were wider than the
viewport, and the overflow pushed the whole page sideways — a 17px horizontal
scroll on `body` was exactly that. The old fix hid the TEXT half, which a raster
cannot do. Restored the equivalent by rendering BOTH lockups and swapping with
CSS (`.mkt-brand__wide` / `.mkt-brand__narrow`), keeping the mark on a phone —
the same approach `TopNav` uses, and for the same stated reason: a
width-measuring hook causes a layout shift on first paint.

Served `/` confirmed to request all three variants — compact (header wide), mark
(header narrow), logo (footer) — with `alt="Scoreboad"`.

`lint` clean · `typecheck` clean · `build` clean · 1880/1880.

---

## 2026-09-20 (fifth session)

**Landing page redesigned.** Brief: turn a documentation-heavy page into a
bright premium AI-recruitment landing page. Scope held to `/` plus the shared
marketing chrome; no backend, routing, auth or Supabase changes.

Note: built once, then the user said "start again" — reverted the two
uncommitted files (`page.tsx` was still untouched, so it cost nothing) and
rebuilt. The decisions below survived because they were computed, not chosen.

**THE ONE STRUCTURAL DECISION: the marketing bands are now FIXED, not
mode-dependent.** `--mkt-*` derived from the app's surface tokens, which flip
under `prefers-color-scheme`. Right for an application; wrong for an
art-directed landing page — following the OS would invert the hero, turn the
closing CTA into a pale box, and destroy the contrast that makes the bright
dashboard read as bright. The page would be a different design on half the
machines that opened it. The app stays fully mode-aware; only the public pages
are pinned. This also affects /how-it-works and /product/* — same art direction,
checked, all 200.

**Three contradictions in the brief, resolved and flagged rather than silently
obeyed:**

1. **"Primary button: bright periwinkle, white text."** White on #8b9eff is
   **2.49:1** and on the bright #aab7ff **1.92:1** — both fail AA badly. Navy on
   the same fill is 7.50:1. Kept the bright fill, changed the ink. Same rule
   `--color-on-accent` already encodes app-side.
2. **Nav asked for Products / Solutions / Pricing / Resources; footer for
   About / Contact / Security / Documentation / Blog / Privacy / Terms.** Nine
   of those pages do not exist, and the same brief forbids broken links AND
   invented functionality — placeholder pages are both. Mapped the requested
   shape onto real destinations. Pricing is the notable omission: the FAQ two
   sections below says pricing is not published, so the link would contradict
   the page it sits on.
3. **"Orbital/radial" was last session's; this one asked for charts implicitly
   via the dashboard.** The funnel in the mock stayed a linear bar set for the
   reason recorded then.

**Light-band palette measured before use.** Ink #0b1020 at 17.95:1 and muted
#5e6678 at 5.46:1 are fine. But the brand accents **cannot be text on light**:
periwinkle 2.36:1, lavender 1.70:1, mint 1.41:1. So `--mkt-accent-ink`
(#515f9e, 6.03:1), `--mkt-mint-ink` and `--mkt-lavender-ink` exist for accent
TEXT, and the raw accents are fills, rules, icon glyphs and glows only. A white
card on #f7f9fc is 1.05:1, which is why every light card carries a border —
on a light band the border does the job the glow does on a dark one.

**The product visual is built in HTML, not a screenshot.** Sharper at any
density, reflows on a phone instead of becoming a thumbnail, its text is real
text for a screen reader, and it cannot go stale against the product's chrome.
Its sidebar is the application's REAL top-level nav in the real order. Figures
are illustrative and both mocks say so in a caption — plausible for a small team
(248 candidates) rather than impressive, because an invented metric presented as
live is the same class of thing as an invented testimonial.

**No dependency added.** Reveal-on-scroll is IntersectionObserver plus a CSS
transition (~40 lines); framer-motion would have shipped ~40KB to fade six
cards. Ribbons are three blurred radial gradients behind `aria-hidden` — no
image, no canvas, no WebGL. FAQ is native `<details>`, so open/close, keyboard
and the screen-reader announcement are free.

**`lib/marketing/home.test.ts` (23 assertions) is the guard that matters.** It
asserts every nav/footer href resolves against INTERNAL_ROUTES — which is
*why* the invented nav was not shipped — every fragment matches a rendered id,
no copy uses unmeasured-outcome vocabulary ("10x faster", "40% reduction",
"guaranteed"), no certification is claimed, no customer or testimonial is
named, every icon name resolves, and the funnel only narrows.

Test-writing note: the certification check had to compare Q+A **pairs**, not
lines. It first failed on the QUESTION "Do you hold SOC 2 or ISO 27001
certification?" — which names both and denies neither, because the denial is in
the answer beneath it.

**Removed dead code**: `NAV_LINKS` and `FOOTER_SECTIONS` in content.ts became
unused once the chrome moved to `HOME_*`; both were exported, and a second set
of nav constants beside the live ones is how a future edit lands in the wrong
file and appears to do nothing. Their link assertions moved to home.test.ts.

**My own hard-shadow test caught the new work**: seven marketing shadows failed
it. Five were `--mkt-glow-*` tokens the allowlist did not know about (it only
matched `var(--glow`); two were literals I had written. Widened the allowlist to
any `var(--*glow*)` and tokenised both literals rather than carving an
exception — an exception is the crack the next hard shadow comes through.

**Old content is moved, not deleted.** The technical band the page used to lead
with (table counts, RLS, AI function counts) is now the trust section, phrased
as what it protects; /how-it-works still carries the full architecture.

SEO: title is absolute (`Scoreboad — Find the Right People Faster`) so it
escapes the `%s · Scoreboad` template; added `metadataBase` from `APP_URL` else
`https://scoreboad.com`, so canonical and og:url are absolute and a preview
deploy canonicalises to itself rather than telling a crawler production is the
original.

`lint` clean · `typecheck` clean · `build` clean · 1890/1890 (+10) · all ten
marketing and auth routes 200 · served HTML carries zero old-brand strings and
zero links to pages that do not exist · band balance ~26% deep / 73% bright.

**Not verified, and it needs a human:** rendered appearance at the eight
breakpoints the brief lists. There is no browser in this environment — the
responsive rules are reasoned and the overflow-prone cases are handled (the
pipeline table scrolls inside its own container; the mock's sidebar goes
horizontal under 860px; the workflow connector redraws vertical under 620px),
but nobody has looked at it.

---

## 2026-09-20 (sixth session) — MODULE 01: design system + animation + SEO foundation

Foundation module. Homepage design deliberately NOT touched (the brief forbids
it); what was built last session was *extracted* into reusable primitives with
byte-identical rendered output — verified by diffing band classes and the
heading outline before and after.

**THE BUG THIS MODULE EXISTED TO FIND.** `app/robots.ts` and `app/sitemap.ts`
generate `/robots.txt` and `/sitemap.xml`, and those are routes like any other —
so the deny-by-default proxy caught them and served **every crawler a 307 to
/login**. The SEO foundation was complete and completely unreadable. Nothing
failed: the files existed, the build passed, lint passed, and `curl` was the
only way to find out. Fixed by allowlisting both in `PUBLIC_PATHS` (safe as
prefix entries — neither is a prefix of a private route) and **pinned in
publicPaths.test.ts**, because the symptom is silence.

**New foundation:**
- `lib/marketing/seo.ts` — `buildMetadata()` plus Organization / SoftwareApplication
  / FAQPage / BreadcrumbList JSON-LD. Adopted on all four public routes, which
  is what gave /how-it-works and /product/* the Open Graph and Twitter blocks
  they had simply never had written out by hand.
- `app/robots.ts`, `app/sitemap.ts`. The sitemap is generated from
  CAPABILITY_GROUPS — the same constant `generateStaticParams` uses — so a
  seventh product page appears in it automatically and cannot be forgotten. It
  lists **only routes that exist**: a sitemap naming /pricing before /pricing is
  written is a 404 handed to a crawler with an invitation.
- `components/marketing/` — Section, SectionHeading, Card + MetricCard, Button +
  ButtonLink, GradientText, Badge, Breadcrumbs, Reveal + Stagger.
- Marketing type scale (`--mkt-display`…`--mkt-caption`), spacing ladder, a
  tertiary button, dark/glass/interactive card variants, focus-visible rings.

**Deliberately NOT built:** the brief listed ~18 components; I built 9. A
component with no caller is dead code the next person has to decide whether they
may delete. Everything here is used by the existing page, which is also how the
API got proven. LogoCloud in particular was skipped — there are no customer
logos, and building the component invites filling it with fake ones.

**Seven card variants collapsed into one `variant` prop.** Light / Dark / Glass /
Feature / Product / Metric / Interactive describes appearances, not seven
things: they share radius, border, padding and hover. MetricCard is separate
because it genuinely has a different shape (the number leads, no icon well).

**JSON-LD is built from the same array the page renders.** `faqJsonLd(HOME_FAQS)`
where HOME_FAQS is what the FAQ section displays — structured data claiming
questions a visitor cannot see is what a manual action is issued for, and it
happens because the two are usually written in different files. No `offers`, no
`aggregateRating`: pricing is unpublished and there are no reviews.

**Reveal moved** from the home folder to `components/marketing/` — it is
foundation, and a second copy beside a second page is how two pages come to fade
at different speeds. `Stagger` added, with the delay **capped** (8 cards × 60ms
is already 420ms of waiting for the last one).

**No dependency added.** Animation is IntersectionObserver + CSS transitions;
icons are the existing lucide-react; styling is the existing Bulma + SCSS. No
Tailwind in this project — the brief's Tailwind references do not apply.

**Old-brand audit (Part 26): clean.** Zero occurrences of MyRecruiter, Hirflix
or Recruitment OS anywhere. Found and removed five unreferenced Next.js starter
SVGs in `public/` — including `vercel.svg` and `next.svg`, which the brief
explicitly calls out. All five confirmed to have zero references first.

**My own hard-shadow test fought back twice, and was right both times.** It
flagged the new focus rings (multi-line declarations read as a bare
`box-shadow:`) — tokenised them rather than loosening the rule. Then it flagged
its OWN explanatory comments, because those sentences contain the word it greps
for; fixed with block-comment STATE tracking, after a first attempt matching
line prefixes missed a line inside a block comment that began with a backtick.
Ran a **negative control** afterwards — injected a real hard shadow, confirmed
it still fails, restored — because a check widened twice is a check worth
proving is not vacuous.

`lint` clean · `typecheck` clean · `build` clean · 1892/1892 (+2) · robots.txt
and sitemap.xml both 200 with 10 URLs · JSON-LD emits Organization +
SoftwareApplication + FAQPage · heading outline is one h1 then h2s.

**Still not verified:** rendered appearance at the eight breakpoints. No browser
in this environment; unchanged from the previous session's note.

---

## 2026-09-20 — Module 02: navbar, mega menus, navigation IA

**The problem the module posed.** The brief asks for six top-level menus
(Products, Solutions, Who It's For, Integrations, Resources, Pricing) covering
~30 destinations, and in the same breath forbids broken links and forbids
creating empty pages to satisfy the nav. The site has 11 real public URLs. Those
instructions only conflict if the architecture and the rendering are one thing.

**The resolution: `lib/marketing/navigation.ts`.** Declares the WHOLE long-term
IA, every item carrying `status: "live" | "planned"`. `liveNavigation()` renders
only live items and drops a menu with none. A later module turns a page on by
editing one word, and `navigation.test.ts` fails until the route actually
resolves. Architecture committed, dead links not shipped.

**Two menus turned out to be real with zero new pages.**
- Products → the six existing `/product/*` pages (their own H1s became the
  one-line descriptions, so menu and page agree by construction).
- Who It's For → the four role cards ALREADY RENDERED on `/how-it-works`. They
  had no ids, so `ROLE_FLOWS` gained an `anchor` field and the cards gained
  `id` + `scroll-margin-top: 6rem` (the header is sticky; an un-offset anchor
  scrolls the heading underneath it). Making existing content addressable, not
  inventing a page.

Solutions / Integrations / Pricing declared, not rendered — no destinations of
any kind. Pricing especially: the home FAQ says pricing is not published, so a
Pricing link would contradict the page it sits on.

**Visual identity untouched, per the brief's MOST IMPORTANT INSTRUCTION.** Same
sticky floating glass pill, same 3.5rem height, same fill/blur/border, same logo
swap, same right-hand action pair. Everything new (mega panel, accordion) reuses
the existing glass tokens.

**Decisions worth keeping:**
- **Disclosure pattern, not `role="menu"`.** `role="menu"` swallows Tab, demands
  roving focus, and makes a screen reader announce a site nav as a command menu.
  `button[aria-expanded]` + a labelled list is what a nav actually is.
- **Panel mounted only when open.** A CSS-hidden panel puts 11 invisible links
  in the tab order.
- **Hover gated on `(hover: hover) and (pointer: fine)`.** On touch, `mouseenter`
  fires synthetically just before the tap and the tap lands on what moved.
- **140ms close delay + the gap carried as PADDING on the panel wrapper.** Empty
  space is not a descendant, so a margin would close the menu mid-diagonal.
- **Route change handled by compare-and-set DURING RENDER**, not an effect —
  `react-hooks/set-state-in-effect` rejects the effect version (4th time this
  rule has bitten in this codebase), and an effect would paint the open menu
  over the new page for one frame.
- **Active state is an underline, not a colour change** — colour alone fails
  WCAG 1.4.1. Drawn with `::after` so it never shifts the row.
- **Breakpoint moved 940 → 900px**, remeasured: 3 triggers (~330px) are narrower
  than the 5 flat links (~400px) the old figure was based on.
- **CTA "Get Started" → "Start free"** — names what the click costs.

**Two bugs the tests caught, both real:**
1. `/how-it-works` lit up TWO menus at once (Who It's For owns its `#for-*`
   anchors, Resources owns the page). Fixed the rule: an anchored href links a
   SECTION and does not claim the page, so only fragment-free hrefs count. That
   also disposes of the home page for free — every `/#...` is excluded, so `/`
   matches nothing instead of lighting all three.
2. "Candidates" as a one-word label — thin anchor text for a site-wide internal
   link. → "Candidate Experience".

**Deleted `HOME_NAV_LINKS`** (dead once the header moved to `NAVIGATION`); its
four assertions moved into `navigation.test.ts`. Its `/#trust` destination was
deliberately carried into Resources as "Security & Trust" so the reorganisation
did not quietly drop the only nav route to the security copy. `/#product` and
`/#ai` are now nav-unreferenced — both are covered by deeper real pages.

**Did NOT touch:** `app/sitemap.ts`, `app/robots.ts` (§32), `components/nav/TopNav.tsx`
— the authenticated app navbar stays a separate component (§24). No schema,
API, auth or business logic.

**Skipped deliberately:** `SiteNavigationElement` JSON-LD. No search engine
consumes it; `lib/marketing/seo.ts` already states the house rule against markup
that signals an SEO plugin rather than a maintained site. The navigation SEO
here is substantive instead: real `<a href>` (no JS-only handlers), descriptive
anchor text, one `<nav aria-label="Main">` landmark, server-rendered links.

`lint` clean · `typecheck` clean · `build` clean · 1908/1908 (+16). Verified
against the running dev server: four `id="for-*"` anchors present, three
`aria-controls="mkt-mega-*"` triggers present, `aria-label="Main"` landmark
present, Resources correctly `data-active` on `/how-it-works`, and the mega/
accordion rules + the 900px breakpoint present in the served CSS.

**Still not verified:** rendered appearance at the eight breakpoints. No browser
in this environment; unchanged from the previous two sessions' note.

---

## 2026-09-20 — Module 03: homepage hero

Scope was the hero only; nothing below it was touched. Most of the brief was
already satisfied by the earlier homepage redesign (H1 text, split gradient
accent, deep-navy band, CSS ribbons, HTML dashboard). The new work was the
entrance choreography, the product visual's FIDELITY, and two SEO defects.

**The entrance is CSS keyframes, not `<Reveal>`, and the delay order is an LCP
decision.** `.mkt-enter` / `.mkt-rise` / `mkt-signal-in` with
`animation-fill-mode: both`. Reveal was wrong here twice over: it is
scroll-driven and needs JS, so the hero would be blank until hydration on the
one screen where that is least acceptable; and this is a one-off rise-and-settle,
not the page's repeating scroll language.

`fill-mode: both` is the LCP trap — Chrome does not treat a transparent element
as a paint candidate, so every millisecond of `animation-delay` on the headline
is a millisecond of LCP. **The H1 and badge carry NO delay**; lead 90ms, detail
150ms, CTAs 210ms, frame 180ms/700ms, tiles 560+45n, funnel 740ms, signals
1150/1310ms.

**Reduced motion needed its own rule.** The existing global block squashes
animations to 0.01ms but does NOT zero `animation-delay` — with fill-mode both
that would have shown a blank hero for 1.31s. `animation: none !important` plus
an explicit visible state, and the two signal cards keep the transform that
PLACES them while losing the one that moves them.

**The dashboard mock was a picture of a product nobody can open.** Fixed:
- tiles → the real `METRIC_LABELS` (New candidates / Screenings completed /
  Interviews today / Overdue applications) in the real tile shape (icon+label
  row, then value; the real dashboard has no delta row, the mock had invented
  ones), with the real amber left-edge on the negative metric.
- funnel → the real `STAGE_LABELS` in real order. The brief sketched
  "Applied → Screening → Interview → Evaluation → Hired"; three of those five
  are not stages in this product (no "Screening" — it's "AI Screening Call"; no
  "Evaluation" — that's recorded against an application; no bare "Interview").
- `lib/marketing/home.test.ts` now asserts both against the real constants, so
  a stage or metric rename breaks the build. That link did not exist before.

**Two SEO defects found and fixed:**
1. The homepage was overriding its title to "Scoreboad — Find the Right People
   Faster" — the H1 reused as a title tag, which never says what the product
   is. Now `SITE_TITLE`.
2. **The H1's textContent was "Find the Right PeopleFaster with AI".** JSX drops
   whitespace between an expression and an element, and the accent span's
   `display: block` hid it visually. One missing word in the most important
   heading on the site, invisible in the browser. Fixed with an explicit
   `{" "}`.

**Tried and reverted:** forcing the root canonical to `https://scoreboad.com/`.
Next normalises trailing slashes out of every resolved metadata URL — proven by
`og:url`, built from the same "/" and never touched, coming out identical.
Reverted rather than leave a comment claiming an effect it does not have; the
two forms are the same URL by RFC 3986 anyway. Recorded in `lib/marketing/seo.ts`.

**New:** `--mkt-amber-ink: #8a5f00` (5.65:1 on white, 5.36:1 on the light band).
First tried #9a6a00 — 4.73:1 on white but 4.49:1 on the light ground, so it
would have failed the moment the token was reused one band over.

**Caught before shipping:** the signal keyframe set `transform` without the
`translateX(±45%)` that POSITIONS each card, so both would have faded in flush
against the frame and snapped sideways on the last frame. Threaded the shift
through a `--sx` custom property so one keyframe serves both directions.

Other: funnel stage column 86px → 112px (real stage names are longer;
"AI Screening Call" wrapped and made one row taller), + ellipsis as a backstop;
`.mkt-ribbon` blur 70px → 45px at ≤620px (three full-height blurs is real GPU
work inside LCP); 2px hover/focus lift on `.mkt-btn` with `:active` returning to
0; `.mkt-hero__horizon` and `.mkt-product__halo` as the luminous horizon and the
bloom behind the product.

**Deliberately not done:** no logo in the hero (the navbar shows it 40px above —
§8 says do not repeat it); no `SiteNavigationElement`-style extra JSON-LD; no
image, so nothing to reserve space for and no CLS contribution; floating signals
`display: none` below 1400px rather than repositioned over the dashboard.

`lint` clean · `typecheck` clean · `build` clean, `/` still prerendered static ·
1919/1919 (+11). Verified against the dev server: one h1, textContent exactly
"Find the Right People Faster with AI", title/description correct, real stage
names and real metric labels in the DOM, both signals and the horizon present,
and every new rule in the served CSS including the reduced-motion override.
Ran a **negative control** on the keyword-stuffing guard (injected "hiring" ×4,
confirmed it fails, restored).

**Still not verified:** rendered appearance at the eight breakpoints. No browser
in this environment — unchanged from the previous three sessions. The 320px
overflow case was checked arithmetically instead (280px shell → 240px main →
115px tiles → 86px funnel track; every text cell has an ellipsis and every grid
track a `minmax(0, …)`), not visually.

---

## 2026-09-20 — Module 04: problem → solution

**The brief collided with the page that already existed, and the resolution is
the whole design decision.** Module 04 asked for a solution band headed "One
connected workspace for modern hiring" showing Job → Candidates → Screening →
Interview → Evaluation → Hiring decision. The page already had `Workspace`
("One workspace for your entire hiring process") and `HiringWorkflow` rendering
exactly those six stages from `WORKFLOW_STEPS`. Building the brief literally
would have put the same heading twice and the same six stages twice on one page.

So:
- **The problem half is genuinely new** — the page had never stated one. It
  opened with the hero's promise and went straight to a capability list, i.e.
  the answer to a question it had never asked.
- **The solution half shows the same six OBJECTS as the problem half, not
  stages.** Resumes / Applications / Screening answers / Interview times /
  Interviewer feedback / The decision — scattered across generic tools in the
  light band, then connected to real Scoreboad surfaces in the dark band.
  Distinct from `WORKFLOW_STEPS` (verbs/stages), and `home.test.ts` now fails if
  the two sets ever converge on the same labels.
- **`Workspace` was retitled** "One workspace for your entire hiring process."
  → "What's in the workspace." That band is no longer the claim, it is the
  itemisation of the claim made two bands earlier.

**`WORKFLOW_PIECES` is ONE array rendered twice** — scattered and connected.
That is the section's whole argument ("the same six things, now joined") made
true by construction. Two arrays would have drifted until before/after were of
different subjects and nothing would have failed.

**Dark solution band, and that is the argument not the rhythm.** Problem =
pale, ordinary ground where the pieces sit loose; solution = brand navy, lit,
one rail. The reader scrolls and the transformation IS the scroll. Side-by-side
in one band would make it a diagram to compare rather than a thing that happens.
Deep bands now 4 of 12 — still the documented ~30/70.

**Animation reuses `<Reveal>`, no new mechanism.** The rail's line growth and
the nodes' settle are CSS keyed off the `.is-shown` class Reveal already adds.
Line grows with `scaleX`/`scaleY`, never `width`.

**Deliberate refusals:**
- The scattered chips do NOT float. §10 asks for them to "gently move
  independently" and four lines later rules out constant movement and infinite
  animation; the prohibition wins. Six perpetually-animating compositor layers
  under a paragraph about chaos is not calm.
- Tilts are FIXED PER INDEX via `data-tilt`, not random — a random tilt at
  render is a hydration mismatch.
- Chips are flex-wrapped, not absolutely positioned: a prettier scatter that
  cannot overlap at any width.
- No `/platform` or `/solutions/ai-recruitment` link — both `planned` in
  `navigation.ts`. The one contextual link goes to `/how-it-works`.

**Bug found and fixed in a Module 01 primitive.** `ButtonLink`/`Button`
destructured only `href`/`children`/`icon` and spread the rest onto the element,
so the rendered markup was `<a class="mkt-btn mkt-btn--glass" variant="secondary"
href="…">` — an invalid HTML attribute on every button on the site. Worse and
quieter: `{...rest}` sat AFTER the computed `className`, so a caller passing one
would have wiped the button's classes entirely. It survived Module 01 because
nothing had called these yet — **the solution band's CTA is the first caller in
the codebase**, which is how it surfaced. Fixed by destructuring
`variant`/`size`/`className` out; the `...rest` type now structurally cannot
contain them, which is a stronger guarantee than a test would be (there is no
jsdom/RTL harness in this project and adding one for this is not worth a
dependency).

**Reused:** `Section`, `SectionHeading`, `ButtonLink`, `Reveal`, `Stagger`,
`Logo`, `iconFor`, `.mkt-lcard` (the problem card is a `--numbered` MODIFIER, so
it inherits surface/border/radius/shadow/hover), Bulma's `.is-sr-only` (already
loaded, already used in `app/hires/[id]/DocumentChecklist.tsx` — not a second
visually-hidden utility).

**Copy rules enforced in tests, not just in review:** every problem-card body
must hedge or describe (`can` / `tends` / `often` / `is hard`…) and none may say
"your" — "candidate data can live in spreadsheets" is an observation, "your
candidate data is a mess" is a claim about a company nobody here has met.

Responsive: problem cards 5 → 3 → 2 → 1 (five is an awkward count and the ragged
last row is accepted rather than inventing a sixth card to square the grid); the
rail turns vertical at **1080px**, not at the phone breakpoint, because six nodes
across needs ~170px each before "Interviewer feedback → Evaluation" wraps to four
lines; tilts come off at ≤620px and the scatter becomes a column.

Reduced motion needed its own rule again: the rail is hidden by default and
revealed by `.is-shown`, so "no animation" could not mean "no transition" —
that would leave the line at scale 0 and six nodes at opacity 0 forever. Forced
to the final state, with `transform: none` rather than `scaleX(1)` because the
same rule serves the vertical rail too.

Contrast computed for every new pairing: scatter sub 5.76:1, problem number
6.03:1, rail label 17.47:1, rail surface 8.24:1, panel title 16.34:1.

`lint` clean · `typecheck` clean · `build` clean, `/` still static · 1928/1928
(+9). Verified against the dev server: one h1 and 13 distinct h2s, no leaked
DOM attributes, the scatter `aria-hidden` with its content carried by a real
caption, and every new rule in the served CSS with the reduced-motion overrides
correctly last in the cascade.

**Still not verified:** the eight breakpoints, visually. No browser — unchanged
from the previous four sessions.

---

## 2026-09-20 — Module 05: platform overview / product showcase

**The six `WORKSPACE_CARDS` mapped exactly onto the six capabilities Module 05
asked for**, so this REPLACED that band rather than adding a seventh section.
The card grid (icon + heading + paragraph ×6) is gone — §3 of the brief
explicitly names that pattern as the thing to avoid — and the same six
capabilities are now six views of ONE product frame. Their copy survives
verbatim as `PLATFORM_VIEWS[].caption`; `WORKSPACE_CARDS` was deleted rather
than left as an unused export, because dead CONTENT data is worse than dead
code (nobody can tell which of two arrays the site renders).

**One frame, six panels — not six dashboards** (§9). Chrome, sidebar and
surface are constant; only the table swaps, and the sidebar's active item moves
to match. `.mkt-product__*` is the hero's own stylesheet, so the two product
shots on the page are recognisably the same application.

**Every label is real, and a test enforces it.** Sources read during
inspection: `app/jobs/page.tsx` (Title/Status/Health), `ApplicationTable.tsx`
(Candidate/Job/Stage/Match), `lib/evaluation/sources.ts` (strong_matches / gaps
/ needs_verification — Module 7's three labelled lists), `lib/evaluation/verdict.ts`
(Pass / Fail / Needs Review, RESUME_SCORE_MAX 100, ROUND_SCORE_MAX 10),
`lib/interviews/feedback.ts` (MODE_LABELS / STATUS_LABELS),
`lib/applications/stages.ts` (STAGE_LABELS), `components/nav/navItems.ts`.

Tests now assert: every view's `nav` is a real `DASHBOARD.nav` entry; pipeline
rows are real `STAGE_LABELS`; the evaluation verdict is a real `STATUS_LABELS`
value; any `n / m` score uses a real max and stays inside it; and the showcase
agrees with the hero about pipeline size (124 both places) — **two product shots
on one page must describe one company.**

**`nav` for screening AND evaluation is "Applications"**, deliberately. Neither
is a separate app; both are views on an application record. Two tabs lighting
one sidebar item is the most honest thing the showcase says about the product
being connected.

**Three bugs caught during the build, all by the repo's own checks:**
1. `app/theme.test.ts` flagged an inline three-line `box-shadow` on the
   light-band frame within a minute of it being written → became
   `--mkt-glow-product-light`. (`--mkt-glow-product` opens with a 1px WHITE
   ring — right over navy, invisible on #f7f9fc, so the frame lost its edge.)
2. A stray `}` in my SCSS edit closed the 860px media query early and orphaned
   everything after it — caught by the Turbopack build, not by lint.
3. **Dangling ARIA IDREFs.** The first version rendered only the selected
   panel, leaving `aria-controls` on the other five tabs pointing at ids not in
   the DOM. Fixed by rendering all six with `hidden` — which is not the "six
   dashboards" the brief forbids: chrome and sidebar stay single and what
   duplicates is four rows of text. Verified: zero dangling `aria-controls` or
   `aria-labelledby` in the served HTML.

**Layout-shift fix:** three of the six views carry progress bars and three do
not, which made those panels ~44px taller — switching tabs moved the section's
lower half. `.mkt-showcase__cell { min-height: 1.875rem }` equalises. A layout
shift caused by the reader's own click is the worst kind.

**Panel-swap animation had to change mechanism** when all six went into the
DOM: a `key`-driven remount no longer fires, so it keys off
`.mkt-showcase__view:not([hidden])` — a CSS animation runs the moment its rule
begins to apply. Still the hero's `mkt-enter` keyframe, so reduced motion is
already covered by the existing `animation: none` rule.

**Tabs:** real WAI-ARIA pattern — roving tabindex, arrow keys with wraparound,
Home/End, **automatic activation** (focus and selection move together; manual
activation would make a keyboard user press twice for what a mouse does once).
`aria-selected` is the CSS hook rather than a parallel `is-active` class, so
what a screen reader is told and what a sighted reader sees cannot drift.

**No CTA**, per §15's own instruction: `/platform` is `planned` in
`navigation.ts`, and the only other honest destination (`/how-it-works`) is
already the Module 04 band's CTA two sections up.

**Known redundancy, not resolved here:** `PipelinePreview` ("See your hiring
pipeline at a glance", the applications table) is now the page's third product
visual and largely superseded by this showcase. Left alone because §29 assigns
"Hiring Pipeline" to a future module — that module should decide whether it
survives.

`lint` clean · `typecheck` clean · `build` clean · 1937/1937 (+9). Verified
against the dev server: one h1, 13 distinct h2s, all ARIA references resolve,
5 panels hidden, sidebar highlight correct, all CSS served.

**Still not verified:** the eight breakpoints, visually. No browser — unchanged
from the previous five sessions.

---

## 2026-09-20 — Module 06: AI recruitment experience (scroll-driven story)

Replaced `AiFeatures`' eight-card icon grid — the exact pattern §3 forbids —
with a scroll-driven demonstration of the screening pipeline plus four
supporting callouts. The band named every AI capability and demonstrated none,
on the one subject where the reader's real question is "but what does it DO?".

**The section's argument, and it came out of the code.**
`lib/ai/matchCandidateToJob.ts`'s own header: salary, experience, location,
notice and literal skill overlap are settled by `lib/matching/deterministic.ts`
and **the model is never told them** — it answers only what code cannot.
`lib/matching/score.ts`: *"CODE owns the number. The model cannot state a score
at all, so it cannot state one that disagrees with the facts beside it."*

So the AI layer shows **four steps with a `by` badge**: AI / Person / Code / AI.
Two of four are not the model. A test asserts a `code` step and a `human` step
both exist and that `ai` is not all of them — because the temptation to
simplify that into one box marked "AI" is exactly how this section would come
to describe a different, worse product.

**Scroll architecture — no scroll handler.** A 220vh track, a sticky viewport,
five zero-size sentinels at 0/20/40/60/80%, and ONE IntersectionObserver with
`rootMargin: -50% 0px -50% 0px` (the viewport reduced to its middle line, so
exactly one sentinel is active). Five callbacks for the whole section. Rejected:
a rAF'd scroll listener (main-thread work during the gesture it decorates),
`animation-timeline: view()` (no Firefox → needs the observer as fallback
anyway = two mechanisms), and any scroll library (§21).

**Bug caught by reasoning, not by a browser:** the first version put
`height: 220vh` on the *absolutely positioned* runway. An out-of-flow child
contributes no height, so `.ai-story` collapsed to the viewport's ~600px, the
sticky element released after half a screen, and the runway hung over the next
section. **A sticky element is only sticky while its PARENT is on screen.**
Height moved to the track.

**Stage gating is one attribute.** `data-stage` on the panel + `data-at` on each
block; a nested Sass `@for` emits the 15 `[data-stage=i] [data-at=j]` pairs.
Blocks dim to **0.3, never 0** — a reader landing mid-section, or a crawler
rendering one frame, still sees the whole story.

**Mobile is a different composition, one media query.** Below 900px the track
loses its height, the viewport stops being sticky, every stage is lit, and the
pulse/path-draw/cursor-light are removed. Same markup, so no second render tree
and no hydration risk; the observer still runs and the rule simply outranks it.
Below 620px the converging SVG is dropped — three cards became one column, so
three converging paths no longer describe the layout.

**Interaction choices:**
- Candidates are a **radiogroup**, not tabs — partly semantics (a choice that
  filters content), mostly because the platform showcase one band above IS a
  tablist and two consecutive identical switchers is how a page starts to feel
  like a template.
- **Cursor light** writes `--mx`/`--my` as CSS custom properties, rAF-throttled,
  gated on `(hover:hover) and (pointer:fine)` + not reduced-motion. A style
  mutation, NOT React state — state would re-render the subtree on every mouse
  move.
- **No infinite animation anywhere.** The connector pulse runs twice, only while
  its own stage is active. The background mesh is three fixed radial fields, not
  an animated gradient: a 20s infinite blur on a full panel is a compositor job
  that never ends.
- **The recruiter controls are spans with `aria-hidden`, not buttons.** A button
  on a marketing page that looks like it advances a real candidate and does
  nothing is worse than no button — the section's claim is that a person
  decides, so faking the deciding would undercut it.

**Deviated from the brief in two places, both reported:**
1. §18 asked for the trust line *"AI assists. Your team decides."* — almost word
   for word the H2 of the Human + AI band further down the same page. Used
   "Every one of these is a draft until a person signs it off." instead, with a
   test pinning the divergence.
2. §8's example candidate ("Alex Morgan / AI Engineer / Python LLM RAG") was
   replaced with the page's existing Senior Backend Engineer + Go/PostgreSQL, so
   all three product shots describe one company. Test asserts the job title.

**Eight callouts → four** (§17). The dropped four — voice screening, interview
briefs, candidate messaging, pipeline automation — are real and each is owned by
a later module per §36; keeping them made this band a summary of the whole
product rather than of screening.

Skipped deliberately: parallax (§13 — conflicts with a sticky viewport for
little gain) and magnetic buttons (§20 — "primarily for primary CTA"; the CTA
already has the Module 03 hover lift). 3D is one 1.5deg hover lift on the
candidate cards, which is the most that reads as depth rather than distortion.

Server/client split (§33): `AiFeatures` stays a server component — heading,
callouts, CTA carry no JS. Only `AiStory` is `"use client"`.

Contrast computed: rail 9.72, step badges 9.09 / 9.73 / 11.75, body 8.24,
callout link 6.03.

`lint` clean · `typecheck` clean · `build` clean · 1945/1945 (+8). Verified on
the dev server: one h1, radiogroup with roving tabindex, four callouts all
resolving to real routes, CTA → /product/screen, sentinels compiled to
0/20/40/60/80%, 15 stage-gating rules emitted.

**Still not verified:** the eight breakpoints, and the scroll choreography
itself, visually. No browser — this is the module where that gap matters most,
because the stage timing is the one thing that can only be judged by scrolling.

---

## 2026-09-20 — Module 07: AI screening call (cinematic voice story)

**THE CENTRAL FINDING, and the whole module turns on it: this product has no
"AI voice interview".** The brief used that name throughout. In this codebase:

- `screening_calls` (Module 8, Bolna) is the automated FIRST call. It asks the
  job's own `job_screening_questions` — written by the hiring team, capped at
  `MAX_QUESTIONS = 12`.
- `interviews` (Module 11) are the later rounds, conducted by **people**,
  scheduled into a real calendar, modes Video / Phone / On-site.

Calling the automated call an "interview" would advertise a model conducting
the rounds a person conducts. Section is named **AI screening calls**; a test
fails on `/AI[- ]?(voice[- ])?interview/i` anywhere in the section's copy. The
brief's H2 was kept — "Let every candidate have a structured first
conversation" is exactly right for a screening call.

**What the schema gave the story (all read before any copy was written):**
- `screening_calls`: one row per ATTEMPT, real status enum (queued / dialing /
  answered / completed), transcript, recording_url, duration, consent_confirmed.
- `screening_reports`: summary, interest_level, expected_ctc,
  notice_period_days, location_accepted, availability_notes — plus **`ai_*`
  mirror columns that are NEVER updated after insert**, `uncertain_fields`
  (what the model itself was unsure about) and `corrected_fields`. A DB trigger
  refuses to create a report without consent.
- `lib/screening/script.ts`: the consent disclosure is always first, always
  present, and `assertScriptIsCompliant()` blocks the dial without it.

The demo **quotes the disclosure and the closing line verbatim**. The closing
line is the human-in-the-loop story told by the product itself: *"A recruiter
from {org} will review this and be in touch about next steps."*

**NO SCORE, and that is a finding not an omission.** `screening_reports` has no
score column — the call produces fields and a summary; the match score belongs
to the resume stage. §11 said not to invent one. A test asserts no `n/m` or the
word "score" appears in any report field.

**The AI-said / human-corrected pair is the section's best moment** and comes
free from the schema: "AI said 'Immediately available' · corrected by R. Menon".

**Architecture:** same sentinel + sticky machinery as Module 06 (deliberate — a
second scroll mechanism for the second scroll section is how you end up with
two of everything), but a different composition: two pinned columns, stage copy
left, call interface right.

**Waveform:** one SVG polyline from a deterministic speech envelope (two sines
under a slow third), drawn twice end-to-end and scrolled by exactly its own
width so the loop has no visible seam. Amplitude via `scaleY` on the SVG box
(not the path — `vector-effect: non-scaling-stroke` keeps the stroke even), hue
and speed per state. Five states differ in **three** signals so AI-speaking vs
candidate-speaking is not carried by hue alone. Deterministic because a random
waveform is the textbook hydration mismatch. **Zero audio elements on the page**
— verified in the served HTML.

**Bug caught in review:** the correction pair was conditionally *rendered*
(`row.corrected && stage >= 5`), so the single most distinctive line in the
section was absent from crawlable HTML until somebody scrolled, and absent
entirely without JS. Everything else gates visibility, not existence — made it
consistent (`data-shown` + `visibility: hidden`, so the row height never
changes either). Same reasoning already applied to the six stage paragraphs:
all six in the DOM with `hidden`, so a crawler gets all of them.

**Band rhythm:** this band is dark and sits directly above Human + AI, which is
also dark. Intended — the call story ends on a recruiter reading the report and
Human + AI is the argument for why it ends there. Five deep bands of thirteen.

**Mobile (900px):** the two-column pin collapses to one column, unpinned; the
call panel shows its finished state; all six explanations render at once as a
numbered list via `counter-increment` (the desktop `hidden` is overridden). At
620px the transcript speaker label moves above the line — a 4.75rem column plus
text at 375px leaves ~40 characters.

**Three callouts, not four.** The brief's fourth was interview scheduling —
real, but nothing about scheduling a human round happens on an automated call,
and it belongs to a later module. All three hrefs distinct: /product/source
(the questions), /product/screen (transcript), /product/decide (the report).

Contrast: status live/done 11.75 / 9.09, uncertain flag 9.73, corrected 11.75,
transcript body 8.24 — all on `--mkt-dark-2`.

`lint` clean · `typecheck` clean · `build` clean · 1953/1953 (+8). Verified on
the dev server: one h1, zero `<audio>` and zero `autoplay`, consent + closing
lines present in crawlable HTML, correction pair present but hidden, sentinels
at 0/16.7/33.3/50/66.7/83.3%.

**Still not verified:** the eight breakpoints and the scroll choreography,
visually. No browser. Two sticky stories now run back to back (Modules 06 and
07) — whether that is one beat too many is a judgement only scrolling can make.

---

## 2026-09-21 — Module 08: candidate workspace / candidate journey

**Deliberate deviation, reported: this is NOT a third sticky scroll story.**
§7 asked for a 220–300vh sticky section with copy left and a pinned workspace
right — which is, to the pixel, the composition of Module 07 directly above it,
itself the second of these. Built as specified the reader would meet the same
two-column pinned panel three times running, and the homepage would carry
~700vh of scroll track before the pipeline module.

What made 06 and 07 work was: one candidate visibly travelling, a surface that
transforms, and a stage indicator. None of that needs scroll as the transport.
So the READER drives this one — six real views as a tablist, a timeline that
fills, one card carrying its state across all six. Reversible: the
sentinel+sticky machinery would drop in around `<CandidateJourney>` unchanged.

**The six views are the product's own screens**, read before any copy:
Profile (`app/candidates/[id]` Profile card fields), Resumes (`ResumesCard`),
Screening (`screening-report`), Interviews, Evaluation (`EvaluationPanel`),
Activity (`activity/` Timeline). The brief's sixth stage was "Review" — not a
screen here; reviewing IS the evaluation panel, and what survives it is the
activity log.

**The timeline is the audit log's own vocabulary.** Every entry is a real
`label` from `lib/activity/events.ts`: Applied · Resume parsed · Parsed fields
reviewed · Match calculated · Screening report reviewed · Interview scheduled ·
Interview feedback submitted · Stage changed. A test pins the whole set, since
that is the first thing that would rot if someone "tidied up" the wording.

**`CandidateCard` is a separate prop-driven server component** (§20) — knows
nothing about stages, timelines or selection, so Module 09 can drop it into a
pipeline column without inheriting any of this. The journey is its CHIPS
changing (Applied → +Resume parsed → +Match 91/100 → +Rounds 1 of 2 → +Verdict
→ +History 8 events) while the card itself never unmounts. A card destroyed and
rebuilt per stage would screenshot identically and mean nothing.

**No email or phone**, though the real Profile card shows both — a
plausible-looking address or number on a public page has a real chance of
belonging to somebody. Test asserts neither appears.

**Bug caught by the theme test:** the timeline's reached-state ring was written
as `box-shadow: 0 0 0 3px` — zero blur, zero offset, so a ring and not a shadow.
The test flagged it anyway and was right to: "but mine isn't really a shadow" is
exactly the argument that lets the next hard drop-shadow through. Replaced with
`outline` + `outline-color`, which says what it is, needs no token, and is
transitionable.

Consistency held: match score 91/100 here, in the AI story and in the platform
showcase — one candidate across four sections. Verdict attributed to a named
recruiter, and a test asserts the journey ends on Activity, not on a score.

Mobile: one column at 900px (never sticky, so nothing to unpin); tab row wraps
rather than scrolling — six short labels make two tidy rows at 390px and a
scroller would hide half the journey behind a gesture nobody knows to make. At
620px the timeline actor moves under its label.

`lint` clean · `typecheck` clean · `build` clean · 1962/1962 (+9). Verified on
the dev server: one h1, six panels with zero dangling `aria-controls`, five
hidden, all six views' content present in crawlable HTML, no email/phone.

**Still not verified:** the breakpoints, visually. And whether dropping the
sticky treatment here reads as relief or as inconsistency — that is a judgement
only scrolling the assembled page can make, and it is the open question to
settle before Module 09 adds another big animation.

---

## 2026-09-21 — Module 09: hiring pipeline

**THE CORRECTION THIS SECTION IS BUILT ON: there is no drag-and-drop**, and the
product's reason is better than the feature. `app/pipeline/PipelineBoard.tsx`:
*"Button-based stage moves rather than drag-and-drop … a dropdown is
keyboard-accessible, works on a phone, and cannot fire from a mis-drag. Moving
someone through a hiring pipeline should be deliberate."* §11 said not to imply
dragging if it does not exist; animating one would have advertised the single
interaction the product deliberately refused. A test bans any positive drag
claim and requires the correction to be stated.

**Other findings from §2:**
- 8 real stages; FOUR are per-job configurable, so a board shows six. The
  caption says so rather than letting six look like the whole product.
- **No Offer stage.** The brief's flow ended "Review → Offer → Hired"; an offer
  is an automation ACTION (`send_offer_letter`). Test bans an Offer column.
- Terminal outcomes are **exit counts, not columns** — the real board's own
  decision: "otherwise the board fills with finished work and stops being a
  work queue."
- Real SLA aging: `DEFAULT_SLA_DAYS` (2/3/3/5/7/7/7), statuses ok/at_risk/
  breached, `AT_RISK_THRESHOLD = 0.75`. A test checks every column's target
  against `DEFAULT_SLA_DAYS`, so §13's bottleneck beat is truthful.
- `move_to_stage`, `start_screening_call`, `notify_recruiter` are real
  automation actions, so §12's automatic transition is genuine.

**The card genuinely travels.** ONE `<CandidateCard>` in an overlay grid with
the same six tracks and the same `--gap` as the board; advancing a beat changes
`--col` and it translates `--col * (100% + gap)` — 100% of its own width being
exactly one track. Transform only, no library, same DOM node in Applied and in
Hired. Rendering it inside whichever column owned it would unmount/remount:
identical screenshot, no animation. `--gap` is declared once on the board and
read by both grids — get it wrong and the card drifts further out of line with
every column it crosses.

**Two controls that do not fight.** Scroll drives the beat; clicking a column
header focuses it. Orthogonal, so a click is never undone by the next pixel of
scroll — the exact collision that made me drop scroll control in Module 08.

**Mobile is genuinely redesigned, not shrunk.** Six columns become six ROWS and
the card travels DOWN: the overlay grid turns single-column and the transform
swaps to `translateY(--col * --row-h)`. Same card, same property, same
transition. Cards sit side by side within a row so a busy stage is not three
screens tall.

**Sticky, at 200vh** — the low end of the brief's range. Scroll-as-transport is
more justified here than anywhere else on the page (you scroll, the candidate
advances), and this is a third distinct composition: full-width board with the
rail beneath, versus the centred panel (06) and the two pinned columns (07).

**`PipelinePreview` deleted**, along with `PIPELINE_PREVIEW`. It was the
redundant third product shot flagged during Module 05; this is the module that
owns the area, so it is the module that resolves it. Net page sections
unchanged.

**A comment I had to correct:** I wrote that `aria-pressed` was the styling
hook for column focus. It is not — the dimming is on the parent via
`data-state`. The guarantee I claimed is real (both derive from one `focus`
value) but the mechanism was described wrong, so the comment was fixed rather
than left to mislead the next reader.

`lint` clean · `typecheck` clean · `build` clean · 1974/1974 (+12). Verified on
the dev server: exactly ONE traveller element, six columns with real stage
names, counts narrowing 124→2, real SLA targets rendered, exits as counts, six
`aria-pressed` toggles, all six beat captions in crawlable HTML.

**Still not verified:** the breakpoints and the travel animation, visually —
including whether `--row-h: 9.25rem` on mobile actually matches the collapsed
row height. That value is the one number in this module I could not compute
from source, and it is the first thing to check in a browser.

## 2026-09-21 (later) — Module 09 completion pass

The Module 09 prompt was re-sent unchanged. The work was already committed and
green, so rather than rebuild it I audited my own delivery against the brief
and closed the four things I had skimped:

**§11 — counts now move.** `PIPELINE_COLUMNS.count` is the base EXCLUDING the
travelling candidate, and `pipelineCountAt(col, beat)` adds them to whichever
column holds them. A move therefore decrements the source and increments the
destination, which is what makes the card read as a move rather than a
duplicate sliding over a static picture. Two tests: the funnel must not widen
**at any of the six beats** (the +1 lands on a different column each time, so
the base has to be chosen for all six), and each beat must show exactly one
−1 and one +1 summing to zero.

**§13 — the bottleneck moment, as a count not a claim.**
`pipelineBreachesAt(col)` totals cards the SLA model already marks `breached`.
The product does NOT have bottleneck detection; it ages cards against a target
you set. The indicator says "2 past target" — red ink AND the words, on the one
line whose job is to be noticed. A test pins the total against the card list.

**§8/§20/§24 — connectors, and a signal on the one the candidate is crossing.**
A 1px rule in each gap via `.pl-col + .pl-col::before`, reaching left so the
connector belongs to the column it points at — which is what lets hovering a
stage brighten its own incoming line. `::after` is the travelling dot, and a
`@for` emits five `[data-beat=i] .pl-col:nth-child(i+1)` rules so **exactly one
connector is animating at any moment** rather than five pulsing forever. On
mobile both pseudo-elements re-aim vertically and the keyframe swaps to
translateY.

**CSS rather than SVG, deliberately, and the reasoning is the same as the
waveform's:** SVG earns its keep where a path is a curve (the AI section's
three converging lines). These are straight segments inside a `var(--gap)` that
changes with the viewport — an SVG would need its viewBox recomputed at every
breakpoint to stay aligned with the grid, where a pseudo-element in the gap is
aligned by construction.

**§11/§12 — the confirmation** reads "Stage changed to Director Round · R.
Menon". "Stage changed" is the real activity event label, and it names a person
rather than implying the board moved someone itself. `visibility` as well as
opacity so the board never grows a line when the beat arrives.

Counters deliberately have no `aria-live`: six announcing on every scroll beat
would be unusable, and the beat caption already narrates the change once in a
sentence.

`lint` clean · `typecheck` clean · `build` clean · 1976/1976 (+2). Verified:
beat-0 board reads 124/46/28/9/4/1 (Applied matching the hero's funnel top),
breach lines absent until the aging beat, toast present but hidden, one
traveller element, all five signal selectors compiled.

---

## 2026-09-21 — Module 10: candidate applications + forms

**`lib/forms/submit.ts` overturned the brief's story, and that is the section.**
The obvious animation — fill a form, AI reads the resume, a profile appears —
is a different and worse product than this one. The real order, from that
file's own header:

1. **The answers are saved FIRST**, before storage, before the model, before
   the candidate insert. "A downstream failure loses a link, never a
   submission."
2. **AI failure is not submission failure.** Candidate and application are
   created from the TYPED answers. "Telling somebody their application failed
   because our model was busy would be absurd."
3. **An existing candidate is never overwritten** — not by the parse, not by
   the form. "A public form is an unauthenticated claim about a record a human
   established." The parse queues in `resume_parse_results` with
   `reviewed_at` null.

So the six beats are apply → resume → **saved** → **created** → parsed →
**proposed**, and the section ends on a proposal awaiting review rather than on
a profile the model rewrote. A test pins the order AND the two inequalities
(saved < parsed, created < parsed), because reverting to the obvious story
would be an easy and invisible edit.

That ending also connects straight back to Module 08's Resume view, which
already shows "Proposed change · Notice period 60 → 30 days".

**Fields are DEFAULT_APPLICATION_FIELDS**, six of thirteen, with the real
labels and the real required flags (email and resume are PROTECTED_FIELD_KEYS,
enforced by migration 0033). Tests check both against the constant.

**Other real facts used:** custom questions can be added to any form but a
custom FILE upload cannot (`CUSTOM_FIELD_TYPES` excludes `file_upload` — "a
form that collects someone's documents and drops them is worse than one that
never offered"); the public endpoint is rate-limited; matching runs on
normalised email and phone.

**THE FORM CANNOT SUBMIT, BY CONSTRUCTION.** No `action`, no `onSubmit`, no
fetch, no Supabase anywhere in the file's import graph; inputs `readOnly`,
button `disabled`. Not "we remembered not to wire it up" — there is nothing
that could reach a backend. Real `<label for>`/`<input id>` pairs though: a
form drawn out of divs is not a demonstration of a form.

**Email is `@example.invalid`** — RFC 2606 reserved, can never be registered,
so it cannot ever belong to a real person the way a plausible @example.com
eventually might. Test pins it.

**No progress percentage.** The bar is indeterminate (62% → 100% as CSS
widths) and the text says "Processing" then "Filed". There is no work behind
it, so a number would be inventing one; a test bans `\d+%` from the copy.

Composition: a three-column split (form | flow lane | Scoreboad) — a fourth
distinct layout after the centred panel (06), two pinned columns (07),
full-width board (09). Sticky at **180vh**, the shortest track on the page.

Mobile: the split stacks, the lane's three rules turn vertical with the signal
keyframe swapped to translateY, nothing is pinned or gated, and the six
captions render as a numbered list via `counter-increment`.

`lint` clean · `typecheck` clean · `build` clean · 1984/1984 (+8). Verified:
one `<form>` with no action, zero fetch, 6 bound labels, 6 record rows in
crawlable HTML, `@example.invalid` present, no `@gmail/@example.com`, no
percentage string anywhere in the section's DOM.

Note: React 19 SSRs `readOnly` as `readOnly=""` (camelCase). HTML attribute
matching is case-insensitive so it IS the readonly attribute — a case-sensitive
grep for `readonly` returns zero and is not evidence of a problem.

**Page state:** 16 h2s, six deep bands against eight bright, four scroll tracks
(220 + 260 + 200 + 180 = 860vh). Still unverified visually at any breakpoint.

---

## 2026-09-21 — Module 11: recruitment automation

**The engine gave the section two details that do all the work**, both read
before any copy:

`lib/automations/approvals.ts` — a rule marked `requires_approval` **does not
act, it proposes**; the run parks at `awaiting_approval` with its actions
**SNAPSHOTTED**: *"if the rule is edited between proposal and decision,
executing its CURRENT actions would mean their click authorised something they
never read."* It expires at seven days, and expiry is its own status —
*"'we let it lapse' and 'we said no' are different facts about somebody's
application."*

`lib/workflow/delay.ts` — a wait is 1 minute to 30 days with a real basis
(`after` / `before_scheduled_call` / `before_interview`), cancelled if the
application changes stage, and a `before_*` wait with no anchor returns null:
*"never 'fire now'. Firing now would send a 'you'll be getting a call shortly'
message to somebody with no call booked."*

**THE APPROVAL NODE IS STRUCTURAL, AND A TEST ENFORCES IT.** The gate sits
before EVERY action because that is where the engine puts it. Drawing it beside
one action would describe a different engine and imply the others run ungated.
The test asserts every `kind: "action"` node comes after the approval node.

Other verified facts used: nine triggers, all wired, with real
`TRIGGER_LABELS`; `screening_call_completed` is `service` mode — Bolna's
webhook, nobody signed in, so the engine limits itself to what it can do alone;
an action nested after a wait cannot need a session.

**`label` vs `action` on a node.** First version's test compared the display
label to `ACTION_LABELS` and failed on "Move to Video Interview" — the real
label is "Move to a stage". Rather than loosen the test, the data now carries
BOTH: `label` is the configured form (what a built rule reads like on screen),
`action` names the catalog entry, and the test checks `action`. Asserting on
the display label would either ban configuration from the picture or let an
invented action through under a plausible name.

**Two real bugs, both mine, both caught by the build:**
1. **Client boundary.** `MagneticCta` is `"use client"` and I passed it
   `icon={ArrowRight}` — a FUNCTION — from a server component. Production build:
   *"Functions cannot be passed directly to Client Components."* Every magnetic
   CTA is a forward action, so the arrow is now imported inside the client file
   as a fixed default and the boundary problem is gone.
2. **Deprecated Sass global.** `percentage()` is removed in Dart Sass 3, and I
   had used it in all FIVE sentinel blocks (Modules 06/07/09/10/11). Replaced
   with `calc(#{$i} * 100% / N)`, which Sass folds at compile time to the same
   exact percentages. **Project code now emits zero Sass warnings** — the only
   remaining ones are Bulma's own.

**MagneticCta** is a new reusable client wrapper: 4px pull, written to two
custom properties on the node rather than to React state (a pointermove that
re-rendered would be a re-render per frame for a decoration). Gated on a real
pointer and on reduced motion. Presentational wrapper only — no role, no focus,
so the link inside keeps all its semantics.

Composition: vertical graph left, run log right, detail inline UNDER each node
(§26 wants a tap to open it there, and one behaviour that works on both beats
two that each work on one). Scroll advances the run; clicking a node opens its
detail — independent state, so a click survives the next pixel of scroll.

`lint` clean · `typecheck` clean · `build` clean · 1993/1993 (+9). Verified:
one h1, seven detail panels with zero dangling `aria-controls`, node kinds
Trigger/Condition/Approval/Wait/Action/Action/Candidate, 7 log rows, magnetic
CTA → /product/operate, sentinels at 0/14.29/28.57/42.86/57.14/71.43/85.71%.

**Page state:** 17 h2s, seven deep bands against eight bright, FIVE scroll
tracks (220+260+200+180+200 = 1060vh). Still unverified visually. This is the
fourth module where I have flagged the compounding scroll length.

---

## 2026-09-21 — Module 12: integrations

**Every integration verified against `PROVIDER_DESCRIPTORS`**
(lib/settings/integrations.ts). Five, and exactly five: Google Calendar
(OAuth), Bolna AI, AI provider, Email, WhatsApp Business. Labels, descriptions
and `featureImpact` are copied verbatim, and a test asserts all three match the
constant — plus that the SET matches both ways, so an extra entry is an
invented integration and a missing one is a real connection left unmentioned.

**Two things a logo wall would have got wrong:**

1. **n8n is retired.** `lib/integrations/n8n` still exists, so it looks live
   from the filesystem — but `CustomerFacingProvider` is literally
   `Exclude<Provider, "n8n">`, its action is in `RETIRED_ACTIONS`, and it has
   no descriptor. Nobody can connect it. A test bans the string.
2. **Google Meet is not a separate integration.** Meet links are a capability
   OF the calendar connection ("Creates interview invites and Meet links"). A
   Meet node would double-count one OAuth grant and imply a second setup step.
   Test bans a Meet node and requires Meet to appear in Calendar's impact.

**`featureImpact` is the section's best idea and it came from the product.** It
is what the settings page shows before you disconnect something — "Interview
invites — interviews still schedule here, but nobody is invited". That answers
§10's "why does this integration matter?" far better than a logo, and it is
already written.

**Categories are the settings page's three**, not five invented to make the
network look bigger. Test pins them.

**NO STICKY TRACK — the fourth deviation on this point, and the reason is now
arithmetic.** §11 asked for another 180–240vh. The page already carries five
such tracks totalling ~1060vh, and the thing being built here is five lines.
The network BUILDS ON ENTRY instead: `<Reveal>` adds `.is-shown`, and the
stylesheet draws each wire and node off a per-index delay. That is §12's
progressive build using the primitive the site already has, at zero added page
height. Reader time goes into selection instead, which is the right trade — a
network's interesting question is "what is that one for?", and that is a click.

**Geometry without measurement:** a 3×3 grid holds hub and nodes; one SVG lies
over it with `preserveAspectRatio="none"` and a 0–100 viewBox, so its
coordinates map linearly onto the same box. No resize observer, and the lines
cannot drift out of step with the nodes because both are positioned by one
element. `vector-effect: non-scaling-stroke` keeps a 1px line 1px under the
non-uniform stretch — without it the horizontal spokes render visibly fatter
than the vertical one.

**The detail panel is the accessible equivalent of the diagram.** One panel
below the network (same behaviour under a tap and a click, never covers what it
describes), always in the DOM so `aria-controls` resolves, and its DEFAULT
state lists all five integrations as text — so the network's content survives
without lines, without colour and without a pointer.

Mobile at 860px: the radial becomes a vertical chain with Scoreboad as the
anchor, and **the SVG is removed** — its lines describe an arrangement that no
longer exists, and a diagram contradicting the layout under it is worse than
none. CSS connectors take over.

**No logos**, and not only because the brief says so: two of the five are
generic by nature ("Email", "AI provider" — a provider you choose), and the
other three belong to companies whose marks this site has no licence to print.

`lint` clean · `typecheck` clean · `build` clean · 2002/2002 (+9). Verified:
5 nodes with the right labels, 5 wires, zero "n8n", no Meet node, all five in
the accessible fallback list, CTA → /how-it-works (no /integrations page
exists).

**Page state:** 18 h2s, seven deep bands against nine bright, five scroll
tracks (~1060vh, unchanged by this module).

---

## 2026-09-21 — Module 13: analytics & hiring intelligence

**THE MARKETING PAGE RENDERS THE PRODUCT'S ACTUAL CHART COMPONENTS.**
`KpiTile`, `FunnelChart`, `BarChart` and `OrbitalMeter` are imported straight
from `app/analytics/charts.tsx` — it turned out they have **no `"use client"`
and no imports at all**: pure presentational components that merely live under
`app/`. So the funnel on the homepage IS the product's concentric-orbit funnel
(10 `<circle>` elements in the served HTML), not a lookalike. If somebody
changes how the product draws a funnel, this page changes with it.

**The price is a token bridge, and it is the interesting part.** Those
components style themselves with the APPLICATION's tokens, which are dark by
default and flip on `prefers-color-scheme`. The marketing palette is
deliberately pinned — the page's light/dark bands are art direction, not a
preference — so a visitor with a dark OS would have got dark-mode ramps and
light-grey secondary text on a white marketing card. `.an-surface` re-declares
the ~16 app tokens those components read, at their LIGHT values, copied from
globals.scss rather than invented. Reusable for any later module that wants to
show a real app component on a marketing band.

**No chart library and no Motion in package.json** (bulma, lucide-react, sass) —
so §25's "reuse Recharts/Framer if installed" resolves to: neither is, and
`charts.tsx` says why. "No charting library: a dependency would be more code
than these four forms."

**The three chart subtitles ARE the section's argument**, copied verbatim:
- "Each step counts applications that ever reached it, not those sitting there
  now."
- "Median days, from closed stage visits only. A stage nobody has left yet
  shows no figure."
- "A source with too few candidates shows its raw counts instead of a
  percentage."

A product that refuses to print a percentage it cannot support is the whole
case for trusting its analytics, and it was already written down. Three tests
protect the consequences: one stage must show **no figure** (an em dash, not a
zero — zero days in a stage is a very different claim from no data), one source
must show **raw counts** rather than a rate, and the copy may not contain
predict / forecast / benchmark / "who will".

**Real filters exist** (DATE_RANGES 7d/30d/90d/12m, job, client, recruiter) but
are shown as a PICTURE — spans, `aria-hidden`, not focusable. A control on a
marketing page that looks like it filters and does not is worse than none. Same
rule as the pipeline's stage menu and the voice section's verdict buttons.

Scroll track is **160vh, the shortest on the page** and below §5's suggested
range: the dashboard is fully readable from the first frame, so the four beats
change EMPHASIS rather than revealing content, and emphasis does not need two
screens to land.

Composition: activity stream left, dashboard right, human note across the foot
— a sixth distinct layout. Events carry a fixed ±1.4deg tilt (two alternating
values, no randomness to hydrate wrong) that squares up when they sort.

`lint` clean · `typecheck` clean · `build` clean · 2010/2010 (+8). Verified:
one h1, 19 h2s, real KPI labels, all three subtitles present, em dash for the
blank stage, "0 of 4" for the unrated source, funnel and meters drawn as SVG,
token bridge in the served CSS.

**Page state:** 19 h2s, seven deep bands against ten bright, six scroll tracks
(220+260+200+180+200+160 = 1220vh).

---

## 2026-09-23 — Module 14: who it's for

**FOUR PERSONAS, NOT THE FIVE ASKED FOR — and the reason is the site's own
navigation.** The brief wanted Recruiters, Hiring Managers, HR Teams, Startups
and Agencies. Checked against the product:

- **`org_role` is `owner | admin | recruiter | viewer`. There is NO
  hiring-manager role.** A hiring manager participates through interviews and
  structured feedback — real, but not a mode of the product. Saying otherwise
  sends an admin looking for a role in team settings that does not exist.
- **"HR teams" and "startups" are market segments, not product distinctions.**
  Nothing in the codebase behaves differently for either.
- **The ONE structural split is agency vs in-house.**
  `lib/organizations/hiringModel.ts`: *"One product, two buyers."* An agency
  has clients, submissions and feedback SLAs; for an in-house team "every
  client-facing surface is a permanently empty page."

So the four are **`ROLE_FLOWS`** — which already exist, were written from
docs/00-overview.md, already render on /how-it-works, and are **already the
four items in the navbar's "Who It's For" menu** (the anchors I added in
Module 02). Five different personas here would have contradicted the site's own
nav. `role`, `summary` and `steps` are READ from ROLE_FLOWS by the component
rather than copied, so homepage, /how-it-works and navbar cannot drift; a test
asserts the anchor sets match.

**The central visual is the product's own nav rail** — `DASHBOARD.nav`, the
real six top-level surfaces — with the ones a persona actually opens lit and
the rest dimmed to 0.45. Nothing is added or removed between personas, which
is the section's claim made literal: same product, different weighting.

**The candidate's rail lights NOTHING**, and that is the sharpest true thing in
the section. A candidate never signs in, so no part of the workspace is theirs.
Required no design — only the discipline not to light something to avoid an
awkward blank. A test asserts `surfaces` is empty.

**No scroll track** (§7 asked for 180–260vh). §5 and §9 describe a SELECTOR,
and scroll-as-transport would overrule the reader's choice on the next pixel —
the exact collision the candidate-workspace section was built to avoid. Fourth
deliberate instance; the page already carries six tracks.

**Two mistakes of my own this module:**
1. A `str.replace` targeted `ANALYTICS_CLOSING,` and hit the occurrence in the
   **import list** instead of the one in `ALL_COPY`, injecting expressions into
   an import statement. The repair script then died on a later assert *before*
   `write_text`, so the "undo" never landed and the file stayed broken through
   a second run — worth remembering: a Python patch script with several asserts
   writes nothing if a late one fails.
2. The rail's "None of it. They never sign in." line was conditionally
   RENDERED, so it was absent from crawlable HTML until somebody selected that
   tab — the same mistake Module 07 made with its correction line. Now always
   rendered, `hidden` when the rail is non-empty.

`lint` clean · `typecheck` clean · `build` clean · 2018/2018 (+8). Verified:
one h1, 20 h2s, four panels with zero dangling `aria-controls`, four persona
h3s from ROLE_FLOWS, 12 links all to real routes, the rail line present and
hidden by default.

**Page state:** 20 h2s, eight deep bands against ten bright, six scroll tracks
(~1220vh, unchanged by this module).

---

## 2026-09-23 — Module 15: security & trust

**THE HOMEPAGE ALREADY HAD THIS SECTION.** `TrustSection` carried six verified
guardrails (human review, candidate consent, database isolation, audit log,
encrypted credentials, graceful degradation) — exactly §11's "4–6 cards". So
this UPGRADED that band rather than adding a second version of the same
argument beside it. H2 count unchanged at 20, which is the proof.

**The decisive finding: `docs/SECURITY.md` and `docs/PRIVACY.md` label every
area `IMPLEMENTED` / `PARTIAL` / `RISK` / `MISSING`.** That turns §1's "only
represent security mechanisms that actually exist" from a judgement call into a
lookup. Only IMPLEMENTED areas appear:

  §1 Authentication · §2 Authorization & RBAC · §3 Multi-tenancy & IDOR ·
  §8 File upload · §11 Candidate signed links · Privacy §2 Consent

**Deliberately absent** because the docs mark them PARTIAL or worse: input
validation, rate limiting, secrets handling, logging, and **data retention —
which PRIVACY.md itself calls "the largest privacy gap"**. A test fails if any
of them is claimed.

**The signature visual is a BOUNDARY, not a flow, and that is why this is not a
fifth scroll story.** §5's phases are the same shape as Modules 06/07/11 — a
fourth "watch a thing travel down a chain" would say nothing new. A boundary is
spatial: two workspaces, a seam, and a request crossing it that gets **"Not
found"**, never "forbidden" — because a cross-tenant id returns 404 so the
difference between the two answers cannot be used to learn which records exist.
The neighbour workspace is dimmed and dashed rather than absent: the point is
that it EXISTS and still cannot be reached, which one box would not say.

**Best material in the codebase, from SECURITY.md §11** (candidate links):
an HMAC over the row's own id with **nothing stored** — "a database dump
contains no working links and there is no token column for a mistaken SELECT to
leak"; bad signature, missing key and malformed token all fail **identically
and in constant time**, "because distinguishing them would let someone probe
which rows exist"; one `token_version` bump revokes every link and QR ever
issued. And the line that is the product's whole ethic: *"a dead unsubscribe
link is worse than an instruction to a human, because the candidate believes
they have opted out."*

Other verified specifics used: four roles enforced at **three** layers (UI, API,
database); role transitions are DB triggers, only an Owner grants Owner, and an
org cannot be left without one; the active-workspace cookie is a **hint**
re-checked every request — a forged value gets the default workspace, not
access; ~20 tenant-integrity triggers.

**Honesty line added**, pointing at the FAQ rather than restating it so the two
answers cannot drift: "No certification is held, and this section claims none."
A test requires that sentence AND bans SOC 2 / ISO 27001 / HIPAA / PCI /
FedRAMP / CCPA / "GDPR compliant" anywhere in the section, plus the §14 register
(bank-level, military-grade, unhackable, 100%, guarantee).

**A test also bans schema leakage** — no policy SQL, no `organization_id`, no
"service-role", no "Supabase", no key names. The diagram is the shape of the
rule, not the rule.

`lint` clean · `typecheck` clean · `build` clean · 2026/2026 (+8). Verified:
one h1, 20 h2s (unchanged — no duplicate section), four layer panels with zero
dangling `aria-controls`, the boundary verdict reads "Not found", the AI chain
badges read AI / Code / Person / Person, and all six original trust cards
survived intact.

**Page state:** 20 h2s, eight deep bands against ten bright, six scroll tracks
(~1220vh, unchanged by this module).

---

## 2026-09-23 — Module 16: use cases (no customer stories exist)

**§1's search was conclusive: there is no verified customer content.** The
project's OWN SPEC says so — `docs/modules/21-public-website.md:143`: *"no
customer logos, no testimonials, no invented pricing tiers and no security
certifications."* No CMS, no quotes file, and `public/` holds exactly three
files, all Scoreboad's own brand assets. So §11's alternative applies.

**THE DESIGN PROBLEM, AND THE RESHAPE.** The five scenarios §4 sketches map
onto bands this page already demonstrates at length — high-volume screening is
the AI band, structured interviews the screening call, candidate management the
workspace, hiring workflow the pipeline board. A section showing them again
would be a recap of the page it sits in, on a page that is already 21 h2s long.

So it is built as an **INDEX BY PROBLEM** — the one thing none of those bands
can do for itself: let a reader who skimmed say "that one is my problem" and go
straight to the part that answers it. Each scenario carries a link INTO this
page (`/#ai`, `/#voice`, `/#candidates`, `/#pipeline`, `/#automation`) and OUT
to a capability page. Navigation by situation rather than by feature — which is
what §16's internal-linking requirement is actually for.

A test asserts every `onPage` fragment is a section this page really renders
(a link into a section that does not exist scrolls nowhere and nothing reports
it) and that no two scenarios share a destination — two pointing at the same
place would make the index useless as an index.

**§6's scattered→orb→connected animation was NOT rebuilt.** That is the
challenge band near the top of this page, built beat for beat in Module 04.
A second copy would be the clearest duplication on the site. The visual is each
scenario's own chain instead — different stages per scenario, which is the
thing that actually differs between them. Connectors and arrowheads are drawn
by the steps' own pseudo-elements (two rotated borders, no icon, no SVG), so a
chain of a different length needs no other change; on a phone the arrow rotates
135deg and the chain becomes a column.

**The honesty note is full-size and centred, not small print:**
"These are product scenarios, not customer stories. Scoreboad is early and has
no customers to name yet — so there are no logos here, and nothing on this page
claims otherwise." A young product saying so is more credible than a row of
invented marks, and this page has taken that line everywhere else.

Tests added: no company/quote/rating/count vocabulary anywhere; the note must
contain both admissions; **no outcome may promise a business result** (banned:
`\d+x`, `%`, faster, cheaper, save time/money, guarantee) — every outcome is a
capability, which is checkable, rather than a result the product cannot
control; and nothing may say the product chooses, picks, selects or ranks a
candidate, with at least one outcome crediting a person explicitly.

Placed directly before the FAQ and `flush` with the trust band above: what the
product protects, then what it is for, then the awkward questions. Reader-driven
— an index wants to be scanned, and a seventh scroll track on this page would
be indefensible.

`lint` clean · `typecheck` clean · `build` clean · 2033/2033 (+7). Verified:
one h1, 21 h2s, five panels with zero dangling `aria-controls`, five H3s that
are situations rather than feature names, all five on-page targets distinct and
real, no "trusted by"/"testimonial"/"customers say" anywhere in the page.

**Page state:** 21 h2s, eight deep bands against eleven bright, six scroll
tracks (~1220vh, unchanged by this module).

---

## 2026-09-23 — Module 17: resources / content hub

**§1's inspection: no blog, no guides, no documentation, no case studies, no
product-tour route, no content directory, no CMS.** Ten public URLs total, and
`navigation.ts` already marks `/blog`, `/resources/guides` and `/docs` as
`planned`.

**The easy move was an empty state. The better one was noticing the site DOES
have real reading material — it is simply not in a blog.** A fifteen-stage
walkthrough, six capability pages, the AI safety model, a use-case index and a
FAQ that answers the unflattering questions are all published and all
crawlable. Nine real destinations. So the section indexes what exists.

**`/how-it-works` IS the product tour §23 asks about**, which is why it is the
featured item rather than a placeholder. Its meta reads "15 stages · the full
walkthrough" — a COUNTABLE FACT a reader can check, rather than a fabricated
"5 min read". §5 bans invented dates, authors and reading times; a test bans
`min read`, `by Firstname Lastname`, a four-digit year, and "published".

**What does not exist is a SENTENCE with no links in it:** "Still to come: a
blog, hiring guides, product documentation. None of them exist yet, so none of
them are linked." A "coming soon" card that looks clickable is a broken link
with better manners, and a greyed-out one still invites the click. A test
requires all three to be named and none to contain a "/".

**No filter.** §7 allows one "if enough real resources exist"; nine items in
three groups is enough to justify headings and not enough to justify a control.
Headings are better for a crawler, and it keeps the section **entirely
server-rendered** — which is what §9 means by lighter than the storytelling
bands. The only client code is the existing `Reveal`/`Stagger`.

**`ResourceCard` went in `components/marketing/`**, not the home folder — §21
asks for components a blog can reuse, and this is the one that qualifies: it
takes a title, description, category and href and knows nothing about the
homepage. A `/blog` index can render it over article front-matter the day one
exists.

Capability cards read `CAPABILITY_GROUPS`' own `heading` and `summary` rather
than copying them, so a rewritten product page rewrites its card; a test pins
the href set against the groups.

Tests also ban: any link to `/blog`, `/docs`, `/resources`, `/guides`,
`/solutions` or `/platform`; duplicate resources; and any claim about how MUCH
content there is (`\d+ articles`, "library of", "hundreds", "weekly"), while
requiring the lead to say the listed things are readable NOW.

Dark band between two light ones, which is also §6's dark editorial surface.
The featured visual is the brand mark on a soft radial field — no photography,
no generated illustration.

`lint` clean · `typecheck` clean · `build` clean · 2041/2041 (+8). Verified:
one h1, 22 h2s, nine card links all real, featured → /how-it-works, zero links
to planned routes, the coming line naming all three gaps.

**Page state:** 22 h2s, nine deep bands against eleven bright, six scroll
tracks (~1220vh, unchanged by this module).

---

## 2026-09-23 — Module 18: pricing

**§1's inspection: there is no billing system.** No Stripe (the only match in
the codebase is a test asserting `isProvider("stripe")` is FALSE), no
subscriptions table, no plans, no checkout, no trial clock, no seat counting,
no usage metering. The single "billing" mention in lib/ is a note about a voice
provider's balance API this product deliberately does not call.

**SECOND FINDING, and the real reason this section earns its place: the site
answered the pricing question NOWHERE.** `lib/marketing/content.ts`'s `FAQS`
has an answer — *"Pricing is not published yet. Get in touch..."* — but that
array is **DEAD**: nothing renders it, its only reference is its own test. The
FAQ that DOES render (`HOME_FAQS`) has no pricing question at all. A visitor
wondering what this costs found silence.

So this is not a placeholder standing in for a pricing table. It is the answer,
in the place people look for it: *"What Scoreboad costs today. Nothing, because
there is nothing to charge for yet."*

**Everything the brief asks for that depends on pricing existing was omitted,
not invented:** no plan cards (§5), no monthly/annual toggle (§4), no
recommended plan (§6), no feature comparison (§8), no free tier (§13), no trial
(§14), no enterprise tier (§15 — and no SSO/SCIM/SLA claims, which is where a
pricing page collects them by habit).

**The careful wording is "no plan limits", never "unlimited"** (§8 bans
assuming unlimited anything). The real statement is narrower and stronger:
there are no plan limits because there are no plans. A test bans "unlimited"
and requires the "no plans to limit" phrasing.

**No "talk to sales".** There is no contact, demo or sales route, and a button
that opens nothing is worse than no button. The dead FAQ answer says "get in
touch" — exactly the promise this cannot repeat, because there is nowhere to
get in touch. CTAs are `/signup` and `/how-it-works`, both real; a test bans
sales/demo/contact labels and asserts the primary is `/signup` with no
buy/subscribe/checkout wording.

**A stale comment of mine, corrected.** `lib/marketing/navigation.ts` justified
keeping `/pricing` as `planned` by citing "the FAQ on the home page says
pricing is not published" — which stopped being true when the homepage FAQ was
rewritten. Both occurrences now cite the real reason (no billing system) and
point at this section.

Also promised in copy and pinned by test: **anyone already using the product
will be told before anything changes for them.** That is a commitment the page
makes, and it should survive editing.

`lint` clean · `typecheck` clean · `build` clean · 2049/2049 (+8). Verified
against the section's visible text only: no currency-and-digit anywhere (the
earlier positive was React's Flight payload — `$7`, `$17` — not content), no
trial or discount language, no "unlimited", both CTAs real.

Entirely server-rendered: nothing here holds state, because there is no second
billing period to toggle to. Light band, `flush` with the FAQ above — the
awkward questions, then the most awkward one, then the ask.

**Page state:** 23 h2s, nine deep bands against twelve bright, six scroll
tracks (~1220vh, unchanged).

## 2026-09-23

**Module 19 — About Scoreboad.** First dedicated marketing route rather than a
homepage section.

- New: `lib/marketing/about.ts` (content), `app/(marketing)/about/page.tsx`,
  `lib/marketing/about.test.ts` (16 assertions), `.ab-*` block in
  `app/(marketing)/marketing.scss`.
- Wired: `/about` into `INTERNAL_ROUTES`, `app/sitemap.ts` (0.5 / yearly), a
  footer link under "How it works", and **`PUBLIC_PATHS` in
  `lib/supabase/session.ts`**.
- **No company section, no team, no timeline, no founding year.** package.json
  has no `author`; nothing in the project records a founder, location, entity,
  funding or milestone. The footer's `© {year}` is the CURRENT year — a
  copyright line, not a founding date. Inventing one from that template is the
  exact failure the page is tested against.
- Decided: the README is stale in calling n8n the automation orchestrator
  (retired in Module 12). Not carried forward onto the page.

Two bugs worth keeping:

- **Deny-by-default 307'd the new page.** `/about` rendered perfectly and every
  anonymous visitor — including crawlers — got `/login?next=%2Fabout`. Same
  class as the robots.txt/sitemap.xml bug already recorded in `session.ts`.
  **Any new public route needs a `PUBLIC_PATHS` entry, and `curl` is the only
  way this shows up** — build, lint, typecheck and the test suite were all green
  while the page was unreachable.
- **`<Stagger as="ol">` already wraps each child in its own `<li>`.** Passing an
  `<li>` as the child nests them, which is invalid and makes the browser close
  the outer one early — breaking the `counter-increment` the step numbers use.
  Children of Stagger must be non-`li` elements.

`about.test.ts` pins the "Says what it does not have" principle against the
actual denials elsewhere on the site (`SECURITY_NOTE`, `USE_CASES_NOTE`,
`PRICING_PANELS`), so adding a pricing table in future fails this page's test
rather than silently making it a lie.

## 2026-09-23 (second session)

**Module 20 — dedicated `/security` page.** Second dedicated marketing route.

- New: `lib/marketing/security.ts`, `lib/marketing/security.test.ts` (16
  assertions), `app/(marketing)/security/page.tsx`,
  `app/(marketing)/_components/security/{SecurityOrb,ArchitectureStack}.tsx`,
  `.sec-*` block in `marketing.scss`.
- Wired: `PUBLIC_PATHS`, `INTERNAL_ROUTES`, sitemap (0.7/monthly), nav entry
  "Security & Trust" repointed `/#trust` → `/security`, footer link likewise.
  The homepage trust section STAYS — the page links back to it. Summary and
  long form, not a duplicate.

**§2 classification source: `docs/SECURITY.md`**, which labels every area
IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN with file references. Only
IMPLEMENTED areas are claimed, and each mechanism was also read in the source —
a status line in a doc is not by itself a verified control.

Deliberately NOT claimed, and named on the page as absent: certifications
(none), third-party audit/pentest (none), CSP (deliberately absent — reason is
in `next.config.ts`), MFA, malware scanning, security contact address (none
exists), published privacy policy (none — `app/settings/privacy` is an
in-product screen). **No blanket "encrypted at rest and in transit" claim** —
Supabase/Vercel provide it but this project has verified neither; the only
encryption claim is the integration credential store, whose AES-GCM cipher is
in our own source.

Worth keeping:

- **The five security headers the page claims are real** — verified with
  `curl -I`, not read off next.config.ts.
- `security.test.ts` checks scheme names as WHOLE ENTRIES, not keywords: the
  page names SOC 2 / ISO 27001 / HIPAA in order to deny them, so a bare keyword
  ban would have failed on the most useful sentence on the page and the
  pressure would be to delete it.
- The absence test asserts the gaps are still *present*. Every other guard
  stops something being added; that one stops the credibility being tidied away.
- Nav labels must be **more than one word** — `navigation.test.ts` enforces
  descriptive anchor text. Shortening "Security & Trust" to "Security" failed it.
- Hero animation lives entirely inside `prefers-reduced-motion: no-preference`,
  so the default render IS the finished diagram. Animating *into* the correct
  picture gives the readers who most need a static page an unfinished one.

Deviation reported: §25 asked for a sticky desktop side rail; built as a sticky
contents STRIP instead. Full-bleed alternating dark/light bands are the design
system, and a side rail would either wear the wrong band's colours or narrow
every section to a column — including the architecture diagram that needs the
width. Two sticky offsets written together: navbar 0.75rem, strip 4.75rem,
architecture pin 8.5rem.

## 2026-09-23 (third session)

**Module 21 — `/contact`.** Third dedicated marketing route.

- New: `lib/marketing/contact.ts` (copy + pure `validateContact()`),
  `lib/marketing/contact.test.ts` (29 assertions),
  `app/(marketing)/contact/page.tsx`,
  `app/(marketing)/_components/contact/{ContactOrb,ContactForm}.tsx`,
  `.ct-*` block in `marketing.scss`, new token `--mkt-error-ink`.
- Wired: `PUBLIC_PATHS`, `INTERNAL_ROUTES`, sitemap (0.7/monthly), footer
  ("Contact and next steps"). No nav change — no Contact entry existed.

**§1 found no contact backend and no way to build one without inventing a
destination.** No contact/demo page, no lead table, no scheduling integration,
no Calendly, no published address. **The email adapter cannot be reused**: it is
tenant-scoped (credentials in `organization_integrations`, read only via the
service-role client filtered by `organization_id`) and fails closed — a
marketing visitor has no organization, so there is no row to read a credential
from, and there is no deployment-wide fallback SMTP by design.

So: **no API route was created** (§10 forbids a fake endpoint), the form never
claims delivery, and `/signup` is the single primary CTA — which Module 18 had
already decided for the whole site in `PRICING_CTA`: *"a button that opens
nothing is worse than no button."*

Design decision worth keeping: **the "this does not send" notice sits ABOVE the
fields, not after submit.** A visitor who writes five fields and only then
learns nothing was sent has been wasted. The form is otherwise complete —
labels, autocomplete, inline validation on blur-then-keystroke, `aria-invalid`,
focus moved to the first error — and its submit reaches a `not-sent` state that
offers to copy the draft so the writing is not lost. `validateContact()` is pure
and lives in `lib/`, the same shape as `validateAnswers()`, so a future server
route calls the identical rule.

Two bugs fixed while building:

- **`--color-error` is mode-dependent.** The contact form is a WHITE panel
  inside a DARK band, so the app's error token would have resolved to its
  dark-mode rose (#ff9aa8) on white — a pale pink validation message, on half
  the machines, on a form nobody tests in light mode because the band looks
  dark. Added `--mkt-error-ink: #b4304a` (6.06:1 on white, 5.75:1 on the light
  ground) to the pinned marketing palette.
- **A live region that is itself `hidden` when its content changes announces
  unreliably.** Restructured so the `aria-live` element is permanent and empty
  and only its contents appear. Do NOT give it `display: contents` — that value
  can drop an element from the accessibility tree, which is the same failure.

## 2026-09-23 (fourth session)

**Module 22 — `/faq`.** Fourth dedicated marketing route, and the site's
canonical FAQ destination.

- New: `lib/marketing/faq.ts`, `lib/marketing/faq.test.ts` (24 assertions),
  `app/(marketing)/faq/page.tsx`,
  `app/(marketing)/_components/faq/FaqBrowser.tsx`, `.faq-*` SCSS block.
- Wired: `PUBLIC_PATHS`, `INTERNAL_ROUTES`, sitemap (0.7/monthly).
- Repointed to `/faq`: nav "Frequently Asked Questions", footer, TrustSection,
  and the Resources index card. All four previously pointed at `/#faq`.

**31 questions across 7 categories.** The homepage's 9 are **imported from
`HOME_FAQS`** and given a category/links via a `HOME_META` map keyed on the
question text — not copied. A rename leaves an entry without metadata and
`faq.test.ts` catches it. The homepage section stays as the short version and
links onward.

**The FAQPage JSON-LD MOVED off the homepage** rather than being added. Two
FAQPage entities describing overlapping content is the duplicate schema the
brief rules out, so there is now exactly one, on the canonical FAQ URL, built
from the same array the page renders. Verified: all 31 schema questions appear
in the rendered HTML.

Decisions worth keeping:

- **Native `<details>`/`<summary>`, reused from the homepage FAQ** rather than a
  hand-built accordion — Enter and Space, expanded state and keyboard operation
  all come from the browser, and Step 8's "no clickable div as a fake button" is
  free. Multiple answers may be open at once (no `name` attribute): these
  questions get compared, so exclusive behaviour would be wrong.
- **The question is an `<h3>` INSIDE the `<summary>`.** Without it the page had
  h1, h2, then 31 questions that were not headings — no heading navigation on
  exactly the page type people navigate by heading. `<summary>` cannot be
  wrapped in a heading (it must be the first child of `<details>`), and the
  spec's content model for it is phrasing content "optionally intermixed with
  heading content", so inside is the arrangement the format allows. The h3 is
  `font: inherit` so the row looks identical.
- **The `::details-content` height transition sits behind
  `@supports (interpolate-size: allow-keywords)`.** Where unsupported the panel
  just appears, which is what it did before.

Questions asked *because* the answer is no: "Does Scoreboad conduct AI
interviews?" (no — screening calls; Module 07's distinction), "Can I drag a
candidate between stages?" (no, deliberate), "Is there a free trial?",
"Can I talk to someone?", certification. The test checks these per-item — a
question may contain the loose phrase as long as its answer denies it, which is
why a bare keyword ban would have deleted the most useful answers.

## 2026-09-24

**Module 23 — global footer + final SEO link architecture.**

- New: `lib/marketing/footer.ts` (route audit + columns),
  `lib/marketing/footer.test.ts` (15 assertions),
  `app/(marketing)/_components/footer/{FooterNav,FooterOrb}.tsx`.
- Rewrote `MarketingFooter.tsx`; replaced the `.mkt-foot*` SCSS block.
- `HOME_FOOTER_SECTIONS` in home.ts is now a **re-export** of
  `FOOTER_SECTIONS`, so Module 01's shared-chrome tests keep their contract
  without a second copy of the data.
- Deleted **73 lines of dead `.mkt-footer` CSS** (no component referenced it)
  and a stale `.mkt-foot__col a:focus-visible` selector.

**Route audit — the whole public surface is:** `/`, `/about`, `/contact`,
`/faq`, `/how-it-works`, `/security`, `/signup`, `/login`, `/product/{6}`.
The brief named ~18 more (/platform, /solutions, /pricing, /demo, /blog,
/docs, /careers, /privacy, /terms, socials…). **None exists**, so none is
linked. Verified every one of the 17 footer destinations with `curl`: all 200,
no redirects.

Decisions worth keeping:

- **NO CTA BAND IN THE FOOTER.** §5 asked for one; §28 says not to duplicate.
  The homepage, /about, /security and /faq *each* already close on a full
  `mkt-band--cta` with the same two actions — 4 of 9 page types. A second one
  would be the same ask twice in a row, weaker for being generic. The footer
  carries **one compact action** in the brand block instead, which serves the
  pages that have no closing CTA (/how-it-works, /product/*, /contact).
- **No social row** — there is no verified Scoreboad account anywhere. The only
  "linkedin" strings in the codebase are a CANDIDATE profile field on an
  application form, i.e. somebody else's account.
- **No Privacy/Terms/Cookie links** — those pages do not exist;
  `app/settings/privacy` is an in-product admin screen behind auth.
- **Product anchor text replaced.** The column used to render the tab words
  ("Source", "Understand", "Decide") — good tabs, useless links. Now each
  carries what the page covers, taken from that page's own heading. The test
  fails if a group falls back to its tab.
- **Mobile accordion via `useSyncExternalStore` on a media query.** Forcing a
  closed `<details>` open with CSS is engine-dependent (old: UA `display:none`;
  new: `content-visibility` on `::details-content`), and rendering the links
  twice duplicates every href. The **server snapshot is `true`**, so the HTML
  ships fully expanded — no-JS and crawlers get everything; collapsing is the
  enhancement. Breakpoint 900px is duplicated in FooterNav and the SCSS; they
  must move together.

Bug worth remembering: **`pathLength` is an SVG attribute, not a CSS
property.** Setting it in the stylesheet silently does nothing, which made the
line-draw animation a no-op that still "looked fine" because the static
diagram was correct. It belongs on the `<path>` element.

Orphan check now lives in `footer.test.ts`: every route in `INTERNAL_ROUTES`
must be reachable from the footer or the navbar.

## 2026-09-24 (second session)

**Module 24 — error states, 404, SEO-safe error handling.**

- New: `app/not-found.tsx` (global 404), `app/(marketing)/error.tsx` (branded
  public boundary), `app/global-error.tsx` (last resort),
  `lib/marketing/errors.ts` + `errors.test.ts` (10 assertions), `.nf-*` SCSS.
- Modified: `app/error.tsx` — see the retry bug below.

**Reused, not rebuilt:** `components/ui/states.tsx` already has `EmptyState`,
`ErrorState`, `Skeleton`, `SkeletonRows`, `SkeletonTiles`, `FormError`, and
`components/states.tsx` re-exports them for 21 modules. §11/§13 were already
satisfied — no empty/loading state was changed.

**Three findings worth keeping:**

1. **`reset` → `retry`.** Next 16.3 made `retry` stable and its own docs say to
   prefer it: `reset()` re-renders the same children WITHOUT re-fetching, so on
   any data-backed screen the app's "Retry" button ran straight back into the
   identical error. It was a no-op on every such page. Fixed in `app/error.tsx`.

2. **`not-found.tsx` cannot export `metadata` in this version** — only the
   experimental `global-not-found.tsx` can. So the 404 inherits the root
   layout's marketing title. Rendering a `<title>` in the tree was TRIED and
   REVERTED: React 19 hoists it, but Next's metadata system had already emitted
   one, giving **two `<title>` elements** with the generic one first — wrong
   title *and* invalid markup. Not worth an experimental flag in the
   `next.config.ts` that carries the production security headers, on a page Next
   already marks `noindex`.

3. **DENY-BY-DEFAULT SWALLOWS THE 404 FOR UNMATCHED TOP-LEVEL PATHS.**
   `/pricing`, `/blog`, `/demo`, `/nope` → **307 to /login**, not 404, because
   the proxy allowlist redirects anything not public. Anything under a public
   prefix (`/about/xx`, `/product/xx`, `/faq/xx`, …) correctly returns 404 and
   renders the page. Same class as the robots.txt/sitemap.xml bug already
   recorded in `session.ts`. **NOT fixed here — the brief forbade touching
   authentication.** Crawlers get a redirect-to-login instead of a 404 for dead
   top-level URLs, so those URLs never drop out of the index.

**Verified on a running server:** 404 status correct, Next auto-injects
`<meta name="robots" content="noindex">`, **no canonical emitted** (so 404s are
not canonicalised to the homepage), exactly one H1, nav landmark present, all
recovery links real, and no stack trace / env var / Supabase host / filesystem
path anywhere in the rendered output.

`global-error.tsx` imports **nothing but React** — no stylesheet, no font, no
Logo. `var(--mkt-dark)` resolves to nothing if globals.scss is what failed, so
every value is a literal on purpose (#0a1128 ground, #8b9eff fill, #0a1128 ink
on the fill — never white, 2.49:1).

## 2026-09-24 (third session)

**Module 25 — legal pages: /privacy, /terms, /cookies.**

- New: `lib/marketing/legal.ts` + `legal.test.ts` (15 assertions),
  `app/(marketing)/{privacy,terms,cookies}/page.tsx`,
  `app/(marketing)/_components/legal/{LegalDocument,LegalToc}.tsx`, `.lg-*` SCSS.
- Wired: `PUBLIC_PATHS`, `INTERNAL_ROUTES`, sitemap (0.3/yearly), and a legal
  row in the footer's bottom bar (`FOOTER_LEGAL`).

**§1 audit — the decisive findings:**

- **No tracking of any kind.** No analytics, tag manager, pixel, session
  recorder or error tracker; no `next/script` anywhere. grep for every common
  provider returns nothing.
- **Two cookies, both strictly necessary** (Supabase session + the httpOnly
  `active_organization_id` hint). **An anonymous visit to the public site sets
  NO cookie at all** — verified with `curl -I`.
- localStorage is used in exactly one place: per-viewer column preferences in
  the signed-in app.

→ **No consent banner, deliberately.** §13/§14 permit one only where tracking
exists. A prompt for cookies that are never set would be theatre. The
`/cookies` page exists anyway, to say that plainly.

**Content came from `docs/PRIVACY.md`**, which carries per-area
IMPLEMENTED/PARTIAL/MISSING/UNKNOWN labels against file references — the same
convention as SECURITY.md. Only verified behaviour is described.

**Honest disclosures published rather than buried:**
- Retention settings exist but are **never executed** — nothing is deleted on a
  schedule (docs/PRIVACY.md's P0). Saying otherwise would be a promise the
  software does not keep.
- Automatic resume shortlisting runs with no human in the loop (a reversible
  flag, never a rejection), and there is **no candidate notice and no stated
  human-review route** for it.
- The consent disclosure is spoken by the voice agent, so a dropped call cannot
  distinguish "disclosed and accepted" from "never disclosed".

**9 placeholders**, rendered as amber `<mark>` elements with an `is-sr-only`
"Unfinished:" prefix, derived programmatically by `legalPlaceholders()` so the
checklist cannot drift from the pages. Test asserts each is upper-case and that
the subjects (entity, governing law, residency, sub-processors, roles,
liability, effective date) are all covered.

**Two Module 20/23 guards fired exactly as designed and were inverted:**
- `security.test.ts` asserted "there is no published privacy policy" with a
  comment saying it was the reminder to swap the sentence for a link the day one
  existed. It failed; the sentence is now a link to `/privacy`.
- `footer.test.ts` asserted no legal link existed. Now asserts every legal link
  resolves, and `FOOTER_LEGAL` is in the orphan-reachability set.

**Near miss checked and pinned:** `/privacy` (public policy) vs
`/settings/privacy` (in-product admin screen) do NOT share a prefix —
`matches()` frees an entry and its own subtree only. Verified: `/settings/privacy`
still 307s.

## 2026-09-24 (fourth session)

**Module 26 — technical SEO audit + indexing readiness.**

- New: `app/opengraph-image.tsx`, `lib/marketing/seo.test.ts` (19 assertions).
- Modified: `lib/marketing/seo.ts`, `app/sitemap.ts`, `lib/supabase/session.ts`
  (+ its test), `lib/marketing/content.ts`, `lib/marketing/footer.ts`,
  `app/(marketing)/product/[slug]/page.tsx`, `app/(marketing)/page.tsx`.

**Audit method:** crawled all 17 public routes and diffed title / description /
canonical / og / h1. Already passing: one H1 everywhere, unique titles, correct
canonicals, no stray noindex, no old branding, no localhost/.vercel.app in
metadata, alt text fine (the only public images are logos).

**Four real findings, all fixed:**

1. **No `og:image` on ANY page** — while `twitter:card` had been
   `summary_large_image` since Module 03. Every share of every page rendered
   imageless. Root cause is worth remembering: **`app/opengraph-image.tsx` is
   merged only into pages that do NOT declare their own `openGraph` object.**
   `buildMetadata()` declares one, which REPLACED the generated block — so
   /login and /signup (no openGraph) carried the card and all 15 marketing
   pages did not. Fixed by naming `images: [OG_IMAGE_PATH]` in both the
   openGraph and twitter blocks.
2. **`/opengraph-image` returned 307 → /login.** Deny-by-default again — the
   route has no file extension, so the proxy matcher's `.png$` exclusion missed
   it. Same bug class as robots.txt/sitemap.xml, already documented in
   session.ts. Allowlisted + pinned.
3. **Product pages titled with their tab word** — "Decide · Scoreboad",
   "Operate · Scoreboad". Now descriptive ("AI screening calls", "Hiring
   pipeline and evaluation") from a single `PRODUCT_SEO_TITLES` map in
   content.ts that the footer's anchor text also reads, so title and link text
   cannot drift.
4. **Sitemap stamped `lastModified: now` on every URL** — so a deploy touching
   one component restamped all 17, telling crawlers /privacy (declared
   `yearly`) changed today, every deploy. Field dropped: no reliable per-page
   date exists, and §11 prefers omission to invention. Also removed /login and
   /signup — auth forms are controls, not content (still crawlable, still
   linked).

**Added:** `WebSite` JSON-LD (name + url only, **no SearchAction** — there is no
site search endpoint; the FAQ filter is client-side and has no URL).

Sitemap is now 15 content URLs, zero lastmod. The OG card is generated with
`next/og` (ships with Next, no dependency), statically optimised, 1200×630,
composed from the real brand mark read off disk at build time.

**Not changed, deliberately:** the Module 24 finding that unmatched top-level
paths 307 to /login instead of 404ing. Still an SEO issue (dead URLs never drop
out of the index) and still an authentication change this module was told not
to make.

## 2026-09-25

**Module 27 — performance / Core Web Vitals.**

Measured first, on a real `next start` production server (Next 16 + Turbopack
prints no bundle sizes, so payloads were measured by fetching each route and
summing its assets, raw and gzipped).

**Baseline (gzipped, homepage):** HTML 52.3K · JS 216.2K (15 chunks) · CSS
108.9K (978K raw).

**Two real findings:**

1. **71 IntersectionObservers on the homepage** — 66 from `<Reveal>` (one per
   instance) plus 5 scroll-story tracks. **Fixed:** `Reveal` now uses ONE
   module-level shared observer with a Map of element → callback; every Reveal
   uses identical options, which is the condition that makes sharing valid.
   71 → 6 observers. Runtime-only: bytes unchanged (216.3K after), which is the
   honest framing.
2. **9 `backdrop-filter` layers, two of them on STICKY elements** (navbar, the
   security page's contents strip) that recomposite on every scroll frame.
   **Fixed:** dropped below 900px. Safe by the design's own contract — every
   glass surface already carries a 0.72–0.96 opaque fill, and the navbar's
   comment says "the fill alone is already sufficient contrast". The two
   genuinely translucent ones (`--mkt-btn--glass`, `--mkt-lcard--glass`) get a
   denser fill on mobile instead.

**Already correct, verified not assumed:** no scroll listeners anywhere
(sentinel/IO architecture); both infinite animations are `transform`/`opacity`
only; global `prefers-reduced-motion` catch-all in globals.scss plus 10 targeted
blocks; fonts self-hosted via next/font with `display: swap` and only 3 Space
Grotesk weights; every lucide import is named (no namespace import in 118
sites); the H1 is the LCP element and carries **zero** animation-delay; the
63K logo PNG is served as a **2.6K WebP** at the rendered size with explicit
width/height.

**THE BIGGEST REMAINING WIN, deliberately not taken: Bulma ships on every
marketing page.** `app/globals.scss` does `@use "bulma/sass"` and is imported by
the ROOT layout, so all 15 marketing pages load 769K raw / **79.6K gz** of Bulma
— 73% of their CSS — to use essentially one class (`is-sr-only`, 8 times).

It cannot be removed safely: there are only two layouts in the whole app
(root and `(marketing)`), every app route sits directly under `app/`, and
**24 of 65 app pages don't render `AppShell`** — including /login, /signup,
/apply/[token] and every settings page — so there is no existing component or
layout to move the import to. The fix is to move the app's ~25 route
directories into an `(app)` route group with its own layout. That is a
restructure, not an optimization, and this module was told not to redesign.

**No dynamic imports added, with the measurement behind it:** the simplest
marketing page ships 188.9K gz of JS and the homepage 216.3K — so all six
scroll stories plus the hero are **27.4K gz**. The framework baseline dominates;
deferring the stories would risk the scroll narrative attaching late to save
noise.

## 2026-09-25 (second session)

**Module 28 — final UX / accessibility / responsive QA audit.**

Audited 15 public routes mechanically (no browser in this environment — stated
plainly rather than claimed). Method: production `next start`, crawl every
route, parse the HTML, plus static analysis of the SCSS and components.

**Three real defects found and fixed:**

1. **Homepage skipped h1 → h3.** The hero's synthetic dashboard mockup used
   `<h3>Overview</h3>` and `<h4>Hiring pipeline</h4>` — chrome inside a PICTURE
   of the product, entering the page's real document outline. A screen-reader
   user navigating by heading landed on "Overview" as though it were a section,
   straight after the h1 and before the first real h2. Now `<p>` with matching
   classes: text still crawlable, outline clean.
2. **The homepage rendered BOTH "Explore the Platform" and "Explore the
   platform"** — same label, same destination, same page — plus "Get Started"
   against the product pages' "Get started". The homepage (Module 03) was the
   last surface in Title Case; the 14 pages built after it all use sentence
   case. Normalised the three homepage labels.
3. **No guard against casing drift.** Added one to `footer.test.ts` — labels
   must be sentence case, with Scoreboad/AI/FAQ exempt. Casing drift is
   invisible in review because nobody sees two variants side by side.

**Verified clean, by measurement not assumption:** every internal link (17
destinations, all 200) · every same-page AND cross-page fragment resolves · no
private route or `href="#"` in marketing · no old branding · no email, phone or
external URL in public copy · terminology consistent (candidate 232 vs
applicant 2) · all 23 `outline: none` have a visible replacement, 53
focus-visible rules · no body-level `overflow-x: hidden` masking · no hydration
risk (the footer's `new Date()` is in a server component; every browser API sits
in an effect or handler) · 15/15 unique titles, canonicals, og:image,
descriptions · 404 returns 404 with noindex and one h1 · footer on every page.

**Animation timings already fit the brief's bands** (micro 0.18–0.25s, standard
0.28–0.34s, story 0.42–0.72s) — §18 says not to force numbers on a consistent
scale, so nothing was changed.

**NOT verifiable here, and reported as such:** keyboard traversal, visible focus
appearance, touch-target sizes as rendered, horizontal overflow at 320–1920px,
browser console/hydration warnings at runtime, Lighthouse. Two targets measured
from CSS sit near minimums and want a real check: `.faq-search__clear` at 24px
square (exactly WCAG 2.2 AA) and `.faq-cat` at roughly 36px tall.

## 2026-09-25 (third session)

**Module 29 — SEO analytics / Search Console / monitoring foundation.**

- New: `docs/SEO.md` (246 lines). Modified: `AGENTS.md` (docs set index).
- **No code changed.** No analytics added, no credentials invented.

**Re-verified rather than trusted from Module 25/26:** there is **no analytics
of any kind** — no GA/GTM/gtag/dataLayer, no Vercel Analytics or Speed Insights,
no Plausible/PostHog/Mixpanel/Amplitude/Hotjar/Clarity/Segment, nothing in
`package.json`, and no third-party script on any public page. Every grep hit was
a false positive ("plausible" in a code comment, "segment" in CSS class names,
"verification" from the product's own match/webhook features). **No Search
Console verification** exists either — no meta tag, no `public/google*.html`.

**Analytics deliberately NOT added, and the binding reason is our own legal
page:** `/cookies` states the site sets no cookies and has no analytics, and
promises *"If any of that is added later, this page and the privacy page change
first, and a consent mechanism gets built at the same time — not afterwards."*
Adding a provider in a module told not to touch legal content would have made
that page false on the day it shipped. `docs/SEO.md` §1 records the required
order for whoever does add one.

**One new technical verification (§25, genuinely testable):** UTM parameters do
NOT create duplicate indexable URLs — `/?utm_source=…&utm_medium=…&utm_campaign=…`
and `/faq?utm_source=…` both still emit the clean canonical, and `og:url` is
clean too. Campaign links are safe to hand out.

Re-verified: sitemap 200, valid XML, 15/15 unique, no query strings, no
localhost/vercel hosts, no private routes · robots references sitemap + host,
blocks `/apply/` `/coding/` `/unsubscribe` · Open Graph + Twitter complete with
image on all six checked pages · social card 200, 1200×630, Scoreboad branding
only · `.env.local.example` needs no new variable (`APP_URL` already feeds
`SITE_URL`).

**Core Web Vitals: NOT measured** — no browser here, no field data without
traffic. Documented the two ways to get real numbers rather than estimating any.

`docs/SEO.md` carries the Search Console setup (DNS TXT, domain property — no
fake token), the weekly monitoring routine, an issue-priority framework noting
which rows are already enforced by tests, the page map of real routes only, and
a production checklist where **only actually-verified rows are ticked**.

## 2026-09-25 (fourth session)

**Module 30 — final production launch audit.** End of the 30-module roadmap.

- Modified: `lib/marketing/home.test.ts` (one new guard). No other code changed —
  the audit found no production blocker in the code.

**Verified, on a real production build served by `next start`:**

- **Secrets clean.** Only `.env.local.example` is tracked (`.env*` gitignored);
  no hardcoded secret in tracked source; only three `NEXT_PUBLIC_*` names, all
  Supabase public values; **no server env name referenced from any "use client"
  file.** Three client chunks matched a secret-name grep — all false positives:
  admin-facing error messages naming a config VARIABLE so an administrator
  knows what to set (`/jobs/[id]`, `/interviews/[id]`), never a value.
- 15 public routes: 200, one H1 each, correct self-canonical, all indexable,
  unique titles. 17 internal destinations + 31 assets crawled, zero broken.
- No PII on public pages (email/uuid/JWT/Supabase host all clean). No old
  branding, no "Vercel"/"Create Next App" in public output.
- Private routes 307; `/api/*` 401. Five security headers served (no CSP —
  documented gap with reasons in `next.config.ts`).
- Trailing slashes 308 to the canonical form — no chain, no loop.
- `vercel.json` is `{}` by design (the sweep is a GitHub Action, DEPLOYMENT §7).

**One real gap found and closed:** `home.ts` was the ONLY marketing content
module without an encryption-claim guard — security/legal/faq/contact all had
one. Added a **scoped** guard to `home.test.ts`: a sentence may claim encryption
only where it is about credentials/keys (the AES-GCM integration store, which is
in our own source), never about candidate data. First attempt was too narrow and
failed on the true sentence "Keys are encrypted before they are stored and the
column is revoked" — widened rather than the copy changed.

**15 legal placeholders remain and are LAUNCH BLOCKERS** — they render as
visible amber markers on /privacy, /terms and /cookies. Entity, governing law,
effective date, data residency, sub-processors, liability, privacy contact,
automated-decision notice, retention enforcement. These were designed to be
impossible to miss; they must be completed with counsel before the site is
public.

Lint clean · typecheck clean · 2,203 tests · build compiles.

**Cannot be verified from here (require the user):** DNS, HTTPS certificate,
www redirect, Vercel production deployment, Search Console verification,
Lighthouse/Core Web Vitals field data, and every browser-dependent check
(keyboard, focus appearance, rendered overflow, console).

## 2026-09-25 (fifth session)

**Homepage accessibility audit (axe, WCAG 2.2 AA, 299 findings).** 151 real
violations, 1 heading-order (already fixed in source, live site is stale), 1
prohibited ARIA, 146 "needs review" (axe could not resolve a background through
gradients/pseudo-elements/backdrop blur).

- Modified: `app/(marketing)/marketing.scss`,
  `app/(marketing)/_components/home/BrandStatement.tsx`, `app/theme.test.ts`.
- **One root cause for ~140 violations: text dimmed with `opacity`.** Step-rail
  off/done states (ai-rail, vi-steps, pl/fl/ap/an-beats, pv-rail), unrevealed
  scroll blocks (`.ai-flow__block` 0.3, `.fl-node__btn` 0.38, `.vi-transcript`
  0.35, `.an-surface` 0.55), plus single rules (`.ap-field__req`,
  `.pl__exitnote`, `.cw-time__by`, `.cw-tab__num`, `.pl-col[data-state=dim]`,
  `.sc-map__side.is-other`). Chose quieter TOKENS (on-dark-faint 6.1:1,
  ink-muted 5.5:1) and CHROME (dashed + unfilled outline → solid + filled when
  reached) over a higher opacity floor, because the floor that passes (~0.85)
  no longer reads as dimmed. `.an-surface` dims with `filter: grayscale(1)`
  instead — keeps luminance, so text contrast survives.
- **Analytics token bridge had two holes:** no `--color-text-muted` (orbital
  notes fell to the dark grey, 1.7:1) and Bulma `.card` colour comes from
  `--bulma-text`, resolved at `:root`, so KPI figures were white on white.
  Bridged muted to `--mkt-ink-muted`, NOT the app's light `#6b7495` (4.37:1 on
  `#f7f9fc`).
- `.mkt-statement`: dropped prohibited `aria-label` on `<p>`; an `is-sr-only`
  comma now separates the words.
- New guard in `theme.test.ts`: no `opacity` in any off/done/dim state rule or
  in the base rule of the five text-bearing reveal panels.
- Left as-is (exempt): aria-hidden `×` glyphs, decorative auras/dots/chevrons,
  disabled contact fieldset at 0.6.

**Open:** app light-mode `--color-text-muted` (#6b7495) is 4.35:1 on the app's
light ground and 4.13:1 on sunken — fails AA; theme.test only checks dark.
Needs a re-scan in a real browser after deploy to clear the 146 "needs review".

Lint clean · typecheck clean · 2,205 tests · build compiles.

## 2026-09-25 (sixth session)

**Homepage usability audit (32 heuristics findings).**

- Modified: `marketing.scss`, `globals.scss` (`.funnel-orbit__stage`),
  `AutomationStory.tsx`, `PersonaSwitch.tsx`, `DashboardPreview.tsx`,
  `PlatformOverview.tsx`, `Analytics.tsx`, `TrustSection.tsx`,
  `components/marketing/Card.tsx` (new `level?: 3 | 4`), `lib/marketing/home.ts`.
- Fixed: sub-11px mockup labels raised to 11px, `ap-form__note` to 12px ·
  funnel stage names wrap instead of ellipsis (app-wide; names are org data) ·
  automation connector 2px in faint ink (was ~2:1) · security bullets capped at
  68ch · `.pv-tabs`/`.mkt-showcase__tabs` `width: max-content` (pill no longer
  stretches) · product-shot gutter 20→26px · decorative nav dots removed ·
  automation beats relabelled as past-tense run events + `aria-label`; the
  candidate node's chip reads "Result" · persona rail head "Where they work in
  Scoreboad" · analytics CTA uses the shared tertiary `ButtonLink` (bespoke
  `.an-close__link` deleted) · trust grid gets its own h3, cards drop to h4.
- Declined, with reasons given to the user: type/colour/radius/button counts
  (1–4, system-level, no minimal fix), all-caps eyebrows (7, 17 — short labels),
  sticky sub-nav and layout variety (19, 20 — page redesign), tabs vs sidebar
  (27 — deliberate), card/tab redundancy (31 — content decision). 18 was
  already fixed in source (stale deploy). 5/6/8: 11–12px kept (tile label
  truncation trade-off; 12px is at the threshold).
- Not browser-verified: the wrap/width/gutter changes need a visual check.

## 2026-09-25 (seventh session)

**Homepage copy audit (6 findings)** — `lib/marketing/home.ts`,
`ApplyStory.tsx`, `app/apply/[token]/ApplyForm.tsx`.

- Rejected two suggested rewrites as untrue: "Every request is authenticated"
  (five routes are public by design, authorised by token/HMAC) and "pricing
  will be published here soon" (pricing is undecided — no implied date). Wrote
  accurate versions and left a comment on each saying why.
- "Submit application" → "Send application" in BOTH the homepage mock and the
  real candidate form, so the picture still matches the product; "Submitting…"
  → "Sending…".

## 2026-09-25 (eighth session)

**Agent Center — Module 1 (foundation).** Spec: `docs/modules/28-agent-center.md`.

- New: `lib/agents/{types,providers,config,registry,queries}.ts` + 2 test files,
  `lib/voice/dialing.ts`, `app/settings/agents/{page,AgentList,AgentFields}.tsx`,
  `new/{page,CreateAgentFlow}.tsx`, `[id]/{page,AgentEditor}.tsx`,
  `app/api/settings/agents/{route,[id]/route}.ts`, migration **0043** +
  `VERIFY_0043.sql`, bundle regenerated (43 files).
- Modified: `lib/integrations/bolna/index.ts` (dialling gate),
  `lib/voice/queries.ts` (in-use delete message), console page/component
  (`?agent=`), `SettingsShell` (`actions` slot), `catalog.ts` (+Agents, −Voice
  agent console shortcut; still 22 in 8), `lib/activity/events.ts` (4 events),
  `globals.scss`, DATABASE.md, KNOWN_ISSUES.md.
- **0043 WRITTEN, NOT REPLAYED, NOT APPLIED.** Docker engine (Rancher Desktop)
  was not running. Run `./supabase/tests/replay.sh` before applying.
- Decisions: `agents` identity table + `voice_agents` as same-id 1:1 extension
  (over renaming voice_agents — the 1,200-line console stays untouched);
  WhatsApp reply stays in 0042 tables (one kill switch), listed read-only;
  only voice_screening may be ACTIVE (DB CHECK, mirrored by `runnable`, test
  compares); in-use delete guard is a DB trigger covering both delete paths;
  status gates dialling (paused/archived never dial; draft DEFAULT skipped
  because 0034 auto-defaults the first agent); Sarvam listed from its docs,
  disabled, no adapter; fixed 0007's provider CHECK missing `'whatsapp'`.
- Not done: layout check in a browser (no browser here); Agent Center test and
  review steps are "coming next" states by design.

## 2026-09-25 (ninth session)

**Central Agents settings architecture** (on top of the eighth session's Agent Center).

- MOVED (git mv, old URLs now redirect): `app/settings/integrations/bolna/` →
  `app/settings/agents/voice/`; `app/settings/auto-reply/` →
  `app/settings/agents/whatsapp/`. API routes unchanged.
- Catalog (21 in 8): "AI & automation" → **AI & Agents** (Agents, AI provider,
  Automations); "Calling & scheduling" → **Integrations** (Bolna AI "Voice
  provider for AI calling", Google Calendar); "Message auto-reply agent"
  removed from Communications; "Screening" → "Screening defaults". New test:
  exactly one Settings link names an agent.
- New type `cv_screening` (migration **0044**, FileSearch), draft-only — the
  resume shortlist reads job requirements, not agent config yet.
- Bolna card: console button → signpost to Agents; connect form's agent ID is
  now OPTIONAL (fallback only); dialling refuses a blank fallback with "create
  a Voice Screening Agent" rather than sending an empty agent_id.
- Agent list: search, status filter, type-group filter, provider label
  (provider / channel / "Scoreboad AI"), "Used in".
- `app/settings/layout.tsx`: robots noindex (third layer after robots.txt +
  auth).
- Chose NOT to add an agent_assignments table: automation actions'
  `config.agent_id` already is the assignment, and nothing but voice screening
  executes an agent.
- Still unreplayed: 0043, 0044 (Docker engine off). Bundle + FRESH_START regen'd (44).
