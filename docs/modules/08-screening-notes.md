# Module 8 (Bolna Screening) — implementation notes and follow-ups

This module **places real phone calls to real people and records them**. That
shapes almost every decision below.

## Deliberate deviation from the spec's staging: consent is built now

The Privacy & Compliance chapter assigns this module:

> "The call script's opening line must state that the call is automated and may
> be recorded, and the candidate's continuation is treated as consent; store
> consent_confirmed boolean + timestamp on screening_calls."

That chapter is staged as a **retrofit** to be done once Modules 1, 4, 8, 14 and
17 all exist. **It is implemented here instead.** Deferring it would mean every
call placed between now and the retrofit records a member of the public with no
disclosure — and the same chapter warns that "call recording without consent is
illegal in many jurisdictions, independent of any data-protection law."

That is a legal exposure, not a piece of data hygiene, and it costs one prompt
segment and two columns to avoid. The rest of the privacy retrofit (retention
jobs, erasure action, sub-processor list) is still outstanding and correctly
staged.

Concretely:
- `buildCallScript()` **always** emits the disclosure first. There is no
  parameter to disable it.
- `assertScriptIsCompliant()` runs inside `placeCall()`, so a script assembled
  anywhere — including by a future Module 13 automation — cannot reach a
  candidate without it.
- `screening_calls.consent_confirmed` is set only when the candidate heard the
  disclosure and did not decline. **Module 9 must refuse to treat a transcript
  as usable without it.**
- A database trigger prevents consent being un-recorded by editing the row.

## Nothing dials by accident

Six gates, in order, before a call is placed:

1. application exists in this tenant
2. candidate has a phone number
3. job has screening questions (none = nothing to ask)
4. retry cap allows another attempt
5. Bolna is explicitly connected (default is `disconnected`)
6. the script passes its compliance check

The UI adds a two-step confirm naming the person and the number. Every other
primary button in this product changes a database row; this one telephones
someone.

Viewer is denied at every layer — RLS, the API, and the UI. A read-only user
must not be able to make the product ring a member of the public.

## The retry cap is an anti-harassment control, not only a cost control

The cost chapter frames the cap as a cost cap. It is also the thing standing
between a runaway automation and someone's phone ringing twenty times.
`normalizeRetryPolicy()` therefore hard-caps attempts at 5 and enforces a
15-minute minimum delay regardless of what is configured.

`callback_requested` is **never** auto-retried: the candidate asked for a
different time, and re-dialling on our schedule ignores what they said. A
consent refusal maps to `cancelled`, which the retry policy treats as terminal —
nobody who declined gets called again.

## The webhook is the only unauthenticated endpoint in the product

- **HMAC-SHA256 over the raw request bytes**, compared in constant time. No
  secret configured means every webhook is rejected — failing closed, because an
  open endpoint that writes transcripts would let anyone forge a candidate's
  answers.
- **Tenancy comes from our own record.** The call is looked up by the id we
  generated and `organization_id` is read from that row. A forged
  `organization_id` in the payload is ignored entirely.
- It can only advance one known call. It cannot create rows.

Verified live: unsigned → 401, forged → 401, valid signature with a tampered
body → 401.

## Credentials

- AES-GCM at rest via `lib/integrations/crypto.ts`. Fails closed: without
  `INTEGRATION_ENCRYPTION_KEY` the adapter refuses to connect rather than
  storing a key in the clear.
- **Column-level `REVOKE`** on `encrypted_credentials` — RLS is row-level and
  cannot express "this column is invisible", so the grant does it. Even an
  Owner's browser session cannot read the ciphertext.
- Reading it therefore needs `lib/supabase/admin.ts` (service role), which
  **bypasses RLS**. Every query made with it filters `organization_id`
  explicitly — that filter *is* the tenant boundary there. Read the header
  comment in that file before using it for anything else.
- Only masked metadata (`••••••4F8A`) is ever returned to the browser.

## Retrofit obligations (from the spec)

- ☑ **DONE (Module 13)** — its `start_screening_call` action calls
  `startScreeningCall()` in `lib/screening/queries.ts`, which is the only caller
  of `placeCall()`. Going through the orchestration rather than the adapter
  directly was deliberate: it inherits the retry cap, the consent disclosure, the
  "candidate asked for a callback" refusal and the not-connected gate. An
  automation must not have a weaker safety path than the manual button. No Bolna
  request is re-implemented anywhere in Module 13.
- ☐ **Module 17** — must **extend** `organization_integrations` (masked display,
  Test Connection UI, `last_tested_at`/`last_success_at`, error codes) rather
  than create a second table, and must not change `placeCall()`'s external
  interface. `connect`/`test`/`getStatus`/`disconnect` are already implemented
  and ready to be surfaced.
- ☐ **Module 9** — summarisation must check `consent_confirmed` before treating
  a transcript as usable.
- ☐ **Module 2 dashboard** — `screening_calls` now exists, so the "Screenings
  completed" and "Failed screening calls" tiles have real tables behind them.
  Note the retrofit doc's open item: those two tiles currently use different
  timestamp columns (`ended_at` vs `created_at`).

## Other follow-ups

- ☐ **Quiet hours.** Nothing currently stops a call at 3am. Not in the spec, but
  a real courtesy and in some places a legal requirement. Worth adding with
  Module 17's settings.
- ☐ **No connection UI yet.** `connect()` works but nothing calls it — that is
  Module 17's Settings page. Until then Bolna can only be connected by writing
  the row directly.
- ☐ **Inbound callbacks at scale** and **multi-language mid-call switching** are
  Build Later per the spec.
- ☐ **Module 14** — one `TODO(Module 14)` in the call route, plus the webhook
  outcome.
- ☐ **Cost ledger** — the cost chapter wants a `call_usage_events` row per
  attempt. That is the cross-cutting retrofit, not built here.
