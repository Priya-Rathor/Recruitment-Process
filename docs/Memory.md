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

- `vercel.json` schedule `*/5 * * * *` → `0 0 * * *`, as instructed. Still one
  cron, still `/api/automations/sweep`. No code change — the endpoint is
  schedule-agnostic.
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
