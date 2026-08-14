# Module 5 (Applications) — implementation notes and follow-ups

This is the central table. Modules 6–16 all read or write it, and the spec says
to treat the schema as **effectively frozen** once they do: add columns, never
rename or remove.

## Design decisions worth knowing

**Stage history is written by a database trigger, not the API.** The spec's test
is "stage history correctly records entered_at/exited_at for every transition",
and the browser holds an authenticated PostgREST client — so a stage update
issued directly would bypass any route handler and silently lose a transition.
Module 10's board and Module 16's time-in-stage analytics both depend on the
history being complete, so `record_application_stage_change()` owns it.
`application_stage_history` has **no client INSERT/UPDATE/DELETE policy at all**:
an audit trail that application code is trusted to maintain is not an audit
trail.

A partial unique index enforces **at most one open (unexited) row per
application** — the invariant every time-in-stage calculation assumes.

**Cross-tenant references are checked explicitly.** Foreign keys do *not* stop an
application in org A pointing at a candidate or job in org B: the FK only checks
the row exists. RLS stops the caller *reading* the other org's rows, but an
insert quoting a known id would still succeed. `enforce_application_tenant_integrity()`
verifies both parents share the application's `organization_id`.

**`unique (candidate_id, job_id)`.** Without it a double submission creates two
pipelines for one person and Module 16's funnel counts them twice.

**Two stages beyond the spec.** Module 10's board lists eight stages ending at
Hired. `rejected` and `withdrawn` were added as terminal exits — without a
negative terminal state, every unsuccessful application sits in an intermediate
stage forever, permanently flagged by Module 2's overdue queue and permanently
inflating Module 16's in-progress counts. **Module 10 must render these as exits
from the board, not as columns.**

**Transitions are permissive about direction, strict about resurrection.**
Recruiters legitimately move applications backwards (a client asks for a
re-review) and skip stages (a referral goes straight to interview), so neither is
blocked. What *is* blocked is reopening a `hired`/`rejected`/`withdrawn`
application — that would corrupt the funnel. A re-application is a new row, which
is also the honest data model.

**Notes are attributable.** RLS requires `author_id = current_app_user_id()` on
insert, and only the author may edit or delete — an Admin rewriting someone
else's note would corrupt the record Module 14 audits.

**The AI summary cannot contradict the fields beside it.** Facts are gathered
server-side from the application's own record (nothing from the request body), and
every number in the output is checked against those facts by the shared
`lib/ai/numericGuard.ts`.

## Fixed in this module (carried over from the Module 2 review)

- The dashboard attention queue no longer says "Nothing is waiting" when the
  query failed — `attentionStatus` is now `"ok" | "pending" | "error"`.
- The AI numeric guard moved to `lib/ai/numericGuard.ts`, closing the
  thousands-separator false positive, spelled-out numbers, and coincidental
  percentages. Both the daily brief and the application summary use it.

## Follow-ups

- ☐ **Module 6 (Resume AI)** — parsed resume data attaches to the candidate, but
  the review screen is reached from an application in practice.
- ☐ **Module 7 (Matching)** — writes `applications.match_score`. The column,
  its 0-100 CHECK, and the PATCH path already exist.
- ☐ **Module 8/9** — screening calls and reports hang off `application_id`.
- ☐ **Module 10 (Pipeline)** — the Kanban board reads `applications.stage` and
  `application_stage_history`. Must render `rejected`/`withdrawn` as exits.
  Also replaces the fixed overdue threshold with `pipeline_sla_config`.
- ☐ **Module 14 (Activity & Audit)** — one `TODO(Module 14)` in
  `app/api/applications/[id]/ai-action/route.ts`; stage changes and note
  creation are both "meaningful actions" the retrofit must log.
- ☐ **Pagination on the list page** — the API paginates; the page renders the
  first 50 and says "Showing 50 of N". Revisit before the 10,000-row target.
- ☐ **Note editing/deleting UI** — the RLS policies exist, there is no UI.
- ☐ **Cost guard** — the summary endpoint has no cache. The cost-tracking
  retrofit should add one keyed on the application and its updated_at.
