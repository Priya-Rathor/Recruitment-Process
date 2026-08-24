# Module 23 — Forms & Public Applications

One form engine, and the first surface in this product that accepts data from
somebody with no account and no relationship to the organization.

A job's application form is a `forms` row with `purpose = 'job_application'` and
a `job_id`. A pre-interview questionnaire is the same row with a different
purpose and no job. There is deliberately no second "job application form"
system: the one that grew a separate field editor would be the one that drifted.

## The shape of it

```
job created (Module 3)
  └─ forms row, purpose=job_application, status=draft, default questions
       └─ recruiter reviews / adds questions   → /settings/forms/{id}
       └─ recruiter publishes                  → job page card
            └─ /apply/{token}                  → public, no login
                 └─ submission
                      ├─ form_responses          (answers, saved FIRST)
                      ├─ resumes + resume_parse_results   (Module 6 pipeline)
                      ├─ candidates              (created OR matched, never overwritten)
                      └─ applications            (Module 5, stage = Applied)
```

## Files

| Path | What it holds |
| --- | --- |
| `supabase/migrations/0033_module23_forms_public_applications.sql` | Tables, enums, triggers, RLS |
| `lib/forms/fields.ts` | Field-type vocabulary, default questions, **which answer maps to which candidate column** |
| `lib/forms/types.ts` | Row shapes |
| `lib/forms/token.ts` | The signed public link, with a version so it can be revoked |
| `lib/forms/validation.ts` | Both validators — the form's shape, and a submission against it |
| `lib/forms/candidateFields.ts` | Answers → candidate row; typed-beats-parsed; conflict detection |
| `lib/forms/queries.ts` | Recruiter-side reads |
| `lib/forms/write.ts` | Auto-create on job creation; the field-save diff |
| `lib/forms/public.ts` | The applicant's read, via service role |
| `lib/forms/submit.ts` | The submission pipeline |
| `lib/forms/rateLimit.ts` | The durable per-source and per-form caps |
| `lib/forms/origin.ts` | Site origin inside a server component |
| `app/apply/[token]/` | The public page and its form |
| `app/jobs/[id]/ApplicationFormCard.tsx` | Link, QR, publish, disable, regenerate |
| `app/settings/forms/` | The list and the shared field editor |
| `app/applications/[id]/FormResponseCard.tsx` | The answers, on the application |
| `app/api/forms/…`, `app/api/apply/[token]/submit` | The routes |
| `lib/forms/forms.test.ts`, `lib/forms/token.test.ts` | 52 unit tests |

Touched: `lib/supabase/session.ts` (+ its test), `app/api/jobs/route.ts`,
`lib/intake/process.ts`, `lib/types.ts`, `lib/activity/{types,events,log}.ts`,
`app/settings/SettingsShell.tsx`, `app/jobs/[id]/page.tsx`,
`app/applications/[id]/page.tsx`, `app/globals.scss`.

## What was REUSED, not rebuilt

This is the part that matters most, because a second implementation of any of
these would mean the same person deduplicated one way through a recruiter's
upload and another way through a public link.

| Concern | Reused from |
| --- | --- |
| Email/phone normalisation | `lib/candidates/dedupe.ts` — `normalizeEmail`, `normalizePhone` |
| Who does this resume belong to? | `lib/intake/match.ts` — `resolveCandidateMatch` |
| Text out of a PDF/DOC | `lib/resumes/extract.ts` — `extractResumeText` |
| Which files count as a resume | `lib/resumes/uploadPolicy.ts` — `isAllowedResumeUpload` |
| AI parse | `lib/ai/parseResume.ts` — `parseResume` |
| Profile conflicts, queued not applied | `lib/resumes/review.ts` + `resume_parse_results` with `reviewed_at = null` |
| Creating the application | `lib/intake/process.ts` — `ensureApplicationForCandidate` |
| "We got your application" | `lib/communications/triggers.ts` — `trySendForEvent('application_received')` |
| Automations | `lib/automations/engine.ts` — `dispatch('application_created')` |
| QR code | the pattern in `app/api/coding-sessions/[id]/qr/route.ts`, and the `qrcode` dependency already present |
| No-login page | the `/unsubscribe` (15) and `/coding` (20) precedent |

`ensureApplicationForCandidate` gained three optional parameters — `client`,
`source`, `via` — so a sessionless caller can use it. Its double guard against
a duplicate application (a SELECT plus the 23505 branch on the unique
`(candidate_id, job_id)` index) is now shared, which matters more here than for
bulk intake: a phone user double-tapping Submit is the likeliest way that race
ever happens in production.

## The public link

An HMAC over `(form id, token_version)`, keyed on `INTEGRATION_ENCRYPTION_KEY`,
base64url, version-prefixed — the same construction as `lib/coding/token.ts`
and `lib/communications/optout.ts`.

**Nothing about the link is stored.** There is no token column, so a database
dump yields no working URL and no mistaken `SELECT` can leak one. The URL carries
only `forms.id` — no organization, job or candidate id, and not the job title.

**Unguessability**: the token is a 256-bit HMAC over the payload. Forging one
requires the server's signing key; guessing one is a 2^256 search. Editing the
payload — pointing it at another form, or bumping the version to survive a
regeneration — invalidates the signature. Both are pinned in `token.test.ts`.

**Revocation** is the thing this token has that the coding one does not.
`token_version` is signed into the payload and checked against the row on every
request, so `update forms set token_version = token_version + 1` kills every link
and printed QR code in one statement, with no secret stored anywhere. It is
Owner/Admin only, and the UI states plainly what it breaks before confirming.

**No key, no link.** `createFormToken()` returns null, publishing is refused with
an actionable message, and no unsigned fallback exists.

## Rate limiting

There was nothing to reuse — this module builds the first limiter in the
codebase — so it is deliberately **durable, not in-process**. An in-memory
counter on serverless is per-instance and resets on every cold start; it is a
suggestion, not a limit.

- `form_submission_attempts`, one row per attempt, keyed on
  `(form_id, ip_hash)`, read over a rolling `[now - 1h, now]` window.
- **3 per source per hour**, and a **120 per form per hour** backstop.
- The IP is stored as a **salted HMAC, never raw** — the limiter's only question
  is "same source as before?", and an IP address is personal data under GDPR
  (Module 22 exists so this product does not collect things casually).
- `x-forwarded-for` is a header. Behind Vercel the platform sets it, but a forged
  value would land in a different bucket — which is exactly what the per-form cap
  covers, and it is stated in the code rather than left as an assumption.
- Where no address can be read at all, submissions share one bucket which is
  **not** capped at three (that would refuse real applicants on a deployment
  with no proxy headers); the per-form cap governs it.
- A database failure **allows** the submission. Deliberate: the cost of a broken
  limiter is spam a recruiter deletes; the cost of failing closed is a real
  person unable to apply for a job because of an outage on our side.
- Old rows are pruned opportunistically from the submission path — they are only
  ever read for an hour, and a ledger of hashed sources is not something to keep.

## The submission order, and why

1. **Re-check the form.** Disabled, archived job, or regenerated link since the
   page rendered — all refused here, not at render time.
2. **Rate limit**, before any file or AI work.
3. **Validate the file** — type and size — *before* parsing, so an anonymous
   caller cannot reach the AI pipeline with a 10 MB junk file.
4. **Re-validate every answer server-side**, against the field definitions read
   from the database. The page's validation is a courtesy anybody can skip with
   `curl`; this is the check that counts.
5. **Store the answers.** Everything after this point is recoverable, and this is
   the rule the whole file is arranged around: somebody has typed for five
   minutes on a phone, so a downstream failure loses a *link*, never a
   submission.
6. Park the file → extract → parse. **An AI failure is not a submission
   failure**: the applicant typed their details in themselves, so the candidate
   and application are created anyway and the resume is filed unparsed.
7. Match deterministically. **An existing candidate is never overwritten** — not
   by the parsed resume (queued in `resume_parse_results`, `reviewed_at` null)
   and not by the typed answers either, which are reported as conflicts on the
   response row. An **ambiguous** match (email points at one person, phone at
   another) resolves nothing at all, exactly as bulk intake refuses to guess.
8. Create the application via the shared helper, `source = 'application_form'`,
   stage `DEFAULT_APPLICATION_STAGE`.
9. Link the response to what it produced; notify; dispatch automations.

If a step after 5 fails, the response is stored with
`status = 'needs_attention'` and a sentence saying what to do, shown on the
application. **The applicant is told it worked either way** — their answers are
in the database and a recruiter can see them; sending somebody away to re-type
five minutes of work because our candidate insert failed would be indefensible.

## Field → column mapping

The candidates table (migration 0003) has the columns it has. This is where
assumptions usually go wrong, so it is explicit:

| Question | Lands in |
| --- | --- |
| First name + Last name | **joined** into `candidates.name` — there is no first/last pair |
| Email * | `email` (dedupe matches on `email_normalized`) |
| Phone * | `phone` (last 10 digits, `PHONE_MATCH_DIGITS`) |
| Current location | `location` |
| Current company / job title | `current_company` / `current_role` |
| Total years of experience | `total_experience_years` — `numeric(4,1)`, CHECK 0–60 |
| Expected annual salary | `expected_salary` — CHECK ≥ 0 |
| Notice period (days) | `notice_period_days` — CHECK 0–365 |
| Resume * | `resumes` row + the `resumes` bucket |
| **Current annual salary** | *nothing* — answer only |
| **LinkedIn profile** | *nothing* — answer only |
| every custom question | *nothing* — answer only |

The numeric bounds are mirrored in `NUMERIC_BOUNDS` and enforced by
`validateAnswers`, so "61 years" is refused where the applicant can still fix it
rather than failing at the insert with a constraint name.

Answer-only fields are not lost: they render on the application's
**Application form responses** card, which shows precisely the answers the
profile has nowhere to hold.

## Permissions

| | Owner | Admin | Recruiter | Viewer |
| --- | --- | --- | --- | --- |
| See forms and submissions | ✅ | ✅ | ✅ | ✅ |
| Edit questions | ✅ | ✅ | ✅ | ❌ |
| Publish / disable | ✅ | ✅ | ✅ | ❌ |
| Regenerate the public link | ✅ | ✅ | ❌ | ❌ |
| Delete a form | ✅ | ✅ | ❌ | ❌ |

Every row is enforced twice — `requireRole()` in the route **and** a policy in
migration 0033 — because the browser holds an authenticated PostgREST client. A
rule that lives only in a handler is not enforced, and here the rule in question
is "can this person put a URL on the public internet".

`form_responses` has **no** insert, update or delete policy at all. The only
writer is the applicant, through the service-role path. Giving staff a write path
would mean a recruiter could edit what somebody submitted — the one thing this
table exists to show faithfully.

## Security notes

- The public page and route use `createAdminClient()` (service role, bypasses
  RLS) after verifying the signature, and **every** query filters
  `organization_id` explicitly, read from our own row. Nothing about which form,
  job or tenant this is comes from the request. This is the same pattern
  `lib/coding/candidate.ts` and the Bolna webhook use; a token-scoped RLS policy
  is not expressible for an anonymous caller, which has no JWT to key on.
- `"/apply"` is on the `PUBLIC_PATHS` allowlist. **`"/applications"` — the
  internal pipeline — stays private**, because it neither equals `"/apply"` nor
  begins with `"/apply/"`. `publicPaths.test.ts` pins that explicitly: an entry
  of `"/app"` would publish the entire product.
- A **disabled** form and an **unknown** token show different messages, and that
  is deliberate. Reaching the "no longer accepting applications" page requires a
  signature this server produced, which cannot be forged — so anybody who gets
  there was genuinely given the link, and telling them the role has closed is
  both true and useful. A **regenerated-away** link is treated as invalid, not
  closed, so the holder of an old QR code is told to ask for the current link.
- An **archived job** closes its form automatically, without anybody remembering
  to disable it. A live link into a requisition nobody is reading is worse than a
  closed page, because the applicant believes they have applied.
- The organization's Module 22 **privacy notice is rendered unconditionally**
  above the submit button. This is the first point of collection from the
  applicant, and per `AGENTS.md` the disclosure cannot be switched off.
- Email and Resume cannot be removed or made optional from a job application
  form. Enforced in three places — the editor omits the control,
  `parseFieldDefinitions()` refuses the payload, and
  `trg_form_fields_protect` refuses the write.

## Manual test cases

### The form
1. Create a job → its detail page shows **Application form** as a **draft** with
   13 standard questions.
2. Open **Manage questions** → rename "Current annual salary", reorder two
   questions, add a paragraph question, Save. Reload: order and labels persisted.
3. Try to remove **Email** or **Resume** → no delete button. Their Required
   toggle is disabled and explains why.
4. Add a dropdown with no choices → Save is refused with a sentence.
5. Set a question type to Dropdown, add choices, switch it back to Short text →
   the stale choices are not saved.
6. Publish with zero questions → refused (422).

### The link
7. Publish → link, **Copy link**, **Show QR code**, submission count and
   **View applications** appear. The QR scans to the same URL.
8. Open the link in a private window → the form renders with no nav, no login.
9. **Disable** → the same link now shows "no longer accepting applications".
   Re-enable → it works again.
10. **Regenerate link** (as Owner) → the warning names what breaks. Confirm, then
    open the old URL: the neutral "no longer available" page. The new URL works.
11. As a **Recruiter**, Regenerate is absent. Call
    `PATCH /api/forms/{id} {"regenerate_link":true}` directly → 403.
12. As a **Viewer**, the whole Forms section is absent from Settings nav; the
    page itself shows the restricted panel; a direct PostgREST
    `update forms set status='published'` from the browser console is denied by
    RLS.

### Submitting
13. Submit with a new email → **exactly one** candidate, **one** application at
    stage Applied, source "Application form", the resume on the profile, and the
    custom answers on the application's responses card in configured order.
14. Submit again with the **same email**, different typed answers → no second
    candidate, no second application; the response is flagged
    `needs_review` and the card names the disagreeing fields. **Nothing on the
    profile changed.**
15. Submit with an email belonging to candidate A and a phone belonging to
    candidate B → nothing is created; the response says the submission matched
    two people.
16. Double-tap Submit on a phone → one application (the 23505 guard).
17. Miss required fields / mistype an email / enter 61 years / enter a 400-day
    notice period → inline errors, all at once, nothing submitted, nothing lost.
18. Attach a `.txt`, then an 11 MB PDF → refused inline before any parsing.
19. Attach a scanned PDF with no text layer → the application is still created;
    the resume is filed with `parse_status = 'failed'`.
20. Submit four times within an hour from one browser → the fourth is refused
    with the "contact the recruiter" message.
21. Open the form at a **360px** viewport → single column, no horizontal scroll,
    full-width submit, the file picker and choice rows are finger-sized.
22. Unset `INTEGRATION_ENCRYPTION_KEY` and try to publish → refused with the
    message naming the variable.

### Standalone forms
23. Settings → Forms → **New form** → lands in the editor with zero questions.
24. Add questions, publish, submit → the answers are stored and **no candidate
    and no application are created** (there is no job to apply to).

### Regression
Candidate create/list/profile; job create (now also creates a form) and edit;
bulk resume intake; stage transitions; interview scheduling; the marketing site
and `/coding` (they share the public path allowlist); `/audit-log`.

## Gaps, stated plainly

- **No attachment field beyond the resume.** `file_upload` is not offered as a
  custom question type and is refused server-side for any key other than
  `resume` on a job application form. An arbitrary attachment needs its own
  bucket, storage policies and a Module 22 retention answer; offering the type
  without them would accept somebody's document and silently drop it. This is the
  same call `docs/modules/19-onboarding-documents.md` made about its upload link.
- **No conditional logic.** Flat, linear field list — no "if X, show Y".
- **No form versioning or A/B testing** per job.
- **No candidate portal or login.** The page stays anonymous and token-based.
- **No candidate columns** for current salary, LinkedIn, GitHub or portfolio.
  Those answers live on the responses card. Adding columns is a
  candidate-profile change with its own UI, filters, exports and retention
  implications.
- **A standalone form is not yet assignable to a specific candidate.** Its
  answers are stored against the form, not linked to a person, so the
  "assign a pre-interview questionnaire to this shortlisted candidate" flow from
  the brief's Feature 13 is **not** built — the data model supports it
  (`form_responses.candidate_id` exists and is nullable), the link-and-send step
  does not.
- **Applications are not filterable by "came from a form"** beyond the existing
  Source filter, which now includes "Application form".

## One pre-existing bug fixed on the way through

`lib/activity/types.ts` had declared the `message_template` (Module 15) and
`privacy` (Module 22) entity types for some time, but neither was ever added to
the `activity_entity_type` database enum. `logActivity()` does not throw on a
failed insert — it logs and returns false — so **every audit row written against
those two entity types has been silently dropped**, including the privacy log's
"who viewed this transcript" entries.

Migration 0033 adds both, along with this module's own `form`. Worth checking
whether anything else depends on those rows having existed.
