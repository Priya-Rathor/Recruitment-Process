-- =============================================================================
-- Retiring the standalone interview-questions list.
--
-- The job form had one generic "Interview questions" list. The Hiring Stages
-- feature split interviews into TWO configurable stages — Phone Interview and
-- Video Interview — each with its own "Suggested questions". So there is no 1:1
-- destination, and the old list has to go somewhere.
--
-- IT IS COPIED INTO BOTH. The old list never recorded which round a question
-- was meant for, so choosing one would be a guess that silently discards the
-- questions from the other. A duplicate a recruiter can delete is recoverable;
-- a deletion they never see is not.
--
-- The two lists are INDEPENDENT after this. Copying is a one-off seed, not a
-- link: editing the phone list later does not touch the video one.
--
-- WHAT THIS DOES *NOT* DO: drop job_interview_questions.
--
-- That table is not a duplicate — it is the original, and Module 11's interview
-- brief reads it today. The application code moves to the stage configs in the
-- same commit, which leaves the table unused but intact. Dropping it in the
-- same breath as the migration that empties its readers would mean a failed
-- deploy has nowhere to fall back to. It can go in a later migration once this
-- one is confirmed applied and the brief is confirmed reading the new source.
-- =============================================================================

do $$
declare
  v_job record;
  v_questions text[];
  v_existing text[];
  v_merged text[];
  v_stage text;
  v_migrated integer := 0;
  v_flagged integer := 0;
  v_flagged_ids text := '';
begin
  if to_regclass('public.job_hiring_stages') is null then
    raise exception
      'job_hiring_stages does not exist — apply migration 0020 before this one.';
  end if;

  for v_job in
    select
      q.job_id,
      j.organization_id,
      j.title,
      array_agg(q.question order by q.display_order, q.created_at) as questions
    from public.job_interview_questions q
    join public.jobs j on j.id = q.job_id
    group by q.job_id, j.organization_id, j.title
  loop
    v_questions := v_job.questions;

    foreach v_stage in array array['phone_interview', 'video_interview']
    loop
      -- Merge rather than overwrite: a stage that already has its own suggested
      -- questions keeps them, and the old generic ones are appended. Overwriting
      -- would destroy work someone did in the new screen.
      select coalesce(
               array(select jsonb_array_elements_text(config -> 'questions')),
               '{}'::text[])
        into v_existing
      from public.job_hiring_stages
      where job_id = v_job.job_id and stage_key = v_stage;

      v_existing := coalesce(v_existing, '{}'::text[]);

      select array_agg(distinct q order by q)
        into v_merged
      from unnest(v_existing || v_questions) as q;

      insert into public.job_hiring_stages
        (job_id, organization_id, stage_key, enabled, config)
      values (
        v_job.job_id,
        v_job.organization_id,
        v_stage,
        -- DISABLED when the row did not exist. Creating it enabled would switch
        -- a hiring stage on for a job that never asked for one, which changes
        -- what candidates go through — a migration must not do that.
        false,
        jsonb_build_object('questions', to_jsonb(coalesce(v_merged, '{}'::text[])))
      )
      on conflict (job_id, stage_key) do update
        set config = public.job_hiring_stages.config
                     || jsonb_build_object(
                          'questions',
                          to_jsonb(coalesce(v_merged, '{}'::text[]))
                        );
    end loop;

    v_migrated := v_migrated + 1;

    -- Neither interview stage switched on: the questions are now stored but
    -- invisible, because a disabled stage hides its configuration. Named in the
    -- notice so a human can decide whether to switch a stage on or let them go.
    if not exists (
      select 1 from public.job_hiring_stages
      where job_id = v_job.job_id
        and stage_key in ('phone_interview', 'video_interview')
        and enabled
    ) then
      v_flagged := v_flagged + 1;
      v_flagged_ids := v_flagged_ids || format(E'\n    - %s (%s)', v_job.title, v_job.job_id);
    end if;
  end loop;

  raise notice 'Interview questions migrated for % job(s).', v_migrated;

  if v_flagged > 0 then
    raise notice
      E'% job(s) have NEITHER interview stage enabled, so their migrated questions are stored but not visible:%',
      v_flagged, v_flagged_ids;
  end if;
end $$;

-- =============================================================================
-- The report, as a query rather than only a notice.
--
-- Notices scroll past in the SQL editor. This can be re-run at any time to see
-- exactly what moved and what needs a human decision.
-- =============================================================================
create or replace view public.report_interview_question_migration
with (security_invoker = true) as
select
  j.id                                as job_id,
  j.organization_id,
  j.title,
  count(q.id)                         as legacy_questions,
  coalesce(
    jsonb_array_length(phone.config -> 'questions'), 0)   as phone_questions,
  coalesce(
    jsonb_array_length(video.config -> 'questions'), 0)   as video_questions,
  coalesce(phone.enabled, false)      as phone_enabled,
  coalesce(video.enabled, false)      as video_enabled,
  case
    when count(q.id) = 0 then 'nothing to migrate'
    when coalesce(phone.enabled, false) or coalesce(video.enabled, false)
      then 'migrated and visible'
    else 'MIGRATED BUT HIDDEN — neither interview stage is enabled'
  end                                 as status
from public.jobs j
left join public.job_interview_questions q on q.job_id = j.id
left join public.job_hiring_stages phone
  on phone.job_id = j.id and phone.stage_key = 'phone_interview'
left join public.job_hiring_stages video
  on video.job_id = j.id and video.stage_key = 'video_interview'
group by j.id, j.organization_id, j.title,
         phone.config, video.config, phone.enabled, video.enabled;

comment on view public.report_interview_question_migration is
  'Post-migration audit for 0025. Rows with status MIGRATED BUT HIDDEN need a human to enable an interview stage or accept losing the old questions from view.';
