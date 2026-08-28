# Module 2 (dashboard) — manual test guide

Every check below is something you can do by hand against a real Supabase
project. Each one names **what to do**, **what you should see**, and — where the
UI alone could mislead you — **the SQL that proves it**.

Module 1's guide is `docs/modules/01-testing-guide.md`. Do that one first: this
module reads the tenant and role it resolves, and a broken tenant boundary makes
every number here meaningless.

## The one idea that makes this testable

**The dashboard owns no tables.** It is a read-only aggregation layer over
Modules 4, 5, 8, 11 and 13. So there is nothing to seed here — you create data
in the other modules and then check that the dashboard counts it correctly.

That shapes the whole guide:

- **Every tile is a claim about a SQL count.** Never accept a tile because it
  "looks about right". Each check below pairs the tile with the query it must
  equal.
- **The three states matter more than the numbers.** Each metric resolves to
  `ok` (a real count), `pending` (the source table doesn't exist yet) or
  `error` (the query failed). A tile that prints `0` when the query actually
  broke is how a dashboard lies to a manager — that distinction is the single
  most important thing under test here.
- **"Today" is the organization's today.** Not the server's, not your browser's.
  Phase 3 is entirely about this and it is where the real bugs live.

### What is already covered by unit tests

`lib/dashboard/metrics.test.ts` has 27 tests over the pure logic:
`isMissingRelation`, `scopeForRole`, `buildAttentionItems` (thresholds,
sorting, severity escalation, per-stage SLA, terminal stages),
`buildOverdueClause` and `availableMetrics`. Run `npm test` rather than re-checking that logic by hand.

Test here only what unit tests cannot reach: live queries, the org timezone
against real timestamps, role scoping end to end, and the AI brief.

---

## Phase 0 — Setup

### 0.1 Prerequisites

- Module 1 works (its guide, Phase 1 at minimum) — you need an org and an Owner.
- All migrations applied. Every source table exists in the current schema, so
  in a healthy setup **no tile should read "Available with Module N"**. If one
  does, a migration is missing — that is a finding, not the expected state.
- The dev server is running.

### 0.2 Note your organization id and timezone

```sql
select id, name, timezone from public.organizations;
```

Keep the id — nearly every query below filters on it. Every count you run must
carry `organization_id = 'ORG_ID'`, because you will be running these as a
service-role query that bypasses RLS.

### 0.3 Set a timezone you can reason about

Settings → Organization → set the timezone to **Asia/Kolkata** (UTC+05:30).
The half-hour offset is deliberate: it catches "today" bugs that a whole-hour
zone like UTC+01:00 hides.

---

## Phase 1 — Access and role scope

### 1.1 The dashboard is the landing page

Log in as the Owner.

**Expect:** you land on `/dashboard`. The header shows your **organization
name**.

### 1.2 A signed-out user cannot reach it

Log out, then type `/dashboard` directly.

**Expect:** redirected to `/login`. `app/dashboard/page.tsx` uses
`requireMembershipOrRedirect()`, which redirects rather than throwing.

### 1.3 Owner, Admin and Viewer see the organization

Using the teammate from Module 1's Phase 2, set them to **Admin**, then
**Viewer**, checking `/dashboard` each time.

**Expect:** both see the organization name in the header and organization-wide
figures. A Viewer sees the same numbers as an Owner — read-only means no
mutations, not fewer rows.

### 1.4 A Recruiter is scoped to their own workload

Set the teammate to **Recruiter** and reload `/dashboard`.

**Expect:** the header reads **"Your workload"** followed by "· showing only
applications assigned to you".

`scopeForRole()` returns `own` for a Recruiter and `organization` for everyone
else.

> **Read Phase 6.2 before you trust this.** The scoping is real but partial —
> only two of the six tiles actually honour it. That is a known open defect, not
> something for you to discover and file.

---

## Phase 2 — The KPI tiles

Six tiles, in two rows: work happening (new candidates, screenings completed,
interviews today) and work going wrong (overdue applications, failed calls,
failed automations).

For each one: create the data, reload `/dashboard`, and match the tile against
the query.

### 2.1 New candidates

Add a candidate through Module 4's UI.

```sql
select count(*) from public.candidates
where organization_id = 'ORG_ID'
  and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata')
                     at time zone 'Asia/Kolkata')
  and created_at <  (date_trunc('day', now() at time zone 'Asia/Kolkata')
                     + interval '1 day') at time zone 'Asia/Kolkata';
```

**Expect:** tile equals the count.

**Note:** this tile is deliberately *not* recruiter-scoped. Candidates are
organization-wide property, not one recruiter's.

### 2.2 Screenings completed

Needs a `screening_calls` row with `status = 'completed'` and an `ended_at`
inside today's window. Use Module 8, or insert one by hand on a dev project.

```sql
select count(*) from public.screening_calls
where organization_id = 'ORG_ID' and status = 'completed'
  and ended_at >= ... and ended_at < ...;   -- same window as 2.1
```

**Expect:** tile equals the count. This tile keys on **`ended_at`**, not
`created_at` — a call started yesterday and finished today counts today.

### 2.3 Interviews today

Schedule an interview for today in Module 11, then **cancel** it.

**Expect:** the tile counts it while scheduled and **stops counting it once
cancelled**. Counting a cancelled interview would overstate the day's workload.

```sql
select count(*) from public.interviews
where organization_id = 'ORG_ID' and status <> 'cancelled'
  and scheduled_at >= ... and scheduled_at < ...;
```

### 2.4 Overdue applications

This tile does **not** use a fixed threshold. It uses the per-stage SLA from
`pipeline_sla_config` (Module 10), so "overdue" means the same thing here as on
the pipeline board.

```sql
select stage, target_days from public.pipeline_sla_config
where organization_id = 'ORG_ID' order by stage;
```

Create two applications in **different** stages with different targets, and age
both by the same amount:

```sql
update public.applications set updated_at = now() - interval '4 days'
where id in ('APP_A', 'APP_B');
```

**Expect:** the one whose stage has a target below 4 days is counted; the other
is not. Same age, different verdict — that is the per-stage SLA working.

Then check the three exclusions:

- **Terminal stages** are never overdue. Move an aged application to `hired`
  → the count drops, and it must not appear in the attention queue either.

  Check this one carefully. Until it was fixed (see `02-dashboard-retrofit.md`)
  the tile counted `hired` while the queue ignored it, so the two disagreed —
  a number with nothing behind it. `rejected` and `withdrawn` were never
  affected. `lib/dashboard/metrics.test.ts` now asserts the tile and the queue
  agree on every stage, so a regression fails `npm test` before it reaches a
  browser.
- **Archived applications** are excluded (`archived_at is null`).
- An **unrecognised stage** falls back to `OVERDUE_DAYS = 3` rather than being
  dropped.

### 2.5 Failed screening calls

```sql
select count(*) from public.screening_calls
where organization_id = 'ORG_ID' and status in ('failed', 'no_answer')
  and created_at >= ... and created_at < ...;
```

**Expect:** tile equals the count.

> **Known inconsistency:** this tile keys on `created_at` while 2.2 keys on
> `ended_at` — the same table with two definitions of "today". A call created
> just before local midnight and failing just after is counted on the wrong day.
> Open defect, listed in `02-dashboard-retrofit.md`. Don't re-file it.

### 2.6 Failed automations

```sql
select count(*) from public.automation_runs
where organization_id = 'ORG_ID' and status = 'failed'
  and started_at >= ... and started_at < ...;
```

**Expect:** tile equals the count. This was the spec's forward-dependency stub —
Module 13 exists now, so it must show a real number, never "Available with
Module 13".

### 2.7 A genuine zero reads as zero

Pick a metric with no data today.

**Expect:** the tile shows **`0`**, not a dash and not "Available with
Module N". A real zero is a real, reportable figure and must be visually
distinct from "not built" and from "failed".

---

## Phase 3 — Timezone correctness

The spec's own checklist puts this first: *"Counts match underlying tables
exactly for the organization's timezone today."* This is the phase most likely
to find something.

The window is **half-open `[start, end)`** — `lib/time.ts`, `dayRangeInZone()`.

### 3.1 The boundary belongs to exactly one day

With the org on **Asia/Kolkata**, create three candidates at these UTC instants
(set `created_at` directly):

| `created_at` (UTC) | Kolkata local | Counts today? |
| --- | --- | --- |
| `18:29:59` yesterday | `23:59:59` yesterday | **No** |
| `18:30:00` yesterday | `00:00:00` today | **Yes** |
| `18:30:00` today | `00:00:00` tomorrow | **No** |

**Expect:** the tile counts exactly one — the middle row. Midnight belongs to
the day starting, never to the day ending, and never to both. Counting the last
row too is the classic repeated-midnight bug.

### 3.2 The browser's timezone is irrelevant

Change your **operating system** timezone to something far away (America/
Los_Angeles), leave the org on Asia/Kolkata, and hard-reload.

**Expect:** every number is unchanged. The counts are computed server-side from
the organization's configured zone. If the numbers move, something is reading
the browser clock.

### 3.3 Changing the org timezone moves the window

Settings → Organization → switch to `America/New_York`. Reload `/dashboard`.

**Expect:** counts shift to that zone's day boundary — rows near the old
boundary drop in or out.

### 3.4 An invalid timezone — known defect

```js
await fetch('/api/organizations/ORG_ID', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ timezone: 'Not/AZone' })
}).then(r => r.json()).then(console.log);
```

**What should happen:** `400`, rejected.

**What actually happens:** it is accepted. The route validates only that the
string is non-empty. `resolveTimeZone()` then silently falls back to UTC, so
every "today" count shifts by the real offset with nothing on screen to say so.

Open defect — `lib/time.ts` exports `isValidTimeZone()` and the PATCH handler
in `app/api/organizations/[id]/route.ts` does not call it. **Set the timezone
back to a valid value before continuing.**

---

## Phase 4 — Degraded states

A dashboard that cannot get a number must say so. Three outcomes, three
distinct renderings.

### 4.1 `ok` — a real count

Covered in Phase 2.

### 4.2 `pending` — the table does not exist

All source tables exist now, so you must remove one to see this. **Dev project
only, and rename it straight back.**

```sql
alter table public.automation_runs rename to automation_runs_tmp;
-- reload /dashboard, then IMMEDIATELY:
alter table public.automation_runs_tmp rename to automation_runs;
```

**Expect while renamed:** that tile shows an em dash and "Available with
Module 13", the other five are unaffected, and a footer reads "1 of 6 tiles are
waiting on modules that aren't built". Nothing throws, and no tile prints `0`.

### 4.3 `error` — the query genuinely failed

Break a query without removing the table:

```sql
revoke select on public.candidates from authenticated;
-- reload /dashboard, then IMMEDIATELY:
grant select on public.candidates to authenticated;
```

**Expect:** the New candidates tile renders in error colour with "Couldn't
load" — **not** `0`, and **not** "Available with Module 4". A permission error
misreported as "not built yet" would hide a real bug behind a state that looks
designed.

`isMissingRelation()` is what draws this line, and
`lib/dashboard/metrics.test.ts` asserts it does not swallow permission errors.

### 4.4 The silent case RLS creates

A wrong RLS SELECT policy returns **zero rows with no error**, so a tile prints
a confident `0` and nothing anywhere signals a problem. No error code can catch
this.

The only way to detect it: run the count twice — once as the signed-in user
through the app, once with the service-role key in the SQL Editor. A gap between
them is an RLS defect, not a dashboard defect.

Do this once per tile after any policy change. It is the check most likely to
catch a regression that every other test passes.

---

## Phase 5 — The attention queue

Sourced only from stalled `applications` today. Modules 8, 9, 11 and 12 each
still owe it an item type — see `02-dashboard-retrofit.md`.

### 5.1 Most urgent first

Create three applications overdue by different amounts.

**Expect:** sorted most-overdue first, regardless of insertion order.

### 5.2 Severity escalates at twice the threshold

**Expect:** an item past **twice** its stage's target renders as `error`
severity; between one and two times, `warning`. If everything is red, red stops
meaning anything.

### 5.3 Each item explains itself

**Expect:** the reason names the stage's target — not a bare "overdue". A
recruiter should not have to look up why a row is listed.

### 5.4 Empty is not the same as broken

With nothing overdue: **expect** an empty state.

Now force a failure (repeat 4.3's revoke against `applications`).

**Expect:** an **error state**, not "Nothing is waiting". Reporting a failed
query as "nothing to do" is a false statement to a manager — this was a real
defect, fixed in Module 5 by replacing a boolean with
`attentionStatus: "ok" | "pending" | "error"`.

### 5.5 The queue is capped at 20

Create more than 20 overdue applications.

**Expect:** 20 listed. Note the overdue **tile** counts all of them, so tile and
list disagree above 20 with no "showing 20 of N" hint. Known nit, already
listed in the retrofit file.

---

## Phase 6 — The AI daily brief

Opt-in: the panel renders with a **Generate** button and produces nothing until
you click it.

### 6.1 It explains the numbers, it does not invent them

Click **Generate**.

**Expect:** a short paragraph consistent with the tiles above it. Every figure
it states must be one the tiles actually show.

This is enforced in code, not by prompt wording: `availableMetrics()` sends only
resolved metrics, and `lib/ai/numericGuard.ts` rejects a brief containing a
number that was never supplied. Pending and errored metrics are omitted
entirely rather than sent as `0`.

### 6.2 Recruiter scope — known defect

As a **Recruiter**, generate the brief.

**What you will see:** the brief may describe organization-wide figures in the
second person — "You have 8 interviews today" about the team's 8 — directly
under a header promising "showing only applications assigned to you".

**Why:** only `overdueApplications` and the attention queue filter by recruiter.
The other four tiles are organization-wide, but the brief is told
`scope: "own"`. There is **no row-level leak** — a Recruiter sees only counts
any teammate could see — but the labelling is wrong. Open defect.

### 6.3 The guard's remaining hole

The guard validates that each number was *supplied*, not that it is attached to
the *right* metric. "You received 18 candidates and completed 42 screenings"
passes with both figures swapped.

**Expect this to be possible.** The fix — having the model return
`cited: {label, value}[]` for validation — is open work, not a test failure.

### 6.4 Repeated clicks are cached

Click **Regenerate** several times.

**Expect:** identical text within about three minutes, and no repeated provider
call — `CACHE_TTL_MS` is 3 minutes in
`app/api/dashboard/ai-action/route.ts`.

**Known gap:** the cache is in-process, so it does not survive a restart, and
**failures are not cached at all** — every retry after a failure is a fresh paid
call.

### 6.5 A failed brief never breaks the dashboard

Set `OPENAI_API_KEY=sk-invalid`, restart, click **Generate**.

**Expect:** an inline error saying the figures below are unaffected — and the
tiles and queue still render normally. Restore the key afterwards.

### 6.6 Tenant isolation of the brief

Run 4.4's service-role cross-check as Org B while Org A holds data.

**Expect:** Org B's brief and tiles describe only Org B. The brief is generated
from counts `getDashboardData()` produced under the caller's own tenant, so
there is no separate path to leak through — confirm it anyway.

---

## Known open defects — do not file these

All are recorded in `docs/modules/02-dashboard-retrofit.md`. They will fail if
you test for them. That is expected.

| # | Defect | Seen in |
| --- | --- | --- |
| 1 | Recruiter scoping covers only 2 of 6 tiles; the brief mislabels the rest as "yours" | 1.4, 6.2 |
| 2 | Numeric guard checks value membership, not label binding | 6.3 |
| 3 | `isMissingRelation` also matches column/function errors, so a wrong column name after a retrofit reads as "not built yet" forever | 4.3 |
| 4 | `failedCalls` uses `created_at` while `screeningsCompleted` uses `ended_at` | 2.5 |
| 5 | Failed briefs are not negatively cached — every retry is a fresh paid call | 6.4 |
| 6 | `PATCH /api/organizations/:id` accepts any string as `timezone`, silently falling back to UTC | 3.4 |
| 7 | Overdue tile counts all rows; the queue caps at 20 with no "showing 20 of N" | 5.5 |
| 8 | `app/dashboard/page.tsx` calls `requireMembershipOrRedirect()` twice per render | — |

Still owed to the attention queue: screening reports awaiting review (Module 9),
exhausted-retry calls (Module 8), interviews awaiting feedback (Module 11 —
`overdueFeedback()` already exists and is tested, it just isn't wired in), and
clients past `feedback_sla_days` (Module 12).

---

## What to re-run after any change

| You changed | Re-run |
| --- | --- |
| `lib/dashboard/metrics.ts` | `npm test`, then Phase 2 and Phase 4 |
| `lib/time.ts` or the org timezone | All of Phase 3 |
| Any RLS policy on a source table | 4.4 against every tile |
| A source table's schema or status vocabulary | The matching Phase 2 check, and update the table in `02-dashboard-retrofit.md` |
| `lib/ai/generateDailyBrief.ts` or `lib/ai/numericGuard.ts` | Phase 6 |
| `app/dashboard/*.tsx` | 4.2, 4.3, 5.4 — the degraded states are what break |

3.1 and 4.4 are the two that catch real regressions. 4.4 in particular is the
only check that catches a tile confidently printing `0` because a policy is
wrong — every other test in this file passes while that happens.
