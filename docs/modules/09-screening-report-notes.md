# Module 9 (AI Screening Report) — implementation notes and follow-ups

## The consent gate — Module 8's promise, kept

Module 8 tells the candidate the call is recorded *so a recruiter can review
it*. This module is where that promise is either honoured or broken, so the gate
is enforced twice:

- `checkReportEligibility()` checks consent **first**, before call status or
  transcript quality, and returns a message naming consent as the reason.
- A database trigger (`enforce_screening_report_preconditions`) refuses to insert
  a report against a call with `consent_confirmed = false` — so it holds for a
  direct PostgREST write and for any future automation.

A perfect transcript from a call with no recorded consent is **not usable**, and
the UI says so in the error colour rather than as a generic failure.

## Corrections are distinguishable from AI output — structurally

The spec's test is that "recruiter corrections persist and are distinguishable
from the original AI output". Rather than a convention, every field is stored
twice:

| Column | Meaning |
| --- | --- |
| `summary_text`, `interest_level`, … | current authoritative value |
| `ai_summary_text`, `ai_interest_level`, … | what the model said. **Immutable** |
| `corrected_fields` | which fields now differ from the AI original |

A trigger (`protect_ai_screening_original`) rejects any update touching the
`ai_*` columns. Without it, a correction could overwrite the model's output and
the audit question — *did AI get this wrong, or did a human change it?* — would
become unanswerable.

`corrected_fields` is recomputed against the **AI original**, not the previous
value, so reverting a field back to what AI said correctly un-flags it. There is
a test for exactly that.

## Uncertainty is a value, not an absence

`'unclear'` is a real enum member for interest level and location acceptance, and
`uncertain_fields` records what the model itself was unsure about. Validation
reconciles the two: a null CTC or an `unclear` interest level is automatically
added to `uncertain_fields`, so a field can never be quietly confident and vague
at once.

The UI marks those fields "check this" and tells the recruiter to start there.
The spec's requirement is that ambiguous answers are *flagged rather than guessed
confidently*, and guessing is the failure that matters — a recruiter acts on
this.

## The narrative cannot contradict its own fields

`findUngroundedFigures()` checks every number in the summary against the
transcript and the extracted fields. A summary saying "45 days" beside a field
saying 30 is rejected, not displayed.

It deliberately accepts legitimate renderings: `19 LPA` for `1900000`, `1 month`
for `30` days, thousands separators, and any figure actually spoken in the
transcript. Spelled-out numbers are common in speech transcripts, which is why
the extracted fields count as support alongside the raw text.

## Prompt constraint worth noting

The system prompt forbids commenting on "accent, tone, personality, or any
protected characteristic". A screening report is a document that influences
hiring decisions and could be disclosed in a dispute; a model volunteering that
someone "sounded nervous" or "had a strong accent" would be both useless and
discriminatory. Sentiment/tone analysis is Build Later per the spec — this keeps
it out until it is designed deliberately.

## Follow-ups

- ☐ **Module 5** — the application summary should cite the *reviewed* report.
- ☐ **Module 10** — pipeline prioritisation should prefer reviewed reports;
  `idx_screening_reports_pending_review` exists for the attention queue.
- ☐ **Module 2 dashboard** — "screening reports pending review" is listed in the
  retrofit doc as an attention-queue item and can now be built.
- ☐ **Module 11** — the interview brief should draw on the reviewed report
  rather than re-reading the transcript.
- ☐ **Module 14** — two `TODO(Module 14)` markers: report generation and the
  review action (including which fields were corrected).
- ☐ **Regeneration replaces corrections.** Regenerating from the transcript
  overwrites the current values, losing prior corrections. The warning says so,
  but a "keep my corrections" merge would be kinder.
- ☐ **Cost guard** — no cache on generation. Regenerating repeatedly costs a
  call each time; the cost-tracking retrofit should bound it.
