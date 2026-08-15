-- =============================================================================
-- Evaluation entries per application stage.
--
-- WHAT THIS TABLE IS *NOT* FOR is the important half. Three of the five
-- evaluation sections already have a home:
--
--   AI Screening Call  -> screening_calls + screening_reports (Modules 8/9)
--   Phone Interview    -> interviews where mode = 'phone'     (Module 11)
--   Video Interview    -> interviews where mode = 'video'     (Module 11)
--
-- Copying those into a second log would create a second source of truth that
-- Module 9's report screen and Module 11's scheduler never read — so a call
-- logged here would be invisible there, and vice versa. The read model in
-- lib/applications/evaluations.ts merges all sources into one shape instead.
--
-- This table exists for what genuinely has nowhere to live:
--   * Written Assessment  — no assessment engine exists anywhere in the product
--   * Director Round      — not an "interview" in Module 11's sense
--   * Phone/Video rounds conducted OUTSIDE the scheduler (a recruiter who just
--     rang someone), which otherwise could not be recorded at all
--
-- The stage_key check deliberately EXCLUDES ai_screening_call: that stage has a
-- real pipeline behind it, and a manual row would sit alongside Module 9's
-- report claiming equal authority.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'evaluation_outcome') then
    create type public.evaluation_outcome as enum ('pass', 'fail', 'pending');
  end if;
end $$;

create table if not exists public.application_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  -- Same vocabulary as application_stage and job_hiring_stages.stage_key. Not a
  -- foreign key to an enum, because this list is narrower than either.
  stage_key text not null check (
    stage_key in ('phone_interview', 'video_interview', 'written_assessment', 'director_round')
  ),

  -- When the thing being recorded HAPPENED, which is not when it was logged. A
  -- recruiter writing up Friday's call on Monday needs the list ordered by the
  -- call, not by the writing-up.
  occurred_at timestamptz not null default now(),

  -- 1-10. Module 11's interview_feedback uses 1-5 and Module 9 has no numeric
  -- score at all; the read model scales everything to 1-10 for display so one
  -- column of badges means one thing. Stored at native scale per source.
  score integer check (score is null or (score >= 1 and score <= 10)),

  outcome public.evaluation_outcome not null default 'pending',
  summary text,

  -- Audit: who wrote this and when. Feeds Module 14.
  logged_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_application_evaluations_application
  on public.application_evaluations (application_id, occurred_at desc);
create index if not exists idx_application_evaluations_organization
  on public.application_evaluations (organization_id);
-- Backs the "does this application have entries in a now-disabled stage?"
-- question that decides whether to keep a section visible read-only.
create index if not exists idx_application_evaluations_stage
  on public.application_evaluations (application_id, stage_key);

drop trigger if exists trg_application_evaluations_touch on public.application_evaluations;
create trigger trg_application_evaluations_touch
  before update on public.application_evaluations
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- A numeric score for a screening call.
--
-- Module 9 stored interest level, CTC, notice and location but never a single
-- number, so the Evaluation panel had nothing to put in a score badge. Added
-- here rather than invented in the UI, so the value is stored once and every
-- reader agrees.
--
-- Nullable with no default: a report written before this column existed has no
-- score, and defaulting it to 5 would fabricate a judgement no one made.
-- =============================================================================
alter table public.screening_reports
  add column if not exists score integer check (score is null or (score >= 1 and score <= 10));

comment on column public.screening_reports.score is
  'Recruiter or AI score for the call, 1-10. Null means never scored — not zero.';

-- =============================================================================
-- Cross-tenant integrity, same as every other child table.
-- =============================================================================
create or replace function public.enforce_evaluation_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.applications where id = new.application_id;

  if v_org is null or v_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_application_evaluations_tenant on public.application_evaluations;
create trigger trg_application_evaluations_tenant
  before insert or update of application_id, organization_id on public.application_evaluations
  for each row execute function public.enforce_evaluation_tenant_integrity();

-- =============================================================================
-- Row-Level Security.
--
-- Viewer may read every entry and write none — the spec's rule for this module.
-- Enforced here as well as in the API because the browser holds a PostgREST
-- client and can insert directly.
-- =============================================================================
alter table public.application_evaluations enable row level security;

drop policy if exists application_evaluations_select_member on public.application_evaluations;
create policy application_evaluations_select_member on public.application_evaluations
  for select using (public.is_org_member(organization_id));

drop policy if exists application_evaluations_write_staff on public.application_evaluations;
create policy application_evaluations_write_staff on public.application_evaluations
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );
