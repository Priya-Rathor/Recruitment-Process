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
-- (ai_screening_call, phone_interview, video_interview, written_assessment), so
-- "is this stage enabled for this job?" is a lookup rather than a translation
-- table that would rot the first time someone added a stage to one list only.
--
-- =============================================================================
-- WHY THIS DOES *NOT* SWAP THE COLUMN'S TYPE
--
-- The first three versions of this migration built a new enum and ran
-- `ALTER TABLE ... ALTER COLUMN stage TYPE ...`. Postgres refused three times,
-- reporting one blocker per attempt:
--
--   1. cannot alter type of a column used by a view or rule
--   2. cannot alter type of a column used in a trigger definition
--   3. operator does not exist: application_stage_next <> application_stage
--
-- The third ended the approach. Changing a column's type means every dependent
-- object has to be torn down and rebuilt in the right order, and each attempt
-- only reveals the next thing in the queue. That is a losing game against a
-- schema this size.
--
-- ALTER TYPE ... RENAME VALUE changes a LABEL, not a type. No rewrite, no
-- dependency teardown, no views or triggers to drop, and every existing row
-- reads as the new name immediately because the underlying value never moved.
-- Four of the six mappings are pure renames, so they happen for free:
--
--   new           -> applied
--   screening     -> ai_screening_call
--   client_review -> director_round
--   interview     -> phone_interview
--
-- The other two COLLAPSE onto a label that already exists, so a rename would
-- collide. Those are plain UPDATEs:
--
--   recruiter_review -> shortlisted      (the internal sift IS shortlisting)
--   offer            -> director_round   (no Offer stage now; the last round)
--
-- Ambiguous cases resolved BACKWARDS on purpose. A generic "Interview" could
-- have been phone or video, and "Offer" sits past every round in the new list;
-- mapping either forwards would claim progress that did not happen. Moving
-- someone forward again is one click, whereas an overstated pipeline is a lost
-- afternoon.
--
-- THE COST: 'recruiter_review' and 'offer' stay in the enum as dead labels,
-- because Postgres cannot remove an enum value. A CHECK constraint below
-- forbids writing them, which gives the same guarantee the type swap was
-- reaching for — no way to store a stage that no longer exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The views come down first.
--
-- Not because they block anything now — renaming a label needs no teardown —
-- but because four of them contain the literal 'screening', 'client_review',
-- 'interview' or 'offer'. The instant those labels are renamed, those views
-- reference values that no longer exist and every read raises 22P02. They are
-- recreated at the bottom against the new vocabulary.
-- -----------------------------------------------------------------------------
drop view if exists public.analytics_application_funnel;
drop view if exists public.analytics_stage_durations;
drop view if exists public.analytics_recruiter_performance;
drop view if exists public.analytics_job_performance;

-- -----------------------------------------------------------------------------
-- 2. Rename the four labels that map one-to-one.
--
-- Guarded individually so a re-run is a no-op rather than an error.
-- -----------------------------------------------------------------------------
do $$
declare
  v_rename record;
begin
  for v_rename in
    select * from (values
      ('new',           'applied'),
      ('screening',     'ai_screening_call'),
      ('client_review', 'director_round'),
      ('interview',     'phone_interview')
    ) as t(old_label, new_label)
  loop
    if exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'application_stage' and e.enumlabel = v_rename.old_label
    ) and not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'application_stage' and e.enumlabel = v_rename.new_label
    ) then
      execute format(
        'alter type public.application_stage rename value %L to %L',
        v_rename.old_label, v_rename.new_label
      );
      raise notice 'renamed stage % -> %', v_rename.old_label, v_rename.new_label;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Add the two stages that genuinely did not exist before.
--
-- `if not exists` makes a re-run safe. Positioned after phone_interview so the
-- enum's own sort order matches the board; nothing depends on that — the board,
-- the list and the funnel all order by PIPELINE_STAGES in TypeScript — but an
-- enum whose order contradicts the product is a trap for whoever writes the
-- next `order by stage`.
--
-- NOTE: these two are ADDED here and deliberately used nowhere else in this
-- file. Postgres forbids using a newly added enum value in the same
-- transaction that added it, and every UPDATE below assigns a label that
-- already existed.
-- -----------------------------------------------------------------------------
alter type public.application_stage add value if not exists 'video_interview' after 'phone_interview';
alter type public.application_stage add value if not exists 'written_assessment' after 'video_interview';

-- -----------------------------------------------------------------------------
-- 4. Collapse the two stages that map onto an existing label.
--
-- pipeline_sla_config has unique (organization_id, stage), so a row whose
-- target already exists would violate it. The loser is deleted first — the
-- survivor is the row that was already using the destination stage.
-- -----------------------------------------------------------------------------
delete from public.pipeline_sla_config a
where a.stage = 'recruiter_review'
  and exists (
    select 1 from public.pipeline_sla_config b
    where b.organization_id = a.organization_id and b.stage = 'shortlisted'
  );

delete from public.pipeline_sla_config a
where a.stage = 'offer'
  and exists (
    select 1 from public.pipeline_sla_config b
    where b.organization_id = a.organization_id and b.stage = 'director_round'
  );

update public.pipeline_sla_config set stage = 'shortlisted'    where stage = 'recruiter_review';
update public.pipeline_sla_config set stage = 'director_round' where stage = 'offer';

update public.applications set stage = 'shortlisted'    where stage = 'recruiter_review';
update public.applications set stage = 'director_round' where stage = 'offer';

update public.application_stage_history set stage = 'shortlisted'    where stage = 'recruiter_review';
update public.application_stage_history set stage = 'director_round' where stage = 'offer';

update public.organization_settings
set default_application_stage = 'shortlisted'
where default_application_stage = 'recruiter_review';

update public.organization_settings
set default_application_stage = 'director_round'
where default_application_stage = 'offer';

-- -----------------------------------------------------------------------------
-- 5. Forbid the two dead labels.
--
-- Postgres cannot remove an enum value, so 'recruiter_review' and 'offer'
-- remain selectable in any tool that reads the type. This is what stops them
-- being WRITTEN — including by a direct PostgREST call from the browser, which
-- is the path a route handler cannot police.
--
-- Written as a NEGATIVE list on purpose: an `in (...)` listing every valid
-- stage would name 'video_interview' and 'written_assessment', and Postgres
-- forbids using an enum value in the same transaction that added it.
-- -----------------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_stage_not_retired;
alter table public.applications
  add constraint applications_stage_not_retired
  check (stage not in ('recruiter_review', 'offer'));

alter table public.application_stage_history
  drop constraint if exists stage_history_stage_not_retired;
alter table public.application_stage_history
  add constraint stage_history_stage_not_retired
  check (stage not in ('recruiter_review', 'offer'));

-- -----------------------------------------------------------------------------
-- 6. Defaults.
--
-- 'new' was renamed to 'applied', and a stored default holds the value's
-- identity rather than its spelling — so the default already reads 'applied'.
-- These statements are belt and braces for a database where it did not.
-- -----------------------------------------------------------------------------
alter table public.applications alter column stage set default 'applied';

do $$
begin
  if to_regclass('public.organization_settings') is not null then
    execute 'alter table public.organization_settings '
         || 'alter column default_application_stage set default ''applied''';
  end if;
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
-- Rejection provenance, maintained by the database.
--
-- In a trigger, not the API, for the reason Module 5 gave originally: the
-- browser holds an authenticated PostgREST client and can update `stage`
-- directly, so a rule that lives only in a route handler is not enforced.
--
-- BEFORE, not AFTER: this writes to the row itself, and an AFTER trigger would
-- need a second UPDATE, re-firing every trigger on the table.
-- =============================================================================
create or replace function public.stamp_rejected_at_stage()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'rejected' and old.stage is distinct from 'rejected' then
    -- Only when the caller has not set it explicitly, so a correction can still
    -- say "actually they were rejected after the phone interview".
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
-- security_invoker stays ON. Without it a view runs as its owner and bypasses
-- RLS entirely, which on an analytics view means one tenant reading another's
-- funnel.
--
-- The `reached_*` flags are RENAMED with the pipeline. Keeping the old names as
-- aliases would have left the funnel quietly counting one interview type as all
-- of them.
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

  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'shortlisted') as reached_shortlisted,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'ai_screening_call') as reached_ai_screening_call,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage = 'phone_interview') as reached_phone_interview,
  -- ::text on these two ONLY.
  --
  -- video_interview and written_assessment are added by this same migration,
  -- and Postgres refuses to USE a newly added enum value in the transaction
  -- that added it — which creating a view referencing the literal would do.
  -- Comparing the label as text needs no enum lookup, so it is safe here and
  -- means the same thing. The other flags keep the enum comparison so
  -- idx_stage_history_stage stays usable.
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage::text = 'video_interview') as reached_video_interview,
  exists (select 1 from public.application_stage_history h
          where h.application_id = a.id and h.stage::text = 'written_assessment') as reached_written_assessment,
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
  -- ::text for the same reason as the funnel's two flags: this list names both
  -- values this migration adds.
  count(a.id) filter (
    where a.stage::text in ('phone_interview', 'video_interview', 'written_assessment',
                            'director_round', 'hired')
  ) as reached_interview_or_beyond,
  avg(a.match_score) filter (where a.match_score is not null) as average_match_score,
  (select count(*) from public.job_screening_questions q where q.job_id = j.id)
    as screening_question_count
from public.jobs j
left join public.applications a on a.job_id = j.id
group by j.id;

-- -----------------------------------------------------------------------------
-- The two views this migration does not change, recreated verbatim from 0015.
--
-- They were dropped at the top only because they sit alongside the others;
-- 'hired', 'rejected' and 'withdrawn' all survive the rename, so nothing in
-- them needed rewriting.
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
