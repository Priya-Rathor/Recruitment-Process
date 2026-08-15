-- =============================================================================
-- Module 7: AI Matching (Candidate-to-Job)
--
-- Scores and EXPLAINS how well a specific candidate fits a specific job. The
-- score lives on the application, never on the candidate — the same person can
-- be a 91% match for one role and 43% for another.
--
-- The division of labour is the point of this module:
--   deterministic_score — salary, experience, location, notice, exact skill
--                         overlap. Computed by code. Never by the LLM.
--   semantic_score      — skill equivalence, role similarity, seniority. The
--                         only part AI contributes.
--   overall_score       — computed by CODE from the two. AI never sets it, so
--                         the number cannot contradict the checkable facts.
--
-- Read by Module 5 (application summary), 10 (pipeline prioritisation),
-- 11 (interview brief) and 16 (analytics).
-- =============================================================================

create table if not exists public.application_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  overall_score numeric(5, 2) not null
    check (overall_score >= 0 and overall_score <= 100),
  deterministic_score numeric(5, 2) not null
    check (deterministic_score >= 0 and deterministic_score <= 100),
  -- NULL when AI was unavailable: the match is still valid, just deterministic
  -- only, and the UI says so rather than implying a semantic read happened.
  semantic_score numeric(5, 2)
    check (semantic_score is null or (semantic_score >= 0 and semantic_score <= 100)),

  -- The three labelled lists the spec requires. Each entry records whether it
  -- was checked by code or assessed by AI, so a recruiter can tell a fact from
  -- a judgement.
  strong_matches jsonb not null default '[]',
  gaps jsonb not null default '[]',
  needs_verification jsonb not null default '[]',

  -- Was AI actually consulted? Distinguishes "no semantic signal" from
  -- "semantic signal said nothing".
  ai_used boolean not null default false,
  ai_error text,

  -- Recalculation control. The cost model chapter forbids recalculating on
  -- every page view; a trigger marks a match stale when the underlying data
  -- actually changes, and the app recalculates once from there.
  is_stale boolean not null default false,
  stale_reason text,

  calculated_at timestamptz not null default now(),

  -- One current match per application; recalculation replaces it.
  unique (application_id)
);

create index if not exists idx_application_matches_organization_id
  on public.application_matches (organization_id);
create index if not exists idx_application_matches_application_id
  on public.application_matches (application_id);
create index if not exists idx_application_matches_calculated_at
  on public.application_matches (calculated_at);
create index if not exists idx_application_matches_org_score
  on public.application_matches (organization_id, overall_score desc);
-- Module 10 prioritises by score; Module 16 aggregates by period.
create index if not exists idx_application_matches_org_calculated_at
  on public.application_matches (organization_id, calculated_at desc);
create index if not exists idx_application_matches_stale
  on public.application_matches (is_stale) where is_stale;

-- =============================================================================
-- Cross-tenant integrity — same reasoning as Modules 5 and 6.
-- =============================================================================
create or replace function public.enforce_match_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application_org uuid;
begin
  select organization_id into v_application_org
  from public.applications where id = new.application_id;

  if v_application_org is null or v_application_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_matches_tenant_integrity on public.application_matches;
create trigger trg_matches_tenant_integrity
  before insert or update of application_id, organization_id on public.application_matches
  for each row execute function public.enforce_match_tenant_integrity();

-- =============================================================================
-- Staleness triggers
--
-- The spec requires "match recalculation when candidate profile or job
-- requirements change", while the cost chapter forbids recalculating on every
-- page view. Marking stale here satisfies both: exactly one recalculation per
-- real change, driven by the database rather than by whoever remembers to call
-- it — including a direct PostgREST edit that never touches our API.
--
-- Only fields that actually affect the score are watched. Renaming a candidate
-- must not burn an AI call.
-- =============================================================================
create or replace function public.mark_matches_stale_for_candidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.skills is distinct from old.skills
     or new.total_experience_years is distinct from old.total_experience_years
     or new.expected_salary is distinct from old.expected_salary
     or new.notice_period_days is distinct from old.notice_period_days
     or new.location is distinct from old.location
     or new."current_role" is distinct from old."current_role"
  then
    update public.application_matches m
      set is_stale = true, stale_reason = 'Candidate profile changed'
      from public.applications a
      where m.application_id = a.id
        and a.candidate_id = new.id
        and m.is_stale = false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_candidates_mark_matches_stale on public.candidates;
create trigger trg_candidates_mark_matches_stale
  after update on public.candidates
  for each row execute function public.mark_matches_stale_for_candidate();

create or replace function public.mark_matches_stale_for_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.required_skills is distinct from old.required_skills
     or new.preferred_skills is distinct from old.preferred_skills
     or new.experience_min is distinct from old.experience_min
     or new.experience_max is distinct from old.experience_max
     or new.salary_min is distinct from old.salary_min
     or new.salary_max is distinct from old.salary_max
     or new.location is distinct from old.location
     or new.work_mode is distinct from old.work_mode
     or new.title is distinct from old.title
  then
    update public.application_matches m
      set is_stale = true, stale_reason = 'Job requirements changed'
      from public.applications a
      where m.application_id = a.id
        and a.job_id = new.id
        and m.is_stale = false;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_jobs_mark_matches_stale on public.jobs;
create trigger trg_jobs_mark_matches_stale
  after update on public.jobs
  for each row execute function public.mark_matches_stale_for_job();

-- =============================================================================
-- Keep applications.match_score in step
--
-- Module 5 stores match_score on the application so lists and the pipeline board
-- can sort without a join. It is a denormalised copy, so the database keeps it
-- accurate rather than trusting every writer to remember.
-- =============================================================================
create or replace function public.sync_application_match_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.applications set match_score = null where id = old.application_id;
    return old;
  end if;

  update public.applications set match_score = new.overall_score
    where id = new.application_id;
  return new;
end;
$$;

drop trigger if exists trg_matches_sync_application_score on public.application_matches;
create trigger trg_matches_sync_application_score
  after insert or update of overall_score or delete on public.application_matches
  for each row execute function public.sync_application_match_score();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.application_matches enable row level security;

-- "View match breakdown" is Yes for all four roles.
drop policy if exists application_matches_select_member on public.application_matches;
create policy application_matches_select_member on public.application_matches
  for select using (public.is_org_member(organization_id));

-- "Trigger manual recalculation" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists application_matches_write_staff on public.application_matches;
create policy application_matches_write_staff on public.application_matches
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );
