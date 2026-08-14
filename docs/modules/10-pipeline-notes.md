# Module 10 (Advanced Pipeline) — implementation notes and follow-ups

## AI supervises, it does not act

The spec: "AI turns constant manual board-monitoring into a supervisor role; it
does not move cards or change stages on its own."

`prioritizePipeline()` returns a **ranked list of links**. It has no database
handle and no mutation path — acting on the list is the recruiter's click. The
panel says "Suggestions only — nothing has been moved" so nobody has to infer it.

## Scope is enforced by construction, not by checking

The spec's test: "AI attention summary and prioritization never suggest an
action outside the recruiter's permission scope."

Rather than validating suggestions against permissions afterwards, the model is
only ever **shown** work the caller can already see. `getBoard()` applies the
same recruiter scoping as the applications list, and the AI route feeds the model
from that output. Validation then discards any id that was not in the input.

So it cannot suggest work on an application the recruiter can't see, because it
was never told such an application exists — and it cannot invent an id either.

## The board is a work queue, not an archive

`rejected` and `withdrawn` render as **exit counts, not columns**. This is the
obligation Module 5 recorded when it added those stages: without it the board
fills with finished work and stops answering "what should I do next".

`hired` remains a column (reaching it is the goal) but is never aged — showing a
hired application as "12 days overdue" is noise that trains people to ignore the
indicator.

## Stage moves are buttons, not drag-and-drop

The spec permits either. A dropdown is keyboard-accessible, works on a phone, and
cannot fire from a mis-drag. Moving someone through a hiring pipeline should be
deliberate.

Nothing here writes stage history — Module 5's database trigger already does,
which is why a move made from this board, from the application page, or by a
direct API call all produce the same audit record.

## Retrofit completed for Module 2

The dashboard used a single fixed 3-day threshold for every stage. It now reads
`pipeline_sla_config`, so **"overdue" means the same thing on the dashboard as on
the board**. The attention queue's `detail` explains *why* ("2 days past the
2-day target for this stage") rather than quoting raw age, and terminal stages
are never flagged.

A test written for that retrofit caught a real bug: `rejected`/`withdrawn` are
not in `PIPELINE_STAGES` (which is the board), so they were falling through to
the fallback threshold and would have been flagged as overdue **forever**.

## SLA configuration

This module owns `pipeline_sla_config` and provides its editor, per the spec's
forward stub.

> **RETROFIT (Module 17):** when `/settings/pipeline` ships it must write to this
> same table via `PUT /api/pipeline/sla` — the spec is explicit: "do not create a
> second, duplicate SLA settings table."

Editing targets is Owner/Admin only, deliberately narrower than "move
applications between stages" which Recruiters may do: changing the yardstick
everyone is measured against is a different act from doing the work.

An absent config row means **use the default**, never "no SLA" — a board with no
aging at all would defeat the module.

## Known approximation

Time-in-stage is derived from `applications.updated_at`, not from
`application_stage_history`. Reading history per card would be an N+1 across the
whole board. In practice they agree, because the only thing that touches
`updated_at` on a board-visible application is a change to it — but an edit that
is not a stage move (reassigning a recruiter, say) resets the clock.

Module 16 computes time-in-stage properly from the history table for analytics.
If the board's aging needs to be exact, the fix is a windowed query over
`application_stage_history`, not a per-card lookup.

## Follow-ups

- ☐ **Module 17** — point `/settings/pipeline` at `pipeline_sla_config`.
- ☐ **Module 14** — one `TODO(Module 14)` in the AI route; stage moves are
  already logged via Module 5's trigger but need an activity event.
- ☐ **Bulk actions** — the spec lists them under Build Now. Not implemented:
  moving several applications at once needs a confirmation design that makes the
  blast radius obvious, and single moves cover the MVP flow.
- ☐ **Automatic stage transitions based on AI confidence** — explicitly Build
  Later, and deliberately not started.
- ☐ **Cost** — Ask Pipeline AI has a 3-minute cache keyed on caller and board
  state. It is in-process, so per-instance on serverless; the cost-tracking
  retrofit should replace it with a shared store.
