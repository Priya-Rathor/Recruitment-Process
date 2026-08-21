# Live Coding Interview (Module 20)

> Built on top of the existing Interview module. Nothing was forked, duplicated
> or replaced: the feature reuses the interview record, the application/candidate
> relationship, the job's Written Assessment configuration, the existing role
> checks, the existing evaluation history, and the signed-link pattern Module 15
> already uses for candidate-facing pages.

**Verified at build time:** `npm run lint` clean · `npm run typecheck` clean ·
`npm test` **52 files / 1154 tests passing** (40 of them new) ·
`npm run build` succeeds.

---

## 1. Overview

An interviewer, mid-call on Google Meet, presses **Start coding round** on the
interview they are already looking at. The product creates a coding session,
signs a link for it, and renders a QR code. The interviewer shares their screen;
the candidate scans it with their phone or laptop, lands on a bare page with no
login, reads the question, writes code in a real editor, and submits. The
interviewer watches the code arrive live on the same screen they started from,
and the result lands in the candidate's history alongside every other stage's
verdict.

**What this makes real.** The **Written Assessment** hiring stage has existed
since Module 3 and was marked `configuration_only` — a job could describe a
coding test and nothing ran it. This is the engine it was waiting for, and the
stage is now `execution: "live"` with `engine: "Live coding rounds (Module 20)"`.
The honesty test in `lib/hiring-stages/config.test.ts` was updated to match, and
still enforces that a live stage must name a real engine.

**What it deliberately does not do.** It does not run code. There is no sandbox,
no test cases and no automatic score — see §9.

---

## 2. Complete user flow

```
INTERVIEWER                                     CANDIDATE
───────────                                     ─────────
Opens /interviews/{id}
  (existing page; Google Meet link
   already there as "Join meeting")
        │
        ▼
Clicks "Start coding round"
        │
        ▼
Modal prefilled from the job's
Written Assessment configuration
  · question title + description
  · instructions
  · languages offered
  · advisory time limit
        │
        ▼
POST /api/interviews/{id}/coding-session
  · creates coding_sessions row (status: created)
  · signs an HMAC access token
  · logs interview.coding_round_started
        │
        ▼
QR modal opens
  · <img src="/api/coding-sessions/{id}/qr">
  · copyable link
  · "Open live monitor"
        │
        ├──── shares screen on Google Meet ────►  scans the QR code
        │                                                │
        │                                                ▼
        │                                     GET /coding/{token}
        │                                       · token verified server-side
        │                                       · session moves to in_progress
        │                                       · opened_at stamped
        │                                                │
        │                                                ▼
        │                                     Reads question · picks language
        │                                     Writes code
        │                                                │
        │                                                ▼
        │                                     AUTOSAVE — 1.5s debounce
        │                                     PUT /api/coding/{token}/draft
        │                                       "Saving…" → "All changes saved 14:32"
        │                                                │
        ▼                                                │
Opens /coding-sessions/{id}                              │
  · polls every 5s while visible  ◄───────────────────────┘
  · read-only <pre>, never an editor
  · "Last updated: just now"
        │                                                │
        │                                                ▼
        │                                     Clicks "Submit code"
        │                                     Confirmation dialog
        │                                                │
        │                                                ▼
        │                                     POST /api/coding/{token}/submit
        │                                       1. save latest code
        │                                       2. stamp submitted_at (row FROZEN by trigger)
        │                                       3. session → submitted
        │                                       4. write application_evaluations row
        │                                       5. log activity (actor = NULL)
        │                                       6. notify the interviewer
        │                                                │
        ▼                                                ▼
Notification: "X submitted their          "Your coding submission has been
coding round"                              successfully submitted."
        │                                  Editor becomes read-only, code stays visible
        ▼
Result now visible in THREE places, none of which were edited to show it:
  · /applications/{id}      → Evaluation panel, Written Assessment section
  · /candidates/{id}        → Application History
  · /analytics              → funnel + stage durations
```

---

## 3. Architecture

```
                    INTERVIEWER (has a session)          CANDIDATE (has no account)
                    ───────────────────────────          ──────────────────────────
  Frontend      /interviews/[id]  (server)               /coding/[token]  (server)
                  └ CodingRoundPanel (client)              └ CodingWorkspace (client)
                /coding-sessions/[id] (server)                └ CodeEditor (dynamic, ssr:false)
                  └ LiveMonitor (client, polling)
                        │                                          │
                        ▼                                          ▼
  API           /api/interviews/[id]/coding-session        /api/coding/[token]
                /api/coding-sessions/[id]                  /api/coding/[token]/draft
                /api/coding-sessions/[id]/qr               /api/coding/[token]/submit
                        │                                          │
                        ▼                                          ▼
  Auth          requireRole() / requireMembership()        verifyAccessToken()
                → RLS applies normally                     → HMAC over the session id
                                                           → NO session exists
                        │                                          │
                        ▼                                          ▼
  Data          lib/coding/queries.ts                       lib/coding/candidate.ts
                (session-bound client)                      (SERVICE-ROLE client,
                                                             scoped by verified id)
                        │                                          │
                        └──────────────────┬───────────────────────┘
                                           ▼
  Database                       coding_sessions
                                 coding_submissions
                                 + 5 triggers, RLS, 2 enums
                                           │
                                           ▼
  Rollup                         application_evaluations
                                 (stage_key = 'written_assessment')
                                           │
                                           ▼
                    listEvaluationEntries() — now FOUR sources
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
            Evaluation panel       Application History        Analytics
            (/applications/[id])   (/candidates/[id])         (funnel, durations)
```

### The three decisions that shaped everything

**1. The candidate has no account, so the link is the authorisation.**
`lib/coding/token.ts` is the same construction as `lib/communications/optout.ts`:
an HMAC-SHA256 over `v1:<session_id>`, base64url-encoded, compared in constant
time. It is **stateless** — nothing is stored, so a database dump contains no
working links. The cost is that a token cannot be individually revoked, so
revocation is expressed on the **session** instead: cancelling a round or letting
it expire closes the link, and access is re-checked on *every* save rather than
cached from page load.

**2. The candidate has no session, so their writes use the service-role client.**
Every RLS policy here asks "is the caller a member of this organization?" and the
honest answer for a candidate is no. `lib/coding/candidate.ts` therefore uses the
service-role client — the same shape the Bolna webhook uses — with the session id
coming out of a *verified signature*, never out of a request body, and every
query scoped by an `organization_id` read from our own row.

**3. The result goes into `application_evaluations`, not a new history surface.**
`listEvaluationEntries()` already merged three sources into one list feeding four
screens. A fifth surface would have been a fifth place to keep in step, and the
coding round would have been invisible to the other four.

---

## 4. Files changed

### New — library (`lib/coding/`)

| File | Purpose |
| --- | --- |
| `session.ts` | Statuses, the **access decision** (`checkSessionAccess`), reuse rule, bounds, `describeLastSaved()`. Pure. |
| `languages.ts` | The closed list of five languages, labels, editor starters, normalisation. Pure. |
| `token.ts` | HMAC sign/verify, `buildCandidateUrl()`. Fails closed with no key. |
| `queries.ts` | Interviewer-side reads and writes (session-bound client) + `suggestQuestion()` from the job's config. |
| `candidate.ts` | Candidate-side reads and writes (service-role, token-scoped). |
| `afterSubmit.ts` | The rollup: evaluation row → activity event → interviewer notification. |
| `coding.test.ts` | 25 tests — access decision, reuse, statuses, time phrasing, languages. |
| `token.test.ts` | 15 tests — round-trip, **enumeration**, tampering, key rotation, fail-closed. |

### New — API

| File | Methods |
| --- | --- |
| `app/api/interviews/[id]/coding-session/route.ts` | `GET` list + suggestion, `POST` start |
| `app/api/coding-sessions/[id]/route.ts` | `GET` monitor poll, `PATCH` cancel |
| `app/api/coding-sessions/[id]/qr/route.ts` | `GET` QR as SVG |
| `app/api/coding/[token]/route.ts` | `GET` candidate view |
| `app/api/coding/[token]/draft/route.ts` | `PUT` save |
| `app/api/coding/[token]/submit/route.ts` | `POST` submit |

### New — pages and components

| File | Purpose |
| --- | --- |
| `app/coding/[token]/page.tsx` | **Public** candidate page — no shell, no nav. Renders the refusal card for invalid/expired/cancelled. |
| `app/coding/[token]/CodingWorkspace.tsx` | Editor, autosave, save status, submit + confirmation. |
| `app/coding/[token]/CodeEditor.tsx` | CodeMirror 6, dynamically imported (`ssr: false`). |
| `app/interviews/[id]/CodingRoundPanel.tsx` | Start button, question modal, QR modal, round history. |
| `app/coding-sessions/[id]/page.tsx` | Interviewer view — monitor **and** submission, one page. |
| `app/coding-sessions/[id]/LiveMonitor.tsx` | Polling, read-only code, cancel with reason. |

### New — database

| File | Purpose |
| --- | --- |
| `supabase/migrations/0031_live_coding_interview.sql` | Tables, enum, 5 triggers, RLS, grants |
| `supabase/ALL_MIGRATIONS.sql` | 0031 appended (this is the file the README tells you to run) |

### Modified — existing files

| File | Change | Why |
| --- | --- | --- |
| `lib/supabase/session.ts` | `/coding` added to `PUBLIC_PATHS` | A candidate has no login; the page authorises itself with its own token |
| `lib/hiring-stages/catalog.ts` | `written_assessment` → `execution: "live"`, engine named, description updated | It now has an engine. Leaving it "Not yet active" would be false |
| `lib/hiring-stages/config.test.ts` | Live-stage assertion now expects three | The honesty test doing its job |
| `lib/applications/evaluations.ts` | `source` union gains `"coding"` | Fourth source |
| `lib/applications/evaluationQueries.ts` | `loadCodingEntries()` added to the parallel fetch | Surfaces rounds in every history view |
| `lib/activity/events.ts` | 3 events added | `coding_round_started` / `_cancelled` / `_submitted` |
| `lib/notifications/templates.ts` | `coding_round_submitted` template + type | Tells the interviewer, at `high` priority |
| `app/interviews/[id]/page.tsx` | Loads coding data server-side, renders the panel | Follows AGENTS.md's server-load convention |
| `app/globals.scss` | ~250 lines under a Module 20 heading | Uses existing tokens only; no new colours |
| `package.json` | 7 deps added | See below |

### Dependencies added

| Package | Why | Where it ships |
| --- | --- | --- |
| `qrcode` + `@types/qrcode` | Server-side SVG QR generation | **Server only** — never in a client bundle |
| `@uiw/react-codemirror` + 5 `@codemirror/lang-*` | The editor | **Candidate page only**, via `next/dynamic({ssr:false})` |

Monaco was rejected: it is several megabytes and effectively unusable on a phone,
which is the *primary* entry path here (scan a QR code → open on your phone).

---

## 5. Database changes

### `coding_sessions`

| Column | Notes |
| --- | --- |
| `id` | The only id the candidate URL exposes |
| `organization_id` | RLS + defence in depth |
| `interview_id` | The parent. Everything else is reachable from here |
| `application_id` | **Denormalised** from the interview, so the candidate's hot save path does not join. A trigger keeps it honest |
| `created_by` | `ON DELETE SET NULL` — the session outlives the user |
| `question_title` / `question_description` / `instructions` | **Captured at creation.** A job's questions are edited freely; a candidate must be judged on what they were shown |
| `status` | `created` → `in_progress` → `submitted`, plus `expired` / `cancelled` |
| `languages[]` | Per session, so an offer cannot change under a candidate mid-test |
| `time_limit_minutes` | **Advisory.** Nothing auto-submits — a dropped connection must not cost someone their work |
| `expires_at` | Default +24h. The hard link boundary |
| `opened_at` / `submitted_at` / `cancelled_reason` | |

Constraints: `submitted` ⇔ `submitted_at is not null`; `cancelled` requires a reason.

**There is deliberately no "one session per interview" constraint.** A round
genuinely gets re-run — the connection dropped, the question was wrong. A unique
constraint would make recovery mean *deleting the evidence of the first attempt*.
The API reuses an open session instead of creating a second.

### `coding_submissions`

One row per session (`UNIQUE coding_session_id`), upserted by every autosave —
the same shape as `resume_parse_results`. Columns: `programming_language`, `code`
(≤200,000 chars), `last_saved_at`, `submitted_at`, `save_count`.

Not an append-only keystroke log: the questions are "what is their code now?" and
"what did they submit?", and a row per save answers neither while writing
thousands of rows per interview.

### Enum

`coding_session_status`: `created | in_progress | submitted | expired | cancelled`.

Five, not the seven a generic lifecycle would have. There is no separate `active`
and `in_progress` — nobody can tell them apart, and two indistinguishable states
is how a status column stops meaning anything. There is no `completed` distinct
from `submitted` either: the candidate's submission is the completion of their
side, and the interviewer's verdict is an `application_evaluations` row.

### Triggers (5)

| Trigger | What it enforces |
| --- | --- |
| `trg_coding_sessions_integrity` | `application_id` matches the parent interview's, and both match the row's org |
| `trg_coding_submissions_integrity` | Submission org matches its session's |
| **`trg_coding_submissions_freeze`** | **A submitted row's code and language cannot change.** The API refuses too, but this is the enforcement — the same approach `screening_reports` takes with its `ai_*` columns |
| `trg_coding_sessions_touch` / `trg_coding_submissions_touch` | `updated_at` |

### RLS

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `coding_sessions` | any member | owner/admin/recruiter | owner/admin/recruiter | — |
| `coding_submissions` | any member | **none** | **none** | — |

`coding_submissions` has **no write policy at all**, and that is the point: the
only writer of a candidate's code is the candidate, through the token-authorised
routes. An interviewer *physically cannot* alter what a candidate submitted —
a stronger guarantee than a disabled textarea.

---

## 6. API documentation

### Interviewer endpoints (session + role)

#### `GET /api/interviews/:id/coding-session`
Lists rounds for an interview plus a suggested question.
**Auth:** any member. **Request:** none.
**Response:** `{ data: Session[], suggestion, can_start, signing_configured, caller_role }`.
A `candidate_url` is returned **only** for an open round — a copy button holding a dead link is worse than no button.
**Errors:** `404` not found / other tenant · `503` migration 0031 not applied · `401`/`403`.

#### `POST /api/interviews/:id/coding-session`
Starts a round. **Idempotent**: an interview with an open round gets that round back (`200`, `reused: true`) rather than a second one — the first click's QR code is already on a shared screen.
**Auth:** owner/admin/recruiter.
**Request:** `{ question_title, question_description, instructions?, languages?, time_limit_minutes? }`
**Response:** `201 { data: {...session, candidate_url}, reused: false }`
**Errors:** `503` no `INTEGRATION_ENCRYPTION_KEY` (checked **before** any write) · `400` title/description/time-limit validation · `409` interview cancelled or no-show · `404` · `403` Viewer · `500` no origin for the link.

#### `GET /api/coding-sessions/:id`
The live monitor's poll. **Auth:** any member.
**Response:** `{ data: { status, candidate_name, language, code, last_saved_at, last_saved_label, save_count, submitted_at, cancelled_reason } }`
`last_saved_label` is rendered **server-side** so every viewer of a shared screen reads the same phrase.
**Errors:** `404`.

#### `PATCH /api/coding-sessions/:id`
Cancels a round — **and this is how the link is revoked.**
**Auth:** owner/admin/recruiter. **Request:** `{ status: "cancelled", reason }`
**Errors:** `400` wrong status value / missing or >500-char reason · `409` already submitted or already cancelled · `404`.

#### `GET /api/coding-sessions/:id/qr`
The QR code as `image/svg+xml`, `Cache-Control: no-store`.
Rendered server-side so the link never enters client state and no QR library reaches the browser. SVG because it is projected on a screen share and photographed.
**Errors:** `409` round no longer open (no scannable image of a dead link) · `503` no link buildable · `404`.

### Candidate endpoints (token only — no session)

#### `GET /api/coding/:token`
The candidate's own view. Used by the workspace to recover after a network drop without a reload that would discard unsaved typing.
**Errors:** `404 invalid` · `409 expired|cancelled|submitted` · `503 unavailable`.

#### `PUT /api/coding/:token/draft`
Saves. **One route for autosave and the manual button** — two would drift, and the one that drifted would be the automatic one nobody watches. PUT because the whole buffer is always sent; a dropped diff would leave stored code the candidate never typed.
**Request:** `{ code, language }` · **Response:** `{ data: { last_saved_at, save_count } }`
**Errors:** `400` malformed · `422` code too long / language not offered · `409` session closed · `404` · `503`.

#### `POST /api/coding/:token/submit`
The final answer. **Request:** `{ code, language }` · **Response:** `201 { data: { submitted_at, status } }`
**Errors:** `422` empty code / invalid language · `409` already submitted or cancelled · `404` · `503`.

**Every message in every candidate response is written to be shown verbatim** —
the client never composes its own. An invalid token and a non-existent session
return the *same* message, so nobody can probe which session ids exist.

---

## 7. Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `/coding/[token]` | **PUBLIC** (allow-listed in `lib/supabase/session.ts`) | The candidate's editor |
| `/coding-sessions/[id]` | member | Live monitor **and** submission view |

Existing routes touched: `/interviews/[id]` gained the Coding round panel.
No route was renamed, removed or changed in behaviour.

---

## 8. Manual testing guide

> Prerequisites: apply `supabase/ALL_MIGRATIONS.sql` (or just
> `0031_live_coding_interview.sql`), set `INTEGRATION_ENCRYPTION_KEY` to 32+
> characters, set `SUPABASE_SECRET_KEY`, and have an interview scheduled against
> an application. A phone on the same network is useful but not required — the
> link is copyable.

### TEST 1 — Start a coding round
1. Sign in as Owner, Admin or Recruiter. 2. Open `/interviews/{id}`.
3. Find the **Coding round** card. 4. Click **Start coding round**.
5. Fill the question (or accept the prefill). 6. Click **Start round**.
**Expected:** QR modal opens with a scannable code, a copyable link, and
**Open live monitor**. A `coding_sessions` row exists with `status='created'`.

### TEST 2 — The question prefills from the job
1. On the job, configure **Written Assessment** with a question and a time limit.
2. Start a round on an interview for that job.
**Expected:** Title and description prefilled; a callout says it came from the
job's configuration and that editing it leaves the job's own settings alone.

### TEST 3 — Candidate opens by QR
1. Scan the QR with a phone camera. 2. Open the link.
**Expected:** A bare page — logo, question, language selector, editor. **No nav,
no dashboard, no sign-in prompt.** The session moves to `in_progress` and
`opened_at` is stamped; the monitor now says the candidate has it open.

### TEST 4 — Autosave
1. Type in the editor. 2. Watch the indicator. 3. Stop typing.
**Expected:** "Unsaved changes" → "Saving…" → "All changes saved 14:32".
In DevTools: **one** `PUT` per pause, **not one per keystroke**.

### TEST 5 — Manual save
Click **Save draft**. **Expected:** Button shows a spinner and disables; status
becomes "All changes saved" with a fresh time.

### TEST 6 — Refresh does not lose work
1. Type, wait for "All changes saved". 2. Hard-refresh.
**Expected:** The code is exactly as saved, with the same language selected.

### TEST 7 — Close the tab and come back
1. Type. 2. Switch to another tab immediately (before the debounce fires).
3. Come back and refresh.
**Expected:** The work is there — `visibilitychange` flushes the pending save.

### TEST 8 — Live monitor
1. Open `/coding-sessions/{id}` in another window. 2. Type as the candidate.
**Expected:** Code appears within ~5s. "Last updated: Just now". The code is a
read-only block — **there is no way to type into it.**

### TEST 9 — Monitor stops when hidden
1. Open the monitor, watch the Network tab. 2. Switch tabs.
**Expected:** Polling stops. Returning triggers an immediate catch-up poll.

### TEST 10 — Submit
1. As the candidate, click **Submit code**. 2. Read the confirmation. 3. Confirm.
**Expected:** Green banner "Your coding submission has been successfully
submitted." The editor becomes **read-only but still shows the code**. Save
status reads "Submitted".

### TEST 11 — Refresh after submitting
Refresh the candidate page. **Expected:** Still the submitted state, code still
visible, no editing. **Not** an "expired" or "invalid" card.

### TEST 12 — The result reaches the candidate's record
1. Open `/applications/{id}` → **Evaluation** panel → Written Assessment section.
2. Open `/candidates/{id}` → **Application History** → expand the application.
**Expected:** In **both**: a Written Assessment entry, outcome **Pending**, plus a
coding-round entry summarising the language, linking to `/coding-sessions/{id}`.
Neither screen was edited to show this.

### TEST 13 — Interviewer is notified
Check `/notifications` as the assigned interviewer.
**Expected:** "{Candidate} submitted their coding round", high priority, linking
to the session.

### TEST 14 — Invalid token
Open `/coding/garbage`. **Expected:** "Invalid coding session" card with guidance
to ask the interviewer. **No stack trace, no editor.**

### TEST 15 — Tampered token (the enumeration test)
Take a valid link, change one character in the **middle** of the token.
**Expected:** Same "Invalid coding session" card — identical to TEST 14.

### TEST 16 — Expired session
Set `expires_at` to the past in SQL, reload the candidate page.
**Expected:** "This coding session has expired" with guidance to ask for a new round.

### TEST 17 — Cancellation closes the link mid-flight
1. Candidate has the page open. 2. Interviewer: monitor → Danger zone → cancel
with a reason. 3. Candidate types.
**Expected:** The next save is refused; a banner shows **the interviewer's
reason**; the editor stops accepting input. Already-saved code is kept.

### TEST 18 — Cancel requires a reason
Try to cancel with the box empty. **Expected:** Button disabled; a direct API
call returns `400` "Say why you're cancelling — the candidate will see this."

### TEST 19 — Submitted code cannot be edited
```sql
update coding_submissions set code = 'hacked' where submitted_at is not null;
```
**Expected:** Refused by `trg_coding_submissions_freeze`.

### TEST 20 — An interviewer cannot write a candidate's code
From the browser console as an Owner:
```js
await supabase.from('coding_submissions').update({code:'x'}).eq('id','<id>')
```
**Expected:** Refused — there is no INSERT or UPDATE policy on that table.

### TEST 21 — Viewer cannot start a round
As a Viewer, open the interview. **Expected:** The card explains the round is
readable but not startable. `POST` → `403`.

### TEST 22 — Cross-tenant isolation
As org A, open `/coding-sessions/{a session id from org B}`.
**Expected:** **404**, never 403.

### TEST 23 — No signing key
Unset `INTEGRATION_ENCRYPTION_KEY`, restart, open an interview.
**Expected:** The card names the missing variable and there is no Start button.
`POST` → `503`. **No session is created.**

### TEST 24 — Migration not applied
Run against a database without 0031. **Expected:** "Coding rounds need a database
migration that hasn't been applied yet. Apply `0031_live_coding_interview.sql`."
Not a generic error, and the rest of the interview page still works.

### TEST 25 — Double-click Start
Click **Start coding round** and submit twice quickly. **Expected:** **One**
session. The second returns the first (`reused: true`) — the QR code already on
the shared screen keeps working.

### TEST 26 — Cancelled interview
Cancel the interview, then look at the Coding round card.
**Expected:** "This interview was cancelled, so there's nothing to assess." No
Start button; `POST` → `409`.

### TEST 27 — Mobile
Open the candidate link on a real phone.
**Expected:** Question above the editor, editor usable, **no page zoom on focus**
(the editor is 16px for exactly this reason), Save/Submit full-width and
thumb-reachable. No horizontal page scroll.

### TEST 28 — Language switching does not destroy work
1. Type real code. 2. Switch language.
**Expected:** **Your code is kept.** (The starter stub is replaced only when the
buffer is still an untouched starter.)

### TEST 29 — Nothing existing broke
Verify: candidate create/list/detail · job create/edit · interview
schedule/reschedule/cancel · **interview feedback still submits and still marks
the interview completed** · Google Meet "Join meeting" still appears · pipeline
moves · dashboard · audit log · settings.

---

## 9. Known limitations

Stated plainly, because the product's rule is that a feature must not imply
something it cannot do.

1. **Code is not executed.** No sandbox, no test cases, no automatic pass/fail.
   The submission is recorded with outcome **Pending** and a human decides. A
   score written by something that never ran the code would be a judgement nobody
   made.
2. **The live monitor polls every 5 seconds** and only updates when the candidate
   *saves*. It is not character-by-character. This product has no realtime
   infrastructure, and adding a permanent socket layer for a transient view would
   be infrastructure bought for the wrong reason.
3. **The time limit is advisory.** Nothing auto-submits. Cutting someone off over
   a clock this product cannot see the candidate's side of — a dropped
   connection, a lift, a sleeping laptop — would destroy real work.
4. **No anti-cheating measures.** No tab-focus tracking, no paste detection, no
   proctoring. The interviewer is on a video call with the candidate, which is
   the control this design relies on.
5. **One question per session.** Multiple questions means multiple rounds.
6. **The interviewer cannot annotate the code inline.** Their verdict goes on the
   `application_evaluations` row using the editor that already exists.
7. **No candidate-side timer display.** The suggested duration is shown as text.
8. **`expires_at` is fixed at 24 hours** and is not configurable in the UI.
9. **Sessions are not swept to `expired`.** Expiry is evaluated at access time,
   so a stale session may still read `created` in the database. The access check
   reports it as expired regardless — see `checkSessionAccess()`.

---

## 10. Future improvements

| Idea | Note |
| --- | --- |
| Run the code | Needs a sandboxed executor. The largest single piece of work here, and the one that would turn `outcome: pending` into a real verdict |
| Test cases + automatic scoring | Depends on execution |
| AI code review | `lib/ai/` already has the boundary and the `AiResult<T>` contract — this would be a new named function, and would follow the propose/confirm rule like every other AI feature |
| Realtime monitor | If the product ever gains socket infrastructure for another reason, this view should use it |
| Interview timer with a soft warning | Warn, never auto-submit |
| Multiple questions per round | Tabs within one session |
| Candidate-visible run/lint feedback | Requires execution |
| Copy/paste telemetry | Only with disclosure to the candidate — the same rule the call recording disclosure follows |
| Configurable expiry | A field on the start modal |
| Sweep expired sessions | Add to the existing hourly `/api/automations/sweep` |

---

## 11. Requirements traceability

| Requested feature | Where it lives | Note |
| --- | --- | --- |
| 1 · Start Coding Round button | `CodingRoundPanel` on `/interviews/[id]` | Role-gated by the page's existing check |
| 2 · Secure candidate link | `lib/coding/token.ts`, `/coding/[token]` | Signed HMAC; exposes only the session id |
| 3 · Candidate coding screen | `app/coding/[token]/` | Title, question, language, editor, status, save, submit |
| 4 · Coding question | **Reuses** `job_hiring_stages` Written Assessment config | No duplicate question store |
| 5 · Auto save | `CodingWorkspace`, 1.5s debounce | One request per pause |
| 6 · Live monitor | `/coding-sessions/[id]` | Polling; read-only *by RLS*, not by a prop |
| 7 · Manual save | Same route as autosave | One code path |
| 8 · Submit | `POST .../submit` + confirmation dialog | Frozen by a DB trigger |
| 9 · Session status | `coding_session_status` enum | Five, not seven — see §5 |
| 10 · Result in candidate profile | `application_evaluations` + 4th evaluation source | Appears in three existing screens unchanged |
| 11 · Google Meet flow | **Untouched** | `interviews.meeting_url` still drives "Join meeting" |
| 12 · Database design | 2 tables, adapted to the existing model | No duplicate candidate/interview ids |
| 13 · API design | 6 routes using `requireRole`/`handleRouteError` | Existing conventions throughout |
| 14 · Security | §3, §5 | Signed token, service-role scoping, no interviewer write path, 404-not-403 |
| 15 · Error handling | §8 TEST 14–19, 23, 24 | Every refusal names what to do next |
| 16 · UI/UX | Existing tokens and modal shell | Loading, empty, error, disabled, confirm, responsive |
| 17 · Nothing broken | Lint, typecheck, 1154 tests, build all green | TEST 29 is the manual sweep |
