# Module 2 (Dashboard) — retrofit checklist

The Dashboard owns no tables. It was built before its data sources existed, so
every metric degrades to a `pending` state instead of throwing or reporting a
fake zero.

The spec requires this retrofit explicitly:

> Once Modules 5, 8, 11, and 13 all exist, revisit every Dashboard KPI query and
> confirm each one reads live data instead of a placeholder/zero value.

Work through this list as each module lands. Do not mark a row done until you
have seen a real non-zero number on `/dashboard` for it.

## KPI tiles

| Tile | Source table | Owning module | Query location | Done |
| --- | --- | --- | --- | --- |
| New candidates | `candidates.created_at` | 4 | `lib/dashboard/metrics.ts` | ☑ table exists; **verify against live data** |
| Screenings completed | `screening_calls.ended_at` + `status='completed'` | 8 | same | ☐ |
| Interviews today | `interviews.scheduled_at`, excl. cancelled | 11 | same | ☑ table exists; **verify against live data** |
| Overdue applications | `applications.updated_at` | 5 | same | ☑ table exists; **verify against live data** |
| Failed screening calls | `screening_calls.status in ('failed','no_answer')` | 8 | same | ☐ |
| Failed automations | `automation_runs.status='failed'` | 13 | same | ☐ |

## Assumptions each module must honour

These are the contracts the queries above were written against. If a module
ships a different shape, fix the query **and** this file.

1. **`organization_id` on every table.** ☑ Resolved: Modules 8 and 11 both
   ship `organization_id` on `screening_calls` and `interviews` despite the
   spec's Core Data Model lines omitting it, so the dashboard's direct filters
   work as written.
2. **`applications.assigned_recruiter_id`** references `public.users.id`, and is
   what recruiter scoping filters on. ☑ Module 5 ships exactly this.
3. **`applications.updated_at`** is touched on every meaningful change, since
   overdue detection depends on it. ☑ Module 5 ships it `NOT NULL` with a
   `touch_updated_at()` trigger.
4. **Status vocabularies**: `screening_calls.status` includes `completed`,
   `failed`, `no_answer`; `automation_runs.status` includes `failed`. Adjust the
   `.in(...)` / `.eq(...)` filters if the real enums differ.

## Attention queue

Currently built only from stalled `applications`. Each module below should add
its own item type in `getAttentionQueue()` (`lib/dashboard/metrics.ts`):

- ☐ **Module 9** — screening reports with `reviewed_at IS NULL` ("waiting for
  recruiter review", the spec's headline example)
- ☐ **Module 8** — failed/no-answer calls that have exhausted retries and need a
  human decision
- ☑ **DONE (Module 11)** — interviews awaiting feedback are computed by
  `overdueFeedback()` in `lib/interviews/feedback.ts` and surfaced on
  `/interviews`. Adding them to the dashboard's attention queue is a small
  follow-up; the computation already exists and is tested.
- ☐ **Module 12** — clients past `feedback_sla_days` without responding
- ☐ **Module 13** — failed automation runs
- ☑ **Module 5** — stalled applications now populate the queue for real
  (`applications` exists with `stage`, `updated_at`, `assigned_recruiter_id`).
  Verify against live data once a database is connected.
- ☑ **DONE (Module 10)** — the fixed `OVERDUE_DAYS = 3` threshold is replaced
  by the per-stage SLA from `pipeline_sla_config`, for both the overdue tile and
  the attention queue. "Overdue" now means the same thing on the dashboard as on
  the pipeline board, and terminal stages are never flagged. The constant
  survives only as a fallback for an unrecognised stage.

## Open defects from the Module 2 review

Found by an independent review after Module 2 was built. Two were fixed
(the repeated-midnight timezone bug and a `daysSince(null)` crash); these
remain open, roughly in priority order.

- ☑ **FIXED (Module 5)** — the attention queue no longer reports "Nothing is
  waiting" when the query actually failed. `attentionPending: boolean` became
  `attentionStatus: "ok" | "pending" | "error"`, and `AttentionQueue.tsx`
  renders `ErrorState` for the error case. The related
  `daysSince(null)` crash was fixed earlier, and `applications.updated_at` is
  now `NOT NULL` with a trigger maintaining it, so the null path cannot recur.
- ☑ **FIXED (Module 5)** — the numeric guard moved to the shared
  `lib/ai/numericGuard.ts`, closing the thousands-separator false positive,
  spelled-out numbers, and coincidental percentages. Tests cover all three.
  The one part NOT fixed is label binding (see the next item).
- ☐ **AI numeric guard: label binding still missing.** The guard checks that
  each number was supplied, not that it is attached to the right metric, so
  "You received 18 candidates and completed 42 screenings" still passes with
  both figures swapped. Fix: have the model return `cited: {label, value}[]`
  alongside the prose and validate each pair against `counts`.
  Original finding, for reference (`lib/ai/generateDailyBrief.ts`):
  - spelled-out numbers bypass it entirely — the spec's *own* example brief
    passes while inventing figures ("Five strong-match candidates…")
  - `"1,234"` splits into `[1, 234]` and is wrongly rejected, permanently
    breaking the brief for any organization with a 4-digit metric
  - `"42%"` passes whenever 42 is an allowed value
  - it checks value *membership*, not label *binding*, so "You received 18
    candidates and completed 42 screenings" passes with both numbers
    attributed to the wrong metric
  Fix: normalise thousands separators, treat number-words and `N%` as
  offenders, and have the model return `cited: {label, value}[]` so
  attribution can be validated.
- ☐ **Recruiter scoping is incomplete and the brief misattributes it.** Only
  `overdueApplications` and the attention queue filter by recruiter; the other
  four tiles are organization-wide. No row-level leak, but the brief receives
  `scope: "own"` alongside org-wide counts, so a recruiter reads "You have 8
  interviews today" about the team's 8 — directly beneath a header promising
  "showing only applications assigned to you". Fix: tag each metric with its
  true scope, label org-wide tiles, and send only matching-scope metrics to the
  brief.
- ☐ **`isMissingRelation` is too loose.** Column/function errors (`42703`,
  `PGRST204`, `PGRST202`, `42883`) are classified as "module not built", so a
  wrong column name after the retrofit would render a calm "Available with
  Module 5" *forever* — the worst place to hide a bug, because the state looks
  designed. Require `42P01`/`PGRST205`, or match the specific table name.
  Related and *not* fixable via error codes: a wrong RLS SELECT policy returns
  0 rows with no error, so a tile would confidently print "0". Verify that at
  retrofit with a service-role cross-check instead.
- ☐ **`failedCalls` uses `created_at` while `screeningsCompleted` uses
  `ended_at`** — same table, two definitions of "today". Use `ended_at` for
  both, and record the timestamp column in the tile table above.
- ☐ **Failed briefs are not negatively cached**, so every retry is a fresh paid
  provider call. Cache non-ok results under a short TTL.
- ☐ **`PATCH /api/organizations/:id` accepts any string as `timezone`**
  (Module 1 file, Module 2 victim). `resolveTimeZone()` then silently falls back
  to UTC, shifting every "today" count. Validate with `isValidTimeZone()` and
  return 400.
- ☑ **FIXED (Module 11)** — `interviewsToday` now excludes cancelled
  interviews.
- ☐ Nits: `app/dashboard/page.tsx` calls `requireMembershipOrRedirect()` twice
  per render; `DailyBrief.tsx` uses `key={item}` on focus strings; the overdue
  tile counts all rows while the queue caps at 20 with no "showing 20 of N" hint.

## Other follow-ups

- ☑ **Module 3/4/10/11**: every quick link in
  `app/dashboard/QuickLinks.tsx` is now live.
- ☐ **Module 4 shipped**: `candidates` now exists, so the "New candidates" tile
  should stop showing "Available with Module 4". Confirm it reports a real count
  once a database is connected — the schema matches
  (`organization_id`, `created_at`), but that has never been executed.
- ☐ **Module 14**: replace the `TODO(Module 14)` in
  `app/api/dashboard/ai-action/route.ts` with a real `logActivity()` call.
- ☐ **Cost-tracking retrofit**: the in-process brief cache in that same route is
  per-instance and does not survive a redeploy. Replace it with a shared store
  alongside `ai_usage_events`.
- ☐ **Recruiter scope toggle**: spec section 9 says recruiter scope is
  "configurable"; that config is Build Later and lives in Module 17 settings.
  `scopeForRole()` is currently fixed.
- ☐ Confirm the composite indexes `(organization_id, created_at)` exist on
  `candidates`, `screening_calls`, `interviews`, `applications` and
  `automation_runs`, and verify each tile query uses them with `EXPLAIN`.
