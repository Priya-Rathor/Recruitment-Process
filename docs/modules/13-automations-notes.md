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

## Follow-ups

- ☐ **Wire `screening_call_completed`.** Needs a service-role execution path so
  the Bolna webhook can dispatch. Until then the trigger is refused at
  activation, which is honest but is a missing feature.
- ☐ **Module 14 (Activity & Audit).** The spec asks for the `notify` action to be
  stubbed *as a call into Module 14's audit log*; Module 14 does not exist, so it
  writes to `automation_runs.action_results` and the server log instead, and the
  UI labels it. Four `TODO(Module 14)` markers across the automation routes.
- ☐ **Module 15 (Notifications).** Replace the `notify_recruiter` stub with a
  real notification. It currently returns `skipped` with an explanation — it does
  not claim to have notified anyone.
- ☐ **Module 17 (Settings).** Remove the assume-connected fallback in
  `checkIntegrations()` and re-test every dependency-blocking rule end-to-end.
- ☐ **Time-delay conditions.** The spec lists "time delays" under condition
  support. `days_in_stage` covers the useful case, but only at the moment a
  trigger fires — there is no scheduler that re-evaluates a rule because time
  passed. A real "after 3 days in Screening" rule needs a cron/queue.
- ☐ **Bulk/large-scale behaviour.** Rules run sequentially per application. A
  bulk stage move of 500 applications would dispatch 500 times inline.
- ☐ **Concurrent edits.** Last-write-wins on the automation row, with no version
  check. Two admins editing one rule can overwrite each other silently.
- ☐ **Cost ledger.** Actions spend AI and calling budget with no per-run cost
  recorded. The dedupe guard bounds the frequency; it does not measure the spend.
