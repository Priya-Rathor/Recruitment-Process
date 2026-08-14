# Job health rule set (Module 3)

The specification's testing checklist requires that "the job health indicator
matches the documented rule set", but the document never states those rules.
They are defined here, implemented in `lib/jobs/health.ts`, and covered by
`lib/jobs/health.test.ts`. **Keep all three in sync.**

Health is **rule-based, not AI-scored.** The spec places "AI-based
(non-rule-based) health scoring" under Build Later, and the platform principle is
that checkable facts belong in code. Every verdict is reproducible and
explainable without a model call.

## Verdict

A job is **Needs Attention** if *any* rule below fires, otherwise **Healthy**.
Each firing rule contributes a plain-language reason, shown verbatim in the UI so
a recruiter always knows *why* — never a bare amber dot.

## Rules

| # | Applies when | Fires if | Reason shown | Rationale |
| --- | --- | --- | --- | --- |
| 1 | status = `on_hold` | always | On hold — needs a decision to resume or close | A paused requisition is a pending human decision by definition. |
| 2 | status = `open` | 0 screening questions | No screening questions — AI screening cannot run | Module 8 cannot place a screening call without a question set, so the downstream workflow is silently blocked. |
| 3 | status = `open` | `experience_min` **and** `experience_max` both null | No experience range — candidate matching will be less accurate | Module 7's deterministic experience check has nothing to compare against. One bound is sufficient. |
| 4 | status = `open` | `salary_min` **and** `salary_max` both null | No salary band — candidate matching will be less accurate | Same, for the deterministic salary check. One bound is sufficient. |
| 5 | status = `open` | `required_skills` empty | No required skills listed | Module 7's semantic matching has no anchor. |
| 6 | status = `open` | age > 30 days (`STALE_OPEN_JOB_DAYS`) | Open for N days without being filled | A requisition open this long needs review. Strictly greater than, so day 30 is still healthy. |
| 7 | status = `open` | `applicationCount === 0` **and** age ≥ 7 days | No candidates after N days | Open but attracting nobody. **Skipped entirely while `applicationCount` is undefined** — see below. |

## Deliberate non-rules

- **`draft` jobs are never unhealthy.** A draft is *allowed* to be incomplete;
  flagging it would make the indicator meaningless during normal authoring.
- **`closed` jobs are never unhealthy.** A closed requisition is finished, not
  neglected.
- **No AI involvement**, per Build Later.

## Retrofit obligations

- ☐ **Module 5 (Applications)** — pass `applicationCount` into
  `evaluateJobHealth()`. Rule 7 is inert until then, and that is deliberate:
  defaulting the count to `0` would mark every healthy job as unhealthy the
  moment it turned 7 days old. There is a test asserting the rule stays skipped.
- ☐ **Module 10 (Pipeline)** — consider deriving rule 6's threshold from
  `pipeline_sla_config` instead of the fixed 30 days.
- ☐ **Module 12 (Clients)** — a client past its `feedback_sla_days` on this job's
  submissions is a candidate for a new rule.
- ☐ **Module 17 (Settings)** — `STALE_OPEN_JOB_DAYS` is currently a constant;
  it is a natural per-organization setting.
