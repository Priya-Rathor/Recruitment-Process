# Module 19 — Onboarding & Document Management

Collects and verifies every document a new hire owes, from the moment an
application reaches Hired.

## The one decision everything else follows from

**Creation is a database trigger, not route code.**

`trg_applications_create_onboarding` fires `after insert or update of stage on
public.applications`. It is not in `PATCH /api/applications/[id]`, and that is
deliberate:

- the browser holds an authenticated PostgREST client, so a stage update can be
  issued directly and never touch a route handler;
- the pipeline board and Module 13's automation engine both move applications;
- there is **no manual "start onboarding" action anywhere**, by design — so a
  hire whose record was never created would be permanently unmanageable, not
  merely inconvenient.

Same reasoning, and the same shape, as `trg_applications_stage_history` in
migration 0004.

`onboarding_records.application_id` is `UNIQUE` and the trigger inserts `on
conflict (application_id) do nothing`. Moving an application out of Hired and
back in therefore finds the existing record and leaves it untouched. Re-running
generation would wipe verified documents, which is the worst possible outcome of
a stage correction.

## Documents are snapshotted, never joined

`onboarding_documents` copies `name`, `required` and `expected_from` from the
template at generation time. The spec's requirement — editing the checklist must
not disturb a hire already midway through it — is therefore true by
construction. A join would make every in-progress checklist change under the
recruiter the moment an Admin renamed a row.

The Settings screen says so in an info panel, because the behaviour is correct
but not guessable: someone editing the list to fix a live hire would be quietly
wrong.

## Two columns the spec gave one name

The spec listed `uploaded_by` on both `organization_document_templates` and
`onboarding_documents`. Those are different facts:

| column | table | meaning |
|---|---|---|
| `expected_from` | both | who OUGHT to provide it — drives the Candidate/Recruiter tag |
| `uploaded_by` | documents only | which user actually put the file there |

One name for both would have been a bug waiting to be written. `expected_from`
is the new name; `uploaded_by` keeps the meaning it has on `resumes`.

## Where the permission rules actually live

Verification is **Owner/Admin only** — the spec's default, and the point of the
step: a recruiter who uploaded a file and then marked it verified has not had it
reviewed.

That rule is a constraint on *what a row may become*, so per this project's
architecture rules it lives in the policy, not only the handler. There are two
UPDATE policies on `onboarding_documents`, OR'ed:

- `onboarding_documents_update_admin` — unrestricted, except that a verified row
  must carry `verified_by = current_app_user_id()`. Stamping someone else's name
  on your own review defeats the second-pair-of-eyes rule.
- `onboarding_documents_update_recruiter` — `WITH CHECK (status in ('pending',
  'uploaded') and verified_by is null and verified_at is null)`, and a `USING`
  clause that refuses a row already verified. A recruiter with the publishable
  key and a REST client cannot self-verify.

Other boundaries encoded in the database rather than the UI:

- **No client INSERT policy on `onboarding_records`.** Creation is a consequence
  of a stage change, never an action. A client that could insert one could
  manufacture a hire nobody hired.
- **INSERT on documents requires `status = 'pending'`** and null verification
  columns, so "upload and verify in one step" is unreachable even for an Admin
  writing directly.
- **DELETE on documents requires `template_id is null`.** A template-generated
  row is the organization's checklist; removing one for a single hire would
  quietly reduce what they owe.
- **`onboarding_documents_rejected_has_reason`** is a CHECK constraint, so the
  spec's "reject requires a reason" holds for a direct write too.
- **`can_manage_onboarding(record_id)`** is the recruiter-scoping rule, and it
  matches Module 5's: own records plus unassigned ones, so somebody can pick up
  work nobody has claimed.

Reassignment is Owner/Admin only. A recruiter quietly taking someone else's
record — or handing their own away — is a workload change somebody should have
agreed to.

## The completion gate

`completionCheck()` in `lib/onboarding/documents.ts`. Every REQUIRED document
must be Verified; optional ones never block. Uploaded-but-unverified blocks —
that is the case where a loose gate marks someone onboarded on the strength of a
file nobody looked at.

It returns the blockers, not just a boolean, so the disabled button can name what
is missing. The spec asked for a tooltip "if clicked too early", but a disabled
button cannot be clicked, so the reason is rendered as visible text next to the
button as well as on `title` — a hover-only explanation reaches nobody on a
touch screen.

The gate is re-checked in `PATCH /api/onboarding/[id]` before `status =
'completed'` is written, reading the documents fresh rather than trusting a count
from the client. An empty checklist counts as complete, not as 0% — there is
nothing outstanding.

## Candidate-facing upload: SCOPED OUT

The stretch feature — a tokenised no-login upload link — was **not built**.

The recruiter uploads on the candidate's behalf, using the same control as any
other document, and the Candidate tag stays on the row because whose document it
is does not change based on who did the filing. That is exactly what section 7 of
the brief describes as the baseline.

It was scoped out rather than rushed because it is an **unauthenticated write
path into a bucket holding identity documents**. Doing it properly needs a
single-purpose token table with expiry and one-shot semantics, a public route
excluded from `proxy.ts`'s auth, rate limiting, a way to revoke a leaked link,
and a decision about what the page reveals to whoever opens it — a link that
says "upload your PAN card, Ananya Sharma" leaks a name and an employment fact
to anyone the URL reaches. None of that is hard; all of it is the kind of thing
that should not be added at the end of a large module.

## Notifications — wired, not stubbed

Module 15 is built, so both hooks are real:

- `onboarding_document_uploaded` — to the assignee, when a **candidate-owned**
  document is uploaded. Not for recruiter-owned ones: a recruiter filing the
  offer letter they produced does not need telling. Never to yourself.
- `onboarding_document_pending` — the overdue sweep, in
  `lib/onboarding/reminders.ts`. Window is `pendingReminderDays` on
  `organization_settings.onboarding_settings`, default 3, 0 disables it.

Both are **internal**. Nothing here emails the candidate: chasing a new hire for
their PAN card is a conversation a human is already having, and an automated nag
in a recruiter's name is not ours to send. Same position Module 12 took on client
chases.

The sweep only covers `in_progress` records — an on-hold hire is paused
deliberately — and only `pending` documents, since an uploaded one is sitting in
the assignee's own review queue. Records with no assignee are skipped rather than
broadcast, and show as Unassigned on the list, which is the honest place to fix
it.

Dedupe reuses Module 15's `REMINDER_COOLDOWN_HOURS` and fails towards SILENCE:
if the dedupe read fails we cannot tell who was already nagged, so nothing sends
and the run reports `failed: true` rather than "0 sent". It hangs off the
existing `POST /api/notifications/reminders`, not a second endpoint — a user
should not have to know which module a reminder belongs to.

There is still no scheduler in this product. The Settings screen says so out
loud rather than implying reminders go out overnight.

## The route is /hires, not /onboarding

`/onboarding` was already Module 1's workspace setup wizard — where
`requireMembershipOrRedirect()` sends a user who has no organization yet. Taking
it would have broken sign-up. The nav label stays "Onboarding" because that is
what a recruiter calls this.

## The navigation bar was full

Adding a tenth item overflowed it, and `.topnav__links` has `overflow-x: auto`
with the scrollbar hidden — so the overflow would not have looked like a bug, it
would have looked like a bar with nothing after Clients.

Measured at 1440px, `.topnav__links` scrollWidth / clientWidth:

| bar | measured | verdict |
|---|---|---|
| 9 items (before this module) | 961 / 961 | fits exactly |
| 10 items, Onboarding added | 1074 / 961 | overflows 113px |
| …with Analytics moved out | 974 / 961 | overflows 13px |
| …with Analytics + Automations out | 961 / 961 | fits |

One move was not enough, and gap-tightening could not have closed 113px — every
intra-group gap plus both dividers is only about 36px at this width.

Analytics and Automations moved into the account menu. They were the third
group, which this file's own header described as "set up once, checked
occasionally" — which is precisely that menu's admission criterion. Analytics and
the Audit log are now neighbours. Neither is `adminOnly`, so a Recruiter still
reaches both.

It also fixed a pre-existing clip: at 1366px the nine-item bar already overflowed
70px and now fits. The first width that still clips is 1280px, at 25px, down
from 156px.

**This is the reversible part of the module.** If Analytics belongs in the bar,
move it back in `NAV_GROUPS` and something else has to leave — the numbers above
are what any such swap has to satisfy.

## Storage

Private bucket `onboarding-documents`, paths
`<organization_id>/<onboarding_record_id>/<uuid>-<filename>`, policies
authorising on the first segment — the same shape as Module 6's resumes bucket.
Reads go through a 60-second signed URL issued only after tenancy is checked.
There is no public URL: a guessable link to somebody's Aadhaar scan is a data
breach with no attacker required.

Images are first-class here, unlike resumes. A candidate photographs their PAN
card with a phone, and refusing a JPEG would mean converting every one by hand.

Replacing a verified document in place is refused. Reset it to pending first —
an explicit, logged decision — because silently swapping the file would undo the
check with nobody told.

## Default checklist

Seeded by `seed_default_document_templates()`, once per organization, and only
when it has none at all. An org that deliberately deleted every row is not
re-seeded: putting "PAN Card" back after somebody removed it would be the
product overruling a decision it was told about.

Backfilled for every organization that already existed, and wired into
`create_organization_and_owner()` for new ones.

The seven types are the spec's list. Background Verification Consent is
**required**, not optional: a background check run without written consent is
unlawful in most jurisdictions, so it is a precondition of the check. Same
position as Module 8's call-recording disclosure.

The defaults exist twice — in SQL and in `lib/onboarding/templates.ts` — so the
settings screen and the tests can read them without a database. A test asserts
every name, `required` flag and owner appears in the migration, so the duplicate
cannot drift silently.

## Applications already at Hired were backfilled

They reached Hired before this module existed, so no trigger saw them. Without
the backfill their paperwork would be permanently unmanageable — a dead end
rather than a missing feature. `started_at` comes from
`application_stage_history`, so the "waiting longest first" sort tells the truth
on day one.

## Not built

Per section 10, and none of it started: no candidate portal or login, no
e-signature integration, no payroll/HRIS handoff, no bulk actions across hires.

## Known gaps

- **Not verified against a live database.** `SUPABASE_SECRET_KEY` is blank in
  this environment, so migration 0026 could not be applied and the trigger, the
  RLS policies and the storage bucket have not been exercised end to end. What
  WAS verified in a browser: every route resolves, the nav fits, the setup
  wizard still works, and both pages degrade to "Database migration pending"
  rather than showing a fabricated empty state. The tests cover the pure logic
  and assert the migration's own guarantees textually.
- **`display_order` on a one-off document** is `max + 1` within the record, which
  puts it last in its group. Fine in practice, but two one-offs added
  concurrently could collide on the same number; they would then order by name.
- **No optimistic concurrency** on a document. Two Admins verifying and rejecting
  the same upload at the same moment: last write wins.
- **The reorder route writes one row at a time.** A failure partway leaves a
  partial order, which it reports rather than swallowing — but a single statement
  would be better, and needs a Postgres function to do properly.
- **Activity events are filed under `entity: "application"`** rather than a new
  `onboarding` entity type, so a hire's timeline reads straight through from
  "moved to Hired" into the paperwork. If onboarding later needs its own audit
  filter, that is the thing to revisit.
