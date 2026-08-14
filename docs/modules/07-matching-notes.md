# Module 7 (AI Matching) — implementation notes and follow-ups

## The split the spec insists on

> "Obvious, checkable facts — salary, experience, location, notice period — are
> evaluated with normal deterministic code, not AI; AI is reserved specifically
> for semantic comparisons that code cannot reliably make."

Its test is "deterministic checks never rely on the LLM". That is **structural**
here, not a promise:

- `lib/matching/deterministic.ts` imports nothing from `lib/ai/` and takes no
  database handle. It is a pure function of two plain objects, so there is no
  code path from it to a model.
- `lib/ai/matchCandidateToJob.ts` is **never told** the salary, experience,
  location or notice period. It receives only the job title, the candidate's
  skills and current role, and the required skills that had no literal match.
  It cannot comment on facts it does not have.

## Code owns the number

`lib/matching/score.ts` computes `overall_score` from both halves. **The model
never emits a score at all**, which is what makes the spec's other test — "AI
explanation lists are internally consistent with the overall score" — true by
construction rather than by checking. A model cannot state a number that
contradicts the facts if it cannot state a number.

Weights are fixed and documented (per-organization weighting is Build Later):

| Component | Weight | |
| --- | --- | --- |
| Required skills coverage | 40 | most common real reason for rejection |
| Experience fit | 20 | |
| Salary fit | 15 | |
| Location fit | 15 | |
| Notice period | 10 | delays a hire, rarely prevents one |

Deterministic 70% / semantic 30%. The facts are recorded; the semantic read is a
judgement, so the number leans on the more trustworthy half. A test asserts that
maximum AI enthusiasm cannot rescue a poor deterministic fit into a strong score.

## Missing data is skipped, never scored zero

A blank salary field means *unknown*, not *bad fit*. Scoring it zero would make a
confident negative claim from an absence. Unevaluable components are dropped and
the remaining weights renormalised, with the omission reported in
needs-verification. There is a test that an otherwise-perfect candidate with no
recorded salary still scores 100.

When nothing at all is checkable the score is 0 — but every component appears in
needs-verification, so the 0 is explained rather than read as "terrible
candidate".

## Every finding is labelled

Each entry carries `source: "code" | "ai"`, rendered as a **checked** or **AI**
tag. Salary being over band is a fact; "Spring covers Spring Boot" is a
judgement. A recruiter deciding someone's career should be able to tell them
apart.

Low-confidence skill equivalences (< 0.6) go to needs-verification rather than
strong matches — a model's hunch is never silently promoted to a fact. And an
equivalence naming a skill that was not in the unmatched list is discarded during
validation, so the model cannot invent a match for a requirement the job never
had.

## Recalculation

The spec wants "auto-recalculation on relevant data changes"; the cost chapter
forbids "recalculating a match score on every page view". Both are satisfied by
marking matches **stale via database trigger** when the specific candidate or job
fields that affect the score change — a rename does not burn an AI call — and
recalculating once from there. Doing it in the database also covers a direct
PostgREST edit that never touches our API.

`applications.match_score` is a denormalised copy kept in step by another
trigger, so lists and the pipeline board can sort without a join.

## AI failure degrades, it does not lose the match

The deterministic pass runs first and always succeeds. If the semantic call
fails, the match is stored with `ai_used = false`, the deterministic score
becomes the overall score, and the UI states plainly that the AI assessment did
not run and what is still being compared. A partial match that is honest is far
more useful than none.

## Follow-ups

- ☐ **Module 5 application summary** can now cite the match score — it already
  receives `match_score`.
- ☐ **Module 10 (Pipeline)** prioritises by score;
  `idx_application_matches_org_score` is in place for it.
- ☐ **Module 11 (Interview brief)** should draw the "verify" list from
  `needs_verification` rather than re-deriving it.
- ☐ **Module 14** — one `TODO(Module 14)` in the match route.
- ☐ **Module 17** — the fixed weights above are the natural per-organization
  setting once Settings exists (spec's Build Later item).
- ☐ **Cost guard** — recalculation is already once-per-change, but there is no
  per-organization rate limit. The cost-tracking retrofit should add one.
- ☐ **Bulk matching** — matches are calculated per application on demand. A
  "score every candidate against this job" sweep would need batching and a queue.
