-- =============================================================================
-- Module 3: Jobs Management
--
-- The anchor other modules attach to: Applications (5), Matching (7), Screening
-- (8), Screening Reports (9), Interviews (11), Clients (12) and Analytics (16)
-- all read these tables. Treat the column names as stable once those exist —
-- add columns rather than renaming.
--
-- Reuses Module 1's is_org_member()/has_org_role()/current_app_user_id() helpers
-- instead of re-deriving tenant or role checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums. Fixed vocabularies so Analytics can group on them reliably.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum ('draft', 'open', 'on_hold', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'work_mode') then
    create type public.work_mode as enum ('onsite', 'hybrid', 'remote');
  end if;
end $$;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- FORWARD STUB (spec, Module 3): clients are introduced by Module 12, so this
  -- is a nullable UUID with NO foreign-key constraint for now. Module 12 must
  -- add `jobs.client_id -> clients.id`, backfill/validate existing rows, and
  -- re-run this module's list/detail/filter tests.
  client_id uuid,

  title text not null check (length(btrim(title)) > 0),
  description text,

  experience_min numeric(4, 1) check (experience_min is null or experience_min >= 0),
  experience_max numeric(4, 1) check (experience_max is null or experience_max >= 0),
  -- Guards the "5-3 years" data-entry slip that would silently break Module 7's
  -- deterministic experience-range check.
  constraint jobs_experience_range_valid
    check (experience_min is null or experience_max is null or experience_min <= experience_max),

  required_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',

  location text,
  work_mode public.work_mode,

  salary_min numeric(12, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(12, 2) check (salary_max is null or salary_max >= 0),
  constraint jobs_salary_range_valid
    check (salary_min is null or salary_max is null or salary_min <= salary_max),

  status public.job_status not null default 'draft',
  owner_recruiter_id uuid references public.users (id) on delete set null,

  -- Archive marker. DELETE /api/jobs/:id archives rather than destroys, because
  -- Applications/Analytics will reference these rows.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_organization_id on public.jobs (organization_id);
create index if not exists idx_jobs_client_id on public.jobs (client_id);
create index if not exists idx_jobs_status on public.jobs (status);
create index if not exists idx_jobs_owner_recruiter_id on public.jobs (owner_recruiter_id);
create index if not exists idx_jobs_created_at on public.jobs (created_at);
create index if not exists idx_jobs_org_created_at on public.jobs (organization_id, created_at desc);
-- The default list view: this organization's non-archived jobs, newest first.
create index if not exists idx_jobs_org_status_created_at
  on public.jobs (organization_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- Question tables.
--
-- Both carry organization_id even though job_id implies it. The global spec rule
-- requires it on every table, and it lets RLS check the tenant without a join
-- back to jobs on every row.
--
-- "order" is a reserved word in SQL, so the column is display_order.
-- -----------------------------------------------------------------------------
create table if not exists public.job_screening_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  question text not null check (length(btrim(question)) > 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_screening_questions_job_id
  on public.job_screening_questions (job_id);
create index if not exists idx_job_screening_questions_organization_id
  on public.job_screening_questions (organization_id);
create index if not exists idx_job_screening_questions_job_order
  on public.job_screening_questions (job_id, display_order);

create table if not exists public.job_interview_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  question text not null check (length(btrim(question)) > 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_interview_questions_job_id
  on public.job_interview_questions (job_id);
create index if not exists idx_job_interview_questions_organization_id
  on public.job_interview_questions (organization_id);
create index if not exists idx_job_interview_questions_job_order
  on public.job_interview_questions (job_id, display_order);

-- =============================================================================
-- updated_at maintenance
--
-- Module 2's "overdue" detection and Module 16's analytics both rely on
-- updated_at being truthful, so it is maintained by the database rather than
-- trusting every caller to set it.
-- =============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_touch_updated_at on public.jobs;
create trigger trg_jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- "A Recruiter may close only their OWN jobs" (spec section 9).
--
-- This CANNOT live only in the API route: the browser holds an authenticated
-- PostgREST client, so a Recruiter could otherwise close a colleague's job with
-- a direct update. RLS alone can't express it cleanly either — the rule is about
-- a specific column TRANSITION (status -> closed), not about row access — so it
-- is a trigger.
--
-- Owners and Admins are unaffected; Recruiters may still edit any job in their
-- organization, which is what the permissions table specifies.
-- =============================================================================
create or replace function public.enforce_recruiter_closes_own_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed'
     and old.status is distinct from 'closed'
     and public.has_org_role(new.organization_id, array['recruiter']::public.org_role[])
     and not public.has_org_role(new.organization_id, array['owner', 'admin']::public.org_role[])
     and new.owner_recruiter_id is distinct from public.current_app_user_id()
  then
    raise exception 'Recruiters can only close jobs they own';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_recruiter_closes_own on public.jobs;
create trigger trg_jobs_recruiter_closes_own
  before update on public.jobs
  for each row execute function public.enforce_recruiter_closes_own_job();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.jobs enable row level security;
alter table public.job_screening_questions enable row level security;
alter table public.job_interview_questions enable row level security;

-- Viewing: every active member, including Viewer (spec: "View jobs" = Yes for
-- all four roles).
drop policy if exists jobs_select_member on public.jobs;
create policy jobs_select_member on public.jobs
  for select using (public.is_org_member(organization_id));

-- Creating/editing: Owner, Admin, Recruiter. Viewer is excluded entirely.
-- WITH CHECK also pins organization_id to a tenant the caller belongs to, so a
-- direct insert cannot plant a row in someone else's organization.
drop policy if exists jobs_insert_staff on public.jobs;
create policy jobs_insert_staff on public.jobs
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists jobs_update_staff on public.jobs;
create policy jobs_update_staff on public.jobs
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: jobs are archived, never destroyed, because Applications
-- and Analytics reference them. Hard deletion is an Owner-only concern for a
-- later compliance flow.

-- Questions inherit the job's access rules.
drop policy if exists job_screening_questions_select_member on public.job_screening_questions;
create policy job_screening_questions_select_member on public.job_screening_questions
  for select using (public.is_org_member(organization_id));

drop policy if exists job_screening_questions_write_staff on public.job_screening_questions;
create policy job_screening_questions_write_staff on public.job_screening_questions
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists job_interview_questions_select_member on public.job_interview_questions;
create policy job_interview_questions_select_member on public.job_interview_questions
  for select using (public.is_org_member(organization_id));

drop policy if exists job_interview_questions_write_staff on public.job_interview_questions;
create policy job_interview_questions_write_staff on public.job_interview_questions
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );
