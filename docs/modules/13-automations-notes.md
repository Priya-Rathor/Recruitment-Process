# Module 13 (Automation Engine) — implementation notes and follow-ups

## This is the module that can telephone someone in a loop

Every other module needs a human to press something before it acts. This one
acts on its own, and two of its actions cost money per invocation. So the safety
work went in first and most of it lives in the database, not in TypeScript.

### The runaway guard

The cost chapter is explicit: *"An automation must not be able to trigger the
same AI action on the same application more than once per stage-entry — guard
this at the automation-run level, not just in the AI function itself."*

`automation_runs` has a unique index on
`(automation_id, application_id, dedupe_key)`, and `dedupe_key` is
`<trigger>:<stage>:<stage_entered_at>` — it identifies the **occasion**, not the
moment. The engine **inserts the run row before doing anything else**. A
duplicate event produces the same key, the insert is rejected with `23505`, and
that path returns without executing a single action.

Two details worth keeping:

- `stage_entered_at` comes from `application_stage_history`, which is written by
  a database trigger. A caller cannot nudge it to earn a second run.
- When it is missing, the key degrades to `<trigger>:<stage>` — **stricter**, not
  looser: at most one run per stage ever, rather than an unbounded number.

A check-then-insert would race here, and the thing being raced is whether a real
person's phone rings twice. So it is a unique index.

### Unknown fails the condition

`evaluateConditions()` treats a `null` context field as a **failed** condition,
not a passed one, and records `unknown: true` so the run says "we couldn't tell"
rather than "it didn't match". A rule that dials a candidate because we could not
establish whether they had consented is exactly the failure this module must not
have.

`buildContext()` therefore leaves every unestablished field `null` — including
when the *query itself* failed. A failed count is not "there are no screening
questions".

### Activation is always a separate, named act

- `POST /api/automations` ignores `status` in the body entirely and always
  writes `draft`.
- Activation is a `PATCH` that records `activated_by`.
- A database trigger **refuses** `status = 'active'` with no `activated_by`, so a
  direct PostgREST write cannot produce an anonymous live rule.
- Editing what an active rule *does* (trigger, conditions, actions) sends it back
  to draft. Renaming does not. Silently changing what the product does to
  candidates without re-approval is the thing being prevented.

That chain is what makes the spec's test — *"AI-drafted rules require explicit
human activation before going live"* — structural. `draftAutomationRule()` has no
database handle. There is no code path from the model's output to an active rule.

## The AI drafting assistant can only speak the closed vocabulary

`lib/automations/catalog.ts` defines every trigger, field, operator, action and
stage a rule may use. `validateRule()` rejects anything else, and the AI function
runs its output through the same gate.

So the worst a model can produce is a rule that is **wrong** — never one that
does something unanticipated. An invented action (`send_offer_letter`) is
rejected at the boundary rather than stored as an inert rule that silently never
fires. Arbitrary scripting inside rules is Build Later, and this is the shape
that keeps it out.

The plain-English summary shown before activation is derived from the **validated
rule**, never from the model's own description of what it wrote.

## Honest about what is actually wired

`TRIGGER_AVAILABILITY` marks `screening_call_completed` **unavailable**, the UI
says so, and `PATCH … {status:'active'}` refuses it with a reason.

Why: that event arrives on Bolna's webhook, which runs with no user session. The
engine and every action it calls use the session-bound Supabase client, so a
dispatch from there would be denied by RLS — the rule would appear active and
quietly never fire. An admin would believe their candidates were being screened.

Wiring it needs a service-role execution path through Modules 7–9, which is a
real refactor with tenant-isolation risk. It is a follow-up, not a stub.

The four wired triggers, and where they dispatch:

| Trigger | Dispatch site |
| --- | --- |
| `application_stage_changed` | `PATCH /api/applications/:id`, only on a real change |
| `application_created` | `POST /api/applications` |
| `screening_report_created` | `POST /api/applications/:id/screening-report` |
| `interview_completed` | `POST /api/interviews/:id/feedback` |

Every dispatch is `await`ed inside its own `try/catch`. Awaited because a
serverless function can be frozen the moment it responds, which would leave a run
claimed and unfinished; caught because the spec requires a failing automation to
never block the manual action that triggered it.

## n8n

The spec's stack names n8n as the executor ("n8n executes the workflow behind the
scenes"). The engine runs **in-process** instead. n8n is not provisioned, and
routing execution through an unconfigured external orchestrator would mean every
rule silently fails while the UI reported success. In-process execution is
deterministic, testable, and inside the tenant boundary already established.

If n8n is introduced later, `dispatch()` is the seam: it is the only entry point,
and its callers pass structured input only.

**Upgrade note.** That decision stands — the engine still executes rules itself
and `notUsedForExecution` is still true. What the upgrade added is a
`call_n8n_webhook` **action**, so a rule can hand an event to a workflow the
organization already built. The host comes from the stored integration and the
rule supplies only a path within it (validated in the catalogue), and the payload
is ids and the stage — no candidate name, email or phone. n8n does not decide
anything and nothing waits on its answer.

## `skipped` is not a failure

The run vocabulary is `success` / `failed` / `skipped` / `blocked`:

- **skipped** — conditions did not match, or the action was a no-op (already in
  that stage). Grey in the UI, not red.
- **blocked** — a required integration was unavailable. Distinct from failed
  because the fix is different: connect the integration, don't debug the rule.

A skipped run still consumes the dedupe key. Deliberate: a rule that did not
match on this stage-entry will not match on a re-delivery either, and the run
history then answers "why didn't my automation fire?" — which is the question
people actually ask.

## Integration health, and its temporary shape

Per the spec's forward stub: Bolna gets a real `getStatus()` check; anything else
defaults to **assume connected**. Both `/automations` and the detail page say so
in plain text rather than leaving an admin to assume the check is real.

This is the exact placeholder `docs/modules/17-settings-integrations.md` lists
for removal.

## Retrofits completed by this module

- ☑ **Module 2's failed-automations tile.** `lib/dashboard/metrics.ts` already
  queried `automation_runs` defensively (`status = 'failed'`, `started_at`,
  `organization_id`). Migration 0012 uses exactly those names, so the tile
  switches from "pending" to a real count with no code change. Verified by
  reading the query against the new schema — **not** verified against a live
  database, because none exists yet.

## Retrofits completed since (Modules 14, 15, 17)

All three of the original forward stubs are gone. This section used to list them
as open, which was wrong for a while — worth knowing, because a stale checklist
costs somebody an afternoon re-doing finished work.

- ☑ **Module 14.** Every `TODO(Module 14)` marker is gone. `finish()` logs one
  `automation.run` event per outcome, and each action that writes logs its own.
- ☑ **Module 15.** `notify_recruiter` really notifies — the assigned recruiter,
  falling back to the triggering user, and a skip (not a failure) when both are
  absent. Failures and blocks alert Owners/Admins.
- ☑ **Module 17.** `checkIntegrations()` has **no** assume-connected fallback.
  All five adapters expose `getStatus()`, and an unrecognised provider BLOCKS.

# The upgrade (migration 0029)

## The bug this started with

`automation_runs` had a SELECT and an INSERT policy and **deliberately no UPDATE
policy** — "a run record is the evidence of what the system did to a candidate".
The intent was right. The consequence was not: the engine CLAIMS a run row and
then completes it with an UPDATE, so RLS silently discarded every completion and
**every run in the product sat at `status='skipped'`, `reason='Running…'`** from
the day Module 13 shipped.

PostgREST returns no error for an update that matches no rows, which is why it
was invisible. The fix keeps the original intent instead of dropping it: a run may
be completed **once** and never rewritten, enforced by
`enforce_automation_run_completion_only()` — a trigger, because the browser holds
an authenticated PostgREST client. `finish()` now logs loudly if the update ever
fails again.

`awaiting_approval` runs deliberately leave `finished_at` NULL, which is exactly
the one later completion the trigger permits.

## Time became a trigger

`lib/automations/sweep.ts`, driven by `GET /api/automations/sweep` (a `CRON_SECRET`
bearer token) or by an Owner/Admin pressing the button (`POST`, their own
organization only). Both paths run the same `sweepOrganization()`, which is the
point: the button is a rehearsal of the cron, not a lookalike.

**Why an hourly sweep cannot double-act.** The dedupe key contains no time —
`time_elapsed_in_stage:<stage>:<stage_entered_at>` — so every sweep computes the
same string for the same stale application. The first claims the run; the rest hit
migration 0012's unique index. There is deliberately **no** "last reminded at"
column: that needs a read-then-write, which races two overlapping sweeps, and the
thing being raced is whether a candidate is contacted twice.

`automation_sweeps` exists so the UI can distinguish three states that look
identical from an empty run history: never ran (no cron — time rules do nothing at
all), ran and found nothing, ran and failed. Only the first is a deployment
problem and only the last is a bug.

A `time_elapsed_in_stage` rule **must** carry a `days_in_stage` gt/gte condition,
refused at write time by `validateRule`. Without one the first sweep would match
every open application in the organization — and each match consumes that
application's dedupe key, so fixing the rule afterwards would not undo it.

Bounds are **reported, not silent**: 250 applications per organization and 50
organizations per invocation, with the remainder surfaced in the UI. A cap that
quietly trims coverage reads as "everything was checked".

## `screening_call_completed` is wired

The old note called this "a follow-up, not a stub", and the reason was structural:
the engine used the session-bound client everywhere, and Bolna's webhook has no
session, so every query would have been denied by RLS.

The engine now takes its **client as a parameter** plus an `ExecutionMode`. That
one change made both the webhook trigger and the whole scheduler possible.

What it did *not* fix: `startScreeningCall`, `calculateAndStoreMatch` and
`generateReportForApplication` each build their own session client deep inside
Modules 7-9. So `ACTION_MODES` records which actions run in which mode, and
`checkExecutable()` refuses the bad **combination** at activation with the reason
spelled out. The honesty rule moved one level finer rather than being dropped:
before, a whole trigger was unavailable; now the trigger works and only the
impossible pairing is refused.

The approval path is where this pays off. Approving runs under the approver's
session, so a rule can propose at 3am with nobody signed in and place the call at
9am on a named person's authority.

## Condition groups

A rule is now an AND of groups, each an ANY or ALL of conditions — two levels, not
arbitrary nesting, because two levels covers the real requests and still renders
as a checkable sentence. `(Java or Kotlin) and score above 75` was previously
inexpressible and the workaround was duplicating the whole rule per language.

`normalizeConditions()` reads **both shapes**: a pre-upgrade flat `Condition[]`
becomes a single ALL group. No data migration — a JSONB migration that mangles one
row is worse than a branch on read. Tested both ways.

An `any` group is the one place a rule can proceed on partial information (an
unknown fails its own condition but does not poison a group that needed only one
to pass). Deliberate, documented, and why the per-group outcomes are kept.

## Guardrails

| | What it bounds |
|---|---|
| Dedupe index (0012) | one run per application per stage-entry |
| `daily_run_cap` | runs per rule per **organization** day — the one 0012 never bounded |
| `automations_enabled` | the whole engine, one column, read before any rule loads |
| `requires_approval` | whether the rule acts at all, or only proposes |

Hitting the cap **pauses the rule** and tells Owners/Admins why. Blocking the run
alone would mean it keeps trying all day and the admin finds out from the invoice.
The kill switch does **not** touch rule statuses, so switching back on restores
exactly what was live — flipping everything to paused and back would silently
reactivate rules an admin had deliberately paused.

## Human oversight, and why it is built rather than promised

`automation_approvals`. A rule marked `requires_approval` parks its run at
`awaiting_approval` and snapshots its **actions** — so the approver authorises what
they read, even if somebody edits the rule in between (same reasoning as Module
19's document snapshots). `send_candidate_email` forces the flag on and the API
overrules a client asking for it off.

Decision order is the **opposite** of the engine's: the engine claims before
acting so a duplicate event cannot call twice; here the decision is recorded
before acting so two admins clicking Approve cannot both execute. Guarded by
`.eq("status", "pending")` and by a trigger for the PostgREST path.

If the actions fail after the decision, the approval still reads "approved". That
is correct — the person approved and the system then failed. Rolling it back would
erase the fact that a human authorised it.

Proposals expire after seven days, recorded as `expired` rather than `rejected`:
"we let it lapse" and "we said no" are different facts about somebody's
application. The sweep is what expires them, because it is the only thing that
runs on a clock.

This is the EU AI Act surface too (Annex III employment systems, high-risk
obligations from 2 August 2026): an overseer with the effective capacity to
intervene, and a log naming who decided what and when. A record rather than an
intention.

## The cost ledger, and what it deliberately is not

`automation_runs.chargeable_actions` counts the chargeable actions a run actually
executed. It holds **no money figure**: nothing in this product measures tokens or
call minutes (`docs/modules/00-cost-tracking.md` is unbuilt), and a rupee number
derived from a guess would be a fabricated fact on a screen a manager reads. A
count is true, and combined with `daily_run_cap` it is the number that bounds
spend.

## What else the upgrade added

- **Triggers**: `evaluations_complete` (via a new pure `evaluationsComplete()` —
  the trigger can advance an application, so its verdict is unit-tested),
  `onboarding_document_uploaded`, `onboarding_completed`,
  `time_elapsed_in_stage`, plus `screening_call_completed` now live. Nine total.
- **Conditions**: `application_source`, `candidate_has_resume`,
  `days_since_applied`, `assigned_recruiter_present`, `job_is_open`,
  `evaluation_outcome`. Fourteen total, and fixed-vocabulary fields are now
  validated against their list — `application_source is jobboard` used to save
  fine and then never match.
- **Actions**: `send_candidate_email` (one approved external template, every value
  a fixed fact, no free text a rule can fill), `assign_recruiter` (never
  reassigns over a person; membership verified before writing), `call_n8n_webhook`.
  Nine total.
- **Templates**: eight in `lib/automations/templates.ts`, as code rather than a
  table — a table is the first two-thirds of the marketplace the spec puts in
  Build Later. Tested for validity, executability, forced approval on
  candidate contact, a cap wherever they spend money, and that **none of them ends
  an application**: a template is handed to people who have not read the
  vocabulary, so one that quietly rejected candidates would do harm at scale.
- **Concurrent edits**: `automations.version`, bumped by a trigger so it is true
  however the row was written; `expected_version` on PATCH returns a 409 with a
  sentence instead of overwriting a colleague silently.
- Every query in `buildContext` and the cap count now filters `organization_id`
  explicitly. They run under the service-role client for webhook and scheduled
  triggers, and that client bypasses RLS.

## Follow-ups

- ☐ **A service-role path through Modules 7-9.** The remaining reason a scheduled
  or webhook rule cannot place a call, score a match or generate a report. Refused
  at activation with a reason today, and routed around by the approval path, but
  it is a missing capability rather than a design choice. Threading a client
  through three modules carries real tenant-isolation risk, which is why it is
  still a follow-up.
- ☐ **`/api/notifications/reminders` still needs a person to press it.** It is
  deliberately NOT on the cron: `lib/notifications/reminders.ts` and
  `lib/onboarding/reminders.ts` build session clients internally, so a cron call
  would be denied by RLS and report zero sent. Wiring it needs the same
  client-parameter treatment the engine just had.
- ☐ **Bulk behaviour.** Rules still run sequentially inline per application. No
  bulk stage-move endpoint exists today, so this is not yet reachable; if one is
  added, `dispatch()` is where a queue would go.
- ☐ **A batch-level trigger** (e.g. "an intake batch finished") has no home in the
  run model: a run requires an `application_id`, which is what the dedupe key is
  built from. It needs a different record shape, not a new trigger name.
- ☐ **Adverse-impact reporting.** Every run now records its trigger, its
  chargeable actions and who caused it, so the data for a bias/adverse-impact
  analysis is there. The report itself belongs with Module 16.
