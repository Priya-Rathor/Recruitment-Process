# Module 12 (Clients) — implementation notes and follow-ups

## This module's AI output leaves the building

Every other AI feature in this product writes for an internal audience. A client
submission describes **a real person to a third party who will make a decision
about their career**, in our customer's name.

An invented "8 years of Kubernetes" is not a hallucination to shrug at — it is a
misrepresentation, and the candidate gets asked about it in an interview they
were set up to fail. So the grounding here is the strictest in the product:

- **`findUnsupportedSkills()`** rejects any technology named in the draft that is
  not on the candidate's record. This is the invention that would actually cause
  harm: it reads as a specific, verifiable claim.
- **Figures** must trace to a supplied value. `allowedSubmissionNumbers()`
  permits "5" and "5.4" for a recorded 5.4 years, and "19 LPA" for 1,900,000 —
  but **not** 6 or 8. Rounding someone's experience up is exactly the
  embellishment a recruiter would be embarrassed by.
- The prompt forbids editorialising ("excellent", "perfect fit") and any
  protected characteristic. Present what they have done; let the client judge.

Screening figures are taken from the **reviewed** report in preference to the
profile, since a human confirmed those against what the candidate actually said.

## Sending is a separate, explicit act

The spec's test: "Sending a submission requires an explicit recruiter action,
never automatic."

`POST /api/applications/:id/submission` **drafts** — it writes nothing and sends
nothing. `PUT` **sends**. Two endpoints, two buttons, and a confirmation naming
the candidate and the client, because a mis-sent submission is not undoable.

The draft lands in an **editable textarea**, and `PUT` records the text from the
request body — so what is stored is what the recruiter approved, not what the
model produced. `client_feedback_events.submission_text` keeps it verbatim: if a
client ever disputes what they were told about someone, the record must be what
was sent.

## Turnaround is computed from the two timestamps alone

A closed feedback event's turnaround does not depend on `now`, which is what
makes it reproducible and auditable — there is a test asserting the same event
measured months apart gives the same answer.

Averages cover **responded events only**. Mixing "took 2 days" with "hasn't
answered yet" is not an average of anything. Rates return `null` rather than 0 on
an empty sample, per the spec's insufficient-data rule: 0% and "no data" mean
very different things to an account manager. A median is reported alongside the
mean, since one client who took three months would otherwise distort it.

## The Module 3 retrofit, completed

Module 3 created `jobs.client_id` as a nullable UUID with **no** foreign key,
because clients did not exist. This migration adds it, and does so defensively so
it is safe on a database that already holds job rows:

1. NULL any `client_id` pointing at a client that does not exist.
2. NULL any `client_id` pointing at a client in a **different organization** — a
   foreign key alone would happily allow that, and it would be a cross-tenant
   leak.
3. Add the constraint, `ON DELETE SET NULL` so archiving a client never deletes
   the jobs done for them.
4. Add a trigger enforcing the tenant rule going forward.

Also completed in the UI, which Module 3 left as placeholders: the **client
picker** on the job form and the **client filter** on the jobs list (the spec
asks for "filters by client, recruiter, status"; only two of three worked until
now).

## Follow-ups

- ☐ **Module 15** — actually deliver the submission. Today `PUT` records it and
  starts the SLA clock; there is a `TODO(Module 15)` at the send site.
- ☐ **Recording a client's response.** `client_feedback_events.responded_at` and
  `outcome` exist and the turnaround maths reads them, but there is no UI to mark
  a response yet. Until there is, every submission shows as pending. This is the
  most visible gap in the module.
- ☐ **Dashboard attention queue** — clients past `feedback_sla_days` is listed in
  the retrofit checklist; `overdueFeedbackRequests()` already computes it.
- ☐ **Module 14** — four `TODO(Module 14)` markers across the client routes.
- ☐ **Module 16** — "Average Client Feedback Time" should read
  `computeClientStats()` rather than re-deriving it.
- ☐ **Client contact editing** — contacts are stored and displayed but there is
  no editor beyond the create form.
- ☐ **Recruiter "assigned" scoping.** The spec scopes Recruiter access to
  assigned clients; `account_manager_id` exists and is displayed, but the query
  layer does not yet filter on it. Owner/Admin behaviour is unaffected.
- ☐ **Cost** — submission drafting has no cache.
