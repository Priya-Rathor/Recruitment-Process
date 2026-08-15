-- =============================================================================
-- Redefining the pipeline stages.
--
--   OLD: New -> Screening -> Recruiter Review -> Shortlisted -> Client Review
--        -> Interview -> Offer -> Hired
--
--   NEW: Applied -> Shortlisted -> AI Screening Call -> Phone Interview
--        -> Video Interview -> Written Assessment -> Director Round -> Hired
--
-- THE STAGE KEYS ARE DELIBERATELY IDENTICAL TO job_hiring_stages' keys
-- (ai_screening_call, phone_interview, video_interview, written_assessment).
-- The two features describe the same four steps, and a translation table
-- between "assessment" and "written_assessment" would be a bug waiting to
-- happen the first time someone added a stage to one list and not the other.
-- With identical keys, "is this stage enabled for this job?" is a lookup, not a
-- mapping.
--
-- A FULL TYPE SWAP, not ALTER TYPE ... ADD VALUE. Postgres cannot remove an
-- enum value, so adding would leave 'new', 'recruiter_review', 'client_review',
-- 'interview' and 'offer' in the type forever — selectable in any tool that
-- reads the enum, and silently valid in a direct PostgREST write. Rebuilding
-- the type is more work here and leaves no way to write a stage that no longer
-- exists.
-- =============================================================================

-- =============================================================================
-- EVERYTHING THAT DEPENDS ON THE COLUMN HAS TO GO FIRST.
--
-- Postgres refuses `ALTER TABLE ... ALTER COLUMN ... TYPE` while anything still
-- references that column, and it reports one blocker at a time — so this
-- migration failed twice, once per category:
--
--   ERROR: cannot alter type of a column used by a view or rule
--   ERROR: cannot alter type of a column used in a trigger definition
--
-- VIEWS. Four of Module 16's views read applications.stage or
-- application_stage_history.stage. All four are dropped here and recreated at
-- the bottom. (analytics_client_performance and analytics_screening_metrics
-- read neither, so they are left alone.)
--
-- TRIGGERS. A trigger declared `update OF <column>` depends on that column —
-- the column list is part of the definition, not just a filter. Only
-- trg_applications_stage_history qualifies: the other triggers on these tables
-- either name different columns (tenant integrity: candidate_id, job_id,
-- organization_id) or name none at all (touch_updated_at), and a trigger with
-- no column list has no column dependency.
-- =============================================================================
drop view if exists public.analytics_application_funnel;
drop view if exists public.analytics_stage_durations;
drop view if exists public.analytics_recruiter_performance;
drop view if exists public.analytics_job_performance;

-- Recreated below, after the swap, with its function unchanged. The stage
-- history it maintains is untouched by this — only the column's TYPE changes,
-- and the rows keep their (remapped) values.
drop trigger if exists trg_applications_stage_history on public.applications;

do $$
declare
  v_mapping text;
begin
  -- Defensive: a previous failed attempt inside a DO block rolls back, but a
  -- half-run script executed statement-by-statement could leave this behind,
  -- and `create type` would then fail on a name clash.
  drop type if exists public.application_stage_next;

  -- Idempotent: only runs while the OLD shape is still in place.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'application_stage' and e.enumlabel = 'new'
  ) then
    raise notice 'application_stage already migrated; skipping.';
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- The mapping, applied to every column that carries a stage.
  --
  --   new             -> applied            (same thing, renamed)
  --   screening       -> ai_screening_call  (screening is now explicitly the call)
  --   recruiter_review-> shortlisted        (the internal sift IS shortlisting)
  --   shortlisted     -> shortlisted        (unchanged)
  --   client_review   -> director_round     (the final human review before hire)
  --   interview       -> phone_interview    (the EARLIEST interview stage)
  --   offer           -> director_round     (no Offer stage now; the last round)
  --   hired/rejected/withdrawn              (unchanged)
  --
  -- Ambiguous cases resolve BACKWARDS on purpose. A generic "Interview" could be
  -- a phone or a video round, and "Offer" sits past every round in the new list;
  -- mapping either one forwards would claim progress that did not happen, and a
  -- recruiter moving someone forward again is a click, whereas discovering that
  -- the pipeline overstated ten candidates is a lost afternoon.
  -- ---------------------------------------------------------------------------
  v_mapping := $map$
    case %1$s::text
      when 'new'              then 'applied'
      when 'screening'        then 'ai_screening_call'
      when 'recruiter_review' then 'shortlisted'
      when 'client_review'    then 'director_round'
      when 'interview'        then 'phone_interview'
      when 'offer'            then 'director_round'
      else %1$s::text
    end::public.application_stage_next
  $map$;

  execute $ddl$
    create type public.application_stage_next as enum (
      'applied',
      'shortlisted',
      'ai_screening_call',
      'phone_interview',
      'video_interview',
      'written_assessment',
      'director_round',
      'hired',
      'rejected',
      'withdrawn'
    )
  $ddl$;

  -- Defaults reference the old type, so they have to go before the swap.
  execute 'alter table public.applications alter column stage drop default';
  if to_regclass('public.organization_settings') is not null then
    execute 'alter table public.organization_settings '
         || 'alter column default_application_stage drop default';
  end if;

  execute format(
    'alter table public.applications alter column stage type public.application_stage_next using '
    || v_mapping, 'stage');

  execute format(
    'alter table public.application_stage_history alter column stage '
    || 'type public.application_stage_next using ' || v_mapping, 'stage');

  if to_regclass('public.pipeline_sla_config') is not null then
    -- Two old stages can collapse onto one new one (client_review and offer
    -- both become director_round), and this table has a unique
    -- (organization_id, stage). Drop the loser before converting, or the type
    -- change fails on a duplicate key.
    execute $dedupe$
      delete from public.pipeline_sla_config a
      using public.pipeline_sla_config b
      where a.organization_id = b.organization_id
        and a.stage::text = 'offer'
        and b.stage::text = 'client_review'
    $dedupe$;

    execute format(
      'alter table public.pipeline_sla_config alter column stage '
      || 'type public.application_stage_next using ' || v_mapping, 'stage');
  end if;

  if to_regclass('public.organization_settings') is not null then
    execute format(
      'alter table public.organization_settings alter column default_application_stage '
      || 'type public.application_stage_next using ' || v_mapping,
      'default_application_stage');
  end if;

  execute 'drop type public.application_stage';
  execute 'alter type public.application_stage_next rename to application_stage';

  execute 'alter table public.applications alter column stage set default ''applied''';
  if to_regclass('public.organization_settings') is not null then
    execute 'alter table public.organization_settings '
         || 'alter column default_application_stage set default ''applied''';
  end if;

  raise notice 'application_stage migrated to the eight-stage pipeline.';
end $$;

-- =============================================================================
-- Where a rejection happened.
--
-- Rejected is reachable from ANY stage, so "rejected" on its own destroys the
-- most useful fact about it — Module 16 cannot tell a candidate rejected after
-- a director round from one rejected on their CV. The stage history holds it,
-- but reconstructing it means a correlated subquery on every funnel row.
-- =============================================================================
alter table public.applications
  add column if not exists rejected_at_stage public.application_stage;

comment on column public.applications.rejected_at_stage is
  'The stage this application was in immediately before being rejected. Null unless stage = rejected.';

create index if not exists idx_applications_rejected_at_stage
  on public.applications (organization_id, rejected_at_stage)
  where rejected_at_stage is not null;

-- =============================================================================
-- Stage history + rejection provenance, maintained by the database.
--
-- Extends the Module 5 trigger rather than replacing it: the history behaviour
-- is unchanged (close the open row, open a new one), and the only addition is
-- stamping rejected_at_stage on the way into 'rejected'.
--
-- In the trigger, not the API, for the reason Module 5 gave originally: the
-- browser holds an authenticated PostgREST client and can update `stage`
-- directly. A rule that lives only in a route handler is not enforced.
-- =============================================================================
create or replace function public.record_application_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_stage_history
      (organization_id, application_id, stage, entered_at, changed_by)
    values
      (new.organization_id, new.id, new.stage, now(), public.current_app_user_id());
    return new;
  end if;

  -- UPDATE: only act on an actual stage change.
  if new.stage is distinct from old.stage then
    update public.application_stage_history
      set exited_at = now()
      where application_id = new.id and exited_at is null;

    insert into public.application_stage_history
      (organization_id, application_id, stage, entered_at, changed_by)
    values
      (new.organization_id, new.id, new.stage, now(), public.current_app_user_id());
  end if;

  return new;
end;
$$;

-- BEFORE, not AFTER: this one writes to the row itself, and an AFTER trigger
-- would need a second UPDATE (re-firing every trigger on the table).
create or replace function public.stamp_rejected_at_stage()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'rejected' and old.stage is distinct from 'rejected' then
    -- Only when the caller has not set it explicitly, so a correction can
    -- still say "actually they were rejected after the phone interview".
    if new.rejected_at_stage is null then
      new.rejected_at_stage := old.stage;
    end if;
  elsif new.stage is distinct from 'rejected' then
    -- Moved back out of rejected (an undo). The field would otherwise claim a
    -- rejection that no longer exists.
    new.rejected_at_stage := null;
  end if;

  return new;
end;
$$;

-- Recreated now the column has its new type. Identical to migration 0004's
-- definition; it was dropped at the top only because `update of stage` made it
-- a dependency of the column.
drop trigger if exists trg_applications_stage_history on public.applications;
create trigger trg_applications_stage_history
  after insert or update of stage on public.applications
  for each row execute function public.record_application_stage_change();

drop trigger if exists trg_applications_stamp_rejected_stage on public.applications;
create trigger trg_applications_stamp_rejected_stage
  before update of stage on public.applications
  for each row execute function public.stamp_rejected_at_stage();

-- Backfill for applications rejected before this column existed: the stage they
-- were in immediately before the rejection row opened.
update public.applications a
set rejected_at_stage = previous.stage
from (
  select distinct on (h.application_id)
    h.application_id,
    h.stage
  from public.application_stage_history h
  where h.stage <> 'rejected'
  order by h.application_id, h.entered_at desc
) as previous
where a.id = previous.application_id
  and a.stage = 'rejected'
  and a.rejected_at_stage is null;

-- =============================================================================
-- Module 16's analytics views, rebuilt on the new stages.
--
-- The views are `create or replace`, so re-running them here is the whole fix —
-- but the COLUMN SET changes (reached_screening / reached_client_review /
-- reached_interview / reached_offer are gone, four new flags take their place),
-- and Postgres refuses to replace a view whose columns changed. They are
-- dropped first.
--
-- Renamed rather than aliased on purpose: keeping `reached_interview` as an
-- alias for `reached_phone_interview` would have left the funnel quietly
-- counting one interview type as all of them.
--
-- security_invoker stays ON. Without it a view runs as its owner and bypasses
-- RLS entirely, which on an analytics view means one tenant reading another's
-- funnel.
-- =============================================================================

create view public.analytics_application_funnel
with (security_invoker = true) as
select
  a.id                       as application_id,
  a.organization_id,
  a.job_id,
  a.assigned_recruiter_id,
  a.source,
  a.stage                    as current_stage,
  a.rejected_at_stage,
  a.match_score,
  a.archived_at,
  a.created_at,
  j.client_id,
  j.title                    as job_title,
  j.work_mode,

  -- Ever-reached flags, from the immutable history. One per board stage.
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'shortlisted') as reached_shortlisted,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'ai_screening_call') as reached_ai_screening_call,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'phone_interview') as reached_phone_interview,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'video_interview') as reached_video_interview,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'written_assessment') as reached_written_assessment,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'director_round') as reached_director_round,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'hired') as reached_hired,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'rejected') as reached_rejected,

  (select min(h.entered_at) from public.application_stage_history h
   where h.application_id = a.id and h.stage = 'hired') as hired_at,

  exists (select 1 from public.screening_calls c
          where c.application_id = a.id) as screening_call_attempted,
  exists (select 1 from public.screening_calls c
          where c.application_id = a.id and c.status = 'completed') as screening_call_completed
from public.applications a
join public.jobs j on j.id = a.job_id;

create view public.analytics_job_performance
with (security_invoker = true) as
select
  j.id                                                   as job_id,
  j.organization_id,
  j.title,
  j.status,
  j.client_id,
  j.owner_recruiter_id,
  j.created_at,
  j.archived_at,
  count(a.id)                                            as applications,
  count(a.id) filter (where a.stage = 'hired')           as hires,
  -- "Interview or beyond" now spans three rounds plus the director round.
  count(a.id) filter (
    where a.stage in ('phone_interview', 'video_interview', 'written_assessment',
                      'director_round', 'hired')
  ) as reached_interview_or_beyond,
  avg(a.match_score) filter (where a.match_score is not null) as average_match_score,
  (select count(*) from public.job_screening_questions q where q.job_id = j.id)
    as screening_question_count
from public.jobs j
left join public.applications a on a.job_id = j.id
group by j.id;

-- -----------------------------------------------------------------------------
-- The two views this migration does not change, recreated verbatim.
--
-- They were dropped at the top only because they reference a stage column and
-- would otherwise have blocked the type swap. Their definitions are unchanged
-- from migration 0015 — 'hired', 'rejected' and 'withdrawn' all survive the
-- rename, so nothing in them needed rewriting.
-- -----------------------------------------------------------------------------
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
