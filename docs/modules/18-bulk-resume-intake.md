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
| `supabase/migrations/0019_intake_manual_reconnect.sql` | `manually_connected` status, undo columns, candidate DELETE policy + resume guard trigger |
| `lib/intake/match.ts` | **The matching decision.** Pure, deterministic, no AI, no database |
| `lib/intake/status.ts` | Status vocabulary, chip tones, the summary sentence. Pure |
| `lib/intake/process.ts` | Orchestration for ONE file: parse → match → create → apply |
| `lib/intake/reconnect.ts` | **The manual override.** Undo a wrong auto-match; the two destructive decisions |
| `lib/intake/queries.ts` | Read side — batch state, unresolved conflicts |
| `lib/resumes/uploadPolicy.ts` | PDF/Word allowlist — shared by the file picker AND the route |
| `lib/resumes/history.ts` | A candidate's resume history with source attribution |
| `lib/candidates/lookup.ts` | Typeahead by name / email / phone (identity, not semantics) |
| `lib/resumes/pending.ts` | "N profile updates need your review" — the queue's visible surface |
| `app/api/jobs/[id]/intake/route.ts` | `POST` one file, `GET` a batch's state |
| `app/api/jobs/[id]/intake/[itemId]/route.ts` | `PATCH` — connect a file to a chosen candidate |
| `app/api/candidates/lookup/route.ts` | `GET` typeahead, every role |
| `app/api/resumes/[id]/download/route.ts` | `GET` — redirect to a short-lived signed URL |
| `components/CandidatePicker.tsx` | Debounced inline search, reused by the modal |
| `app/candidates/[id]/ResumesCard.tsx` | The Resumes section on the profile |
| `app/jobs/[id]/IntakeModal.tsx` | Drop zone, per-file rows, live status, retry |
| `app/jobs/[id]/page.tsx` | The button, and the unresolved-conflict banner |
| `app/candidates/[id]/page.tsx` | The queued-updates banner |

Tests: `lib/intake/match.test.ts`, `status.test.ts`, `conflicts.test.ts`,
`reconnect.test.ts`, `lib/resumes/formats.test.ts`, `lib/candidates/lookup.test.ts`.

## File formats

PDF, `.docx` **and legacy `.doc`**. Three different parsers:

| Format | Parser | Notes |
|---|---|---|
| `.pdf` | `unpdf` | serverless build of pdf.js |
| `.docx` | `mammoth` | a ZIP of XML |
| `.doc` | `word-extractor` | an **OLE compound document** — a completely different binary format |

`.doc` was rejected outright before this pass, because mammoth cannot read it
and handing it one produced "corrupt file" on a perfectly good document.
`detectFileKind()` therefore prefers the **extension over the MIME type**: some
browsers label both Word formats `application/msword`, and trusting that hands a
ZIP to the OLE reader.

`lib/resumes/formats.test.ts` runs all three through extraction using **real
fixture files** in `lib/resumes/__fixtures__/`, generated from one source text by
Chromium's print-to-PDF and macOS `textutil`. A mocked test would not have caught
the `.doc` gap.

**Everything else is rejected before upload**, with the spec's exact wording:
*"Only PDF and Word documents (.doc, .docx) are supported"*. The rule lives in
`lib/resumes/uploadPolicy.ts` and is applied in three places from that one
source: the `accept` attribute, the client-side check that marks the row failed
without spending an upload, and the route handler (which a direct `POST`
bypasses the UI to reach). A rejected row shows **no Retry button** — the same
file would be rejected again.

`uploadPolicy.ts` is separate from `extract.ts` on purpose. The file picker needs
the allowlist, `extract.ts` needs `unpdf`/`mammoth`/`word-extractor`, and those
need Node's `fs` — importing the policy from the extractor broke the client build
with `Can't resolve 'fs'`.

## Manual "connect to existing candidate"

Available on **every resolved row in every state**, not only the ambiguous ones:
automatic matching can create the wrong new candidate or pick the wrong existing
one, and both need correcting without re-uploading.

`PATCH /api/jobs/:id/intake/:itemId` with a `candidate_id`. In order:

1. **Re-point the resume first.** `resumes.candidate_id` is `ON DELETE CASCADE`,
   so removing the candidate first would take the uploaded file with it.
   Migration 0019 adds a trigger that refuses a candidate delete while any resume
   is still attached, so getting this order wrong is a loud error rather than a
   silent loss. The storage object is moved to the correct candidate's folder.
2. **Remove the application — only if this flow created it.**
   `shouldRemoveApplication()` returns false for `already_applied`, where the
   application pre-dates the upload and carries stage history, notes and
   interviews. It also checks `auto_status`, so a *second* reconnection of an
   already-applied file still refuses.
3. **Clean up the orphan** — see below.
4. **Queue the field comparison** against the newly chosen candidate, unreviewed,
   exactly as an automatic match does. A manual connection is not a licence to
   overwrite a profile.
5. **Ensure the application** for the correct candidate+job, skipping if one
   already exists.

The row's status becomes `manually_connected` — a seventh outcome, deliberately
not reusing `candidate_matched`, so a week later it is still possible to tell
which links a human made.

### Hard delete vs archive

`cleanupDecision()` in `lib/intake/reconnect.ts`:

| Situation | Action |
|---|---|
| Auto-match found a **pre-existing** person | `kept` — never touched |
| Auto-**created**, and still pristine | **`deleted`** (hard) |
| Auto-created, but something else attached | `archived` |

"Pristine" is counted *after* step 1 and 2: no resumes, no applications, no other
intake item pointing at it.

**Hard delete is the default for a pristine orphan, and archiving is not the
safer option it looks like.** Intake matching deliberately includes archived
candidates — re-creating someone archived last month would be a duplicate in
every sense that matters — so an archived orphan keeps colliding with the real
person on every future upload, turning one bad match into a permanent
`match_conflict`. Archiving is the fallback for when deleting would take
someone else's work with it.

Either way the outcome is recorded in `resume_intake_items.cleanup_action` and
written to the activity log *before* the delete, so the audit outlives the row
(`activity_events` has no foreign key to `candidates`).

## The Resumes section (candidate profile)

Replaces a single line that only said whether *a* resume existed. Lists every
resume ever uploaded, newest first, each with filename, upload date, size,
uploader, and **where it came from** — "Uploaded via {job} job" when it arrived
through bulk intake (linked), "Uploaded directly" otherwise.

Source attribution is a join to `resume_intake_items`, not a denormalised column
on `resumes` — a column Module 6's own upload route would have to remember to
set, and would eventually forget.

**"Most recent" is a label on the first row, not a state.** Nothing is deleted or
hidden when a new resume arrives; only the label moves. Empty state offers
"Upload resume", which opens Module 6's existing single-candidate flow.

Download goes through `GET /api/resumes/:id/download`, which checks tenancy and
then **redirects** to a five-minute signed URL — the URL never sits in client
state where it could be copied out. 302, not 301, because a permanent redirect
would be cached past the expiry.

## Permissions summary

| Action | Owner/Admin/Recruiter | Viewer |
|---|---|---|
| Upload resumes (bulk or single) | yes | **no** |
| Connect to existing candidate | yes | **no** |
| View the Resumes section | yes | yes |
| Download a resume | yes | yes |
| Candidate lookup/typeahead | yes | yes |

Viewer denial is enforced in the route (`requireRole` → 403) and again in RLS.
The candidate `DELETE` policy added in 0019 is Owner/Admin/Recruiter — Module 4
had no delete policy at all, because archiving was the only removal when every
candidate was created by a human.

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

- **Resolving a match conflict** now has a real path: "Connect to existing
  candidate" on the row picks the right person and files everything. What is
  still manual is deciding WHICH of the two candidates is right, and merging the
  two duplicate records afterwards — there is no merge tool in the product.
- **The job page's conflict banner does not clear itself.** Once a conflicted
  file is reconnected from the modal its status changes, so it drops out of the
  banner — but a conflict resolved by editing candidates directly leaves the row
  at `match_conflict` forever. *A "dismiss" control is the obvious follow-up.*
- **Reconnecting a file that failed to parse** creates the application and files
  the stored file, but the resume row is left `parse_status: 'pending'` with no
  parse result, so no profile comparison is queued. Re-running the parse from
  the candidate's Resumes section is the workaround.
- **A moved storage object that fails to move** is logged and left at the old
  path. The row is what the product reads and the path is still the right
  tenant's folder, so nothing breaks — but the file sits under the wrong
  candidate's prefix for anyone reading storage directly.
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
- **Not verified end to end.** Extraction of all three formats IS verified
  against real files, and the UI — format rejection, the connect link, the
  picker, the Resumes section, retry, the concurrency cap — was verified in a
  browser. The create / match / apply / reconnect path could not be exercised:
  the OpenAI account has no credits, and migrations 0018 and 0019 have not been
  applied to the live database. `cleanupDecision()` and
  `shouldRemoveApplication()` — the two decisions that destroy rows — are unit
  tested, but their surrounding plumbing has never run against Postgres.
