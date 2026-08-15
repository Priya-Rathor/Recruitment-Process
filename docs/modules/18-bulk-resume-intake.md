# Bulk resume intake — "Add candidates" on a job

A cross-module feature, not a numbered spec module. It composes Module 3 (Jobs),
Module 4 (Candidates), Module 5 (Applications) and Module 6 (Resume AI) into one
action: drop N resumes on a job, get N applications.

```
file → extract text → AI parse → validate → MATCH → candidate
     → store resume → queue profile conflicts → application
```

## Where the code lives

| Path | Role |
|---|---|
| `supabase/migrations/0018_bulk_resume_intake.sql` | `resume_intake_items` + `resume_intake_status` enum, RLS, tenant trigger |
| `lib/intake/match.ts` | **The matching decision.** Pure, deterministic, no AI, no database |
| `lib/intake/status.ts` | Status vocabulary, chip tones, the summary sentence. Pure |
| `lib/intake/process.ts` | Orchestration for ONE file: parse → match → create → apply |
| `lib/intake/queries.ts` | Read side — batch state, unresolved conflicts |
| `lib/resumes/pending.ts` | "N profile updates need your review" — the queue's visible surface |
| `app/api/jobs/[id]/intake/route.ts` | `POST` one file, `GET` a batch's state |
| `app/jobs/[id]/IntakeModal.tsx` | Drop zone, per-file rows, live status, retry |
| `app/jobs/[id]/page.tsx` | The button, and the unresolved-conflict banner |
| `app/candidates/[id]/page.tsx` | The queued-updates banner |

Tests: `lib/intake/match.test.ts`, `status.test.ts`, `conflicts.test.ts`.

## The matching rule, exactly

Normalisation is **imported from `lib/candidates/dedupe.ts`**, never redefined —
that file is itself kept in sync with `normalize_candidate_contact()` in
migration 0003. Three implementations of "same phone number" would eventually
disagree, and the day they did a duplicate would slip through in exactly the
flow this feature exists to prevent.

- **Email** — `trim()` then `toLowerCase()`. Nothing else. Gmail-style dot and
  `+tag` stripping is deliberately *not* applied: on most corporate providers
  `a.nanya@` and `ananya@` are two different people, and merging them is
  unrecoverable by hand.
- **Phone** — strip every non-digit, then compare the **last 10 digits**. So
  `+91 98765 43210`, `098765-43210` and `9876543210` are one person. Strings
  shorter than 10 digits are kept whole, so a partial number still matches an
  identical partial.

The decision itself takes a **union**, not a sequence:

```
emailMatches = candidates whose email_normalized == parsed email
phoneMatches = candidates whose phone_normalized == parsed phone
union        = distinct ids across both

0 ids  → create a new candidate
1 id   → that person (even if only one field matched)
2+ ids → CONFLICT — resolve nothing
```

The union is what makes it correct rather than merely plausible. "Check email,
else check phone" passes every other test but silently picks the email's owner
in precisely the shared-family-phone case the spec says not to guess at. There
is a test named for this (`does not silently prefer the email's owner`).

Three conflict flavours, all refusing to resolve:

| Reason | When |
|---|---|
| `email_phone_disagree` | The spec's named case — email → A, phone → B |
| `email_ambiguous` | One address already sits on two candidate records |
| `phone_ambiguous` | One number already sits on two candidate records |

The last two are reachable today: there is **no unique index** on
`candidates.email_normalized`, only a plain one. Two records for one person can
already exist from before dedupe caught them, and that is exactly as ambiguous
as the case the spec names.

## The six outcomes

| Status | What was created | Chip |
|---|---|---|
| `candidate_created` | candidate + resume + parse result + application | success |
| `candidate_matched` | resume + parse result + application | info |
| `already_applied` | resume + parse result, **no second application** | neutral |
| `match_conflict` | **nothing** — file parked at `<org>/_intake/…` | warning |
| `failed` | nothing | error, with Retry |
| `queued` / `processing` | — | neutral |

`already_applied` is deliberately neutral, not a warning. Nothing went wrong:
the candidate is already in this pipeline, which is the correct outcome of
uploading the same resume twice.

Retry is offered for `failed` only. A `match_conflict` would resolve the same
way every time — it needs a person, not another attempt.

## How conflicts are queued, and where they surface

**Profile conflicts** (a matched candidate whose resume disagrees) reuse Module
6's existing machinery unchanged. `processIntakeFile()` writes a
`resume_parse_results` row with `reviewed_at = null` and moves on. That row *is*
the queue — `buildFieldComparisons()` computes the differences on read, and
`/candidates/[id]/resume/review` is the existing Conflict Row screen.

Nothing new was built for the review UI, and nothing writes to `candidates`
except `applyReviewDecisions()`, which only returns fields the recruiter
explicitly accepted.

Surfaced in three places:

1. **The intake row** — "2 profile updates queued for review".
2. **The candidate's profile** — an info panel with the count and a Review link.
   Counted by `listPendingReviews()`, which skips proposals that agree with the
   profile, so a resume that merely repeats what is already stored does not
   leave a permanent badge with nothing behind it.
3. **Conflicts and new fields are counted separately** — a conflict needs a
   judgement call, a blank-profile field needs a glance. One combined number
   would hide which is which.

**Match conflicts** create nothing at all, so `resume_intake_items` is the only
record they have. The job page lists them until someone acts, naming both
candidates with links. The parsed JSON is stored alongside so resolving one
later does not mean paying for the AI call twice.

## Why `resume_intake_items` exists

Five of the six outcomes leave a durable row somewhere else. `match_conflict`
leaves nothing, by design. Without this table that file would live only in React
state, and closing the modal would destroy the one record a human still has to
act on. Storing every outcome rather than only the conflicts also buys "close
the modal and check back", which the spec asks for directly.

## Permissions

Owner / Admin / Recruiter — the same roles that may create a candidate or an
application anywhere else. Enforced three times:

1. The button is not rendered for a Viewer (`canEdit` on the job page).
2. `requireRole(["owner","admin","recruiter"])` in the route, which throws
   `TenantError` → 403 for a direct `curl`.
3. **RLS `WITH CHECK`** on `resume_intake_items`, `candidates`, `applications`,
   `resumes` and `resume_parse_results`. This is the one that actually holds —
   the browser has an authenticated PostgREST client, so a Viewer can POST
   straight to `/rest/v1/` and never touch a route handler.

## Design decisions worth knowing

**One file per HTTP request.** "Every file resolves independently" becomes
structural rather than promised: siblings are separate requests, so a throw
cannot reach them. It also gives live per-file status without inventing a
polling protocol, and makes retry the same code path as the first attempt.

**Client-side concurrency of 3.** Each file is a 5–20s AI call. Serial would run
ten minutes for thirty files; all-at-once would spike the provider's rate limit
and make the first failure look like a cascade.

**Workers claim rows through a `Set` ref, not through `status`.** Setting a
status goes through `setState`, which is asynchronous — two workers reading in
the same tick would both see `queued` and both upload the same file, creating a
duplicate application.

**Duplicate applications are guarded twice.** A `SELECT` answers the normal
case; the `23505` branch catches the race the `SELECT` cannot. The
`unique (candidate_id, job_id)` index is what actually makes the guarantee.

**A new candidate is created from parsed fields without a review step.** The
platform rule says AI output passes through human review before becoming trusted
data. That rule exists to stop a model destroying something a human established —
and here there is nothing to destroy: the record does not exist until that call,
every value came from the resume, and no human has asserted anything about it.
The alternative, thirty confirmation forms, is the workflow the spec says to
avoid. The full parse result stays attached and unreviewed, so every field
remains inspectable, and the creation is written to the activity log with
`source: resume_upload, via: bulk_intake`.

**Archived candidates are matched.** Re-creating someone archived last month
would be a duplicate in every sense that matters. The archive is reversible and
the profile the row links to shows the "Archived" tag.

## Edge cases NOT automated

- **Resolving a match conflict** is manual by design. There is no "merge these
  two candidates" tool in the product, so the recruiter opens both profiles and
  decides. The banner does not disappear on its own — the item stays
  `match_conflict` until someone deletes it. *A "dismiss" control is the obvious
  follow-up.*
- **A resume with no email and no phone** cannot be deduplicated at all. It
  creates a candidate every time it is uploaded. A file with no name *and* no
  contact details is refused outright (`hasIdentifyingDetails`), but a named
  resume with no contact details is accepted and is a genuine duplicate risk.
- **Storage succeeds, the bookkeeping row fails.** The route returns the real
  outcome rather than a failure the recruiter would retry pointlessly, but that
  batch's row is missing on reload.
- **The `GET ?batch_id=` endpoint is not wired into the modal.** The batch state
  is durable and the endpoint works, but reopening the modal starts a fresh
  batch rather than restoring the last one. The `File` objects cannot be
  recovered from the server, so a restored row could be shown but not retried.
- **No scanned-PDF OCR.** Inherited from Module 6 — an image-only PDF reports
  "no text layer" and names OCR as the fix.
- **`getLatestParsedResume()` picks the newest resume with status `parsed` or
  `reviewed`.** If a candidate has an older unreviewed proposal *and* a newer
  reviewed one, the Review link opens the newer. Intake always adds its resume as
  the newest and unreviewed, so this does not bite the intake flow.
- **Not verified end to end.** The matching logic has 43 unit tests, and the UI,
  failure path, retry and concurrency cap were verified in a browser. The
  create/match/apply path could not be exercised because the OpenAI account has
  no credits and migration 0018 has not been applied to the live database.
