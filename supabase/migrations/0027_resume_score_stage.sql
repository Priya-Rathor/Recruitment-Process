-- =============================================================================
-- Resume Score — a fifth row on the job's Hiring Stages card.
--
-- It is NOT a pipeline stage. Every application is scored against its job the
-- moment it exists, whether or not anything here is switched on (see migration
-- 0024's note on jobs.resume_passing_score). What this row configures is HOW
-- that score is produced for this particular job:
--
--   enabled = false -> the platform default prompt and weights are used
--   enabled = true  -> this job's own prompt, weights and pass mark are used
--
-- That is why it is not added to the application_stage enum and not added to
-- CONFIGURABLE_STAGES: a stage a candidate never "moves into" has no business
-- in the pipeline stepper.
--
-- THE PASS MARK IS SYNCED, NOT DUPLICATED.
--
-- jobs.resume_passing_score already exists (0024) and is already read by
-- lib/evaluation/sources.ts. Storing a second copy in this row's config and
-- teaching the reader about it would give the same rule two homes and two
-- answers. Instead a trigger writes the column from the row, so every existing
-- reader keeps working and there is still exactly one source of truth.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Let the row exist.
--
-- The original constraint was declared inline in migration 0020, so PostgreSQL
-- named it <table>_<column>_check. Dropped and re-added rather than edited,
-- because a CHECK cannot be altered in place.
-- -----------------------------------------------------------------------------
alter table public.job_hiring_stages
  drop constraint if exists job_hiring_stages_stage_key_check;

alter table public.job_hiring_stages
  add constraint job_hiring_stages_stage_key_check check (
    stage_key in (
      'resume_score',
      'ai_screening_call',
      'phone_interview',
      'video_interview',
      'written_assessment'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Keep jobs.resume_passing_score in step with the row.
--
-- A TRIGGER rather than route code, for the same reason migration 0020's tenant
-- check is one: the browser holds an authenticated PostgREST client and can
-- upsert this row directly. A sync that lived in the PUT handler would leave the
-- gate reading a stale threshold for anyone who went around it.
--
-- Switching the row OFF clears the column. That is the honest reading of "off
-- means platform default": there is no default pass mark, and leaving a stale
-- number behind would keep failing candidates against a rule the recruiter
-- believes they turned off. Null reads as Needs Review, never as Fail — see
-- statusFor() in lib/evaluation/verdict.ts.
-- -----------------------------------------------------------------------------
create or replace function public.sync_job_resume_passing_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer;
begin
  if new.stage_key <> 'resume_score' then
    return new;
  end if;

  if new.enabled then
    -- ->> yields NULL for a JSON null and for an absent key; nullif catches the
    -- empty string a form can send. Anything non-numeric would raise, which is
    -- why lib/hiring-stages/config.ts normalises this value before it is written.
    v_score := nullif(new.config ->> 'passingScore', '')::integer;
  else
    v_score := null;
  end if;

  update public.jobs
    set resume_passing_score = v_score
  where id = new.job_id
    and resume_passing_score is distinct from v_score;

  return new;
end;
$$;

drop trigger if exists trg_job_hiring_stages_sync_resume_score on public.job_hiring_stages;
create trigger trg_job_hiring_stages_sync_resume_score
  after insert or update on public.job_hiring_stages
  for each row execute function public.sync_job_resume_passing_score();

-- -----------------------------------------------------------------------------
-- 3. Backfill.
--
-- A job that already carries a pass mark from before this row existed keeps it,
-- and gets an ENABLED row describing where that number now lives. Creating the
-- row disabled would clear a threshold someone deliberately set — the one thing
-- this migration must not do.
--
-- Jobs with no threshold get nothing: an empty row would claim a configuration
-- nobody made.
-- -----------------------------------------------------------------------------
insert into public.job_hiring_stages (job_id, organization_id, stage_key, enabled, config)
select
  j.id,
  j.organization_id,
  'resume_score',
  true,
  jsonb_build_object(
    'passingScore', j.resume_passing_score,
    'weights', null,
    'semanticWeightPercent', null
  )
from public.jobs j
where j.resume_passing_score is not null
on conflict (job_id, stage_key) do nothing;
