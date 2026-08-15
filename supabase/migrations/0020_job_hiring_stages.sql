-- =============================================================================
-- Hiring stages per job (Module 3 extension)
--
-- Four independently toggleable stages, each with a prompt/script that can
-- reference live job and candidate data through {{placeholder}} tokens.
--
-- ONE ROW PER (job, stage), ALWAYS PRESENT ONCE TOUCHED — never deleted when a
-- stage is switched off. The spec is explicit: "When a row is OFF, its
-- previously saved prompt_template and config are preserved in the database,
-- not deleted — re-enabling restores what was there before rather than starting
-- blank." So `enabled` is a flag on a durable row, not the row's existence.
-- Deleting on disable would silently discard a script someone spent ten minutes
-- writing, and they would only discover it after re-enabling.
-- =============================================================================

create table if not exists public.job_hiring_stages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,

  stage_key text not null check (
    stage_key in (
      'ai_screening_call',
      'phone_interview',
      'video_interview',
      'written_assessment'
    )
  ),

  enabled boolean not null default false,

  -- The script, with {{job.title}} / {{candidate.name}} style tokens left
  -- unresolved. Substitution happens at RUN time, never at save time: a stored
  -- script with a candidate's name baked in would be wrong for every other
  -- candidate, and would quietly leak one candidate's details into another's
  -- call.
  prompt_template text,

  -- Stage-specific extras. jsonb rather than columns because the four stages
  -- genuinely need different things (a time limit means nothing to a phone
  -- call), and columns would be null for three stages out of four. Shape is
  -- validated in lib/hiring-stages/config.ts before it is written.
  config jsonb not null default '{}'::jsonb,

  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),

  unique (job_id, stage_key)
);

create index if not exists idx_job_hiring_stages_job
  on public.job_hiring_stages (job_id);
create index if not exists idx_job_hiring_stages_organization
  on public.job_hiring_stages (organization_id);
-- Backs "which jobs have screening switched on?", which Module 8 asks before
-- dialling and Module 13 asks when evaluating automation conditions.
create index if not exists idx_job_hiring_stages_enabled
  on public.job_hiring_stages (organization_id, stage_key)
  where enabled;

-- =============================================================================
-- Cross-tenant integrity
--
-- Same reasoning as Modules 5, 6 and the intake table: a foreign key proves the
-- job row exists, not that it belongs to this tenant. Without this a caller
-- could attach a stage to another organization's job and the FK would accept
-- it — and that stage's prompt would then run against their candidates.
-- =============================================================================
create or replace function public.enforce_job_hiring_stage_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.jobs where id = new.job_id;

  if v_org is null or v_org <> new.organization_id then
    raise exception 'Job does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_hiring_stages_tenant_integrity on public.job_hiring_stages;
create trigger trg_job_hiring_stages_tenant_integrity
  before insert or update of job_id, organization_id on public.job_hiring_stages
  for each row execute function public.enforce_job_hiring_stage_tenant_integrity();

-- updated_at maintained by the database, not by callers — same reason as
-- migration 0002's touch_updated_at(): a caller that forgets makes the column
-- lie, and several modules read it.
drop trigger if exists trg_job_hiring_stages_touch on public.job_hiring_stages;
create trigger trg_job_hiring_stages_touch
  before update on public.job_hiring_stages
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security — identical to the jobs table it hangs off.
--
-- Viewer may SELECT (the spec: "Viewer can see which stages are enabled and
-- view, not edit, their configuration") and may not write. The API checks the
-- role too, for a readable message, but this is the boundary that holds: the
-- browser holds an authenticated PostgREST client and can POST straight to
-- /rest/v1/job_hiring_stages without touching a route handler.
-- =============================================================================
alter table public.job_hiring_stages enable row level security;

drop policy if exists job_hiring_stages_select_member on public.job_hiring_stages;
create policy job_hiring_stages_select_member on public.job_hiring_stages
  for select using (public.is_org_member(organization_id));

drop policy if exists job_hiring_stages_write_staff on public.job_hiring_stages;
create policy job_hiring_stages_write_staff on public.job_hiring_stages
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );
