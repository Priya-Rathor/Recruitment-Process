# Pipeline stages, evaluation, and per-job stage lists

Covers the redefinition of the eight pipeline stages, the Evaluation panel on
the application detail page, and the rule that makes both conditional on the
job's `job_hiring_stages` configuration.

## Migrations

| File | What it does |
|---|---|
| `0021_pipeline_stage_redefinition.sql` | Rebuilds the `application_stage` enum, migrates data, adds `rejected_at_stage`, rebuilds the analytics views |
| `0022_application_evaluations.sql` | `application_evaluations` table, `evaluation_outcome` enum, adds `screening_reports.score` |

**Both are required.** The Applications list selects `rejected_at_stage`, so
until 0021 runs the list fails with `42703 — column ... does not exist`.

## The new stages

```
Applied → Shortlisted → AI Screening Call → Phone Interview
        → Video Interview → Written Assessment → Director Round → Hired
```

Plus `rejected` and `withdrawn` — terminal exits reachable from **any** stage,
rendered as a separate lane on the pipeline board rather than mixed into the
left-to-right flow.

### Naming standardisation

The two briefs disagreed on two labels. Resolved in favour of the **Job Hiring
Stages** wording, which also meant zero changes to that feature's UI:

| Applications brief said | Job Hiring Stages said | Standardised on |
|---|---|---|
| "Video/Zoom Interview" | "Video Interview" | **Video Interview** |
| "Assessment" | "Written Assessment" | **Written Assessment** |

"Zoom" is one vendor of several and would be wrong for a team on Meet or Teams.
"Written Assessment" is the more precise of the two, and is what the job
configuration screen already said.

**The stage keys are identical to `job_hiring_stages.stage_key`** —
`ai_screening_call`, `phone_interview`, `video_interview`, `written_assessment`.
A translation table between "assessment" and "written_assessment" would have
broken the first time someone added a stage to one list and not the other. With
identical keys, "is this stage enabled for this job?" is a lookup.
`lib/applications/stages.test.ts` asserts the two lists are equal.

### The data migration mapping

| Old | New | Why |
|---|---|---|
| `new` | `applied` | Same thing, renamed |
| `screening` | `ai_screening_call` | Screening is now explicitly the call |
| `recruiter_review` | `shortlisted` | The internal sift **is** shortlisting |
| `shortlisted` | `shortlisted` | Unchanged |
| `client_review` | `director_round` | The final human review before a hire |
| `interview` | `phone_interview` | The **earliest** interview stage |
| `offer` | `director_round` | No Offer stage now; the last round before hire |
| `hired` / `rejected` / `withdrawn` | unchanged | |

**Ambiguous cases resolve backwards on purpose.** A generic "Interview" could
have been a phone or a video round, and "Offer" sits past every round in the new
list. Mapping either forwards would claim progress that did not happen; a
recruiter moving someone forward again is one click, whereas discovering the
pipeline overstated ten candidates is a lost afternoon.

Applied to four columns: `applications.stage`,
`application_stage_history.stage`, `pipeline_sla_config.stage`,
`organization_settings.default_application_stage`. Two old stages collapse onto
`director_round`, which collides with `pipeline_sla_config`'s
`unique (organization_id, stage)` — the `offer` row is deleted before the
conversion, or the type change fails on a duplicate key.

**A full type swap, not `ALTER TYPE … ADD VALUE`.** Postgres cannot remove an
enum value, so adding would leave `new`, `recruiter_review`, `client_review`,
`interview` and `offer` in the type forever — selectable in any tool that reads
the enum and silently valid in a direct PostgREST write.

### `rejected_at_stage`

"Rejected" alone destroys the most useful fact about a rejection: a candidate
turned down after a director round and one turned down on their CV are not the
same outcome. A `before update` trigger stamps it from `OLD.stage`, and clears
it if the application is moved back out of rejected. Backfilled from the stage
history for rejections that pre-date the column.

In a trigger rather than the API for Module 5's original reason: the browser
holds a PostgREST client and can update `stage` directly.

## Per-job stage lists

`lib/applications/effectiveStages.ts` — pure, and the single source the stepper,
the Evaluation panel and the move dropdown all read. Two rules:

1. A configurable stage that is **off** does not appear. Not greyed, not
   skipped-with-a-gap — absent, so the stepper compresses. A job with only AI
   Screening Call on renders five segments, not eight with three holes.
2. **Unless the application already has entries logged in it.** Switching
   Written Assessment off after ten candidates sat one must not erase those ten
   records. The stage stays visible and **read-only**: history shown, new
   entries refused.

A third rule falls out of the first two: a stage **holding** the application is
always visible, even if the job later switched it off. Otherwise the stepper
would have no current segment, which reads as a broken page rather than a
configuration change — and the application genuinely is there.

`movableStages()` is narrower than `visibleStages()`: a stage visible only for
its history is **not** a move target, because sending someone new into a retired
stage is creating fresh work there.

## The Evaluation panel: what comes from where

| Section | Source | New entries? |
|---|---|---|
| Resume & Match | Module 7 match score + Module 6 parsed fields | read-only |
| **AI Screening Call** | `screening_calls` + `screening_reports` | no — Module 8 places calls |
| **Phone Interview** | `interviews` `mode='phone'` + `interview_feedback` **and** `application_evaluations` | yes (manual) |
| **Video Interview** | `interviews` `mode='video'` + `interview_feedback` **and** `application_evaluations` | yes (manual) |
| **Written Assessment** | `application_evaluations` only | yes |
| **Director Round** | `application_evaluations` only | yes |

Three sections already had a home, so nothing is copied — a second log would be
invisible to Module 9's report screen and Module 11's scheduler, and a call
recorded in one place would be missing from the other. `application_evaluations`
exists only for what genuinely has nowhere to live, and its `stage_key` check
**excludes** `ai_screening_call` so a hand-written row cannot sit beside a real
report claiming equal authority.

Scores are normalised to **1-10** for display: `interview_feedback` stores 1-5,
`application_evaluations` stores 1-10, and `screening_reports` had no score at
all until 0022 added one. One column of badges has to mean one thing.

Module 6 never produced a prose summary, so `lib/resumes/keyPoints.ts` composes
one from the structured fields it did extract — not another AI call, since every
fact is already validated output.

Logging an entry **never** moves the application. The two are separate actions;
coupling them would mean writing up a failed interview accidentally promoting
the candidate.

## One stage, one place on the page

The detail page used to say the same thing in two places. The sidebar carried
`Calculate match`, `AI screening call` and `Screening report` buttons, a full
interview list, the applied date and days-in-current-stage — all of which the
Evaluation panel and the stepper already showed. Worse, the sidebar copies were
**unconditional**: a job that never places a screening call still offered the
call console and the report screen.

Every stage now appears exactly once, in its own Evaluation section:

| Was in the sidebar | Now |
|---|---|
| Calculate match / See match breakdown | inside **Resume & Match** |
| AI screening call, Screening report | inside **AI Screening Call**, and only when the job runs it |
| Interviews list | inside **Phone Interview** / **Video Interview** |
| Applied date | the **Applied** section's timing line |
| Days in current stage | the current section's "N days so far" |

What stays in the sidebar is what is *not* a stage: the Interview brief (it
spans whichever rounds the job runs), Submit to client (Module 12), the
recruiter/source details, total age, and the move control. The Interviews card
still exists, but only for rounds no stage section shows — an onsite interview,
or a phone round on a job that has since switched that stage off. Nothing
disappears; a stage holding entries stays visible by the `has_history` rule.

## Every section states its own timing

`lib/applications/stageTimings.ts` folds `application_stage_history` into one
record per stage — first entered, last exited, whole days, visit count, and
whether the stage is open. The Timeline card renders the same history
chronologically; this renders it per stage, which is the shape the question
"when did this reach Video Interview and how long did it sit?" actually has.

Days are **summed across every visit**, not taken from the latest. An
application moved back for a re-review has two rows for one stage, and the last
visit alone understates a stall. An open visit is measured to `now` and labelled
"so far", so a running total cannot be mistaken for a finished one — the same
reading `daysInCurrentStage()` already took for the header.

Applied, Shortlisted and Hired now get sections too. They carry no score —
nothing is assessed at them — so the timing line is the whole record, and no
"Nothing logged yet" is printed underneath, which would imply someone forgot to
write something up. This also means every stepper segment has a section to jump
to; previously three of them fell back to the top card.

## Job stage changes reach every application immediately

There is no per-application copy of the job's stage configuration to keep in
sync. `listJobStages()` is read on each request (the detail page is
`force-dynamic`, nothing is cached), and `effectiveStages()` derives the list
from those rows plus the application's own state. Switching a stage on or off
for a job therefore changes the stepper, the Evaluation panel and the move
dropdown for **all** of that job's applications on their next render, with two
deliberate exceptions that protect data rather than defeat the rule: an
application currently *in* a switched-off stage keeps it visible, and a stage
holding logged entries stays visible read-only.

## Applications list

- **Job filter** and **candidate search** (name/email) added; the "filter from
  that record's own page" helper text removed.
- **Default sort is stage order**, with a toggle to Last updated. Sorted in
  memory from `stageSortKey`, not in SQL: Postgres orders an enum by declaration
  order, which happens to match the board today, but the next stage inserted in
  the middle would silently reorder every list.
- The **Stage filter narrows when a Job filter is applied** — it fetches that
  job's hiring stages and offers only those, plus the terminal exits. Choosing a
  job that does not run the currently-filtered stage clears the stage rather
  than leaving a combination that can only return zero rows.

## Permissions

Owner/Admin/Recruiter add and edit entries and move stages. Viewer sees the
stepper, every entry, and the read-only notice, and cannot write. Enforced in
the routes and again by RLS. The `POST` route re-checks `acceptsEntries()`
server-side, so a stage hidden in the UI also refuses a direct API call.

## Known gaps

- **Not verified in a browser end to end.** The new-application form, pipeline
  board and analytics page were checked and show the new eight stages with no
  old names. The **list and detail pages could not be**: they need migration
  0021, which is unapplied — the list currently fails with
  `42703 rejected_at_stage does not exist`. The stepper's rendering at each of
  the eight stages, at a rejection, and under every stage-flag combination is
  covered by 30 unit tests instead.
- **`withdrawn` was kept.** The brief named only Rejected as the extra terminal,
  but `withdrawn` already existed in the schema and in application data;
  removing it would have orphaned rows for no stated benefit.
- **Panel interviews show one feedback row.** `interview_feedback` allows
  several per interview; the panel shows the first and links out for the rest.
- **`application_evaluations` has no delete route.** Entries can be corrected
  but not removed — deliberate for an audit trail, but it means a typo'd entry
  stays visible in edited form.
- **The pipeline board's exit lane** already existed from Module 10 and now
  carries the new terminal semantics unchanged; `rejected_at_stage` is stored
  and exposed in the funnel view but is not yet shown on the board.
