# Supplement — Modules M26–M31, and the chapters the manual was missing

> **This file is the second half of `docs/QA-MANUAL-TESTING-GUIDE.md`.**
> That manual was written on 2026-08-20 and documents M01–M25. Six modules
> shipped after it, and three chapters it never had — Getting Started, the
> candidate journey, and the integration/infrastructure register — are here.
> Same house format, same test-case table columns, same rule: everything below
> was read out of the source, and where something is *not* built that is stated
> rather than assumed.
>
> Both files are rendered by the in-app documentation centre at `/docs`. A
> reader cannot tell which file a page came from, which is the point. When you
> build a new module, add its chapter here and a row in `lib/docs/registry.ts`.

---

# S1. Getting Started

## S1.1 What you need before you start

| You are | You need | You end up at |
| --- | --- | --- |
| Starting a new company workspace | An email address you can receive mail at | `/onboarding`, then `/dashboard` |
| Joining a colleague's workspace | The invite link they sent you | `/invite/{token}`, then `/dashboard` |
| Coming back | Your email and password, or the Google account you signed up with | `/dashboard` |
| A candidate | Nothing. **Candidates have no login** — every candidate-facing page is opened from a signed link | The one page that link opens |

That last row is a design rule, not an omission: see S9.4 and `docs/PRIVACY.md`.

## S1.2 Signing in

```
USER
  ↓  opens any protected page, e.g. /candidates
proxy.ts  (runs at the edge on every request)
  ↓  supabase.auth.getUser() — no session found
REDIRECT  /login?next=/candidates
  ↓  the `next` value is validated as a same-origin relative path
LOGIN FORM
  ↓  email + password, or "Continue with Google"
SUPABASE AUTH   (called directly from the browser — not through our API)
  ↓  on failure: one generic message, identical for a wrong password and an
  ↓  unknown address, so nobody can probe which accounts exist
  ↓  on success: HTTP-only session cookies are set
proxy.ts  re-runs, finds the session, allows the page
  ↓
PAGE  calls requireMembershipOrRedirect()
  ↓  no user profile row  → self-heals via ensure_current_user_profile()
  ↓  no organization      → /onboarding
  ↓  otherwise            → renders, scoped to your organization
DASHBOARD
```

**Everything about that flow is enforced on the server.** The login page is
cosmetic; `proxy.ts` at the edge and `lib/tenant.ts` inside every page and route
are what actually decide.

## S1.3 The four roles

| Role | Meaning | Cannot |
| --- | --- | --- |
| **Owner** | Created the workspace, or was promoted. Full control including billing-shaped and destructive settings | — |
| **Admin** | Day-to-day administrator | Some Owner-only actions, e.g. regenerating a public form link |
| **Recruiter** | Does the hiring work: jobs, candidates, applications, interviews | Change organization settings, invite members, change roles |
| **Viewer** | Read-only | Write anything |

Roles are enforced in three places for anything that changes what a row may
become: the UI hides it, the API route refuses it, and a database policy refuses
it again. The third one is the one that counts — a signed-in browser holds a
real database client and can skip the first two.

## S1.4 Your first hour

1. **Set the organization's timezone** — `/settings/organization`. Every
   "today", "this week" and SLA clock in the product uses it, not your browser's.
2. **Invite the team** — `/team/invite`. Give people the least role that lets
   them work.
3. **Look at Integrations** — `/settings/integrations`. Everything that contacts
   a real person is disconnected until you connect it, on purpose.
4. **Create a job** — `/jobs/new`. A job application form is created with it,
   as a draft.
5. **Publish the form** and open its link in a private window. That is what an
   applicant sees.
6. **Read the candidate journey** (S2) so you know what happens after they press
   Submit.

## S1.5 Signing out, and staying signed in

- Sign out is in the account menu behind your avatar, top right. It clears the
  session and returns you to `/login`; pressing Back does not restore the app.
- Sessions survive a refresh and a browser restart, and are refreshed on every
  request that passes through the edge.
- Deleting your `sb-*` cookies, or having your session expire, sends you back to
  `/login?next=` the page you were on.
- **Password reset**: `/forgot-password` → the emailed link → `/reset-password`.
  The "we sent it" panel appears whether or not the address has an account.

## S1.6 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-START-001 | First run | A brand-new workspace | Sign up with a fresh address, complete `/onboarding` | You land on `/dashboard` as **Owner** of a workspace containing nothing | | | Critical |
| TC-START-002 | Invite | Joining an existing workspace | Open the invite link while signed out, sign in | You join **that** organization with the role on the invite, not as an Owner of a new one | | | Critical |
| TC-START-003 | Roles | Least privilege actually bites | As a Viewer, open `/settings/organization` | Refused by the page itself, not merely hidden from the menu | | | Critical |
| TC-START-004 | Timezone | The clock is the organization's | Set the timezone to a distant zone, then read the dashboard's "today" counts | Counts change to that zone's day boundary, not your browser's | | | High |
| TC-START-005 | Session | Deep link preserved | Signed out, open `/candidates/{id}`, sign in | You land on that candidate, not the dashboard | | | High |
| TC-START-006 | Session | Sign out is complete | Sign out, then press the browser Back button | The app does not render from cache; you stay on `/login` | | | Critical |

---

# S2. Complete Candidate Journey

Written for somebody who does not read code. Every arrow is something this
product actually does today.

```
A PERSON SEES A JOB
      │  a link on WhatsApp, a QR code on a poster, an agency's outreach
      ▼
OPENS THE APPLICATION FORM              ← no account, no login, no app to install
      │  the form is the job's own; the link is signed and can be revoked
      ▼
FILLS IT IN AND ATTACHES A CV
      │  answers are checked as they type, and again on our server afterwards
      ▼
PRESSES SUBMIT
      │  ANSWERS ARE SAVED FIRST — before any AI, any file work, any matching.
      │  Everything after this point can fail without losing what they typed.
      ▼
THE CV IS READ                          ← text extracted, then structured by AI
      │  if the AI fails, the application is still created; the CV is filed unparsed
      ▼
ARE THEY ALREADY KNOWN TO US?
      ├── new person          → a candidate record is created
      ├── existing person     → their record is REUSED and NEVER overwritten;
      │                         anything that disagrees is flagged for a human
      └── ambiguous (email says one person, phone says another)
                              → nothing is guessed; a recruiter is asked
      ▼
AN APPLICATION IS CREATED               ← this candidate, this job, stage "Applied"
      │  they receive a "we got your application" message if that is configured
      ▼
AI MATCHING SCORES THE FIT
      │  an LLM and a deterministic matcher both run; the score is advice
      ▼
A RECRUITER REVIEWS                     ← a human, always, before anything irreversible
      │
      ├──────────────► AI SCREENING CALL (if the job turns it on)
      │                    │  the call says it is automated and may be recorded,
      │                    │  every time, and that sentence cannot be switched off
      │                    │  a hard attempt cap stops it dialling forever
      │                    ▼
      │                SCREENING REPORT — transcript, summary, answers
      │                    │
      ▼                    ▼
STAGE MOVES ON THE PIPELINE BOARD
      │  the board ages every application and flags the ones going stale
      ▼
INTERVIEW SCHEDULED
      │  an AI brief is prepared for the interviewer from everything above
      │  a meeting link is attached IF the calendar integration is connected
      ▼
INTERVIEW HAPPENS
      │
      ├──────────────► LIVE CODING ROUND (optional)
      │                    │  interviewer shares a QR code on the call
      │                    │  candidate scans it, writes code, submits
      │                    │  NOTHING RUNS THE CODE — a human reads it
      ▼                    ▼
FEEDBACK AND A STRUCTURED EVALUATION
      │
      ├──────────────► CLIENT SUBMISSION (agencies only)
      │                    the shortlist goes to the client company
      ▼
OFFER  →  HIRE
      │
      ▼
ONBOARDING DOCUMENTS
      │  a checklist, and a signed upload link the new hire uses
      ▼
DONE — and every step above is on the candidate's record, in order
```

## S2.1 What the candidate can see, ever

Three pages, each opened by a signed link addressed to them, each of which
stops working when the thing behind it closes:

| Page | Reached from | Stops working when |
| --- | --- | --- |
| The application form | A published job form link or QR code | The form is disabled, the job is archived, or the link is regenerated |
| The coding round | A QR code shared on the interview call | The round is submitted, cancelled, or 24 hours pass |
| The document upload | An onboarding link sent to a new hire | The checklist is complete or withdrawn |
| Unsubscribe | Any automated message | Never — it must always work |

They never see a dashboard, another candidate, the job's other applicants, their
own AI score, or anything about the organization beyond what the page shows.

## S2.2 Where a human is required

The product will not do these on its own, by design:

- Move an application forward on the strength of an AI score alone.
- Save a parsed CV over a candidate's existing profile.
- Place a screening call without the job's screening being switched on.
- Send a message to a candidate who has opted out.
- Decide a coding round passed or failed.

---

# S3. MODULE M26 — Forms & Public Applications

**Status: implemented.** Built 2026-08-22. Migration
`0033_module23_forms_public_applications.sql`. Owning library: `lib/forms/`.
Reference: `docs/modules/23-forms-public-applications.md`.

## S3.1 Purpose

One form engine, and the first surface in the product that accepts data from
somebody with no account and no relationship to the organization.

A job's application form is a `forms` row with `purpose = 'job_application'` and
a `job_id`. A pre-interview questionnaire is the same row with a different
purpose and no job. There is deliberately no second "job application form"
system.

**Who uses it:** recruiters build and publish; anybody on the internet submits.
**Problem solved:** before this, a candidate could only enter the product by a
recruiter typing them in or uploading their CV.

## S3.2 UI Components

### `/settings/forms` — the list and the editor
| UI Component | Purpose | User Action | Expected Result |
| --- | --- | --- | --- |
| Forms list | Every form in the organization | — | Job forms and standalone forms, with status and submission count |
| **New form** | Create a standalone form | Click | Lands in the editor with zero questions |
| Field editor | Add, rename, reorder, retype questions | Drag / type / select | Saved only on an explicit **Save** — never auto-saved |
| Required toggle | Make a question mandatory | Click | Disabled for Email and Resume, with the reason shown |
| Question type | Short text, paragraph, dropdown, etc. | Select | Choice rows appear for choice types; stale choices are dropped on retype |

### `/jobs/{id}` — the Application form card
| UI Component | Purpose | User Action | Expected Result |
| --- | --- | --- | --- |
| Status chip | Draft / published / disabled | — | A new job's form starts as a **draft** with 13 standard questions |
| **Manage questions** | Open the editor | Click | → `/settings/forms/{id}` |
| **Publish** | Make the link live | Click | Link, Copy link, Show QR code and submission count appear |
| **Copy link** / **Show QR code** | Share it | Click | The QR scans to the same URL |
| **Disable** | Stop accepting | Click | The same link now says the role is no longer accepting applications |
| **Regenerate link** | Revoke every copy | Click (Owner/Admin only) | A warning naming exactly what breaks, then a new URL; every old link and printed QR dies |

### `/apply/{token}` — what the applicant sees
No navigation, no login, no product chrome. The questions, the CV upload, the
organization's privacy notice (which cannot be switched off), and a submit
button.

## S3.3 Complete User Flow

```
Recruiter creates a job
   └─ a draft form is created with it, with the standard questions
Recruiter opens Manage questions, edits, Saves
Recruiter publishes  ──────────────► a signed URL + QR code
                                         │
Applicant opens the link                 │
   ├─ answers are validated in the browser (a courtesy)
   └─ presses Submit
        1. the form is re-checked   (disabled? job archived? link regenerated?)
        2. rate limit               (3 per source per hour, 120 per form per hour)
        3. the file is validated    (type and size) BEFORE any parsing
        4. every answer is re-validated SERVER-SIDE against the field definitions
        5. THE ANSWERS ARE STORED   ← nothing after this can lose their typing
        6. file parked → text extracted → AI parse (failure is not a submission failure)
        7. deterministic match against existing candidates (never overwrites)
        8. the application is created, source "Application form", stage Applied
        9. the response is linked, the team is notified, automations dispatch
        │
        └─ if any step after 5 fails: the response is stored as `needs_attention`
           with a sentence saying what to do — and the applicant is still told
           it worked, because it did: their answers are in the database.
```

## S3.4 Technical Flow

`/apply/{token}` (public page) → verify the HMAC signature → read the form with
the **service-role client**, every query filtering `organization_id` read from
our own row → render. Submission posts to `/api/apply/{token}/submit`, which
repeats the whole check. Nothing about which form, job or tenant this is comes
from the request.

**The link itself**: an HMAC over `(form id, token_version)`, base64url,
version-prefixed. **Nothing about it is stored** — there is no token column, so
a database dump yields no working URL. Bumping `token_version` kills every
issued link in one statement, with no secret stored anywhere.

## S3.5 API Flow

| API | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/api/forms` | GET, POST | Session + role | List, create a standalone form |
| `/api/forms/{id}` | GET, PATCH, DELETE | Session + role | Publish, disable, regenerate link (Owner/Admin), delete |
| `/api/forms/{id}/fields` | PUT | Session + role | Save the question set as a diff |
| `/api/forms/{id}/qr` | GET | Session | The QR image for the current link |
| `/api/apply/{token}/submit` | POST | **None — the signed token is the credential** | Rate-limited, re-validated, one of five documented public routes |

## S3.6 Database Flow

```
forms  (organization_id, job_id?, purpose, status, token_version)
  │
  ├── form_fields          the questions, ordered; Email and Resume protected by trigger
  │
  ├── form_responses       one per submission — raw answers, status, conflicts
  │      │                 NO insert/update/delete policy: staff cannot edit
  │      │                 what somebody submitted
  │      ├──► candidates       created OR matched, never overwritten
  │      ├──► resumes + resume_parse_results   (review queued, not applied)
  │      └──► applications     stage Applied, source application_form
  │
  └── form_submission_attempts   the rate limiter: (form_id, ip_hash), 1-hour window
                                  the IP is a salted HMAC — never stored raw
```

## S3.7 Permissions

| | Owner | Admin | Recruiter | Viewer |
| --- | --- | --- | --- | --- |
| See forms and submissions | Yes | Yes | Yes | Yes |
| Edit questions | Yes | Yes | Yes | No |
| Publish / disable | Yes | Yes | Yes | No |
| Regenerate the public link | Yes | Yes | No | No |
| Delete a form | Yes | Yes | No | No |

Every row is enforced twice — in the route and in a database policy — because
the rule in question is "can this person put a URL on the public internet".

## S3.8 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-FORM-001 | Form creation | A job gets a form automatically | Create a job, open it | An **Application form** card, status draft, 13 standard questions | | | High |
| TC-FORM-002 | Editor | Protected questions | Try to delete Email or Resume | No delete control; the Required toggle is disabled and explains why | | | Critical |
| TC-FORM-003 | Editor | Dropdown with no choices | Add a dropdown, leave choices empty, Save | Refused with a sentence naming the problem | | | Medium |
| TC-FORM-004 | Editor | Retyping drops stale choices | Dropdown with choices → switch to Short text → Save | The choices are not saved | | | Medium |
| TC-FORM-005 | Publish | Empty form | Publish a form with zero questions | Refused, 422 | | | Medium |
| TC-FORM-006 | Publish | The link works | Publish, open the link in a private window | The form renders with no nav and no login | | | Critical |
| TC-FORM-007 | Publish | QR matches the link | Show QR code, scan it | Opens the same URL | | | Medium |
| TC-FORM-008 | Disable | Closing a role | Disable, open the link | "No longer accepting applications" — a different message from an invalid link | | | High |
| TC-FORM-009 | Revocation | Regenerate kills old links | Regenerate as Owner, open the OLD url | The neutral "no longer available" page. The new URL works | | | Critical |
| TC-FORM-010 | Revocation | Role check is real | As Recruiter: `PATCH /api/forms/{id} {"regenerate_link":true}` | 403 from the API, not merely a hidden button | | | Critical |
| TC-FORM-011 | Revocation | RLS is the real boundary | As Viewer, from the browser console, PostgREST `update forms set status='published'` | Denied by the database | | | Critical |
| TC-FORM-012 | Submission | Happy path | Submit with a new email and a real CV | Exactly one candidate, one application at Applied, source "Application form", CV on the profile, custom answers on the responses card | | | Critical |
| TC-FORM-013 | Submission | Existing candidate | Submit again with the same email and different answers | No second candidate, no second application; response flagged `needs_review`; **nothing on the profile changed** | | | Critical |
| TC-FORM-014 | Submission | Ambiguous match | Email of candidate A, phone of candidate B | Nothing is created; the response says it matched two people | | | High |
| TC-FORM-015 | Submission | Double-tap on a phone | Double-click Submit | One application (the unique-index guard) | | | High |
| TC-FORM-016 | Validation | Everything at once | Miss required fields, mistype the email, enter 61 years, 400-day notice | All errors shown together, nothing submitted, nothing lost | | | High |
| TC-FORM-017 | Uploads | Wrong type and oversize | Attach a `.txt`, then an 11 MB PDF | Refused inline, before any parsing | | | Critical |
| TC-FORM-018 | Uploads | Unparseable CV | Attach a scanned PDF with no text layer | The application is still created; the resume is filed `parse_status = failed` | | | High |
| TC-FORM-019 | Rate limit | Source cap | Submit four times within an hour from one browser | The fourth is refused with the "contact the recruiter" message | | | High |
| TC-FORM-020 | Privacy | Notice is not optional | Open any published form | The organization's privacy notice renders above Submit, with no way to switch it off | | | Critical |
| TC-FORM-021 | Mobile | 360px viewport | Open the form on a narrow phone | Single column, no horizontal scroll, full-width submit, finger-sized controls | | | High |
| TC-FORM-022 | Config | No signing key | Unset `INTEGRATION_ENCRYPTION_KEY`, try to publish | Refused with a message naming the variable — no unsigned fallback | | | Critical |
| TC-FORM-023 | Standalone | No job, no application | Create a standalone form, publish, submit | Answers stored; **no candidate and no application created** | | | Medium |
| TC-FORM-024 | Near-miss | `/applications` stays private | Signed out, open `/applications` | Redirected to `/login`. The `/apply` allowlist entry must not free it | | | Critical |

## S3.9 Edge Cases

| ID | Edge case | Expected |
| --- | --- | --- |
| EC-FORM-01 | Archived job with a live form | The form closes automatically — nobody has to remember |
| EC-FORM-02 | Answer with no candidate column (LinkedIn, current salary) | Kept on the responses card, never silently dropped |
| EC-FORM-03 | No proxy headers, so no IP can be read | Submissions share one bucket, governed by the per-form cap rather than refused |
| EC-FORM-04 | The rate-limit table itself fails | The submission is **allowed** — a real applicant must not lose a job over our outage |
| EC-FORM-05 | Submission succeeds but the candidate insert fails | Response stored `needs_attention`; the applicant is still told it worked |

## S3.10 Known Gaps

- No attachment field beyond the CV; `file_upload` is refused as a custom
  question type until there is a bucket, a storage policy and a retention answer.
- No conditional logic ("if X, show Y"), no versioning, no A/B testing.
- No candidate portal or login — the page stays anonymous and token-based.
- A standalone form cannot yet be assigned to a specific candidate; the column
  exists, the send step does not.

---

# S4. MODULE M27 — Live Coding Interviews

**Status: partly built** — the round runs end to end, but **nothing executes the
code**. Reference: `docs/live-coding-interview.md`. Owning library: `lib/coding/`.

## S4.1 Purpose

An interviewer, mid-call, presses **Start coding round** on the interview they
are already looking at. The product creates a session, signs a link, and renders
a QR code. The candidate scans it with their phone or laptop, lands on a bare
page with no login, reads the question, writes code in a real editor, and
submits. The interviewer watches the code arrive on the same screen.

This is what makes the **Written Assessment** hiring stage real: it existed from
Module M06 as configuration only, with nothing to run it.

**What it deliberately does not do: it does not run code.** No sandbox, no test
cases, no automatic score. The submission is recorded as **Pending** and a human
decides — a score written by something that never executed the code would be a
judgement nobody made.

## S4.2 UI Components

| UI Component | Where | Purpose | Expected Result |
| --- | --- | --- | --- |
| **Start coding round** | `/interviews/{id}` | Begin a round | Modal prefilled from the job's Written Assessment config |
| Start modal | `/interviews/{id}` | Question, instructions, languages, advisory time limit | Editable before starting |
| QR code + link | `/coding-sessions/{id}` | How the candidate gets in | Shared on the interviewer's screen |
| Live monitor | `/coding-sessions/{id}` | Watch the code arrive | Polls every 5 seconds; updates when the candidate **saves** |
| Cancel round | `/coding-sessions/{id}` | Close the link mid-flight | Requires a reason; the candidate's link stops working immediately |
| Code editor | `/coding/{token}` | Where the candidate writes | CodeMirror, language switcher, autosave |
| Submit | `/coding/{token}` | Hand it in | Locks the submission; the candidate cannot edit afterwards |

## S4.3 Complete User Flow

```
INTERVIEWER                                  CANDIDATE
Opens /interviews/{id}
Clicks "Start coding round"
Modal prefills from the job's stage config
  ↓
POST /api/interviews/{id}/coding-session
  → coding_sessions row (status: created)
  → link signed, QR rendered
  ↓
Shares screen with the QR code   ───────►   Scans it with a phone or laptop
                                              ↓
                                            /coding/{token}
                                              no login, no account, no install
                                              ↓
                                            Reads the question, writes code
                                              ↓
Live monitor shows saves arriving  ◄──────  Autosave (PUT …/draft) + manual save
                                              ↓
                                            Submit
  ↓                                           ↓
Result lands on application_evaluations     "Submitted" — editing is closed
(stage_key = written_assessment)
  ↓
Appears in the Evaluation panel, the
candidate's history, and analytics
```

## S4.4 Technical Flow

Two completely separate authorisation paths, which is the whole design:

| | Interviewer | Candidate |
| --- | --- | --- |
| Page | `/interviews/[id]`, `/coding-sessions/[id]` | `/coding/[token]` |
| Auth | `requireRole()` / `requireMembership()`, RLS applies normally | `verifyAccessToken()` — an HMAC over the session id, compared in constant time. **No session exists** |
| Data access | Session-bound client (`lib/coding/queries.ts`) | Service-role client scoped by the **verified** id (`lib/coding/candidate.ts`) |

The token is stateless — nothing is stored, so a database dump contains no
working links. A token cannot be individually revoked, so revocation is
expressed on the **session**: cancelling or expiring closes the link, and access
is re-checked on *every save* rather than cached at page load.

## S4.5 API Flow

| API | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/api/interviews/{id}/coding-session` | GET, POST | Session + role | Start a round; read the current one |
| `/api/coding-sessions/{id}` | GET, PATCH | Session | Read, cancel (reason required) |
| `/api/coding-sessions/{id}/qr` | GET | Session | The QR image |
| `/api/coding/{token}` | GET | **Token only** | The candidate's read of the question and their draft |
| `/api/coding/{token}/draft` | PUT | **Token only** | Autosave. Public and uncapped — see S4.8 |
| `/api/coding/{token}/submit` | POST | **Token only** | Final submission; closes editing |

## S4.6 Database Flow

```
interviews
   └── coding_sessions   (question, languages, status, expires_at = +24h)
          └── coding_submissions   (code, language, submitted_at)
                 └──► application_evaluations  (stage_key = 'written_assessment',
                                                outcome = pending)
                          └──► the Evaluation panel, the candidate's history,
                               and the analytics funnel — one rollup, four screens
```

Five triggers and RLS on both tables; two enums.

## S4.7 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CODE-001 | Start | A round begins | Open an interview, Start coding round, confirm | A session, a link and a QR code | | | Critical |
| TC-CODE-002 | Start | Prefill from the job | Configure a Written Assessment on the job, then start a round | Question, instructions, languages and time limit are prefilled | | | High |
| TC-CODE-003 | Access | Candidate opens by QR | Scan the QR on a phone | The question and editor load with no login | | | Critical |
| TC-CODE-004 | Autosave | Work is not lost | Type, wait for autosave, refresh the page | The code is still there | | | Critical |
| TC-CODE-005 | Autosave | Close and return | Close the tab, reopen the link | The draft is restored | | | High |
| TC-CODE-006 | Monitor | The interviewer sees saves | Watch `/coding-sessions/{id}` while the candidate saves | Code appears within ~5 seconds of each save | | | High |
| TC-CODE-007 | Submit | Handing in | Submit | Confirmation; the editor is locked | | | Critical |
| TC-CODE-008 | Submit | No edits after | Refresh after submitting | Still submitted; still not editable | | | Critical |
| TC-CODE-009 | Rollup | It reaches the record | Open the candidate's history and the application's Evaluation panel | The round appears in both, outcome **Pending** | | | Critical |
| TC-CODE-010 | Auth | Invalid token | Open `/coding/garbage` | A single neutral failure page | | | Critical |
| TC-CODE-011 | Auth | Tampered token | Edit one character of a valid token | **The same** neutral failure — no hint that a session exists | | | Critical |
| TC-CODE-012 | Auth | Expired session | Wait past 24 hours, open the link | Reported as expired at access time | | | High |
| TC-CODE-013 | Revocation | Cancel mid-flight | Cancel the round while the candidate is typing | Their next save is refused; the link is closed | | | Critical |
| TC-CODE-014 | Revocation | Cancel needs a reason | Cancel with an empty reason | Refused | | | Medium |
| TC-CODE-015 | Integrity | Interviewer cannot write the code | Attempt to PUT a draft as the interviewer | Refused — the candidate's submission is theirs | | | Critical |
| TC-CODE-016 | Permissions | Viewer cannot start | As Viewer, look for Start coding round | Absent, and the API refuses it | | | High |
| TC-CODE-017 | Isolation | Cross-tenant | Use a token from another organization's session | Refused | | | Critical |
| TC-CODE-018 | Config | No signing key | Unset `INTEGRATION_ENCRYPTION_KEY`, start a round | Refused with an actionable message | | | High |
| TC-CODE-019 | Editing | Language switching | Switch language mid-round | The code is not destroyed | | | High |
| TC-CODE-020 | Mobile | Phone editor | Open the round on a phone | Usable editor, no horizontal scroll | | | High |

## S4.8 Known Limitations

1. **Code is not executed** — no sandbox, no test cases, no automatic pass/fail.
2. The live monitor **polls every 5 seconds** and updates on save, not per
   keystroke. This product has no realtime infrastructure.
3. The time limit is **advisory** — nothing auto-submits. A dropped connection
   must not destroy real work.
4. **No anti-cheating measures.** The control this design relies on is that the
   interviewer is on a video call with the candidate.
5. One question per session; multiple questions means multiple rounds.
6. `expires_at` is fixed at 24 hours and is not configurable in the UI.
7. Sessions are not swept to `expired`; expiry is evaluated at access time.
8. **`PUT /api/coding/{token}/draft` is public and has no rate limit.** Tracked
   as S-07 in the known-issues register.

---

# S5. MODULE M28 — Privacy, Consent & Data Retention

**Status: partly built.** The configuration, the decision logic, the schema and
the UI are complete; **the enforcement wiring is not**. Reference:
`docs/modules/22-privacy-consent.md`. Migration `0032_module21_privacy_consent.sql`.

## S5.1 Purpose

Organization-level control over how candidate voice-call and interview data is
handled: consent mode, disclosure wording, retention windows, who may view a
transcript or a recording, and a log of who looked at what.

**Who uses it:** Owner and Admin only, at `/settings/privacy`.

## S5.2 The one thing that is not configurable

**Every screening call states that it is automated and may be recorded.** There
is no setting for that sentence, and there is no toggle that removes it.
Recording somebody without telling them is unlawful in many jurisdictions, so
the product treats it as a build constraint rather than a preference.

## S5.3 UI Components

| UI Component | Purpose | Expected Result |
| --- | --- | --- |
| Consent mode (§2) | How consent is captured and what a decline means | A declined consent is **terminal** — no retry |
| Disclosure segments (§7) | The wording read on the call | Assembled by `lib/privacy/consent.ts`; the mandatory segment cannot be removed |
| Retention windows (§5) | How long transcripts, recordings and artifacts are kept | **Currently a dry-run** — see S5.7 |
| Capability matrix (§9) | Which role may view a transcript, play a recording, export | Stored and tested; **not yet consulted at every call site** |
| Processor register (§8) | Which external processors receive candidate data | Server-rendered from the integration set |
| Privacy log (§10) | Who viewed what | Real, but incomplete — see S5.7 |

## S5.4 Technical Flow

`lib/privacy/settings.ts` holds the config model with its defaults, clamps and
invariants. `consent.ts` resolves consent and builds disclosure segments.
`retention.ts` decides what *should* expire. `queries.ts` reads the log and runs
the retention dry-run the settings page displays.

## S5.5 Database Flow

Migration 0032 adds the settings column, an enum value, consent provenance
columns on the call record, a trigger that **refuses to store a recording that
consent did not permit**, and indexes. The privacy settings themselves live in
`organization_settings.privacy_settings`.

## S5.6 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-PRIV-001 | Access | Owner/Admin only | Open `/settings/privacy` as a Recruiter | Refused by the page, not merely hidden | | | Critical |
| TC-PRIV-002 | Disclosure | It cannot be switched off | Look for a control that removes the recording disclosure | There isn't one, on any screen | | | Critical |
| TC-PRIV-003 | Consent | Decline is terminal | Decline consent on a screening call | The call is not retried; the status is `consent_declined` | | | Critical |
| TC-PRIV-004 | Recording | The database refuses | Attempt to store a recording where consent did not permit it | Refused by the trigger — a loud error, never a silent capture | | | Critical |
| TC-PRIV-005 | Retention | Honest dry-run | Set a short retention window and read the page | It reports what *would* be deleted and says nothing is being deleted yet | | | High |
| TC-PRIV-006 | Log | Read failure is visible | Break the log read | An error state renders, not an empty list that reads as "nobody looked" | | | High |
| TC-PRIV-007 | Public form | Notice at the point of collection | Open any published application form | The organization's privacy notice renders above Submit | | | Critical |

## S5.7 Not Built Yet — the honest boundary

- **The retention executor.** `planRetentionActions()` decides; nothing carries
  it out. There is no scheduled sweep, so **no data is being deleted or archived
  on expiry today**. The settings page shows the dry-run.
- **§9 enforcement at each call site.** `canUseCapability()` is the single source
  of truth and is tested, but the transcript view, recording player, delete and
  export actions do not consult it yet. Their existing Owner/Admin checks still
  apply, so nothing is *more* exposed than before.
- **§10 event emission.** All 11 event types exist and render, but
  `privacy.transcript_viewed`, `privacy.recording_viewed`,
  `privacy.data_exported` and `privacy.data_deleted` are not yet emitted at their
  actions. The log is real but incomplete.
- **§6 request handling.** No candidate-facing endpoint to make a deletion,
  export or withdrawal request, and no queue for staff to work them.
- **The webhook path** still uses the older consent logic and needs to call
  `resolveConsentOutcome()`.

---

# S6. MODULE M29 — Public Product Website

**Status: implemented.** Reference: `docs/modules/21-public-website.md`.
Owning library: `lib/marketing/`.

## S6.1 Purpose

The first public, unauthenticated, indexable surface in the product. Everything
before it was either behind a login or authorised by a signed token sent to one
specific person.

## S6.2 What shipped

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | Static | Landing page — hero, stat band, feature explorer, capability grid, trust band, FAQ, CTA |
| `/how-it-works` | Static | The 15-stage end-to-end flow, four role flows, the AI safety model |
| `/product/{slug}` | Prerendered ×6 | One page per capability group: `source`, `understand`, `screen`, `decide`, `close`, `operate` |

Eight prerendered HTML pages. **No public page reads the session**, so none of
them is dynamic and none can leak tenant data.

## S6.3 Why `/` in the public allowlist is not a hole

The allowlist treats an entry as "this exact path, or anything beneath it". For
`/` the second half compiles to a prefix check against `//`, which no normalised
pathname satisfies. So `/` grants the landing page and nothing else.

`/product` and `/how-it-works` *are* prefix entries and do free everything
beneath them — safe only because no private route begins with either string.
**Before adding a route here, check the near-miss**: an entry of `/job` would
silently publish `/jobs`. `publicPaths.test.ts` pins this.

## S6.4 The no-fiction rule

Every capability named on the site maps to code in this repository. No customer
logos, no testimonials, no invented pricing, no security certifications — there
are no customers to quote and no certifications held, and the FAQ says so rather
than staying silent. Stat-band figures are counted from the repository, with the
derivation in a comment beside each one. `content.test.ts` rejects the vocabulary
of an unmeasured performance claim.

## S6.5 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-WEB-001 | Access | Public pages are public | Signed out, open `/`, `/how-it-works`, `/product/screen` | All render, no redirect | | | Critical |
| TC-WEB-002 | Access | The app stays private | Signed out, open `/jobs` and `/applications` | Both redirect to `/login` | | | Critical |
| TC-WEB-003 | Content | No dead links | Click every footer and nav link | No 404s; nothing links to an unbuilt page | | | High |
| TC-WEB-004 | Content | No fiction | Read the stat band and FAQ | Every figure is countable; no testimonials, logos or certifications | | | High |
| TC-WEB-005 | Isolation | No session read | Load a public page with no cookies at all | Renders identically | | | Critical |
| TC-WEB-006 | Mobile | Narrow viewport | Open `/` at 360px | No horizontal scroll | | | High |

## S6.6 Not Built Yet

Contact / lead capture (an unauthenticated write, which needs its own table,
policies, rate limiting and validation), screenshots and demo visuals (they
would contain real candidate data until a seeded demo organization exists),
legal pages, a public documentation section, pricing, `sitemap.xml`,
`robots.txt`, JSON-LD and an OG image.

---

# S7. MODULE M30 — Voice Agent Console

**Status: implemented.** Reference: `docs/modules/24-voice-agent-console.md`.
Migration `0034_module24_voice_agent_console.sql`. Owning library: `lib/voice/`.

## S7.1 Purpose

One page — `/settings/integrations/bolna` — that configures what the automated
screening call says, how it sounds, how it behaves, and what it falls back to
when a job has not configured its own screening.

**What it is not**: not a second integration path (it saves through the existing
adapter), not a second question list (a job's questions stay on the job; these
are fallbacks), not a second language or attempt-count setting.

## S7.2 UI Components

Nine independently expandable sections on one scrollable page with one sticky
Save:

| Section | Holds |
| --- | --- |
| 0 · Switcher | The organization's agents; exactly one is the default |
| 1 · General | Name, purpose, company name, caller number |
| 2 · Greeting | Welcome and closing lines, with a field picker |
| 3 · AI Brain | Persona, tone, prompt, guardrails, model, response length, temperature — plus **AI Edit** |
| 4 · Voice | Text-to-speech voice, from the provider catalogue |
| 5 · Speech | Speech-to-text model and language |
| 6 · Behavior | Interruption, backchannel, ambience, silence, duration, hangup, voicemail |
| 7 · Default Call Data | Organization fallbacks, with a precedence preview |
| 8 · Handoff | Transfer toggle and number |
| 9 · Test Agent | **Call** (a real call, confirmed, capped) and **Chat** (LLM only — no call, no telephony) |

**AI Edit** proposes a revised prompt; the route has no write. Only the page's
own Save persists it, and a revision that drops a guardrail is *rejected* rather
than flagged, because a reviewer skims a fluent rewrite.

## S7.3 Safety

- Placing a test call is **Owner/Admin only**, checked in the route and in RLS.
- `confirmed: true` is required in the body; the console asks first, **naming the
  number**.
- A hard cap of **ten test calls per organization per rolling hour**, and the
  counter **fails closed** — a count that errors is treated as being at the limit.
- The consent disclosure comes from the screening script and cannot be switched
  off. Whoever answers may not be whoever pressed the button.
- `voice_agent_test_calls` has **no UPDATE policy** — outcomes are written only
  by the webhook, so nobody's browser can rewrite the record of a call.
- Transfer cannot be saved on without a number: a transfer to nowhere drops the
  candidate mid-call.
- Default Call Data cannot overwrite `script`, `questions`, `language` or
  `is_test` — otherwise an admin could replace a compliance-checked script
  *after* it passed its check.

## S7.4 Save behaviour and degraded states

Save is one request carrying the whole form: normalise, **write locally**, then
push to the provider and record whether it landed. A failed sync returns 200
with `synced: false` and a plain reason — the settings *are* saved, and the
console says the provider does not have them yet. The form never clears on error.

| Situation | What the page does |
| --- | --- |
| Migration not applied | Says so and names the migration. No button that cannot work |
| Integration not connected | Still editable and savable; a banner says nothing dials yet |
| Catalogue unreachable | Dropdowns empty **and disabled**, with the reason. Never backfilled with invented voices |
| A saved voice no longer listed | "Saved selection (no longer listed)", value intact |
| No jobs yet | The precedence table says there is nothing to compare against |
| No cost ledger | An explicit "not tracked" state — never a fabricated number |

## S7.5 API Flow

| API | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/api/settings/voice-agents` | GET, POST | Session + role | List, create |
| `/api/settings/voice-agents/{id}` | PUT, DELETE | Owner/Admin | Save the whole form; delete |
| `/api/settings/voice-agents/{id}/test-call` | GET, POST | Owner/Admin | Place a confirmed, capped test call |
| `/api/settings/voice-agents/{id}/prompt-edit` | POST | Session + role | AI Edit — **proposes only, never writes** |
| `/api/settings/voice-agents/{id}/chat` | POST | Session + role | Text rehearsal. No call, no row |
| `/api/settings/voice-agents/preview` | POST | Session | Precedence preview |

## S7.6 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-VOICE-001 | Access | Role check | Open the console as a Recruiter | Refused by the page and by the API | | | Critical |
| TC-VOICE-002 | Save | Local write survives a provider outage | Break the provider, Save | 200 with `synced: false`, a plain reason, and your edits intact | | | Critical |
| TC-VOICE-003 | Save | Nothing is invented | Make the catalogue unreachable | Dropdowns empty **and disabled** with the reason — never backfilled with invented voices | | | High |
| TC-VOICE-004 | Test call | Confirmation names the number | Press Call | A confirmation showing the exact number to be dialled | | | Critical |
| TC-VOICE-005 | Test call | The cap holds | Place eleven test calls in an hour | The eleventh is refused | | | Critical |
| TC-VOICE-006 | Test call | The cap fails closed | Break the counter query, then place a call | Refused — an uncountable cap is treated as reached | | | Critical |
| TC-VOICE-007 | Disclosure | Cannot be removed | Search every section for a switch that removes the recording disclosure | There isn't one | | | Critical |
| TC-VOICE-008 | AI Edit | Proposal only | Use AI Edit, then reload without saving | The prompt is unchanged — the route cannot write | | | Critical |
| TC-VOICE-009 | AI Edit | Guardrail removal is rejected | Ask for a revision that drops a guardrail | Rejected, not merely flagged | | | Critical |
| TC-VOICE-010 | Chat | No telephony | Use the Chat tab | An LLM reply; **no call record, no call placed** | | | High |
| TC-VOICE-011 | Handoff | Transfer needs a number | Enable transfer, leave the number empty, Save | Refused by the normaliser | | | High |
| TC-VOICE-012 | Precedence | Call data cannot overwrite the script | Put `script` in Default Call Data, place a test call | The key is stripped from the payload | | | Critical |
| TC-VOICE-013 | Cost | Honest empty state | Open the header with no cost ledger | "Not tracked", never a plausible invented figure | | | High |

## S7.7 Known Gaps

- Chat mode costs LLM tokens; it creates no call record, but it is not free and
  should be metered once a cost ledger exists.
- `rejectUnknownCallers` is stored but not applied — this product places
  outbound calls only, and the help text says exactly that.
- The provider payload's field names are pinned by unit test, **not by a live
  call**. Verification against a real staging payload still needs doing.
- Catalogue endpoint paths are best-effort and overridable by environment, so a
  renamed endpoint does not need a deploy.

---

# S8. MODULE M31 — Custom Fields

**Status: implemented.** Built 2026-09-06. Migration
`0039_module27_custom_fields.sql`. Reference: `docs/modules/27-custom-fields.md`.
Owning library: `lib/customFields/`.

## S8.1 Purpose

Per-organization extra fields on **jobs, candidates and applications**, with no
code change and no per-organization schema migration.

**The one decision everything else follows from: fixed fields stay fixed, custom
fields are additive, and the database enforces it.** Nothing in `jobs`,
`candidates` or `applications` was altered. A custom field cannot even be
*named* after a built-in one — a `CHECK` constraint lists every reserved key per
entity, so `email` on a candidate is refused by Postgres, not merely by a route
handler that a signed-in browser could bypass.

## S8.2 UI Components

| UI Component | Where | Purpose |
| --- | --- | --- |
| Field list | `/settings/custom-fields` | Every definition, grouped by entity, with its type and order |
| Field editor | `/settings/custom-fields` | Label, key, type, choices, required, display order, show-on-public-form |
| Custom fields section | Job, candidate and application forms | Renders the definitions for that entity |
| Custom columns | Job, candidate and application lists | Optional extra columns |

## S8.3 Data model

`custom_field_definitions` is the vocabulary; `custom_field_values` holds one
answer per definition per record, as `jsonb`.

`entity_id` is **polymorphic**, so there is no foreign key — three `AFTER DELETE`
triggers stand in for `ON DELETE CASCADE`, firing on hard delete only.
Archiving a job keeps its values, which is correct.

`field_type` is the enum Module M26 already created, filtered rather than
retyped. Three types are excluded, by `CHECK` and in code:

| Excluded | Why |
| --- | --- |
| `email`, `phone` | Identity has one home. A custom email field would be a second address disagreeing with the candidate's real one, editable from a page the real one is not |
| `file_upload` | No bucket, no storage policy, no retention answer |

## S8.4 The public-form distinction

A job field marked `show_on_public_form` is asked of **every applicant**. The
definition belongs to the **job**; each value belongs to the **application** that
came through the form — otherwise every candidate would overwrite the last one's
answer. This is the one permitted entity mismatch, allowed explicitly by the
integrity trigger and nowhere else.

## S8.5 Permissions

| | Definitions | Values |
| --- | --- | --- |
| Owner / Admin | Full | Full |
| Recruiter | Read | Full |
| Viewer | Read | Read |

Enforced in the API *and* in RLS.

## S8.6 Deleting

`DELETE` **deactivates** the definition and the dialog names how many records
hold data for it. Permanent erasure is refused server-side the moment one value
exists. Turning a field back on is what restores it.

## S8.7 API Flow

| API | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/api/custom-fields/definitions` | GET, POST | Session + role | List, create |
| `/api/custom-fields/definitions/{id}` | GET, PATCH, DELETE | Owner/Admin to write | Deactivate, or `?permanent=true` |
| `/api/custom-fields/values` | GET, PUT | Session + role | Read and write values for one record |

## S8.8 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CF-001 | Definitions | Create a field | Add a "Visa sponsorship" dropdown on jobs | It appears on the job form and, if marked, on the public application form | | | High |
| TC-CF-002 | Reserved keys | The database refuses | Try to create a candidate field keyed `email` | Refused — and refused again by PostgREST directly, not only by the route | | | Critical |
| TC-CF-003 | Excluded types | No file uploads | Try to create a `file_upload` custom field | Not offered, and refused server-side | | | High |
| TC-CF-004 | Public form | Answers land on the application | Mark a job field public, submit an application | The value is on the **application**, not on the job | | | Critical |
| TC-CF-005 | Public form | No overwriting | Two applicants answer the same public field | Two separate values; neither overwrites the other | | | Critical |
| TC-CF-006 | Permissions | Recruiter cannot define | As Recruiter, try to create a definition | Refused by the API and by RLS; values are still writable | | | High |
| TC-CF-007 | Deleting | Soft by default | Delete a field with data | Deactivated, and the dialog names the record count | | | High |
| TC-CF-008 | Deleting | Permanent is refused with data | `?permanent=true` on a field with one value | Refused server-side | | | Critical |
| TC-CF-009 | Placeholders | Three-part tokens | Use `{{custom.job.visa_sponsorship}}` in a template | Resolves; an applicant's own answer wins over the job's | | | High |
| TC-CF-010 | Fixed fields | Nothing moved | Check the candidate's name, email and phone | Still editable only from the candidate page | | | Critical |

## S8.9 Gaps

- Analytics is untouched.
- Clients, interviews and other entities are out of scope.
- `show_on_public_form` is organization-wide, not per job.
- No help text on a custom field.

---

# S9. Integrations & External Services

Every external service this product talks to, and — more usefully — precisely
what each one does **not** do today. All six adapters live in
`lib/integrations/{bolna,calendar,email,llm,n8n,whatsapp}/` and expose the same
four functions: `connect` / `test` / `getStatus` / `disconnect`.

## S9.1 The rules every integration obeys

1. **A later module calls the adapter. It never re-implements a provider call.**
   There is exactly one place in the codebase that talks to each provider.
2. **Credentials are AES-GCM encrypted** in `organization_integrations` and
   protected by a column-level `REVOKE`, so they can only be read through the
   service-role client — which bypasses row-level security, so every query made
   with it filters `organization_id` explicitly.
3. **Nothing that contacts a real person is on by default.** Disconnected until
   somebody connects it; an explicit confirmation in the UI; a hard attempt cap;
   and a consent disclosure that cannot be switched off.
4. **Not configured means not sent — and it is reported as `skipped`, never
   silently dropped.**
5. **A send never throws.** A failed email must not take down the in-app
   notification it accompanies, or the stage change that triggered both.

## S9.2 The register

| Service | What it is used for | State today |
| --- | --- | --- |
| **Supabase** | Database, authentication, file storage | The platform this product runs on. Not optional |
| **Bolna** | The AI screening call — telephony plus the conversational agent | Real adapter. Dials only when connected, the script passes its compliance check, and the retry cap allows it |
| **Google Calendar (and Meet)** | Creating the interview event and its video link | Real implementation of Google's documented REST contract — **never executed against Google**, see S9.4 |
| **Email provider** | Candidate messages and team notifications | Real adapter. No default provider and no fallback SMTP |
| **WhatsApp Business** | Candidate messages | Real adapter, with Meta's 24-hour free-form window and template rules encoded |
| **LLM provider** | Every AI feature, through `lib/ai/provider.ts` | Works from a server environment key. An organization can store its own key and see its health, but `provider.ts` does **not** read from there yet — the settings page says which key is in force |
| **n8n** | Named in the original stack as the automation executor | **Not used for execution.** The automation engine runs in-process. The adapter records an instance and reports reachability, and `getStatus()` returns `not_used_for_execution: true` so the card can say so plainly |

## S9.3 How an integration is connected

```
/settings/integrations
   └─ a card per provider: status chip, Connect, Test connection, Disconnect
        │
   Connect  →  credentials POSTed once
        │       encrypted with AES-GCM (lib/integrations/crypto.ts)
        │       stored in organization_integrations
        │       column-level REVOKE: unreadable except by the service role
        ▼
   Test connection  →  a real call to the provider, result shown as a status chip
        │
        ▼
   The feature that needs it now works. Until then it reports `skipped`,
   with a sentence saying what to connect.
```

**A credential is never displayed again.** The card shows a mask, and no route
returns a stored secret.

## S9.4 Google Meet — read this before believing anything

The question this section exists to answer honestly: *does this product
integrate with Google Meet?*

**It contains a real, complete Google Calendar integration that requests a Meet
link — and that code has never run against Google.**

- `lib/integrations/calendar/index.ts` creates the event and asks for
  conferencing (`conferenceSolutionKey: hangoutsMeet`), then reads the Meet URL
  back out of the response and stores it on `interviews.meeting_url`.
- `lib/integrations/calendar/oauth.ts` implements Google's documented OAuth 2.0
  flow. Its own file header says it plainly: **no Google Cloud project exists for
  this product.** No client ID, no client secret, no registered redirect URI, no
  consent screen. Not one line has ever executed against Google.
- Consequences, today: unless somebody creates a Google Cloud project and
  connects Calendar, **an interview has no meeting link**, and there is no field
  in the UI to paste one in by hand.
- `not_connected` is deliberately **not an error**. Scheduling must succeed
  without a calendar, and a *revoked* grant degrades to `not_connected` too — a
  revoked token is a connection problem, not a scheduling one.

So: no fabricated Meet integration, and no pretence that the written one is
proven. Verifying it end to end with real credentials is an open task recorded
in `docs/modules/17-settings-notes.md`.

## S9.5 What each integration is allowed to break

| If this is down | What still works | What stops |
| --- | --- | --- |
| Bolna | Everything except placing a screening call. The manual workflow is always usable | New screening calls |
| Calendar | Interview scheduling, feedback, briefs | The event and the meeting link |
| Email / WhatsApp | In-app notifications, every stage change | Outbound candidate messages, reported as `skipped` |
| LLM | Every manual path in the product | Parsing, matching, briefs, summaries — each reports an AI failure rather than a wrong answer |
| n8n | Everything. Automations do not use it | Only the reachability chip |

## S9.6 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-INTG-001 | Defaults | Nothing dials by default | Open `/settings/integrations` on a fresh workspace | Every provider is disconnected | | | Critical |
| TC-INTG-002 | Secrecy | Credentials are never returned | Connect a provider, then read every settings API response | Only a mask; no route returns the secret | | | Critical |
| TC-INTG-003 | Degradation | Email not connected | Trigger a stage change that would message a candidate | The stage change succeeds; the send is reported as `skipped` with a reason | | | Critical |
| TC-INTG-004 | Degradation | Calendar not connected | Schedule an interview | The interview is created; no meeting link; no error state on the page | | | Critical |
| TC-INTG-005 | Honesty | n8n does not execute | Connect n8n and read its card | It says it is not used for execution | | | High |
| TC-INTG-006 | Honesty | Which LLM key is in force | Store an organization LLM key | The page says whether the stored key or the server key is being used | | | High |
| TC-INTG-007 | Isolation | Cross-tenant credentials | Try to read another organization's integration row | Refused — the admin client filters `organization_id` explicitly | | | Critical |

---

# S10. Infrastructure & Cloud Services

The spec template for this chapter assumes Google Cloud. **This product does not
run on Google Cloud**, so this documents what it actually uses.

## S10.1 The stack, as configured

| Layer | What it actually is |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Rendering | Server components by default; client components only where the browser is genuinely needed |
| Styling | Sass + Bulma, with the design tokens in `app/globals.scss` |
| Database | PostgreSQL, hosted by **Supabase**, with row-level security on every table |
| Authentication | Supabase Auth — HTTP-only session cookies, refreshed at the edge |
| File storage | Supabase Storage, **private buckets only** |
| Hosting | Vercel (the deployment target `vercel.json` is written for) |
| Scheduled work | **One** cron: `GET /api/automations/sweep`, every 5 minutes |
| AI | An LLM provider called only from `lib/ai/provider.ts` |
| Telephony | Bolna, called only from `lib/integrations/bolna/` |

There is **no** ORM, **no** schema-validation library and **no** vendor AI SDK.
That is a decision, not an oversight.

## S10.2 Data flow through the platform

```
BROWSER
   │  every request, including navigation
   ▼
EDGE (proxy.ts)          refreshes the Supabase session; enforces "is there a
   │                     session?" against a deny-by-default allowlist
   ▼
SERVER COMPONENT / ROUTE HANDLER
   │  resolves the tenant from the SESSION via lib/tenant.ts — never from a
   │  body, a query param, a header, or an unverified claim
   ▼
SUPABASE POSTGRES        row-level security applies as a second, independent
   │                     boundary. The browser also holds a database client, so
   │                     a rule that exists only in a route handler is not a rule
   ├──► SUPABASE STORAGE     private buckets; files are served only through a
   │                         short-lived signed URL issued after a tenancy check
   ├──► LLM PROVIDER         structured input only; validated output; never an
   │                         irreversible action on a model's say-so
   └──► BOLNA / EMAIL / WHATSAPP / CALENDAR   through the adapters in S9
```

## S10.3 The three database clients, and when each is used

| Client | Who it acts as | Rule |
| --- | --- | --- |
| Browser client | The signed-in user | RLS applies. **This is why RLS is the real boundary** — a signed-in user can write to the database without going through any route |
| Server client | The signed-in user, on the server | RLS applies. The default choice |
| Admin (service-role) client | Nobody. It **bypasses RLS** | Only where there is genuinely no session — the public form, the coding round, the provider webhook. Every query with it filters `organization_id` explicitly, because there is no safety net behind it |

## S10.4 Storage

- **Private buckets only.** No file in this product is served from a public URL.
- Size, MIME type and extension are enforced, and the bucket's own
  `allowed_mime_types` is the real gate — not the client-supplied content type.
- A stored file is reached through a **short-lived signed URL**, issued only
  after the caller's tenancy has been checked.

## S10.5 Scheduling — one clock

`vercel.json` defines exactly one cron job: `GET /api/automations/sweep`, every
five minutes. Stale-stage rules, approval expiry and the delayed-action queue
all drain from that single sweep.

**Do not add a second cron, a worker, or a timer** — add a pass to the existing
sweep. If `CRON_SECRET` is unset the sweep is a permanent 503 and no time-based
automation ever fires, which is a deployment mistake that looks like a product
bug.

## S10.6 Configuration and secrets

Only two environment variables may carry the `NEXT_PUBLIC_` prefix: the Supabase
URL and its row-level-security-constrained publishable key. Everything else —
the service-role key, the encryption key, the LLM key, the provider credentials,
the cron secret — is server-side only.

**No secret appears in source, in a log line, in an error returned to a client,
or in this documentation.** Third-party error bodies are truncated before
logging, because a rejected email send echoes the recipient and an LLM 4xx can
echo a candidate's CV.

## S10.7 What is not set up

Stated so nobody assumes otherwise: **no Supabase project and no Google Cloud
project exist for this product yet**, so every integration in S9 is
correct-by-reading rather than proven by a live call. There is also no CI, no
error tracking, no verified backup restore and no security headers — all four
are open items in the known-issues register.

## S10.8 Test Cases

| Test Case ID | Feature | Test Scenario | Steps | Expected Result | Actual | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-INFRA-001 | Storage | No public file URLs | Upload a CV, then try to open its storage path without a signed URL | Refused | | | Critical |
| TC-INFRA-002 | Storage | Type gate is server-side | Rename a `.exe` to `.pdf` and upload it | Refused by the bucket, not only by the browser | | | Critical |
| TC-INFRA-003 | Tenancy | The admin client is scoped | Exercise a public route (form submit, coding save) and inspect what it can reach | Only the one organization's rows | | | Critical |
| TC-INFRA-004 | Scheduling | The single clock | Unset `CRON_SECRET`, call the sweep | 503, and no time-based automation fires — an obvious failure, not a silent one | | | High |
| TC-INFRA-005 | Secrets | Nothing leaks into a response | Force an error from every integration | No credential, no key and no third-party body appears in the response | | | Critical |
| TC-INFRA-006 | Config | Missing Supabase config | Blank `NEXT_PUBLIC_SUPABASE_URL`, restart, open `/login` | An actionable error naming the exact variables — not an opaque network failure | | | Medium |
