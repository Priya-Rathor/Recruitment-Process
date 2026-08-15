-- =============================================================================
-- Module 16: Analytics & Reporting
--
-- Five read-only views over the operational tables. No new data: analytics that
-- keep their own copy of the truth drift from it.
--
-- =============================================================================
-- THE MOST DANGEROUS LINE IN THIS FILE IS `security_invoker = true`.
-- =============================================================================
--
-- A PostgreSQL view executes with the privileges of its OWNER, not its caller.
-- Row-Level Security on the underlying tables is therefore evaluated against the
-- view owner — and these views are owned by `postgres`, which BYPASSES RLS.
--
-- Without `security_invoker = true`, every view below would return EVERY
-- ORGANIZATION'S DATA to any authenticated user who selected from it. The RLS
-- policies on applications, interviews, screening_calls and the rest would still
-- exist, still be correct, and be completely irrelevant.
--
-- That is the single worst failure available in this codebase — a silent,
-- total, cross-tenant leak through a feature whose whole job is aggregation, so
-- nobody would see individual rows and notice. It is also easy to introduce by
-- accident, because the view "works" perfectly in a single-tenant test.
--
-- security_invoker (PostgreSQL 15+, which Supabase runs) makes the view run as
-- the caller, so the existing RLS policies apply exactly as they do to a direct
-- query. Every view here sets it. If a future migration recreates one of these
-- views without it, that migration reintroduces the leak.
--
-- The views also carry organization_id explicitly, so a caller can (and the
-- query layer does) filter on it as a second, visible boundary.
-- =============================================================================

-- =============================================================================
-- analytics_application_funnel
--
-- One row per application, denormalised with the timestamps every funnel and
-- time-to-hire calculation needs. The stage TIMESTAMPS come from
-- application_stage_history, which is written only by a database trigger — so
-- they cannot be back-dated by application code.
--
-- `reached_*` is "did this application EVER reach this stage", not "is it there
-- now". A funnel built on current stage alone would show a hired candidate as
-- never having been screened, which understates every conversion rate.
-- =============================================================================
drop view if exists public.analytics_application_funnel;
create view public.analytics_application_funnel
with (security_invoker = true) as
select
  a.id                       as application_id,
  a.organization_id,
  a.candidate_id,
  a.job_id,
  a.assigned_recruiter_id,
  a.source,
  a.stage                    as current_stage,
  a.match_score,
  a.archived_at,
  a.created_at,
  j.client_id,
  j.title                    as job_title,
  j.work_mode,

  -- Ever-reached flags, from the immutable history.
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'screening'
  ) as reached_screening,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'shortlisted'
  ) as reached_shortlisted,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'client_review'
  ) as reached_client_review,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'interview'
  ) as reached_interview,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'offer'
  ) as reached_offer,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'hired'
  ) as reached_hired,
  exists (
    select 1 from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'rejected'
  ) as reached_rejected,

  -- When it entered the terminal stages, for time-to-hire.
  (
    select min(h.entered_at) from public.application_stage_history h
    where h.application_id = a.id and h.stage = 'hired'
  ) as hired_at,

  -- A screening call was actually PLACED. Distinct from reaching the Screening
  -- stage: an application can sit in Screening with no call ever made, and
  -- reporting those as "AI screened" would overstate the product's own value.
  exists (
    select 1 from public.screening_calls c
    where c.application_id = a.id
  ) as screening_call_attempted,
  exists (
    select 1 from public.screening_calls c
    where c.application_id = a.id and c.status = 'completed'
  ) as screening_call_completed

from public.applications a
left join public.jobs j on j.id = a.job_id;

-- =============================================================================
-- analytics_stage_durations
--
-- CLOSED stage rows only. An open row's duration depends on `now`, which would
-- make the same report give different answers on successive loads and make
-- "average time in Client Review" creep upward simply because nobody reloaded.
--
-- Not one of the five views the spec names, but time-in-stage is a named
-- feature and it needs its own grain — one row per stage VISIT, not per
-- application.
-- =============================================================================
drop view if exists public.analytics_stage_durations;
create view public.analytics_stage_durations
with (security_invoker = true) as
select
  h.id,
  h.organization_id,
  h.application_id,
  h.stage,
  h.entered_at,
  h.exited_at,
  extract(epoch from (h.exited_at - h.entered_at)) / 86400.0 as days_in_stage,
  a.assigned_recruiter_id,
  a.job_id,
  j.client_id
from public.application_stage_history h
join public.applications a on a.id = h.application_id
left join public.jobs j on j.id = a.job_id
where h.exited_at is not null;

-- =============================================================================
-- analytics_recruiter_performance
--
-- Aggregated per recruiter. The spec is explicit that recruiter data is shown
-- as "workload and outcomes as separate views, never a single ranked
-- leaderboard", so this view deliberately emits NO composite score and NO rank.
-- Anything that ordered people by a single number would be used as one.
-- =============================================================================
drop view if exists public.analytics_recruiter_performance;
create view public.analytics_recruiter_performance
with (security_invoker = true) as
select
  a.organization_id,
  a.assigned_recruiter_id                                as recruiter_id,
  u.name                                                 as recruiter_name,
  u.email                                                as recruiter_email,
  count(*)                                               as applications,
  count(*) filter (where a.archived_at is null
    and a.stage not in ('hired', 'rejected', 'withdrawn')) as active_applications,
  count(*) filter (where a.stage = 'hired')              as hires,
  count(*) filter (where a.stage = 'rejected')           as rejected,
  min(a.created_at)                                      as first_application_at,
  max(a.created_at)                                      as last_application_at
from public.applications a
left join public.users u on u.id = a.assigned_recruiter_id
where a.assigned_recruiter_id is not null
group by a.organization_id, a.assigned_recruiter_id, u.name, u.email;

-- =============================================================================
-- analytics_job_performance
-- =============================================================================
drop view if exists public.analytics_job_performance;
create view public.analytics_job_performance
with (security_invoker = true) as
select
  j.organization_id,
  j.id                                                   as job_id,
  j.title,
  j.status,
  j.client_id,
  j.owner_recruiter_id,
  j.created_at,
  j.archived_at,
  count(a.id)                                            as applications,
  count(a.id) filter (where a.stage = 'hired')           as hires,
  count(a.id) filter (where a.stage in ('interview', 'offer', 'hired')) as reached_interview_or_beyond,
  avg(a.match_score) filter (where a.match_score is not null) as average_match_score,
  -- Feeds the rule-based health indicator, which stays in TypeScript
  -- (lib/jobs/health.ts) so the rules have one home.
  (select count(*) from public.job_screening_questions q where q.job_id = j.id) as screening_question_count
from public.jobs j
left join public.applications a on a.job_id = j.id
group by j.organization_id, j.id, j.title, j.status, j.client_id,
         j.owner_recruiter_id, j.created_at, j.archived_at;

-- =============================================================================
-- analytics_client_performance
--
-- Centred on feedback turnaround, per the spec. Response times are computed
-- only from RESPONDED events: mixing "took 2 days" with "hasn't answered yet"
-- is not an average of anything, and Module 12 already made that call.
-- =============================================================================
drop view if exists public.analytics_client_performance;
create view public.analytics_client_performance
with (security_invoker = true) as
select
  c.organization_id,
  c.id                                                   as client_id,
  c.name                                                 as client_name,
  c.feedback_sla_days,
  c.account_manager_id,
  count(e.id)                                            as submissions,
  count(e.id) filter (where e.responded_at is not null)  as responses,
  count(e.id) filter (where e.responded_at is null)      as awaiting_response,
  avg(extract(epoch from (e.responded_at - e.requested_at)) / 86400.0)
    filter (where e.responded_at is not null)            as average_response_days,
  count(e.id) filter (
    where e.responded_at is not null
      and extract(epoch from (e.responded_at - e.requested_at)) / 86400.0 <= c.feedback_sla_days
  )                                                      as responded_within_sla
from public.clients c
left join public.client_feedback_events e on e.client_id = c.id
group by c.organization_id, c.id, c.name, c.feedback_sla_days, c.account_manager_id;

-- =============================================================================
-- analytics_screening_metrics
--
-- One row per screening call. Deliberately per-call rather than pre-aggregated:
-- the rates are computed in TypeScript so the zero-denominator and
-- insufficient-data rules live in one tested place rather than being reinvented
-- in SQL, where "0 out of 0 = 0%" is very easy to write by accident.
-- =============================================================================
drop view if exists public.analytics_screening_metrics;
create view public.analytics_screening_metrics
with (security_invoker = true) as
select
  c.id                                                   as call_id,
  c.organization_id,
  c.application_id,
  c.status,
  c.attempt_number,
  c.duration_seconds,
  c.language,
  c.consent_confirmed,
  c.created_at,
  c.ended_at,
  a.assigned_recruiter_id,
  a.job_id,
  j.client_id,
  j.title                                                as job_title,
  r.id                                                   as report_id,
  -- The CURRENT value: Module 9 writes a human's correction over
  -- interest_level and preserves the model's original in ai_interest_level.
  -- Analytics wants what a human stands behind, so it reads the live column.
  r.interest_level,
  r.ai_interest_level,
  r.interest_level is distinct from r.ai_interest_level  as interest_level_corrected,
  r.reviewed_at is not null                              as report_reviewed
from public.screening_calls c
left join public.applications a on a.id = c.application_id
left join public.jobs j on j.id = a.job_id
left join public.screening_reports r on r.application_id = c.application_id;

-- =============================================================================
-- Supporting indexes.
--
-- The views select on organization_id and a date column in every query, and
-- the `exists` sub-selects in the funnel view hit stage history by
-- (application_id, stage) — which had no index until now.
-- =============================================================================
create index if not exists idx_stage_history_app_stage
  on public.application_stage_history (application_id, stage);
create index if not exists idx_applications_org_created_at
  on public.applications (organization_id, created_at desc);
create index if not exists idx_screening_calls_org_created_at
  on public.screening_calls (organization_id, created_at desc);
create index if not exists idx_interviews_org_scheduled_at
  on public.interviews (organization_id, scheduled_at desc);
create index if not exists idx_client_feedback_events_org_requested
  on public.client_feedback_events (organization_id, requested_at desc);
create index if not exists idx_applications_source
  on public.applications (organization_id, source);

-- =============================================================================
-- Grants.
--
-- SELECT only, to authenticated users. With security_invoker the caller's RLS
-- still applies, so this grants the ability to ask the question — not the right
-- to see anyone else's answer.
--
-- No INSERT/UPDATE/DELETE is granted, and none would work: these are views over
-- joins and aggregates, not updatable relations.
-- =============================================================================
grant select on public.analytics_application_funnel  to authenticated;
grant select on public.analytics_stage_durations     to authenticated;
grant select on public.analytics_recruiter_performance to authenticated;
grant select on public.analytics_job_performance     to authenticated;
grant select on public.analytics_client_performance  to authenticated;
grant select on public.analytics_screening_metrics   to authenticated;
