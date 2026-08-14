# Module 11 (Interviews) — implementation notes and follow-ups

## AI prepares, it does not evaluate

The spec: "The human interviewer still conducts the interview and enters the
actual feedback — AI prepares, it does not evaluate the candidate."

Enforced three ways, not just asked for:

1. **The output schema has no verdict field.** There is nowhere for a score,
   rating, or recommendation to go.
2. **`findVerdictLanguage()` rejects hire/no-hire phrasing** anywhere in the
   brief, so a verdict cannot be smuggled into prose. A brief that says "strong
   hire" has decided the outcome before the interview happened — the interviewer
   would then interview to confirm it rather than to find out.
3. **Figures are checked against the facts supplied**, so the brief cannot
   contradict the application summary built from the same data (the spec's
   test).

The prompt additionally forbids commenting on personality, accent, age, gender
or any protected characteristic — a document that shapes a hiring decision and
could be disclosed in a dispute has no business containing that.

## Calendar failure never blocks scheduling

The spec's test: "Calendar integration failure does not block internal interview
scheduling."

`scheduleInterview()` writes the interview row **first** and attempts the
calendar **second**. A calendar problem downgrades to a message returned
alongside a successful response; the interview is scheduled either way.

`not_connected` is deliberately **not** an error and is recorded as
`not_attempted`, not `failed`. Until Module 17 ships OAuth it is the normal
state, and the UI shows a neutral "no calendar invite" tag rather than something
that looks broken.

> **RETROFIT (Module 17):** swap the stub `createEvent()` for real Google OAuth
> **without changing this module's calling code** — the signatures in
> `lib/integrations/calendar/index.ts` are the contract. It must also keep
> returning `not_connected` when OAuth is later revoked, so scheduling keeps
> degrading gracefully.

## Missing-feedback reminders

FORWARD STUB per the spec: Module 15 (Notifications) doesn't exist, so nothing is
sent anywhere. `overdueFeedback()` **computes** the queue on read and
`/interviews` displays it.

The rule is "fires at the configured delay **only when feedback is missing**", so
it returns not-due with a distinct reason for every other case — chasing someone
for feedback on a cancelled interview would be worse than not chasing at all.

The default delay is 24 hours, deliberately short: recollection decays fast, and
feedback written three days later is measurably worse than feedback written the
same afternoon.

> **RETROFIT (Module 15):** connect this computation to the real send pipeline.

## Database-enforced consistency

- **Submitting feedback marks the interview completed**, via trigger. In the
  database so status and feedback can never disagree — an interview with
  feedback but still "scheduled" would sit in the missing-feedback queue forever.
- **`submitted_by` is pinned to the caller** by RLS, so an assessment cannot be
  attributed to someone else.
- **Only the author may revise their own feedback.**
- **No DELETE policy on interviews** — they are cancelled, not erased, and a
  cancellation (with its reason) is part of the record of how a candidate was
  treated.

## Retrofits completed for Module 2

- The `interviewsToday` tile now excludes cancelled interviews, which the
  retrofit checklist flagged specifically.
- `organization_id` is present on `interviews` despite the spec's Core Data
  Model line omitting it, so the dashboard's direct filter works as written —
  closing assumption #1 in that checklist for both Modules 8 and 11.
- Every dashboard quick link is now live.

## Follow-ups

- ☐ **Dashboard attention queue** — add interviews awaiting feedback. The
  computation exists and is tested; it just needs wiring into
  `getAttentionQueue()`.
- ☐ **Module 14** — three `TODO(Module 14)` markers: scheduling, feedback
  submission, and the brief generation.
- ☐ **Module 15** — real reminder delivery.
- ☐ **Module 17** — real calendar OAuth, and `FEEDBACK_DUE_HOURS` is a natural
  per-organization setting.
- ☐ **Panel interviews with aggregated multi-interviewer scoring** — Build Later
  per the spec. The schema already permits several people to file feedback on one
  interview (`unique (interview_id, submitted_by)`); what's missing is the
  aggregation and the UI for it.
- ☐ **Rescheduling doesn't update the calendar event.** `PATCH` changes
  `scheduled_at` but does not re-sync, because there is nothing to sync to yet.
  Module 17 must handle it.
- ☐ **Cost** — brief generation has no cache. Regenerating repeatedly costs a
  call each time.
