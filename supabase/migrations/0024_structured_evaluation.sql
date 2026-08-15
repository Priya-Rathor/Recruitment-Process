-- =============================================================================
-- Structured evaluation results: strengths and concerns alongside the score.
--
-- The pattern, applied to every round that produces a result:
--
--   score  +  status  +  key strengths  +  key concerns  (+ the narrative)
--
-- The narrative summary STAYS. A summary answers "what happened"; the lists
-- answer "what should I look at". Collapsing either into the other loses one of
-- them, so both are kept.
--
-- WHAT THIS MIGRATION DOES *NOT* ADD, because it already exists:
--
--   * The resume/match round. application_matches (Module 7) already stores
--     strong_matches, gaps and needs_verification — labelled lists that ARE
--     strengths and concerns, each tagged with whether code or AI produced it.
--     Adding parallel columns would create a second source of truth for the
--     same judgement, so the read model derives from those instead.
--
--   * Per-stage passing thresholds for the four configurable stages. Those live
--     in job_hiring_stages.config, which is jsonb and needs no DDL — see
--     lib/hiring-stages/config.ts.
--
-- A NOTE ON THE BRIEF: it asked to "reuse the passing_score pattern already
-- built for Written Assessment". No such pattern existed — that stage's config
-- was questions + timeLimitMinutes only. The threshold is therefore new, and is
-- added to all four stages plus the resume gate at once rather than to one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Screening call results (Modules 8/9).
--
-- text[] rather than jsonb: these are lists of sentences with no internal
-- structure, and an array keeps them queryable with the ordinary array
-- operators rather than needing a jsonb path everywhere they are read.
-- -----------------------------------------------------------------------------
alter table public.screening_reports
  add column if not exists key_strengths text[] not null default '{}',
  add column if not exists key_concerns text[] not null default '{}';

comment on column public.screening_reports.key_strengths is
  'Two to four short points in the candidate''s favour. Supplements summary_text.';
comment on column public.screening_reports.key_concerns is
  'Two to four short points against. Supplements summary_text, never replaces it.';

-- -----------------------------------------------------------------------------
-- Manually logged rounds (phone, video, assessment, director).
--
-- OPTIONAL here, deliberately. These entries are typed by a recruiter after a
-- conversation, and requiring two bulleted lists before a call can be recorded
-- would push people into logging nothing at all.
-- -----------------------------------------------------------------------------
alter table public.application_evaluations
  add column if not exists key_strengths text[] not null default '{}',
  add column if not exists key_concerns text[] not null default '{}';

comment on column public.application_evaluations.key_strengths is
  'Optional. Free text when a human logged the round; AI-produced when graded.';

-- -----------------------------------------------------------------------------
-- The resume/match gate's threshold.
--
-- On `jobs` rather than in job_hiring_stages.config, because the resume match
-- is not one of the four toggleable stages — every application is scored
-- against its job whether or not any stage is switched on.
--
-- Nullable with no default. A threshold nobody set must read as "not judged"
-- rather than silently failing every candidate below an invented number: see
-- statusFor() in lib/evaluation/verdict.ts, where a missing threshold yields
-- Needs Review rather than Fail.
-- -----------------------------------------------------------------------------
alter table public.jobs
  add column if not exists resume_passing_score integer
    check (resume_passing_score is null
           or (resume_passing_score >= 0 and resume_passing_score <= 100));

comment on column public.jobs.resume_passing_score is
  'Match percentage at or above which a resume passes this job''s first gate. Null = no gate configured; results read as Needs Review.';
