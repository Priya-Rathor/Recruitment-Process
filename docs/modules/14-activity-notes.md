# Module 14 (Activity & Audit) — implementation notes and the retrofit record

## Three spec endpoints are deliberately not implemented

Section 6 lists `POST`, `PATCH` and `DELETE /api/activity-events/:id`. None
exist, and the database refuses all three independently:

- **`POST`** would let a client write its own audit entries. A forged trail is
  worse than a missing one. Events are written server-side by `logActivity()` at
  the point the thing actually happened.
- **`PATCH` / `DELETE`** would make the log editable, which is the one property
  an audit log cannot have. There is no UPDATE policy and no DELETE policy, and
  `reject_activity_event_mutation()` blocks both **for the service role too** —
  `lib/supabase/admin.ts` bypasses RLS, and a bug there must not be able to
  rewrite history.

This is a considered deviation, not an omission. The generic CRUD list in
section 6 is boilerplate repeated across all 17 module specs; section 7 asks for
an *immutable* log, and the two cannot both be satisfied.

Deleting an **organization** still cascades. The tenant is gone, and retaining
its audit trail would mean holding personal data with no controller — which the
privacy chapter forbids.

## The sensitive/ordinary split is enforced in RLS

Section 9 restricts the security audit log to Owner/Admin. The browser holds an
authenticated PostgREST client, so a rule living only in the route handler would
be no rule at all. The SELECT policy reads `is_sensitive` directly.

`is_sensitive` is set **from the catalogue, never from the caller**. A route that
could mark its own event non-sensitive would be able to hide a role change from
the audit log — precisely what the audit log exists to catch.

The split itself: anything that changes **who can do what**, touches
**credentials**, or **turns an automation on**. Ordinary recruitment work is not
sensitive, because a Recruiter must be able to see what happened to their own
candidates; marking those rows sensitive would silently empty their timelines.
There is a test for each direction.

Two further insert-side rules:

- `actor_id` must be the caller or NULL. A Recruiter cannot write a row reading
  "Owner removed a member".
- A trigger requires the actor to be a member of *this* organization — otherwise
  a caller could attribute an action to a user from another tenant, which is both
  a false record and a small identity leak, since the log renders actor names.

Writing a sensitive event is **not** role-gated on insert: a *failed* permission
change is performed by whoever attempted it, and that attempt is exactly what
should be captured.

## Logging can never break the action it records

Every `logActivity()` call is caught internally and returns a boolean. It never
throws and never rejects, so no call-site needs a `try`. Losing an audit row is
bad; losing a candidate's stage change because the audit insert failed is worse,
and it is the failure that would make people mistrust the product.

## What is deliberately NOT stored

The table is append-only and never expires, so anything logged is permanent.

- **Never**: passwords, API keys, tokens, prompts, completions, call
  transcripts. `sanitizeMetadata()` strips these by key pattern as a backstop and
  drops nested objects entirely — that is how a whole provider payload ends up in
  a log by accident.
- **Field names, not values**, for candidate, organization and client updates.
  The row itself holds the current values; the log answers *who changed what
  kind of thing, and when*.
- **Note text is never logged** — only that a note was added. A recruiter's
  private assessment of a candidate does not belong in a second, append-only
  table nobody can redact.
- **Invite tokens are never logged.** Anyone who could read the audit trail could
  otherwise use the link to join the organization.

Per section 10, AI calls are recorded at summary level: which function ran, and
whether it worked. An error *code* is stored; the provider's message is not,
since it can echo input back.

## The AI narrative is checked, not trusted

The spec's constraint — *"AI narrative never states an event absent from the
underlying log"* — is enforced by `findUngroundedClaims()` **after** generation,
and a narrative that fails is **rejected**, not shown with a warning. A summary a
reader must fact-check is worth less than no summary, because they will not
fact-check it.

Three checks: milestone claims (a phrase like "completed AI screening" requires a
screening event), figures (every number must trace to a supplied fact), and dates
(every date must be a date something happened).

The model is given **rendered descriptions**, never raw rows, so what it can say
is bounded by what the timeline already shows a human.

Below three events it refuses outright: a "narrative" of one line adds nothing
over the line itself, and paying for an AI call to restate it is the cost
chapter's exact complaint.

### Two bugs the tests caught, both worth recording

1. **The screening pattern required the word "call".** "Rahul completed AI
   screening" — the spec's own phrasing — sailed through ungrounded. Widened to
   the bare word.
2. **The date stripper bit a year in half.** Given "10 August 2026" it matched
   `August 20` (the first two digits of the year) and left "10" and "26" behind
   as two invented figures, so every *correct* day-first narrative was rejected.
   That is how a guard gets switched off. Fixed by stripping years first and
   anchoring each day number with `(?!\d)`; the date check now reads both orders,
   which also closed a real hole — a fabricated "25 August" was never checked at
   all.

## THE RETROFIT — every call-site, as the spec requires

The spec is explicit that *"'added logging going forward only' is not
sufficient"* and that every touched call-site must be listed. All 22
`TODO(Module 14)` markers are resolved, plus the spec-named actions that never
had a marker.

### Module 1 — Authentication & Organization (all sensitive)

| File | Event |
| --- | --- |
| `app/api/organizations/route.ts` | `organization.created` |
| `app/api/organizations/[id]/route.ts` | `organization.updated` |
| `app/api/invites/route.ts` | `member.invited` |
| `app/api/invites/[id]/route.ts` | `member.invite_revoked` |
| `app/api/invites/accept/route.ts` | `member.invite_accepted` |
| `app/api/members/[id]/route.ts` | `member.role_changed`, `member.removed` |

Role changes record **both** the old and new role — "was promoted to Owner" is
only meaningful next to what they were before.

### Modules 3–5 — Jobs, Candidates, Applications

| File | Event |
| --- | --- |
| `app/api/jobs/route.ts` | `job.created` |
| `app/api/jobs/[id]/route.ts` | `job.updated`, `job.status_changed`, `job.archived` |
| `app/api/candidates/route.ts` | `candidate.created`, `candidate.duplicate_flagged` |
| `app/api/candidates/[id]/route.ts` | `candidate.updated`, `candidate.archived` |
| `app/api/applications/route.ts` | `application.created` |
| `app/api/applications/[id]/route.ts` | `application.stage_changed`, `application.recruiter_assigned`, `application.archived` |
| `app/api/applications/[id]/notes/route.ts` | `application.note_added` |

A job status change is logged as its own event *as well as* the generic update —
"closed this job" is what a manager looks for, and it would be invisible inside a
list of changed field names.

### Modules 6–9 — Resumes, Matching, Screening

| File | Event |
| --- | --- |
| `app/api/candidates/[id]/resumes/route.ts` | `resume.uploaded` |
| `app/api/resumes/[id]/parse/route.ts` | `resume.parsed` + `ai.invoked` |
| `app/api/resumes/[id]/review/route.ts` | `resume.review_applied` |
| `app/api/applications/[id]/match/route.ts` | `match.calculated` + `ai.invoked` |
| `app/api/applications/[id]/screening-call/route.ts` | `screening_call.started` |
| `app/api/webhooks/bolna/route.ts` | `screening_call.completed` |
| `app/api/applications/[id]/screening-report/route.ts` | `screening_report.generated` + `ai.invoked` |
| `app/api/screening-reports/[id]/review/route.ts` | `screening_report.reviewed` |

The **webhook** is the unusual one, in two ways, both deliberate:

- `actorId` is **NULL**. A provider callback is not a person, and naming the
  recruiter who started the call as the actor of its *outcome* would be a false
  record.
- It passes `useAdminClient: true`, because there is no session. The
  `organization_id` comes from our own `screening_calls` row, never from the
  payload.

`lib/screening/reportQueries.ts` deliberately does **not** log: it is reached
both from the route (a named recruiter) and from an automation (no user), so it
has no single correct actor. The callers log instead.

### Modules 11–13 — Interviews, Clients, Automations

| File | Event |
| --- | --- |
| `app/api/interviews/route.ts` | `interview.scheduled` |
| `app/api/interviews/[id]/route.ts` | `interview.cancelled` |
| `app/api/interviews/[id]/feedback/route.ts` | `interview.feedback_submitted` |
| `app/api/clients/route.ts` | `client.created` |
| `app/api/clients/[id]/route.ts` | `client.updated` |
| `app/api/applications/[id]/submission/route.ts` | `client.submission_sent` + `ai.invoked` |
| `app/api/automations/route.ts` | `automation.created` |
| `app/api/automations/[id]/route.ts` | `automation.activated`, `automation.paused`, `automation.deleted` |
| `lib/automations/engine.ts` | `automation.run`, plus every action it performs |

The **engine** needed the most care. Its actions bypass the routes entirely, so
without logging there a candidate would appear in a new stage with nothing
explaining how they got there. It now logs `screening_call.started`,
`match.calculated`, `screening_report.generated`, `application.stage_changed` and
`application.note_added` from the action executor, and `automation.run` from
`finish()` — so every outcome is captured once, **including skips and blocks**,
which are the ones people actually ask about.

`actorId` on those is the user whose action triggered the rule, with the
automation named in `actor_label`: they are the reason it ran, but the timeline
reads "Automation: Screen strong matches" rather than blaming whoever moved a
stage.

Deleting an automation cascades its run history away, so `automation.deleted`
keeps the rule's name — it becomes the only remaining evidence it existed. The
DELETE handler now loads the row first, which also turns a delete against another
tenant's id into a clean 404 rather than a silent no-op.

### AI-call logging (section 10) — all nine remaining `ai-action` routes

`app/api/jobs/ai-action`, `candidates/ai-action`, `candidates/search`,
`clients/[id]/ai-action`, `dashboard/ai-action`, `pipeline/ai-action`,
`organizations/[id]/ai-action`, `applications/[id]/ai-action`,
`applications/[id]/interview-brief` — each records `ai.invoked` with the feature
name and outcome.

## Follow-ups

- ☐ **`candidate.duplicate_resolved` is defined but unwired.** Module 4 never
  built a merge UI, so nothing writes it. The event name is fixed now so it does
  not change once something does.
- ☐ **Integration events are unwired.** `integration.connected` / `.disconnected`
  / `.tested` are defined and sensitive, but the adapters are called from Module
  17's settings UI, which does not exist. Wire them there.
- ☐ **Per-entity timelines beyond candidates.** `/candidates/[id]/activity` and
  `/audit-log` are the spec's two named routes and both exist.
  `getEntityTimeline()` is generic, so adding a tab to the job, client and
  application detail pages is small — it just is not done.
- ☐ **Pagination on the timeline views.** The API paginates; the two pages take
  the first 100/200 rows. At 10,000+ events per entity that degrades, and the
  spec's large-dataset check is not really satisfied.
- ☐ **Recruiter scoping on the activity feed is by RLS only.** That is correct
  and sufficient for the timeline (a Recruiter only sees rows they could read
  anyway), but there is no explicit "own scope" filter like the one Module 13's
  run history has.
- ☐ **No cost cache on the narrative.** Each press is a fresh AI call.
- ☐ **`entity_id` has no foreign key** (it points at twelve tables, and a log
  entry must outlive its subject). Nothing enforces that it points at a real row.
