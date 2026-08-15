# Module 16 (Analytics & Reporting) — implementation notes

## `security_invoker = true` is the most important line in this module

A PostgreSQL view executes with the privileges of its **owner**, not its caller.
RLS on the underlying tables is therefore evaluated against the view owner —
`postgres` — which **bypasses RLS entirely**.

Without `security_invoker = true`, every `analytics_*` view would return **every
organization's data** to any authenticated user. The policies on `applications`,
`interviews`, `screening_calls` and the rest would still exist, still be
correct, and be completely irrelevant.

That is the worst failure available in this codebase, and it is easy to
introduce by accident because the view works perfectly in a single-tenant test —
and because analytics aggregate, so nobody sees a stray row and notices.

Every view sets it. **A future migration that recreates one of these views
without it reintroduces the leak.** The query layer additionally filters
`organization_id` on every call, so a mistake in one layer is not a leak.

## Zero denominators and small samples

The rule that shapes `metrics.ts`: a rate needs a denominator, and a denominator
of zero has no rate — not 0%, not 100%, none. And a rate over a sample of one is
arithmetically fine and editorially useless: **"100% hire rate" from a single
application will be quoted in a meeting.**

So every rate returns a `Rate` union that can say `no_data` or `insufficient`,
and the UI is obliged to handle it. Returning a bare number would make the
misleading case the easy one. `MIN_SAMPLE_FOR_RATE` is 3, not 1 — two data
points give 0%, 50% or 100%, all of which read as findings and none of which
are.

The same discipline runs through to the CSV: an unavailable rate exports as an
**empty cell**, never as 0. A 0% in a spreadsheet gets averaged, charted and
presented; an empty cell gets questioned.

## The trend trap the spec names

> "for time-to-hire, lower is better - do not assume all increases are positive"

Every dashboard that colours by the sign of the delta gets this wrong: a
time-to-hire that rose from 21 to 34 days rendered in reassuring green, and
nobody notices because green means good.

`direction` is therefore a **required field** on every comparison, with no
default — a default is exactly how a metric ends up silently treated as
higher-is-better. `METRIC_DIRECTIONS` declares one per metric, and there is a
test asserting the same delta gets opposite verdicts for opposite metrics.

Two smaller decisions inside it:

- **The arrow follows the number; the colour follows the verdict.** A falling
  time-to-hire is a green *down* arrow. Flipping the arrow to match the
  sentiment would misreport the underlying figure.
- **Volume is `neutral`.** Applications rising is not good or bad on its own —
  it depends entirely on capacity — so it renders in ink, not in a judgement
  colour.

## Medians, not means, decide the bottleneck

Time-in-stage flags a bottleneck on the **median**. One application stuck in
Client Review for six months makes that stage look like the bottleneck under a
mean even when everything else clears it in a day — and sends someone to chase a
problem that does not exist. A stage is also never flagged on a sample below
`MIN_SAMPLE_FOR_RATE`.

Stage durations come from **closed visits only**. An open visit's duration
depends on `now`, so the same report would give different answers on successive
loads and "average time in Client Review" would creep upward simply because
nobody reloaded.

## Counting decisions worth knowing

- **"AI screened" counts a call actually placed**, not arrival in the Screening
  stage. An application can sit in Screening with no call ever made, and
  reporting those as screenings would overstate the product's own contribution —
  the number most likely to be quoted back to a customer.
- **Funnel steps are ever-reached flags** from the immutable stage history, not
  current stage. A funnel built on current stage shows a hired candidate as
  never shortlisted. It also makes the funnel monotonic by construction: a later
  step cannot exceed an earlier one.
- **A consent refusal counts as answered but not completed.** The candidate did
  answer — they asked for a person.
- **Skips are excluded from automation success rate.** A rule whose conditions
  did not match has not failed to succeed; including skips makes a healthy
  narrow rule look broken.
- **Interview feedback rate is measured against completed interviews**, not
  scheduled ones. A cancelled interview has no feedback to give, and counting it
  makes a diligent team look negligent.
- **Time saved is an estimate**, labelled as one, with the assumption printed
  beside the number rather than buried in a doc. Only completed calls count — a
  no-answer saves nobody anything.

## Charts

No chart library. The spec asks for a funnel and two focused bar charts, and a
dependency would be more code than the charts.

The funnel uses an **ordinal ramp** — one hue, monotone lightness — which is the
correct encoding for ordered stages. The steps were **generated in OKLCH and
validated**, not eyeballed:

- The obvious ramp (`#C7D2FE…#4338CA`, straight off the Tailwind indigo scale)
  **fails** two checks: adjacent steps too close in lightness, and a lightest
  step at **1.49:1** against a white card — effectively invisible.
- The shipped ramp passes monotone lightness, adjacent ΔL ≥ 0.06, and 2.33:1 at
  the light end. `lib/analytics/charts.test.ts` asserts those properties, so an
  edit that breaks the ramp fails a test rather than only looking slightly off.

**The ramp direction was chosen after rendering it and looking.** Dark→light
looked conventional but compounded two weaknesses: bars get shorter down a
funnel, so the last steps were both smallest *and* palest — and those steps
(Offers, Hired) are the ones anyone cares about. Reversed, the large top bars
are a calm wash and the small outcome bars carry the most weight.

Other rules held: single-series bars are one colour (colouring bars
darker-where-bigger would double-encode the length); status colours appear only
where the value *means* a status and always beside a text label, never
colour-alone; **no dual axis anywhere** — volume and rate are two charts, because
one plot with two scales invents a correlation.

## Recruiters: two views, never a leaderboard

The spec: *"workload and outcomes as separate views, never a single ranked
leaderboard."* The view emits no composite score and no rank — anything that
ordered people by a single number would be used as one. Workload and outcomes
are separate charts with a line saying why: someone carrying twice the pipeline
is not underperforming for having the same number of hires.

## Export matches the screen by construction

`buildReport()` produces one object; the page and the CSV both render it. The
spec's test holds because there is **one** implementation, not two that ought to
agree. The export link carries the page's own query string.

The CSV also guards **formula injection**: a cell beginning `=`, `+`, `-` or `@`
is executed when the file opens in Excel or Sheets, and candidate names and job
titles are user-supplied — an exported report is a plausible delivery route.

Failed and truncated sections are carried into the file as `WARNING` rows. A
partial export that looks complete, opened later by someone who wasn't there when
the screen said otherwise, is the failure worth preventing.

## A bug in Module 13, found while writing the views

Checking column names against the real schema exposed that
`lib/automations/engine.ts` selected `screening_reports.reviewed_interest_level`
— **a column that has never existed**. Module 9 writes a human's correction over
`interest_level` and preserves the model's original in `ai_interest_level`.

The whole select failed, so `interest_level` was permanently `null` in the
automation context, and every rule with an interest-level condition silently
never matched. Fixed here.

## Two spec items deliberately not built

- **`POST`/`PATCH`/`DELETE /api/analytics-reporting`.** This module owns no
  writable entity. It reads six views over other modules' tables; an endpoint
  writing to an analytics view would either fail (views over aggregates are not
  updatable) or corrupt the operational data the views summarise.
- **Materialized views.** The spec defers them itself ("introduced later for
  expensive calculations"). Plain views with supporting indexes are correct at
  this scale and cannot go stale.

## Follow-ups

- ☐ **Row cap, not pagination.** `ROW_CAP` is 10,000 and the UI says when it
  bit, but a very large organization gets a lower bound rather than an exact
  count on the widest ranges. Real aggregation belongs in SQL
  (`count(*) filter (...)`) or a materialized view.
- ☐ **`security_invoker` is unverified against a live database.** Reasoned and
  documented, never executed — like every migration in this repo.
- ☐ **12-month trends and month-over-month placement growth** are not charted.
  The `12m` range works, but there is no time-series visual — a monthly line
  chart is the obvious next addition and needs a different query grain.
- ☐ **Job health on the analytics tab** re-derives "no screening questions"
  inline rather than calling `evaluateJobHealth()` from `lib/jobs/health.ts`.
  Two rule sets that can drift; they should be one.
- ☐ **Offer acceptance rate** is approximated by offer→hire. A declined offer is
  not distinguishable from one still open, because no module records a decline.
- ☐ **No-show rate** depends on an interview status (`no_show`) that Module 11
  never actually sets.
- ☐ **The filter dropdowns cap at 100 options** with a note; a searchable picker
  is the fix.
- ☐ **Recruiter figures ignore the date filter** — the view aggregates all time.
  Reading it through the funnel rows instead would make it period-aware.
