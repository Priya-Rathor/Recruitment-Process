-- =============================================================================
-- ALL MIGRATIONS, concatenated in order.
-- Generated from supabase/migrations/. Paste into the Supabase SQL Editor.
-- Every migration is re-runnable (if not exists / drop policy if exists).
-- =============================================================================


-- ############################################################################
-- ## 0001_module1_authentication_organization.sql
-- ############################################################################

-- =============================================================================
-- Module 1: Authentication & Organization
-- Foundation schema. Every later module's tables reference organizations(id)
-- and every later module's RLS/API layer reuses is_org_member()/has_org_role()
-- defined here instead of re-implementing tenant/role checks.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enum: shared Owner/Admin/Recruiter/Viewer role vocabulary. Reused by every
-- later module that needs a role-scoped check (see spec's role helper note).
-- Fully custom RBAC is explicitly out of scope for MVP, so a fixed enum is
-- appropriate here rather than an open-ended text column.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_role') then
    create type public.org_role as enum ('owner', 'admin', 'recruiter', 'viewer');
  end if;
end $$;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  industry text,
  size text,
  country text,
  timezone text not null default 'Asia/Kolkata',
  -- Onboarding AI assistant answer (Module 1 spec, section 10). Deliberately
  -- just the raw answer + a completion timestamp - the recommendations
  -- themselves are ephemeral, reviewed suggestions, not stored business data.
  onboarding_answer text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_organizations_created_at on public.organizations (created_at);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique references auth.users (id) on delete cascade,
  name text,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_auth_id on public.users (auth_id);
create index if not exists idx_users_email on public.users (email);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.org_role not null,
  status text not null default 'active' check (status in ('active', 'removed')),
  -- SET NULL, not the default NO ACTION: public.users cascades from
  -- auth.users, so deleting an inviter would otherwise hit an FK violation
  -- from the rows they invited and abort the whole user deletion.
  invited_by uuid references public.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_org_members_organization_id on public.organization_members (organization_id);
create index if not exists idx_org_members_user_id on public.organization_members (user_id);
create index if not exists idx_org_members_status on public.organization_members (status);
create index if not exists idx_org_members_org_joined_at on public.organization_members (organization_id, joined_at);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.org_role not null,
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references public.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists idx_invites_organization_id on public.invites (organization_id);
create index if not exists idx_invites_status on public.invites (status);
create index if not exists idx_invites_org_created_at on public.invites (organization_id, created_at);

-- =============================================================================
-- Helper functions — used by RLS policies here AND by every later module's
-- RLS/API layer. Do not rename/remove once other modules depend on them.
--
-- SECURITY DEFINER + a pinned search_path lets these run inside another
-- table's RLS policy without recursing back through organization_members'
-- own RLS (which would otherwise deadlock the policy check).
-- =============================================================================

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_id = auth.uid();
$$;

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = public.current_app_user_id()
      and status = 'active'
  );
$$;

create or replace function public.has_org_role(p_organization_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = public.current_app_user_id()
      and status = 'active'
      and role = any(p_roles)
  );
$$;

revoke all on function public.current_app_user_id() from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- =============================================================================
-- auth.users -> public.users sync
-- =============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Phone-only auth identities have no email. Skip rather than raise, so a
  -- NOT NULL violation here can never break sign-up; create_organization_and_owner
  -- and accept_invite both upsert the profile row defensively anyway.
  if new.email is null then
    return new;
  end if;

  insert into public.users (auth_id, name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (auth_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =============================================================================
-- RPCs — the ONLY way client code creates an organization or accepts an
-- invite. Both write to organization_members, which has no client-facing
-- INSERT policy (see RLS below), so this is not just a convenience wrapper —
-- it is the enforcement point for "sign-up creates exactly one organization
-- and one Owner" and "invited users cannot join without a valid token".
-- =============================================================================

create or replace function public.create_organization_and_owner(
  p_name text,
  p_industry text default null,
  p_size text default null,
  p_country text default null,
  p_timezone text default 'Asia/Kolkata'
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Defensive upsert in case the auth.users trigger has not fired yet
  -- (e.g. immediately after signUp with email confirmation disabled).
  insert into public.users (auth_id, name, email)
  select auth.uid(), split_part(au.email, '@', 1), au.email
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();

  insert into public.organizations (name, industry, size, country, timezone)
  values (btrim(p_name), p_industry, p_size, p_country, coalesce(p_timezone, 'Asia/Kolkata'))
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_org.id, v_user_id, 'owner', 'active', now());

  return v_org;
end;
$$;

create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.users (auth_id, name, email)
  select auth.uid(), split_part(au.email, '@', 1), au.email
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();

  select * into v_invite
  from public.invites
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_invite.id is null then
    raise exception 'Invalid or expired invite';
  end if;

  insert into public.organization_members (organization_id, user_id, role, status, invited_by, joined_at)
  values (v_invite.organization_id, v_user_id, v_invite.role, 'active', v_invite.invited_by, now())
  on conflict (organization_id, user_id)
    do update set role = excluded.role, status = 'active';

  update public.invites set status = 'accepted' where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

revoke all on function public.create_organization_and_owner(text, text, text, text, text) from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.create_organization_and_owner(text, text, text, text, text) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;

-- =============================================================================
-- Invariant: an organization always has at least one active Owner.
--
-- Enforced in the database, for two reasons the API layer cannot cover:
--   1. Direct PostgREST writes bypass the route handlers entirely.
--   2. The API's count-then-write is a TOCTOU race — with two Owners, two
--      concurrent requests can each see "2 Owners, safe to proceed" and both
--      commit, leaving zero. The row lock below serializes those writes.
-- =============================================================================

create or replace function public.enforce_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_owners integer;
begin
  -- When the organization itself is being deleted, its members cascade away
  -- with it and there is nothing left to protect. Without this guard, deleting
  -- an organization would fail on its own cascade.
  if not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;

  -- Serializes concurrent membership changes for this organization so the
  -- count below cannot miss another transaction's in-flight demotion.
  perform 1 from public.organizations where id = v_org for update;

  select count(*) into v_owners
  from public.organization_members
  where organization_id = v_org
    and role = 'owner'
    and status = 'active';

  if v_owners = 0 then
    raise exception
      'An organization must always have at least one active Owner. Promote another member to Owner first.';
  end if;

  return null;
end;
$$;

-- Note: this also blocks deleting an auth user who is their organization's sole
-- Owner (the cascade would orphan the workspace). Transfer ownership first —
-- relevant to the Privacy & Compliance chapter's erasure flow.
drop trigger if exists trg_owner_remains on public.organization_members;
create constraint trigger trg_owner_remains
  after update or delete on public.organization_members
  deferrable initially immediate
  for each row execute function public.enforce_owner_remains();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.organization_members enable row level security;
alter table public.invites enable row level security;

-- organizations: readable/editable only by active members of that org.
-- No client-facing INSERT policy — creation only via create_organization_and_owner().
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists organizations_update_owner_admin on public.organizations;
create policy organizations_update_owner_admin on public.organizations
  for update
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- users: a user can always read their own row, plus the profile rows of
-- anyone who shares at least one organization with them (needed to render
-- team member lists/names). No client-facing INSERT policy — the auth
-- trigger (SECURITY DEFINER, table-owner privileges) handles creation.
drop policy if exists users_select_self_or_org_peer on public.users;
create policy users_select_self_or_org_peer on public.users
  for select using (
    auth_id = auth.uid()
    or id in (
      select om2.user_id
      from public.organization_members om1
      join public.organization_members om2 on om2.organization_id = om1.organization_id
      where om1.user_id = public.current_app_user_id()
        and om1.status = 'active'
        and om2.status = 'active'
    )
  );

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update using (auth_id = auth.uid()) with check (auth_id = auth.uid());

-- organization_members: visible to any active member of the same org;
-- mutable only by Owner/Admin. No client-facing INSERT policy — membership
-- rows are only ever created by create_organization_and_owner()/accept_invite().
drop policy if exists org_members_select_member on public.organization_members;
create policy org_members_select_member on public.organization_members
  for select using (public.is_org_member(organization_id));

-- Role transitions are constrained HERE, not only in the API layer. The
-- browser holds an authenticated PostgREST client (see lib/supabase/client.ts),
-- so a signed-in Admin can issue writes directly against this table and skip
-- the route handlers entirely. Without the extra clauses below, an Admin could
-- run `update organization_members set role='owner' where id=<own row>` and
-- self-promote.
--
--   USING      sees the row as it is now  -> who may be TARGETED
--   WITH CHECK sees the row after change  -> what it may BECOME
--
-- Both restrict Owner to Owner-callers, so an Admin can neither touch an
-- existing Owner's row nor mint a new one.
drop policy if exists org_members_update_owner_admin on public.organization_members;
create policy org_members_update_owner_admin on public.organization_members
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  );

drop policy if exists org_members_delete_owner_admin on public.organization_members;
create policy org_members_delete_owner_admin on public.organization_members
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  );

-- invites: contain candidate/teammate PII (email) — Owner/Admin only, full
-- stop. Acceptance bypasses this entirely via accept_invite(token), which is
-- deliberate: the token itself is the credential, the same pattern as a
-- password-reset link.
drop policy if exists invites_select_owner_admin on public.invites;
create policy invites_select_owner_admin on public.invites
  for select using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Same escalation vector as organization_members: an Admin writing directly to
-- PostgREST could otherwise insert an Owner invite for their own address, or
-- rewrite an existing pending invite's role to 'owner' before it is accepted —
-- and accept_invite() upserts `role = excluded.role`, so that promotes the
-- accepting user for real. Only an Owner may create or touch an Owner invite.
drop policy if exists invites_insert_owner_admin on public.invites;
create policy invites_insert_owner_admin on public.invites
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  );

drop policy if exists invites_update_owner_admin on public.invites;
create policy invites_update_owner_admin on public.invites
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and (role <> 'owner' or public.has_org_role(organization_id, array['owner']::public.org_role[]))
  );


-- ############################################################################
-- ## 0002_module3_jobs_management.sql
-- ############################################################################

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


-- ############################################################################
-- ## 0003_module4_candidates_management.sql
-- ############################################################################

-- =============================================================================
-- Module 4: Candidates Management
--
-- The single source of truth for candidate identity, regardless of how the
-- candidate entered the system. Read by Applications (5), Resume AI (6, which
-- writes confirmed fields back here), Matching (7), Screening (8), Screening
-- Reports (9) and Clients (12). Treat these column names as stable.
--
-- Reuses Module 1's is_org_member()/has_org_role() helpers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Intake sources, from the spec's feature list. A fixed vocabulary so Analytics
-- (Module 16) can group "source performance" reliably.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'candidate_source') then
    create type public.candidate_source as enum (
      'career_page',
      'resume_upload',
      'email',
      'referral',
      'job_board',
      'agency_database',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'duplicate_status') then
    create type public.duplicate_status as enum ('open', 'confirmed', 'dismissed');
  end if;
end $$;

-- =============================================================================
-- candidates
-- =============================================================================
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),
  email text,
  phone text,

  -- Normalised forms, maintained by a trigger below. Dedup matches on THESE,
  -- never on the raw values: "Rahul@Example.COM " and "rahul@example.com" are
  -- the same person, and an index on a normalised column keeps the lookup fast
  -- at scale (a per-row function call would force a sequential scan).
  email_normalized text,
  phone_normalized text,

  location text,
  current_company text,
  /**
   * QUOTED because `current_role` is a RESERVED WORD in PostgreSQL — it is the
   * SQL-standard CURRENT_ROLE function. Unquoted, `current_role text` is a
   * syntax error at parse time.
   *
   * Quoting at DDL time only tells the parser this is an identifier; the column
   * is still plainly named current_role, and PostgREST (and therefore every
   * TypeScript caller) refers to it without quotes as normal. The only places
   * that must quote it are raw SQL like this file and the trigger in 0006.
   */
  "current_role" text,
  total_experience_years numeric(4, 1)
    check (total_experience_years is null or (total_experience_years >= 0 and total_experience_years <= 60)),
  skills text[] not null default '{}',
  expected_salary numeric(12, 2) check (expected_salary is null or expected_salary >= 0),
  notice_period_days integer
    check (notice_period_days is null or (notice_period_days >= 0 and notice_period_days <= 365)),

  source public.candidate_source not null default 'manual',
  resume_url text,

  -- Archive marker: candidates are archived, never destroyed, because
  -- Applications (5) and Analytics (16) reference them. True erasure is the
  -- Privacy & Compliance retrofit's job, and is a different operation.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- At least one way to reach the person, or the record is not actionable.
  constraint candidates_contactable
    check (email is not null or phone is not null)
);

create index if not exists idx_candidates_organization_id on public.candidates (organization_id);
create index if not exists idx_candidates_created_at on public.candidates (created_at);
create index if not exists idx_candidates_org_created_at
  on public.candidates (organization_id, created_at desc);
create index if not exists idx_candidates_source on public.candidates (source);

-- Dedup lookups: scoped per tenant, so the same person may legitimately exist
-- in two different organizations.
create index if not exists idx_candidates_org_email_normalized
  on public.candidates (organization_id, email_normalized)
  where email_normalized is not null;
create index if not exists idx_candidates_org_phone_normalized
  on public.candidates (organization_id, phone_normalized)
  where phone_normalized is not null;

-- Skill filtering (Module 7 will lean on this too).
create index if not exists idx_candidates_skills on public.candidates using gin (skills);

-- =============================================================================
-- candidate_duplicates
--
-- Records a SUSPECTED duplicate for a human to confirm or dismiss. Deliberately
-- not auto-merging: merging two people's histories wrongly is far worse than
-- carrying a duplicate for a day.
-- =============================================================================
create table if not exists public.candidate_duplicates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  candidate_id uuid not null references public.candidates (id) on delete cascade,
  duplicate_of_id uuid not null references public.candidates (id) on delete cascade,

  -- What actually collided: 'email', 'phone', or 'email,phone'.
  matched_on text not null,
  status public.duplicate_status not null default 'open',

  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),

  -- A record cannot be its own duplicate.
  constraint candidate_duplicates_distinct check (candidate_id <> duplicate_of_id),
  -- One open pairing per direction; re-running the check must not pile up rows.
  unique (candidate_id, duplicate_of_id)
);

create index if not exists idx_candidate_duplicates_organization_id
  on public.candidate_duplicates (organization_id);
create index if not exists idx_candidate_duplicates_candidate_id
  on public.candidate_duplicates (candidate_id);
create index if not exists idx_candidate_duplicates_duplicate_of_id
  on public.candidate_duplicates (duplicate_of_id);
create index if not exists idx_candidate_duplicates_status
  on public.candidate_duplicates (status);
create index if not exists idx_candidate_duplicates_org_created_at
  on public.candidate_duplicates (organization_id, created_at desc);

-- =============================================================================
-- Normalisation trigger
--
-- Kept in the database rather than the API so that a direct PostgREST write
-- (or a later module's insert) can never bypass it and create a record that
-- silently escapes duplicate detection.
--
-- Must match lib/candidates/dedupe.ts exactly — that file has the unit tests
-- and the reasoning; this is the enforcement.
-- =============================================================================
create or replace function public.normalize_candidate_contact()
returns trigger
language plpgsql
as $$
declare
  v_digits text;
begin
  new.email_normalized :=
    case
      when new.email is null or btrim(new.email) = '' then null
      else lower(btrim(new.email))
    end;

  if new.phone is null or btrim(new.phone) = '' then
    new.phone_normalized := null;
  else
    -- Keep digits only, then compare on the last 10 — enough to make
    -- "+91 98765 43210", "098765 43210" and "9876543210" the same person
    -- without needing a full libphonenumber dependency.
    v_digits := regexp_replace(new.phone, '[^0-9]', '', 'g');
    if length(v_digits) >= 10 then
      new.phone_normalized := right(v_digits, 10);
    elsif length(v_digits) = 0 then
      new.phone_normalized := null;
    else
      new.phone_normalized := v_digits;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_candidates_normalize_contact on public.candidates;
create trigger trg_candidates_normalize_contact
  before insert or update of email, phone on public.candidates
  for each row execute function public.normalize_candidate_contact();

-- updated_at maintenance (touch_updated_at() was created by Module 3).
drop trigger if exists trg_candidates_touch_updated_at on public.candidates;
create trigger trg_candidates_touch_updated_at
  before update on public.candidates
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.candidates enable row level security;
alter table public.candidate_duplicates enable row level security;

-- "View all candidates" is Yes for every role including Viewer.
drop policy if exists candidates_select_member on public.candidates;
create policy candidates_select_member on public.candidates
  for select using (public.is_org_member(organization_id));

-- "Create/edit candidate" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists candidates_insert_staff on public.candidates;
create policy candidates_insert_staff on public.candidates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists candidates_update_staff on public.candidates;
create policy candidates_update_staff on public.candidates
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: archive instead. Hard erasure belongs to the Privacy &
-- Compliance retrofit, which must also clear resumes, screening calls and notes
-- in one audited operation — not a stray DELETE from the browser.

drop policy if exists candidate_duplicates_select_member on public.candidate_duplicates;
create policy candidate_duplicates_select_member on public.candidate_duplicates
  for select using (public.is_org_member(organization_id));

drop policy if exists candidate_duplicates_write_staff on public.candidate_duplicates;
create policy candidate_duplicates_write_staff on public.candidate_duplicates
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );


-- ############################################################################
-- ## 0004_module5_applications_management.sql
-- ############################################################################

-- =============================================================================
-- Module 5: Applications Management
--
-- An Application is the join between a Candidate and a Job. Match scores,
-- screening results, interview history and client status all belong HERE, not
-- globally to the candidate — the same person can be a 91% match for one role
-- and 43% for another.
--
-- This is the central table: Modules 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 and 16
-- all read or write it. Per the spec, treat this schema as effectively frozen
-- once those exist — ADD columns, never rename or remove.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pipeline stages.
--
-- The first eight are Module 10's board, in order:
--   New -> Screening -> Recruiter Review -> Shortlisted -> Client Review ->
--   Interview -> Offer -> Hired
--
-- 'rejected' and 'withdrawn' are ADDITIONS not named in the spec's board. They
-- are necessary rather than speculative: without a terminal negative state every
-- unsuccessful application sits in an intermediate stage forever, which would
-- make Module 2's overdue queue flag it permanently and make Module 16's
-- conversion rates meaningless. Module 10 must render these as exits from the
-- board, not as columns.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_stage') then
    create type public.application_stage as enum (
      'new',
      'screening',
      'recruiter_review',
      'shortlisted',
      'client_review',
      'interview',
      'offer',
      'hired',
      'rejected',
      'withdrawn'
    );
  end if;
end $$;

-- =============================================================================
-- applications
-- =============================================================================
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,

  stage public.application_stage not null default 'new',

  -- Percentage, per application. Module 7 writes it; nullable until then.
  match_score numeric(5, 2) check (match_score is null or (match_score >= 0 and match_score <= 100)),

  assigned_recruiter_id uuid references public.users (id) on delete set null,

  -- How this candidate came to THIS job. Distinct from candidates.source, which
  -- records how the person entered the system at all.
  source public.candidate_source not null default 'manual',

  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One application per candidate per job. Without this, a double submission
  -- creates two pipelines for one person and Module 16's funnel counts them
  -- twice.
  unique (candidate_id, job_id)
);

create index if not exists idx_applications_organization_id on public.applications (organization_id);
create index if not exists idx_applications_candidate_id on public.applications (candidate_id);
create index if not exists idx_applications_job_id on public.applications (job_id);
create index if not exists idx_applications_stage on public.applications (stage);
create index if not exists idx_applications_assigned_recruiter_id
  on public.applications (assigned_recruiter_id);
create index if not exists idx_applications_created_at on public.applications (created_at);
create index if not exists idx_applications_org_created_at
  on public.applications (organization_id, created_at desc);
-- Module 2's overdue query and Module 10's board both read this shape.
create index if not exists idx_applications_org_stage_updated_at
  on public.applications (organization_id, stage, updated_at);
create index if not exists idx_applications_org_recruiter_updated_at
  on public.applications (organization_id, assigned_recruiter_id, updated_at);

-- =============================================================================
-- application_stage_history
--
-- Written ONLY by trigger (see below). There is deliberately no INSERT/UPDATE
-- policy for clients: an auditable history that application code is trusted to
-- maintain is not auditable at all.
-- =============================================================================
create table if not exists public.application_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  stage public.application_stage not null,
  entered_at timestamptz not null default now(),
  -- NULL means "currently in this stage". Exactly one open row per application.
  exited_at timestamptz,

  changed_by uuid references public.users (id) on delete set null,

  constraint stage_history_exit_after_entry
    check (exited_at is null or exited_at >= entered_at)
);

create index if not exists idx_stage_history_application_id
  on public.application_stage_history (application_id);
create index if not exists idx_stage_history_organization_id
  on public.application_stage_history (organization_id);
create index if not exists idx_stage_history_stage on public.application_stage_history (stage);
create index if not exists idx_stage_history_app_entered_at
  on public.application_stage_history (application_id, entered_at desc);
-- Module 16 computes time-in-stage from closed rows.
create index if not exists idx_stage_history_org_entered_at
  on public.application_stage_history (organization_id, entered_at desc);

-- At most one open (unexited) row per application — the invariant every
-- time-in-stage calculation depends on.
create unique index if not exists idx_stage_history_one_open_per_application
  on public.application_stage_history (application_id)
  where exited_at is null;

-- =============================================================================
-- application_notes
-- =============================================================================
create table if not exists public.application_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid references public.users (id) on delete set null,
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_application_notes_application_id
  on public.application_notes (application_id);
create index if not exists idx_application_notes_author_id
  on public.application_notes (author_id);
create index if not exists idx_application_notes_organization_id
  on public.application_notes (organization_id);
create index if not exists idx_application_notes_org_created_at
  on public.application_notes (organization_id, created_at desc);

-- =============================================================================
-- Cross-tenant integrity
--
-- Foreign keys alone do NOT prevent an application in org A pointing at a
-- candidate or job in org B: the FK only checks the row exists. RLS stops the
-- caller READING the other org's rows, but an insert quoting a known id would
-- still succeed and create a cross-tenant link. Checked explicitly.
-- =============================================================================
create or replace function public.enforce_application_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_org uuid;
  v_job_org uuid;
begin
  select organization_id into v_candidate_org from public.candidates where id = new.candidate_id;
  select organization_id into v_job_org from public.jobs where id = new.job_id;

  if v_candidate_org is null or v_candidate_org <> new.organization_id then
    raise exception 'Candidate does not belong to this organization';
  end if;

  if v_job_org is null or v_job_org <> new.organization_id then
    raise exception 'Job does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_applications_tenant_integrity on public.applications;
create trigger trg_applications_tenant_integrity
  before insert or update of candidate_id, job_id, organization_id on public.applications
  for each row execute function public.enforce_application_tenant_integrity();

-- =============================================================================
-- Stage history maintenance
--
-- In a TRIGGER, not the API. The spec's test is "stage history correctly records
-- entered_at/exited_at for every transition", and the browser holds an
-- authenticated PostgREST client — so a stage update issued directly would
-- bypass any route handler and silently lose a transition. Module 10's board
-- and Module 16's time-in-stage analytics both depend on this being complete.
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

drop trigger if exists trg_applications_stage_history on public.applications;
create trigger trg_applications_stage_history
  after insert or update of stage on public.applications
  for each row execute function public.record_application_stage_change();

-- updated_at maintenance (touch_updated_at() created by Module 3). Module 2's
-- overdue detection reads updated_at, so it must be truthful.
drop trigger if exists trg_applications_touch_updated_at on public.applications;
create trigger trg_applications_touch_updated_at
  before update on public.applications
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.applications enable row level security;
alter table public.application_stage_history enable row level security;
alter table public.application_notes enable row level security;

-- Viewing: every active member, including Viewer. Recruiter narrowing to
-- "own/assigned" is applied in the query layer rather than RLS — a Recruiter
-- legitimately needs to see unassigned applications in order to pick them up,
-- so a hard RLS filter would break the workflow.
drop policy if exists applications_select_member on public.applications;
create policy applications_select_member on public.applications
  for select using (public.is_org_member(organization_id));

drop policy if exists applications_insert_staff on public.applications;
create policy applications_insert_staff on public.applications
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists applications_update_staff on public.applications;
create policy applications_update_staff on public.applications
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: applications are archived, never destroyed.

-- Stage history is READ-ONLY to clients. No insert/update/delete policy exists,
-- so the only writer is the SECURITY DEFINER trigger above.
drop policy if exists stage_history_select_member on public.application_stage_history;
create policy stage_history_select_member on public.application_stage_history
  for select using (public.is_org_member(organization_id));

-- Notes: any member may read; staff may write. A note may only be edited or
-- deleted by its author (an Admin rewriting someone else's note would corrupt
-- the record Module 14 audits).
drop policy if exists application_notes_select_member on public.application_notes;
create policy application_notes_select_member on public.application_notes
  for select using (public.is_org_member(organization_id));

drop policy if exists application_notes_insert_staff on public.application_notes;
create policy application_notes_insert_staff on public.application_notes
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
    and author_id = public.current_app_user_id()
  );

drop policy if exists application_notes_update_author on public.application_notes;
create policy application_notes_update_author on public.application_notes
  for update
  using (author_id = public.current_app_user_id())
  with check (author_id = public.current_app_user_id());

drop policy if exists application_notes_delete_author on public.application_notes;
create policy application_notes_delete_author on public.application_notes
  for delete using (author_id = public.current_app_user_id());


-- ############################################################################
-- ## 0005_module6_resume_ai.sql
-- ############################################################################

-- =============================================================================
-- Module 6: Resume AI (Parsing)
--
-- The first full AI pipeline: upload -> extract text -> AI parses -> schema
-- validation -> recruiter review -> confirmed values update the candidate.
--
-- The critical rule, stated most strongly here in the spec: AI does NOT directly
-- overwrite trusted candidate data. It proposes differences; the recruiter
-- chooses. Nothing in this schema lets parsed output reach public.candidates
-- without passing through a review the application performs explicitly.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resume_parse_status') then
    create type public.resume_parse_status as enum (
      'pending',      -- uploaded, not yet parsed
      'extracting',   -- pulling text out of the file
      'parsing',      -- AI is running
      'parsed',       -- structured output available for review
      'reviewed',     -- a recruiter has applied their choices
      'failed'        -- extraction or parsing failed; see parse_error
    );
  end if;
end $$;

-- =============================================================================
-- resumes
-- =============================================================================
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,

  -- Storage object path within the private 'resumes' bucket.
  file_url text not null,
  file_name text not null,
  file_type text,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),

  -- SHA-256 of the file. The AI & Calling Cost Model chapter requires: "Do not
  -- re-run resume parsing if the resume file hash is unchanged since the last
  -- successful parse." Stored now so that guard is a lookup, not a re-upload.
  file_hash text,

  parse_status public.resume_parse_status not null default 'pending',
  parse_error text,

  -- How much text extraction actually recovered. A scanned image PDF yields
  -- almost nothing, and the UI must say so rather than blaming the AI.
  extracted_characters integer,

  uploaded_by uuid references public.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  parsed_at timestamptz
);

create index if not exists idx_resumes_organization_id on public.resumes (organization_id);
create index if not exists idx_resumes_candidate_id on public.resumes (candidate_id);
create index if not exists idx_resumes_parse_status on public.resumes (parse_status);
create index if not exists idx_resumes_org_uploaded_at
  on public.resumes (organization_id, uploaded_at desc);
-- Backs the "same file, don't re-parse" check.
create index if not exists idx_resumes_candidate_file_hash
  on public.resumes (candidate_id, file_hash)
  where file_hash is not null;

-- =============================================================================
-- resume_parse_results
--
-- The AI's proposal, held separately from public.candidates. This separation IS
-- the safety property: parsed values live here until a recruiter confirms them,
-- so there is no code path where a model's output silently becomes candidate
-- data.
-- =============================================================================
create table if not exists public.resume_parse_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,

  -- Validated structured output. Schema-checked in lib/ai/parseResume.ts before
  -- it is ever written here.
  raw_json jsonb not null,

  -- Model's own confidence, 0-1, when supplied. Advisory only — it never gates
  -- anything on its own.
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Which fields the recruiter actually applied, recorded for audit so a later
  -- question ("who changed the expected salary?") has an answer.
  applied_fields text[] not null default '{}',

  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),

  -- One result per resume; re-parsing replaces it.
  unique (resume_id)
);

create index if not exists idx_resume_parse_results_resume_id
  on public.resume_parse_results (resume_id);
create index if not exists idx_resume_parse_results_organization_id
  on public.resume_parse_results (organization_id);
create index if not exists idx_resume_parse_results_reviewed_at
  on public.resume_parse_results (reviewed_at);

-- =============================================================================
-- Cross-tenant integrity
--
-- Same reasoning as Module 5: a foreign key only proves the row exists, not that
-- it belongs to this tenant.
-- =============================================================================
create or replace function public.enforce_resume_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_org uuid;
begin
  select organization_id into v_candidate_org
  from public.candidates where id = new.candidate_id;

  if v_candidate_org is null or v_candidate_org <> new.organization_id then
    raise exception 'Candidate does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resumes_tenant_integrity on public.resumes;
create trigger trg_resumes_tenant_integrity
  before insert or update of candidate_id, organization_id on public.resumes
  for each row execute function public.enforce_resume_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.resumes enable row level security;
alter table public.resume_parse_results enable row level security;

-- Viewing: any active member (Viewer included — they may read candidate data).
drop policy if exists resumes_select_member on public.resumes;
create policy resumes_select_member on public.resumes
  for select using (public.is_org_member(organization_id));

-- "Upload/parse resume" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists resumes_insert_staff on public.resumes;
create policy resumes_insert_staff on public.resumes
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists resumes_update_staff on public.resumes;
create policy resumes_update_staff on public.resumes
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists resumes_delete_owner_admin on public.resumes;
create policy resumes_delete_owner_admin on public.resumes
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists resume_parse_results_select_member on public.resume_parse_results;
create policy resume_parse_results_select_member on public.resume_parse_results
  for select using (public.is_org_member(organization_id));

-- "Review/confirm AI-parsed fields" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists resume_parse_results_write_staff on public.resume_parse_results;
create policy resume_parse_results_write_staff on public.resume_parse_results
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- Storage
--
-- Private bucket. Resumes are personal data: they must never be world-readable
-- by URL, so the bucket stays private and the app issues short-lived signed URLs
-- after checking tenancy.
--
-- Object paths are `<organization_id>/<candidate_id>/<uuid>-<filename>`, and the
-- policies below authorise on the FIRST path segment — so a member of org A can
-- neither read nor write anything under org B's folder.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists resumes_storage_select on storage.objects;
create policy resumes_storage_select on storage.objects
  for select using (
    bucket_id = 'resumes'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists resumes_storage_insert on storage.objects;
create policy resumes_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'resumes'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin', 'recruiter']::public.org_role[]
    )
  );

drop policy if exists resumes_storage_delete on storage.objects;
create policy resumes_storage_delete on storage.objects
  for delete using (
    bucket_id = 'resumes'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.org_role[]
    )
  );


-- ############################################################################
-- ## 0006_module7_ai_matching.sql
-- ############################################################################

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


-- ############################################################################
-- ## 0007_module8_bolna_screening.sql
-- ############################################################################

-- =============================================================================
-- Module 8: Bolna AI Screening (Calling)
--
-- This module places REAL PHONE CALLS to real people and RECORDS them. Two
-- consequences shape the schema:
--
--   1. Consent. The Privacy & Compliance chapter assigns this module
--      "verbal consent at the start of every AI screening call" and warns that
--      "call recording without consent is illegal in many jurisdictions,
--      independent of any data-protection law". That chapter is staged as a
--      later retrofit, but consent_confirmed is included HERE rather than
--      deferred: every call placed before the retrofit would otherwise record
--      someone with no disclosure. See docs/modules/08-screening-notes.md.
--
--   2. Nothing may dial by accident. Credentials live in a separate table that
--      defaults to disconnected, and the adapter refuses to place a call unless
--      it is explicitly configured.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'screening_call_status') then
    create type public.screening_call_status as enum (
      'queued',             -- created, not yet dialled
      'dialing',            -- provider has accepted it
      'answered',           -- picked up, conversation under way
      'completed',          -- finished with a usable transcript
      'no_answer',          -- rang out
      'busy',
      'callback_requested', -- candidate asked to be called another time
      'failed',             -- provider or network failure
      'cancelled'           -- a human stopped it
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'integration_status') then
    create type public.integration_status as enum (
      'disconnected',
      'connected',
      'needs_attention',
      'error'
    );
  end if;
end $$;

-- =============================================================================
-- organization_integrations
--
-- FORWARD STUB (spec, Module 8): "have placeCall() read credentials from a
-- minimal organization_integrations table ... even before Module 17 builds the
-- full settings UI around that same table."
--
-- Module 17 must EXTEND this table (masked display, test-connection flow,
-- last_tested_at/last_success_at, error_code/error_message) rather than create
-- a second one, and must not change placeCall()'s external interface.
-- =============================================================================
create table if not exists public.organization_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  provider text not null check (provider in ('bolna', 'calendar', 'email', 'llm', 'n8n')),
  status public.integration_status not null default 'disconnected',

  -- AES-GCM ciphertext produced by lib/integrations/crypto.ts. Never plaintext.
  encrypted_credentials text,
  -- Non-secret configuration (retry policy, caller id, language, ...).
  settings jsonb not null default '{}',

  -- Shown to the user instead of the secret itself, e.g. "********4F8A".
  credential_hint text,

  last_tested_at timestamptz,
  last_success_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, provider)
);

create index if not exists idx_organization_integrations_organization_id
  on public.organization_integrations (organization_id);
create index if not exists idx_organization_integrations_provider
  on public.organization_integrations (provider);
create index if not exists idx_organization_integrations_org_created_at
  on public.organization_integrations (organization_id, created_at desc);

drop trigger if exists trg_organization_integrations_touch on public.organization_integrations;
create trigger trg_organization_integrations_touch
  before update on public.organization_integrations
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- screening_calls
--
-- One row per ATTEMPT. attempt_number counts within an application, so the retry
-- policy and Module 16's analytics can both reason about "how many times did we
-- try this person" without a separate table.
-- =============================================================================
create table if not exists public.screening_calls (
  id uuid primary key default gen_random_uuid(),
  -- Present despite the spec's column list omitting it: the global rule
  -- requires organization_id on every table, and Module 2's dashboard filters
  -- this table directly by it.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  provider text not null default 'bolna' check (provider in ('bolna')),
  status public.screening_call_status not null default 'queued',

  attempt_number integer not null default 1 check (attempt_number >= 1),

  -- Provider's own identifier, for reconciling webhooks.
  provider_call_id text,

  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),

  recording_url text,
  transcript text,
  language text not null default 'en',

  -- CONSENT (Privacy & Compliance chapter, pulled forward — see header).
  -- The opening line states the call is automated and may be recorded; the
  -- candidate continuing is treated as consent. Module 9 must refuse to treat a
  -- transcript as usable unless consent_confirmed is true.
  consent_confirmed boolean not null default false,
  consent_confirmed_at timestamptz,

  failure_reason text,
  triggered_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint screening_calls_end_after_start
    check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists idx_screening_calls_organization_id
  on public.screening_calls (organization_id);
create index if not exists idx_screening_calls_application_id
  on public.screening_calls (application_id);
create index if not exists idx_screening_calls_status on public.screening_calls (status);
create index if not exists idx_screening_calls_org_created_at
  on public.screening_calls (organization_id, created_at desc);
-- Module 2's dashboard counts completed calls by ended_at, and failures too.
create index if not exists idx_screening_calls_org_status_ended_at
  on public.screening_calls (organization_id, status, ended_at desc);
-- Webhook reconciliation.
create unique index if not exists idx_screening_calls_provider_call_id
  on public.screening_calls (provider, provider_call_id)
  where provider_call_id is not null;

drop trigger if exists trg_screening_calls_touch on public.screening_calls;
create trigger trg_screening_calls_touch
  before update on public.screening_calls
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity — a foreign key proves the row exists, not that it is
-- ours. Same pattern as Modules 5, 6 and 7.
-- =============================================================================
create or replace function public.enforce_screening_call_tenant_integrity()
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

drop trigger if exists trg_screening_calls_tenant_integrity on public.screening_calls;
create trigger trg_screening_calls_tenant_integrity
  before insert or update of application_id, organization_id on public.screening_calls
  for each row execute function public.enforce_screening_call_tenant_integrity();

-- =============================================================================
-- Consent timestamp is set by the database, not by whoever writes the row.
-- =============================================================================
create or replace function public.stamp_screening_consent()
returns trigger
language plpgsql
as $$
begin
  if new.consent_confirmed and new.consent_confirmed_at is null then
    new.consent_confirmed_at := now();
  end if;
  -- Consent cannot be un-given retroactively to hide that it was recorded.
  if tg_op = 'UPDATE' and old.consent_confirmed and not new.consent_confirmed then
    raise exception 'Recorded consent cannot be withdrawn by editing the call record';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_screening_calls_consent on public.screening_calls;
create trigger trg_screening_calls_consent
  before insert or update on public.screening_calls
  for each row execute function public.stamp_screening_consent();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.organization_integrations enable row level security;
alter table public.screening_calls enable row level security;

-- Integrations are Owner/Admin only — they hold credentials.
-- "Configure call scripts | Owner Yes | Admin Yes | Recruiter No | Viewer No".
drop policy if exists organization_integrations_select_owner_admin
  on public.organization_integrations;
create policy organization_integrations_select_owner_admin on public.organization_integrations
  for select using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists organization_integrations_write_owner_admin
  on public.organization_integrations;
create policy organization_integrations_write_owner_admin on public.organization_integrations
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- COLUMN-level revoke: even an Owner's browser session must never be able to
-- read the ciphertext. Row-level security cannot express this; column grants
-- can. Server-side code reads it through the service-role client only.
revoke select (encrypted_credentials) on public.organization_integrations from authenticated;
revoke select (encrypted_credentials) on public.organization_integrations from anon;

-- Screening calls: viewable by every role including Viewer ("Trigger/view
-- screening calls | Viewer: Yes (read-only)").
drop policy if exists screening_calls_select_member on public.screening_calls;
create policy screening_calls_select_member on public.screening_calls
  for select using (public.is_org_member(organization_id));

-- Triggering a call is Owner/Admin/Recruiter. Viewer denied: a read-only user
-- must not be able to make the product telephone a member of the public.
drop policy if exists screening_calls_insert_staff on public.screening_calls;
create policy screening_calls_insert_staff on public.screening_calls
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists screening_calls_update_staff on public.screening_calls;
create policy screening_calls_update_staff on public.screening_calls
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: a call record is evidence of what was said to a candidate
-- and of the consent given. Erasure belongs to the Privacy retrofit's audited
-- flow, not to a stray delete.


-- ############################################################################
-- ## 0008_module9_screening_reports.sql
-- ############################################################################

-- =============================================================================
-- Module 9: AI Screening Report (Summarization)
--
-- Turns an 8-minute Bolna conversation into a 60-second structured report.
--
-- Two properties are enforced by the schema rather than by convention:
--
--   1. "Recruiter corrections persist and are DISTINGUISHABLE from the original
--      AI output" (spec test). Every extracted field is stored twice: ai_* holds
--      what the model said and never changes; the plain column holds the current
--      authoritative value. corrected_fields records which the human overrode.
--
--   2. A transcript is only usable WITH CONSENT. Module 8 records
--      consent_confirmed on the call; a trigger here refuses to attach a report
--      to a call that has none. That is the downstream half of the promise made
--      to the candidate at the start of the call.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'interest_level') then
    -- 'unclear' is a first-class value, not a null: the spec requires ambiguous
    -- answers to be FLAGGED rather than guessed confidently.
    create type public.interest_level as enum ('high', 'medium', 'low', 'unclear');
  end if;

  if not exists (select 1 from pg_type where typname = 'location_acceptance') then
    create type public.location_acceptance as enum ('accepted', 'rejected', 'unclear');
  end if;
end $$;

create table if not exists public.screening_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  screening_call_id uuid not null references public.screening_calls (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  -- ---- Current, authoritative values -------------------------------------
  summary_text text not null,
  interest_level public.interest_level not null default 'unclear',
  expected_ctc numeric(12, 2) check (expected_ctc is null or expected_ctc >= 0),
  notice_period_days integer
    check (notice_period_days is null or (notice_period_days >= 0 and notice_period_days <= 365)),
  location_accepted public.location_acceptance not null default 'unclear',
  availability_notes text,

  -- ---- What the AI originally said. NEVER updated after insert. -----------
  ai_summary_text text not null,
  ai_interest_level public.interest_level not null,
  ai_expected_ctc numeric(12, 2),
  ai_notice_period_days integer,
  ai_location_accepted public.location_acceptance not null,
  ai_availability_notes text,

  -- Fields the model itself was unsure about. Surfaced in the UI so a recruiter
  -- checks them first.
  uncertain_fields text[] not null default '{}',
  -- Fields a human changed. Together with ai_*, this makes every edit visible.
  corrected_fields text[] not null default '{}',

  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One report per call; regenerating replaces it.
  unique (screening_call_id)
);

create index if not exists idx_screening_reports_organization_id
  on public.screening_reports (organization_id);
create index if not exists idx_screening_reports_application_id
  on public.screening_reports (application_id);
create index if not exists idx_screening_reports_screening_call_id
  on public.screening_reports (screening_call_id);
create index if not exists idx_screening_reports_org_created_at
  on public.screening_reports (organization_id, created_at desc);
-- Module 2's attention queue wants reports still awaiting review, and Module 10
-- prioritises on the same signal.
create index if not exists idx_screening_reports_pending_review
  on public.screening_reports (organization_id, created_at desc)
  where reviewed_at is null;

drop trigger if exists trg_screening_reports_touch on public.screening_reports;
create trigger trg_screening_reports_touch
  before update on public.screening_reports
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Consent gate + tenant integrity
--
-- The Privacy chapter requires consent_confirmed to be true "before a
-- transcript/recording is treated as usable in Module 9". Enforced in the
-- database so it holds even for a direct PostgREST insert, and so no future
-- automation can quietly bypass it.
-- =============================================================================
create or replace function public.enforce_screening_report_preconditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call record;
  v_application_org uuid;
begin
  select organization_id, application_id, consent_confirmed, status, transcript
    into v_call
  from public.screening_calls
  where id = new.screening_call_id;

  if v_call is null then
    raise exception 'Screening call not found';
  end if;

  if v_call.organization_id <> new.organization_id then
    raise exception 'Screening call does not belong to this organization';
  end if;

  if v_call.application_id <> new.application_id then
    raise exception 'Screening call belongs to a different application';
  end if;

  select organization_id into v_application_org
  from public.applications where id = new.application_id;

  if v_application_org is null or v_application_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  -- The consent gate. The candidate was told the call was recorded so a
  -- recruiter could review it; without that confirmation the recording is not
  -- ours to process.
  if not v_call.consent_confirmed then
    raise exception 'This call has no recorded consent, so its transcript cannot be summarised';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_screening_reports_preconditions on public.screening_reports;
create trigger trg_screening_reports_preconditions
  before insert on public.screening_reports
  for each row execute function public.enforce_screening_report_preconditions();

-- =============================================================================
-- The AI original is immutable.
--
-- Without this, a correction could overwrite what the model said and the audit
-- question "did AI get this wrong, or did a human change it?" becomes
-- unanswerable.
-- =============================================================================
create or replace function public.protect_ai_screening_original()
returns trigger
language plpgsql
as $$
begin
  if new.ai_summary_text is distinct from old.ai_summary_text
     or new.ai_interest_level is distinct from old.ai_interest_level
     or new.ai_expected_ctc is distinct from old.ai_expected_ctc
     or new.ai_notice_period_days is distinct from old.ai_notice_period_days
     or new.ai_location_accepted is distinct from old.ai_location_accepted
     or new.ai_availability_notes is distinct from old.ai_availability_notes
  then
    raise exception 'The original AI extraction cannot be edited. Correct the current values instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_screening_reports_protect_ai on public.screening_reports;
create trigger trg_screening_reports_protect_ai
  before update on public.screening_reports
  for each row execute function public.protect_ai_screening_original();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.screening_reports enable row level security;

-- "View screening report" is Yes for all four roles.
drop policy if exists screening_reports_select_member on public.screening_reports;
create policy screening_reports_select_member on public.screening_reports
  for select using (public.is_org_member(organization_id));

-- "Review/correct report" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists screening_reports_insert_staff on public.screening_reports;
create policy screening_reports_insert_staff on public.screening_reports
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists screening_reports_update_staff on public.screening_reports;
create policy screening_reports_update_staff on public.screening_reports
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists screening_reports_delete_owner_admin on public.screening_reports;
create policy screening_reports_delete_owner_admin on public.screening_reports
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );


-- ############################################################################
-- ## 0009_module10_pipeline.sql
-- ############################################################################

-- =============================================================================
-- Module 10: Advanced Pipeline
--
-- The board itself needs no new tables — it reads and writes applications.stage
-- and application_stage_history, both from Module 5, and stage transitions are
-- already recorded by that module's trigger.
--
-- The one thing this module owns is the SLA configuration.
--
-- FORWARD STUB (spec): "Module 17's dedicated Pipeline Settings page doesn't
-- exist yet, so this module both creates and provides a basic edit UI for
-- pipeline_sla_config directly."
--
-- RETROFIT (spec): "When Module 17 ships /settings/pipeline, point its UI at
-- this same pipeline_sla_config table — do not create a second, duplicate SLA
-- settings table."
-- =============================================================================

create table if not exists public.pipeline_sla_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  stage public.application_stage not null,

  -- Days an application may sit in this stage before it needs attention.
  target_days integer not null check (target_days >= 0 and target_days <= 365),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One target per stage per organization. Absent rows fall back to the
  -- defaults in lib/pipeline/sla.ts rather than meaning "no SLA".
  unique (organization_id, stage)
);

create index if not exists idx_pipeline_sla_config_organization_id
  on public.pipeline_sla_config (organization_id);
create index if not exists idx_pipeline_sla_config_org_stage
  on public.pipeline_sla_config (organization_id, stage);

drop trigger if exists trg_pipeline_sla_config_touch on public.pipeline_sla_config;
create trigger trg_pipeline_sla_config_touch
  before update on public.pipeline_sla_config
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.pipeline_sla_config enable row level security;

-- Every member reads it: the board shows aging to everyone who can see the
-- board, including Viewer.
drop policy if exists pipeline_sla_config_select_member on public.pipeline_sla_config;
create policy pipeline_sla_config_select_member on public.pipeline_sla_config
  for select using (public.is_org_member(organization_id));

-- Editing SLA targets is a configuration change, so Owner/Admin only. Note this
-- is narrower than "move applications between stages", which Recruiters may do:
-- changing the yardstick everyone is measured against is a different act from
-- doing the work.
drop policy if exists pipeline_sla_config_write_owner_admin on public.pipeline_sla_config;
create policy pipeline_sla_config_write_owner_admin on public.pipeline_sla_config
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- =============================================================================
-- Board performance
--
-- The board groups every live application by stage and sorts by how long it has
-- been sitting. Module 5 already indexes (organization_id, stage, updated_at);
-- this adds the partial index for the "open board" case, which excludes
-- archived rows and terminal stages.
-- =============================================================================
create index if not exists idx_applications_open_board
  on public.applications (organization_id, stage, updated_at)
  where archived_at is null
    and stage not in ('hired', 'rejected', 'withdrawn');


-- ############################################################################
-- ## 0010_module11_interviews.sql
-- ############################################################################

-- =============================================================================
-- Module 11: Interviews
--
-- Schedules interviews, prepares interviewers, and captures structured feedback.
--
-- Two things shape the schema:
--
--   1. "Calendar integration failure does not block internal interview
--      scheduling" (spec test). calendar_event_id is NULLABLE and carries a
--      status, so an interview scheduled while Google Calendar is disconnected
--      is a complete, valid record — not a half-written one.
--
--   2. AI prepares, humans evaluate. There is no AI-authored verdict column
--      anywhere here. rating and recommendation are supplied by the interviewer,
--      and nothing else may write them.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'interview_status') then
    create type public.interview_status as enum (
      'scheduled',
      'completed',
      'cancelled',
      'no_show'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'interview_mode') then
    create type public.interview_mode as enum ('video', 'phone', 'onsite');
  end if;

  if not exists (select 1 from pg_type where typname = 'calendar_sync_status') then
    create type public.calendar_sync_status as enum (
      'not_attempted',  -- calendar isn't connected; the interview stands alone
      'synced',
      'failed'          -- we tried and it didn't work; the interview still stands
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'interview_recommendation') then
    create type public.interview_recommendation as enum (
      'strong_yes',
      'yes',
      'no',
      'strong_no'
    );
  end if;
end $$;

-- =============================================================================
-- interviews
-- =============================================================================
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  -- Present despite the spec's column list omitting it: the global rule requires
  -- organization_id on every table, and Module 2's dashboard filters this table
  -- directly by it.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60
    check (duration_minutes > 0 and duration_minutes <= 480),

  interviewer_id uuid references public.users (id) on delete set null,
  mode public.interview_mode not null default 'video',
  status public.interview_status not null default 'scheduled',

  -- Calendar is OPTIONAL. A null event id with 'not_attempted' is the normal
  -- state until Module 17 ships OAuth, and must never read as a failure.
  calendar_event_id text,
  calendar_sync_status public.calendar_sync_status not null default 'not_attempted',
  calendar_error text,
  meeting_url text,

  /** Free-text location for an onsite interview. */
  location text,
  notes text,

  cancelled_reason text,
  created_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_interviews_organization_id on public.interviews (organization_id);
create index if not exists idx_interviews_application_id on public.interviews (application_id);
create index if not exists idx_interviews_interviewer_id on public.interviews (interviewer_id);
create index if not exists idx_interviews_status on public.interviews (status);
create index if not exists idx_interviews_scheduled_at on public.interviews (scheduled_at);
create index if not exists idx_interviews_org_created_at
  on public.interviews (organization_id, created_at desc);
-- Module 2's "interviews today" tile: a window on scheduled_at, excluding
-- cancelled. The retrofit doc flagged that filter specifically.
create index if not exists idx_interviews_org_status_scheduled
  on public.interviews (organization_id, status, scheduled_at);

drop trigger if exists trg_interviews_touch on public.interviews;
create trigger trg_interviews_touch
  before update on public.interviews
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- interview_feedback
--
-- Written by the human interviewer. The spec is explicit that AI "prepares, it
-- does not evaluate the candidate" — there is deliberately no AI-authored
-- column in this table.
-- =============================================================================
create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,

  rating integer not null check (rating >= 1 and rating <= 5),
  recommendation public.interview_recommendation not null,
  notes text,

  submitted_by uuid references public.users (id) on delete set null,
  submitted_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One submission per person per interview. Panel interviews with aggregated
  -- multi-interviewer scoring are Build Later, but the shape already allows
  -- several people to file feedback on the same interview.
  unique (interview_id, submitted_by)
);

create index if not exists idx_interview_feedback_organization_id
  on public.interview_feedback (organization_id);
create index if not exists idx_interview_feedback_interview_id
  on public.interview_feedback (interview_id);
create index if not exists idx_interview_feedback_submitted_by
  on public.interview_feedback (submitted_by);
create index if not exists idx_interview_feedback_org_submitted_at
  on public.interview_feedback (organization_id, submitted_at desc);

drop trigger if exists trg_interview_feedback_touch on public.interview_feedback;
create trigger trg_interview_feedback_touch
  before update on public.interview_feedback
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity — a foreign key proves the row exists, not that it is
-- ours. Same pattern as Modules 5-9.
-- =============================================================================
create or replace function public.enforce_interview_tenant_integrity()
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

drop trigger if exists trg_interviews_tenant_integrity on public.interviews;
create trigger trg_interviews_tenant_integrity
  before insert or update of application_id, organization_id on public.interviews
  for each row execute function public.enforce_interview_tenant_integrity();

create or replace function public.enforce_feedback_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview_org uuid;
begin
  select organization_id into v_interview_org
  from public.interviews where id = new.interview_id;

  if v_interview_org is null or v_interview_org <> new.organization_id then
    raise exception 'Interview does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_tenant_integrity on public.interview_feedback;
create trigger trg_feedback_tenant_integrity
  before insert or update of interview_id, organization_id on public.interview_feedback
  for each row execute function public.enforce_feedback_tenant_integrity();

-- =============================================================================
-- Submitting feedback completes the interview.
--
-- In the database rather than the API so the two can never disagree — an
-- interview with feedback but still marked "scheduled" would sit in the
-- missing-feedback queue forever.
-- =============================================================================
create or replace function public.complete_interview_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.interviews
    set status = 'completed'
    where id = new.interview_id
      and status = 'scheduled';
  return new;
end;
$$;

drop trigger if exists trg_feedback_completes_interview on public.interview_feedback;
create trigger trg_feedback_completes_interview
  after insert on public.interview_feedback
  for each row execute function public.complete_interview_on_feedback();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.interviews enable row level security;
alter table public.interview_feedback enable row level security;

-- Viewing: every active member. "View AI interview brief" is Yes for all four
-- roles, and the brief is meaningless without the interview.
drop policy if exists interviews_select_member on public.interviews;
create policy interviews_select_member on public.interviews
  for select using (public.is_org_member(organization_id));

-- "Schedule interview" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists interviews_insert_staff on public.interviews;
create policy interviews_insert_staff on public.interviews
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists interviews_update_staff on public.interviews;
create policy interviews_update_staff on public.interviews
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: interviews are cancelled, not erased. A cancelled interview
-- is part of the record of how a candidate was treated.

-- Feedback is readable by any member — Module 16 reports on it and a recruiter
-- needs to read what an interviewer wrote.
drop policy if exists interview_feedback_select_member on public.interview_feedback;
create policy interview_feedback_select_member on public.interview_feedback
  for select using (public.is_org_member(organization_id));

-- "Submit feedback" is Owner/Admin/Recruiter. submitted_by is pinned to the
-- caller so feedback cannot be attributed to someone else — an interviewer's
-- assessment must be theirs.
drop policy if exists interview_feedback_insert_staff on public.interview_feedback;
create policy interview_feedback_insert_staff on public.interview_feedback
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
    and submitted_by = public.current_app_user_id()
  );

-- Only the author may revise their own feedback.
drop policy if exists interview_feedback_update_author on public.interview_feedback;
create policy interview_feedback_update_author on public.interview_feedback
  for update
  using (submitted_by = public.current_app_user_id())
  with check (submitted_by = public.current_app_user_id());


-- ############################################################################
-- ## 0011_module12_clients.sql
-- ############################################################################

-- =============================================================================
-- Module 12: Clients
--
-- Connects recruitment work to the hiring companies the agency serves, and
-- tracks how responsive each one is.
--
-- This migration also completes the RETROFIT Module 3 deliberately deferred:
--
--   Module 3 spec: "jobs.client_id refers to a client that Module 12 introduces
--   later. Create client_id as a nullable UUID column now with NO foreign-key
--   constraint. Module 12 must add the FK constraint once its clients table
--   exists."
--
--   Module 12 spec: "Add the foreign-key constraint jobs.client_id -> clients.id
--   now that this table exists, backfill/validate existing job rows, and re-run
--   Module 3's job list/detail/filter tests to confirm nothing broke."
--
-- See the bottom of this file.
-- =============================================================================

-- =============================================================================
-- clients
-- =============================================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),

  -- [{ name, email, phone, role }]. JSONB because a client's contact list is a
  -- small, read-together blob, not something we query across.
  contacts jsonb not null default '[]',

  -- Days the client is expected to take responding to a submission. Drives
  -- turnaround tracking and Module 16's "Average Client Feedback Time".
  feedback_sla_days integer not null default 3
    check (feedback_sla_days >= 0 and feedback_sla_days <= 90),

  -- Who manages this relationship. Recruiter access is scoped to "assigned".
  account_manager_id uuid references public.users (id) on delete set null,

  notes text,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One client per name per organization; a duplicate would split a client's
  -- history in two and quietly break their metrics.
  unique (organization_id, name)
);

create index if not exists idx_clients_organization_id on public.clients (organization_id);
create index if not exists idx_clients_account_manager_id on public.clients (account_manager_id);
create index if not exists idx_clients_org_created_at
  on public.clients (organization_id, created_at desc);

drop trigger if exists trg_clients_touch on public.clients;
create trigger trg_clients_touch
  before update on public.clients
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- client_feedback_events
--
-- One row per submission: when the candidate was put in front of the client, and
-- when (if ever) they came back. responded_at NULL means "still waiting", which
-- is what the SLA tracking is actually measuring.
-- =============================================================================
create table if not exists public.client_feedback_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  requested_at timestamptz not null default now(),
  responded_at timestamptz,

  -- What the client said, once they say it.
  outcome text check (outcome is null or outcome in ('interview', 'reject', 'hold', 'offer', 'other')),
  response_notes text,

  -- The submission text actually sent, kept verbatim. This is what a client was
  -- told about a real person — if it is ever disputed, the record must be what
  -- was sent, not what we would generate today.
  submission_text text,
  submitted_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint feedback_response_after_request
    check (responded_at is null or responded_at >= requested_at)
);

create index if not exists idx_client_feedback_events_organization_id
  on public.client_feedback_events (organization_id);
create index if not exists idx_client_feedback_events_client_id
  on public.client_feedback_events (client_id);
create index if not exists idx_client_feedback_events_application_id
  on public.client_feedback_events (application_id);
create index if not exists idx_client_feedback_events_org_requested_at
  on public.client_feedback_events (organization_id, requested_at desc);
-- Outstanding responses — the thing an account manager chases.
create index if not exists idx_client_feedback_events_pending
  on public.client_feedback_events (organization_id, requested_at)
  where responded_at is null;

drop trigger if exists trg_client_feedback_events_touch on public.client_feedback_events;
create trigger trg_client_feedback_events_touch
  before update on public.client_feedback_events
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity
-- =============================================================================
create or replace function public.enforce_client_feedback_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_org uuid;
  v_application_org uuid;
begin
  select organization_id into v_client_org from public.clients where id = new.client_id;
  select organization_id into v_application_org
  from public.applications where id = new.application_id;

  if v_client_org is null or v_client_org <> new.organization_id then
    raise exception 'Client does not belong to this organization';
  end if;

  if v_application_org is null or v_application_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_client_feedback_tenant_integrity on public.client_feedback_events;
create trigger trg_client_feedback_tenant_integrity
  before insert or update of client_id, application_id, organization_id
  on public.client_feedback_events
  for each row execute function public.enforce_client_feedback_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.clients enable row level security;
alter table public.client_feedback_events enable row level security;

-- "View client activity summary" is Yes for all four roles including Viewer.
drop policy if exists clients_select_member on public.clients;
create policy clients_select_member on public.clients
  for select using (public.is_org_member(organization_id));

-- "Manage clients" is Owner/Admin/Recruiter; Viewer denied. The spec scopes
-- Recruiter to "assigned", which is applied in the query layer — a Recruiter
-- must still be able to see unassigned clients in order to pick one up.
drop policy if exists clients_insert_staff on public.clients;
create policy clients_insert_staff on public.clients
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists clients_update_staff on public.clients;
create policy clients_update_staff on public.clients
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: clients are archived. Jobs reference them, and Module 16
-- reports on their history.

drop policy if exists client_feedback_events_select_member on public.client_feedback_events;
create policy client_feedback_events_select_member on public.client_feedback_events
  for select using (public.is_org_member(organization_id));

-- "Generate/send submission summary" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists client_feedback_events_write_staff on public.client_feedback_events;
create policy client_feedback_events_write_staff on public.client_feedback_events
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- RETROFIT: jobs.client_id -> clients.id
--
-- Module 3 created client_id as a nullable UUID with no constraint, because
-- clients did not exist yet. Now it does.
--
-- Done defensively, in this order, so the migration is safe on a database that
-- already has job rows:
--   1. NULL any client_id that points at a client which does not exist. Those
--      are dangling references from before the constraint; keeping them would
--      make the ALTER fail, and they carry no meaning anyway.
--   2. NULL any client_id pointing at a client in a DIFFERENT organization.
--      A foreign key alone would happily allow that, and it would be a
--      cross-tenant leak.
--   3. Add the constraint.
--
-- ON DELETE SET NULL, not CASCADE: archiving or removing a client must never
-- delete the jobs done for them.
-- =============================================================================
do $$
begin
  -- 1. Dangling references.
  update public.jobs j
    set client_id = null
    where j.client_id is not null
      and not exists (select 1 from public.clients c where c.id = j.client_id);

  -- 2. Cross-tenant references.
  update public.jobs j
    set client_id = null
    where j.client_id is not null
      and exists (
        select 1 from public.clients c
        where c.id = j.client_id and c.organization_id <> j.organization_id
      );

  -- 3. The constraint itself.
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_client_id_fkey'
  ) then
    alter table public.jobs
      add constraint jobs_client_id_fkey
      foreign key (client_id) references public.clients (id) on delete set null;
  end if;
end $$;

-- A foreign key does not check the tenant, so the same rule Modules 5-11 use
-- applies here too: a job may only point at a client in its own organization.
create or replace function public.enforce_job_client_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_org uuid;
begin
  if new.client_id is null then
    return new;
  end if;

  select organization_id into v_client_org from public.clients where id = new.client_id;

  if v_client_org is null or v_client_org <> new.organization_id then
    raise exception 'Client does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_jobs_client_tenant_integrity on public.jobs;
create trigger trg_jobs_client_tenant_integrity
  before insert or update of client_id, organization_id on public.jobs
  for each row execute function public.enforce_job_client_tenant_integrity();


-- ############################################################################
-- ## 0012_module13_automations.sql
-- ############################################################################

-- =============================================================================
-- Module 13: Automation Engine
--
-- When / If / Then rules. The spec calls this "the brain connecting every other
-- module", which is also why it is the most dangerous module in the product:
-- an automation can place phone calls, spend AI budget, and act on candidates
-- without a human in the loop.
--
-- Three safety properties are enforced HERE rather than in application code:
--
--   1. THE RUNAWAY GUARD. A unique index prevents the same automation firing
--      twice for the same application in the same stage-entry. The cost chapter
--      requires this ("must not be able to trigger the same AI action on the
--      same application more than once per stage-entry — guard this at the
--      automation-run level"), and it is also what stops a bad rule telephoning
--      a candidate over and over.
--
--   2. Automations start INACTIVE. There is no path where creating a rule makes
--      it live, which matters because AI can draft them.
--
--   3. Owner/Admin only. A Recruiter can read run history but cannot create a
--      rule that acts on the whole organization.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'automation_status') then
    create type public.automation_status as enum ('draft', 'active', 'paused');
  end if;

  if not exists (select 1 from pg_type where typname = 'automation_run_status') then
    create type public.automation_run_status as enum (
      'success',
      'failed',
      -- A rule whose conditions did not match. NOT a failure — the spec asks for
      -- success/failure/skip precisely so a skip does not read as an error.
      'skipped',
      'blocked'  -- a required integration was unavailable at run time
    );
  end if;
end $$;

-- =============================================================================
-- automations
-- =============================================================================
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),
  description text,

  -- Trigger vocabulary lives in lib/automations/catalog.ts. Stored as text
  -- rather than an enum so a new trigger does not need a migration, and
  -- validated on write by the API.
  trigger text not null,

  -- [{ field, operator, value }]. Evaluated by a pure function, never by AI —
  -- the spec requires rules to be "explainable and predictable".
  conditions jsonb not null default '[]',
  -- [{ type, config }]
  actions jsonb not null default '[]',

  -- Starts as draft. Activation is always a separate, explicit act.
  status public.automation_status not null default 'draft',

  -- Which integrations this rule needs. Computed from its actions on write, so
  -- the activation check does not have to re-derive it.
  required_integrations text[] not null default '{}',

  created_by uuid references public.users (id) on delete set null,
  activated_by uuid references public.users (id) on delete set null,
  activated_at timestamptz,

  -- True when the rule was proposed by AI. Kept so "did a human write this?"
  -- has an answer, and so the UI can show a Review & Activate step.
  drafted_by_ai boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, name)
);

create index if not exists idx_automations_organization_id on public.automations (organization_id);
create index if not exists idx_automations_status on public.automations (status);
create index if not exists idx_automations_trigger on public.automations (trigger);
create index if not exists idx_automations_org_created_at
  on public.automations (organization_id, created_at desc);
-- The dispatch query: active rules for a given trigger.
create index if not exists idx_automations_active_trigger
  on public.automations (organization_id, trigger)
  where status = 'active';

drop trigger if exists trg_automations_touch on public.automations;
create trigger trg_automations_touch
  before update on public.automations
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- automation_runs
-- =============================================================================
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,

  status public.automation_run_status not null,

  -- Why it skipped or failed, in words a human can act on.
  reason text,
  error_message text,

  -- What actually happened: [{ action, status, detail }]
  action_results jsonb not null default '[]',

  /**
   * THE RUNAWAY GUARD KEY.
   *
   * Identifies the specific occasion this rule fired for this application —
   * normally "<stage>:<stage_entered_at>". Two triggers of the same rule for the
   * same stage-entry produce the same key and the second is rejected by the
   * unique index below.
   */
  dedupe_key text not null,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_automation_runs_organization_id
  on public.automation_runs (organization_id);
create index if not exists idx_automation_runs_automation_id
  on public.automation_runs (automation_id);
create index if not exists idx_automation_runs_application_id
  on public.automation_runs (application_id);
create index if not exists idx_automation_runs_status on public.automation_runs (status);
create index if not exists idx_automation_runs_org_started_at
  on public.automation_runs (organization_id, started_at desc);
-- Module 2's "failed automations today" tile.
create index if not exists idx_automation_runs_org_status_started
  on public.automation_runs (organization_id, status, started_at desc);

-- =============================================================================
-- THE RUNAWAY GUARD.
--
-- One run per automation per application per occasion. This is a UNIQUE INDEX,
-- not an application-level check, because a check-then-insert races — and the
-- thing being raced is whether a real person's phone rings twice.
-- =============================================================================
create unique index if not exists idx_automation_runs_dedupe
  on public.automation_runs (automation_id, application_id, dedupe_key)
  where application_id is not null;

-- =============================================================================
-- Cross-tenant integrity
-- =============================================================================
create or replace function public.enforce_automation_run_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_automation_org uuid;
  v_application_org uuid;
begin
  select organization_id into v_automation_org
  from public.automations where id = new.automation_id;

  if v_automation_org is null or v_automation_org <> new.organization_id then
    raise exception 'Automation does not belong to this organization';
  end if;

  if new.application_id is not null then
    select organization_id into v_application_org
    from public.applications where id = new.application_id;

    if v_application_org is null or v_application_org <> new.organization_id then
      raise exception 'Application does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automation_runs_tenant_integrity on public.automation_runs;
create trigger trg_automation_runs_tenant_integrity
  before insert or update of automation_id, application_id, organization_id
  on public.automation_runs
  for each row execute function public.enforce_automation_run_tenant_integrity();

-- =============================================================================
-- Activation is deliberate.
--
-- A rule may only become active with an activated_by recorded. Combined with the
-- API's dependency check, this means "who turned this on, and when?" always has
-- an answer — including for a rule AI drafted.
-- =============================================================================
create or replace function public.enforce_automation_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if new.activated_by is null then
      raise exception 'An automation can only be activated by a named user';
    end if;
    if new.activated_at is null then
      new.activated_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automations_activation on public.automations;
create trigger trg_automations_activation
  before insert or update on public.automations
  for each row execute function public.enforce_automation_activation();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

-- Everyone may see what rules exist — an automation acting on your work should
-- not be invisible to you. Editing is Owner/Admin.
drop policy if exists automations_select_member on public.automations;
create policy automations_select_member on public.automations
  for select using (public.is_org_member(organization_id));

-- "Create/edit automations | Owner Yes | Admin Yes | Recruiter No | Viewer No".
drop policy if exists automations_write_owner_admin on public.automations;
create policy automations_write_owner_admin on public.automations
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- "View automation run history" is Yes for all four roles.
drop policy if exists automation_runs_select_member on public.automation_runs;
create policy automation_runs_select_member on public.automation_runs
  for select using (public.is_org_member(organization_id));

-- Runs are written by the engine on behalf of a member. No UPDATE or DELETE
-- policy: a run record is the evidence of what the system did to a candidate,
-- and editing it after the fact would destroy the audit trail Module 16 reports
-- on.
drop policy if exists automation_runs_insert_member on public.automation_runs;
create policy automation_runs_insert_member on public.automation_runs
  for insert with check (public.is_org_member(organization_id));


-- ############################################################################
-- ## 0013_module14_activity_audit.sql
-- ############################################################################

-- =============================================================================
-- Module 14: Activity & Audit
--
-- One table, and almost all of its design is about what CANNOT happen to it.
--
-- IMMUTABLE. There is no UPDATE policy and no DELETE policy. Not an oversight —
-- the spec's section 6 lists PATCH and DELETE endpoints, and they are
-- deliberately not implemented (see docs/modules/14-activity-notes.md). A log a
-- user can edit is not an audit trail; it is a story. The one question this
-- table exists to answer is "what actually happened", and an editable row
-- cannot answer it.
--
-- SENSITIVE EVENTS ARE GATED IN RLS, NOT IN THE ROUTE. Section 9 restricts the
-- security/settings audit log to Owner/Admin. The browser holds an
-- authenticated PostgREST client, so a Recruiter could read the table directly;
-- a rule that lives only in a route handler would be no rule at all. The
-- is_sensitive flag is therefore enforced in the SELECT policy.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_entity_type') then
    create type public.activity_entity_type as enum (
      'organization',
      'member',
      'job',
      'candidate',
      'application',
      'resume',
      'screening_call',
      'screening_report',
      'interview',
      'client',
      'automation',
      'integration'
    );
  end if;
end $$;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  entity_type public.activity_entity_type not null,
  /**
   * The row this happened to.
   *
   * NO foreign key, on purpose. It points at twelve different tables, and more
   * importantly a log entry must outlive its subject: if a candidate is later
   * erased under the privacy retrofit, "this record was erased on this date by
   * this person" is exactly the row that has to survive. A cascade here would
   * delete the evidence along with the evidence's subject.
   */
  entity_id uuid,

  -- Vocabulary lives in lib/activity/events.ts and is validated on write.
  event_type text not null check (length(btrim(event_type)) > 0),

  -- Who did it. NULL means the system acted on its own — an automation, a
  -- webhook, a scheduled job. Never invent a user for those.
  actor_id uuid references public.users (id) on delete set null,
  /**
   * Preserved actor description.
   *
   * actor_id nulls out when a user is deleted, but "who closed this job?" must
   * still be answerable afterwards. This is a name/email snapshot at write time,
   * not a live join.
   */
  actor_label text,

  -- Summary-level context only. The AI-call events store a token/outcome
  -- summary, NEVER the prompt, the provider payload, or any credential.
  metadata jsonb not null default '{}',

  /**
   * Security/settings-sensitive. Owner/Admin only, enforced below in RLS.
   *
   * Stored rather than derived from event_type so the boundary survives a later
   * rename of an event, and so the policy is a simple column read rather than a
   * list the policy has to keep in step with application code.
   */
  is_sensitive boolean not null default false,

  created_at timestamptz not null default now()
);

-- Indexes named by the spec, plus the two composites the real queries use.
create index if not exists idx_activity_events_organization_id
  on public.activity_events (organization_id);
create index if not exists idx_activity_events_entity_id
  on public.activity_events (entity_id);
create index if not exists idx_activity_events_actor_id
  on public.activity_events (actor_id);
create index if not exists idx_activity_events_created_at
  on public.activity_events (created_at desc);
create index if not exists idx_activity_events_org_created_at
  on public.activity_events (organization_id, created_at desc);
-- The per-entity timeline query.
create index if not exists idx_activity_events_entity_timeline
  on public.activity_events (organization_id, entity_type, entity_id, created_at desc);
-- The audit log, which reads only the sensitive slice.
create index if not exists idx_activity_events_sensitive
  on public.activity_events (organization_id, created_at desc)
  where is_sensitive;

-- =============================================================================
-- Immutability, enforced.
--
-- Omitting the UPDATE/DELETE policies already blocks both for ordinary users.
-- This trigger also blocks them for the SERVICE ROLE, which bypasses RLS
-- entirely — lib/supabase/admin.ts is used by the Bolna webhook and the
-- integration adapters, and a bug there must not be able to rewrite history.
--
-- Deleting an ORGANIZATION still cascades. That is intentional: the tenant is
-- gone, and keeping its audit trail would be retaining personal data with no
-- controller, which the privacy chapter forbids.
-- =============================================================================
create or replace function public.reject_activity_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'activity_events is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists trg_activity_events_immutable on public.activity_events;
create trigger trg_activity_events_immutable
  before update or delete on public.activity_events
  for each row execute function public.reject_activity_event_mutation();

-- =============================================================================
-- Cross-tenant integrity.
--
-- The actor must belong to the organization the event is recorded against.
-- Without this, a caller could attribute an action in their own org to a user
-- from another one — which would be both a false record and a small identity
-- leak (the audit log renders actor names).
-- =============================================================================
create or replace function public.enforce_activity_event_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is not null then
    if not exists (
      select 1
      from public.organization_members m
      where m.user_id = new.actor_id
        and m.organization_id = new.organization_id
    ) then
      raise exception 'Actor is not a member of this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_activity_events_tenant_integrity on public.activity_events;
create trigger trg_activity_events_tenant_integrity
  before insert on public.activity_events
  for each row execute function public.enforce_activity_event_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.activity_events enable row level security;

/**
 * SELECT.
 *
 * Ordinary events: any member of the organization. Section 9 gives all four
 * roles the entity timeline, and an activity trail that hid itself from the
 * people whose work it describes would be worse than useless.
 *
 * Sensitive events: Owner/Admin only. This is the security boundary from
 * section 9, and it is here — not merely in the route — because the browser can
 * query this table directly.
 */
drop policy if exists activity_events_select_member on public.activity_events;
create policy activity_events_select_member on public.activity_events
  for select using (
    public.is_org_member(organization_id)
    and (
      not is_sensitive
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  );

/**
 * INSERT.
 *
 * Any member may write an event, because every member performs actions that
 * must be logged. Two things they may NOT do:
 *
 *   - attribute an action to someone else. actor_id must be the caller, or NULL
 *     for a genuinely system-driven event. A Recruiter writing a row that reads
 *     "Owner removed a member" would be forging the audit trail.
 *   - the tenant trigger above additionally requires the actor to be a member
 *     of this organization.
 *
 * Writing a *sensitive* event is not role-gated on insert: a failed permission
 * change is performed by whoever attempted it, and that attempt is precisely
 * what the audit log needs to capture.
 */
drop policy if exists activity_events_insert_member on public.activity_events;
create policy activity_events_insert_member on public.activity_events
  for insert with check (
    public.is_org_member(organization_id)
    and (actor_id is null or actor_id = public.current_app_user_id())
  );

-- No UPDATE policy. No DELETE policy. See the header.


-- ############################################################################
-- ## 0014_module15_notifications.sql
-- ############################################################################

-- =============================================================================
-- Module 15: Notifications & Communication
--
-- Three tables, and one policy that is deliberately STRICTER than every other
-- table in this product.
--
-- A NOTIFICATION IS READABLE ONLY BY ITS RECIPIENT.
--
-- Everywhere else, org membership is the read boundary — the team list, the
-- pipeline, the activity log. Not here. A notification body quotes candidate
-- names, interview times and screening outcomes, and it is addressed to one
-- person. "Rahul Sharma declined the automated call" delivered to a Viewer who
-- has no business with that application is a leak dressed up as a feature.
--
-- So the SELECT policy requires user_id = the caller. There is no org-wide read.
--
-- notification_preferences is here rather than in Module 1. The spec lists
-- "Module 1: users/roles + user_preferences" as a dependency, but Module 1 never
-- built such a table — see docs/modules/15-notifications-notes.md.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type public.notification_channel as enum ('in_app', 'email');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_delivery_status') then
    create type public.notification_delivery_status as enum (
      'pending',
      'sent',
      'failed',
      -- The integration is not connected. Distinct from 'failed': nothing broke,
      -- the channel simply does not exist yet, and the fix is different.
      'skipped'
    );
  end if;
end $$;

-- =============================================================================
-- notifications — the in-app record. Always written, whatever happens outside.
-- =============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- The recipient. NOT NULL: a notification addressed to nobody is not a
  -- notification, and a null here would make the RLS policy silently fail open.
  user_id uuid not null references public.users (id) on delete cascade,

  -- Vocabulary in lib/notifications/templates.ts, validated on write.
  type text not null check (length(btrim(type)) > 0),

  title text not null check (length(btrim(title)) > 0),
  body text not null,

  /**
   * Where to go when the notification is clicked. Stored as a relative path,
   * never a full URL — an absolute URL in a database column is an open redirect
   * waiting for someone to write to it.
   */
  link_path text check (link_path is null or link_path like '/%'),

  /** low | normal | high. Drives ordering in the centre, nothing else. */
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),

  -- Fixed facts and ids the template rendered from. Never the raw event payload.
  metadata jsonb not null default '{}',

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_organization_id
  on public.notifications (organization_id);
create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_notifications_created_at on public.notifications (created_at desc);
create index if not exists idx_notifications_org_created_at
  on public.notifications (organization_id, created_at desc);
-- The centre's main query, and the nav badge's count.
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- =============================================================================
-- notification_deliveries — one row per channel attempt.
--
-- Separate from notifications on purpose. The in-app notification is the record
-- that something happened; a delivery is the record of an ATTEMPT to send it
-- somewhere. Collapsing them would mean a failed email either destroys the
-- notification or silently reports success, and both are wrong.
-- =============================================================================
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  notification_id uuid not null references public.notifications (id) on delete cascade,

  channel public.notification_channel not null,
  status public.notification_delivery_status not null default 'pending',

  /** The provider's id, for reconciling bounces later. Never a credential. */
  provider_message_id text,

  /** Plain reason, safe to show a user. Provider bodies are not stored. */
  error_message text,

  /** Masked at write time — never a full address (see lib/notifications/notify.ts). */
  recipient_hint text,

  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_deliveries_organization_id
  on public.notification_deliveries (organization_id);
create index if not exists idx_notification_deliveries_notification_id
  on public.notification_deliveries (notification_id);
create index if not exists idx_notification_deliveries_status
  on public.notification_deliveries (status);
create index if not exists idx_notification_deliveries_provider_message_id
  on public.notification_deliveries (provider_message_id);
create index if not exists idx_notification_deliveries_org_created_at
  on public.notification_deliveries (organization_id, created_at desc);

-- One attempt row per notification per channel: retries update, never duplicate.
create unique index if not exists idx_notification_deliveries_unique
  on public.notification_deliveries (notification_id, channel);

-- =============================================================================
-- notification_preferences
--
-- One row per (organization, user, type). A NULL user_id is the ORGANIZATION
-- DEFAULT; a row with a user_id is that person's override.
--
-- Modelled as rows rather than a JSON blob on the user so a default and an
-- override are separate facts. With a blob, "I never chose this" and "I chose
-- the same thing the org did" are indistinguishable — so changing the org
-- default would either silently overwrite deliberate personal choices or never
-- reach anyone.
-- =============================================================================
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /** NULL = the organization default for this type. */
  user_id uuid references public.users (id) on delete cascade,

  notification_type text not null check (length(btrim(notification_type)) > 0),

  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_preferences_organization_id
  on public.notification_preferences (organization_id);
create index if not exists idx_notification_preferences_user_id
  on public.notification_preferences (user_id);

-- Two partial uniques rather than one: NULL never equals NULL in a unique
-- index, so a plain unique(organization_id, user_id, notification_type) would
-- happily allow twenty conflicting organization defaults for the same type.
create unique index if not exists idx_notification_preferences_org_default
  on public.notification_preferences (organization_id, notification_type)
  where user_id is null;

create unique index if not exists idx_notification_preferences_user
  on public.notification_preferences (organization_id, user_id, notification_type)
  where user_id is not null;

drop trigger if exists trg_notification_preferences_touch on public.notification_preferences;
create trigger trg_notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity.
--
-- The recipient must be a member of the organization the notification belongs
-- to. A foreign key to users proves the person exists, not that they are ours —
-- without this, a bug in a notify() call-site could deliver an internal message
-- about a candidate to someone in another tenant.
-- =============================================================================
create or replace function public.enforce_notification_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organization_members m
    where m.user_id = new.user_id
      and m.organization_id = new.organization_id
  ) then
    raise exception 'Recipient is not a member of this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_tenant_integrity on public.notifications;
create trigger trg_notifications_tenant_integrity
  before insert on public.notifications
  for each row execute function public.enforce_notification_tenant_integrity();

create or replace function public.enforce_delivery_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.notifications where id = new.notification_id;

  if v_org is null or v_org <> new.organization_id then
    raise exception 'Notification does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deliveries_tenant_integrity on public.notification_deliveries;
create trigger trg_deliveries_tenant_integrity
  before insert or update of notification_id, organization_id
  on public.notification_deliveries
  for each row execute function public.enforce_delivery_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_preferences enable row level security;

-- READ: only your own. See the header — this is the strictest policy in the
-- product, and deliberately so.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

/**
 * INSERT: a member may create a notification for a colleague.
 *
 * Necessarily so — almost every notification is raised by one person's action
 * for someone else's attention ("your interview was cancelled"). The tenant
 * trigger above bounds it to the same organization, and the type must be one of
 * the approved templates, which the API validates.
 */
drop policy if exists notifications_insert_member on public.notifications;
create policy notifications_insert_member on public.notifications
  for insert with check (public.is_org_member(organization_id));

/**
 * UPDATE: mark your own as read. Nothing else.
 *
 * WITH CHECK repeats user_id = caller so an update cannot REASSIGN a
 * notification to someone else — a USING-only policy would let you hand your
 * notification to another user, and the row would then be theirs to read.
 */
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update
  using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  )
  with check (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

-- Deliveries follow their notification: you can see the send status of a message
-- addressed to you, and nobody else's.
drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own on public.notification_deliveries
  for select using (
    exists (
      select 1
      from public.notifications n
      where n.id = notification_id
        and n.user_id = public.current_app_user_id()
    )
    or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

-- Written by the send pipeline on behalf of a member.
drop policy if exists notification_deliveries_write_member on public.notification_deliveries;
create policy notification_deliveries_write_member on public.notification_deliveries
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Preferences: everyone reads (you need to see the default you inherit).
drop policy if exists notification_preferences_select_member on public.notification_preferences;
create policy notification_preferences_select_member on public.notification_preferences
  for select using (public.is_org_member(organization_id));

/**
 * PREFERENCE WRITES — the one that carries a real rule.
 *
 * "Configure organization notification defaults | Owner Yes | Admin Yes |
 *  Recruiter No | Viewer No".
 *
 * So a row with user_id IS NULL (the org default) requires Owner/Admin, and a
 * row with a user_id must be your OWN. Both halves are in WITH CHECK as well as
 * USING, because the rule constrains what the row may BECOME: without the
 * WITH CHECK, a Recruiter could take their own override row and null its
 * user_id, turning a personal setting into an organization-wide default.
 */
drop policy if exists notification_preferences_write on public.notification_preferences;
create policy notification_preferences_write on public.notification_preferences
  for all
  using (
    public.is_org_member(organization_id)
    and (
      case
        when user_id is null
          then public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
        else user_id = public.current_app_user_id()
      end
    )
  )
  with check (
    public.is_org_member(organization_id)
    and (
      case
        when user_id is null
          then public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
        else user_id = public.current_app_user_id()
      end
    )
  );


-- ############################################################################
-- ## 0015_module16_analytics.sql
-- ############################################################################

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


-- ############################################################################
-- ## 0016_module17_settings.sql
-- ############################################################################

-- =============================================================================
-- Module 17: Settings & Integrations
--
-- The last core module, and mostly a completion rather than a new build.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES **NOT** CREATE
-- ----------------------------------------------------
-- The spec's schema for this module lists several JSONB columns that would
-- duplicate tables earlier modules already own. Creating them would give the
-- product two places to configure the same thing, and they would drift within a
-- week.
--
--   * `pipeline_settings` — Module 10 built `pipeline_sla_config` as ROWS (one
--     per stage, with a check constraint). The spec's own retrofit instruction
--     for this module says to "point this module's /settings/pipeline page at
--     the pipeline_sla_config table Module 10 already created rather than
--     creating a duplicate". So there is no pipeline_settings column.
--
--   * `notification_settings` / `user_preferences.notification_preferences` —
--     Module 15 built `notification_preferences` as rows, one per
--     (organization, user, type), specifically so that "I never chose this" and
--     "I chose the same as the default" are different facts. Collapsing that
--     into a blob would destroy the distinction its inheritance depends on.
--
-- `organization_settings` therefore holds only what nothing else owns.
-- =============================================================================

-- =============================================================================
-- organization_settings
--
-- One row per organization, keyed BY organization_id rather than a surrogate id
-- — there can only ever be one, and a surrogate key invites two.
-- =============================================================================
create table if not exists public.organization_settings (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  /**
   * Timezone lives on `organizations` (Module 1) and every date calculation in
   * the product already reads it from there via lib/time.ts. It is NOT
   * duplicated here — two timezones would mean the dashboard and the analytics
   * could disagree about what "today" is, which is exactly the bug lib/time.ts
   * exists to prevent.
   */

  currency text not null default 'INR'
    check (currency ~ '^[A-Z]{3}$'),

  -- Applied when an application is created with no explicit recruiter.
  default_recruiter_id uuid references public.users (id) on delete set null,

  default_application_stage public.application_stage not null default 'new',

  default_interview_duration_minutes integer not null default 60
    check (default_interview_duration_minutes between 5 and 480),

  /**
   * Screening defaults: max attempts, retry delay, language, whether recording
   * is enabled. Read by lib/screening/retry.ts and lib/screening/script.ts.
   *
   * JSONB rather than columns because this set genuinely changes as the
   * screening product evolves, and every reader already normalises it through
   * a typed helper.
   */
  screening_settings jsonb not null default '{}',

  /**
   * Retention: how long to keep transcripts, recordings and archived records.
   * The Privacy & Compliance retrofit implements the actual deletion; this is
   * the setting it will read, defined now so the shape is fixed before anything
   * depends on it.
   */
  retention_settings jsonb not null default '{}',

  -- Branding. A logo URL, not a blob — Supabase storage owns files.
  logo_url text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_settings_default_recruiter
  on public.organization_settings (default_recruiter_id);

drop trigger if exists trg_organization_settings_touch on public.organization_settings;
create trigger trg_organization_settings_touch
  before update on public.organization_settings
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- user_preferences
--
-- Per-user, per-organization. The same person in two organizations can
-- legitimately want different display settings, so the key is the pair.
-- =============================================================================
create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,

  /**
   * A DISPLAY-ONLY override. Every stored calculation ("today", SLA breaches,
   * analytics ranges) uses the ORGANIZATION's timezone, because a report whose
   * numbers change depending on who opened it is not a report. This only
   * affects how a timestamp is rendered to this person.
   */
  display_timezone text,

  date_format text not null default 'dd MMM yyyy'
    check (date_format in ('dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')),

  -- Density, default landing page, collapsed nav — cosmetic only.
  ui_preferences jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists idx_user_preferences_user_id on public.user_preferences (user_id);
create index if not exists idx_user_preferences_organization_id
  on public.user_preferences (organization_id);

drop trigger if exists trg_user_preferences_touch on public.user_preferences;
create trigger trg_user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- organization_integrations — the columns Module 8's version was missing.
--
-- EXTENDED, not replaced. The spec is explicit that Module 17 "must extend
-- organization_integrations rather than create a second table, and must not
-- change placeCall()'s external interface". Both hold: this is `add column if
-- not exists`, and no adapter signature changes.
-- =============================================================================

-- A machine-readable failure reason, so the UI can offer the right remedy
-- (reconnect vs retry vs check the provider) without parsing English.
alter table public.organization_integrations
  add column if not exists error_code text;

/**
 * platform_managed vs organization_managed.
 *
 * The spec requires both. platform_managed means a shared account this product
 * operates (a managed Bolna number); organization_managed means the customer's
 * own credentials (their Google Calendar OAuth, their email domain).
 *
 * It matters beyond bookkeeping: a platform_managed integration must NOT expose
 * a disconnect button that would break other tenants, and an
 * organization_managed one must never fall back to platform credentials — a
 * customer whose OAuth expired would otherwise silently start sending invites
 * from our account.
 */
alter table public.organization_integrations
  add column if not exists credential_mode text not null default 'organization_managed'
    check (credential_mode in ('platform_managed', 'organization_managed'));

-- Who connected it, for the audit trail. NULL for platform-managed rows, which
-- no customer user connected.
alter table public.organization_integrations
  add column if not exists connected_by uuid references public.users (id) on delete set null;

create index if not exists idx_organization_integrations_status
  on public.organization_integrations (status);

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organization_settings enable row level security;
alter table public.user_preferences enable row level security;

/**
 * organization_settings SELECT: any member.
 *
 * Deliberately not Owner/Admin-only. These are operating defaults — the default
 * interview duration, the currency — that the whole team's UI reads. Hiding
 * them would mean a Recruiter's interview form could not show the right
 * default, and nothing here is a secret. Credentials live in a different table
 * with a different policy.
 */
drop policy if exists organization_settings_select_member on public.organization_settings;
create policy organization_settings_select_member on public.organization_settings
  for select using (public.is_org_member(organization_id));

-- "Manage organization settings | Owner Yes | Admin Yes | Recruiter No | Viewer No".
drop policy if exists organization_settings_write_owner_admin on public.organization_settings;
create policy organization_settings_write_owner_admin on public.organization_settings
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

/**
 * user_preferences: your own, and only your own.
 *
 * user_id = caller appears in WITH CHECK as well as USING, because the rule
 * constrains what the row may BECOME — without it, a caller could take their own
 * row and reassign its user_id to a colleague, overwriting that person's
 * settings. The same shape Module 15's notification preferences use.
 */
drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all
  using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  )
  with check (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

-- =============================================================================
-- Cross-tenant integrity.
--
-- The default recruiter must be a member of the organization they are the
-- default for. A foreign key to users proves the person exists, not that they
-- are ours — without this, an organization could name a stranger as the default
-- assignee for every new application.
-- =============================================================================
create or replace function public.enforce_settings_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_recruiter_id is not null then
    if not exists (
      select 1
      from public.organization_members m
      where m.user_id = new.default_recruiter_id
        and m.organization_id = new.organization_id
        and m.status = 'active'
    ) then
      raise exception 'Default recruiter is not an active member of this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_organization_settings_tenant_integrity on public.organization_settings;
create trigger trg_organization_settings_tenant_integrity
  before insert or update of default_recruiter_id, organization_id
  on public.organization_settings
  for each row execute function public.enforce_settings_tenant_integrity();

create or replace function public.enforce_user_preferences_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organization_members m
    where m.user_id = new.user_id
      and m.organization_id = new.organization_id
  ) then
    raise exception 'User is not a member of this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_preferences_tenant_integrity on public.user_preferences;
create trigger trg_user_preferences_tenant_integrity
  before insert or update of user_id, organization_id
  on public.user_preferences
  for each row execute function public.enforce_user_preferences_tenant_integrity();

-- =============================================================================
-- Re-assert the credential REVOKE.
--
-- Module 8 revoked column-level SELECT on encrypted_credentials. Restated here
-- because this migration ALTERs the table, and because it is the single control
-- standing between an Owner's browser session and every provider secret the
-- organization owns. Re-running it costs nothing and makes the guarantee
-- present in the file that most obviously touches credentials.
-- =============================================================================
revoke select (encrypted_credentials) on public.organization_integrations from authenticated;
revoke select (encrypted_credentials) on public.organization_integrations from anon;


-- ############################################################################
-- ## 0017_fix_missing_user_profile.sql
-- ############################################################################

-- =============================================================================
-- Fix: an authenticated session with no public.users row causes an infinite
-- redirect loop.
--
-- HOW IT HAPPENS
--
-- public.users rows are created by the on_auth_user_created trigger in
-- migration 0001. Anyone who signed up BEFORE that migration was applied — or
-- during any window where the trigger was absent or failed — has a row in
-- auth.users and none in public.users.
--
-- The application then loops:
--
--   proxy.ts sees a valid Supabase session   -> allows /dashboard
--   /dashboard: getCurrentUser() is null     -> redirect /login
--   proxy.ts sees a valid session on /login  -> redirect /dashboard
--   ...
--
-- The browser gives up with ERR_TOO_MANY_REDIRECTS. Clearing cookies works
-- around it, but the same trap catches the next person it happens to, and the
-- symptom points nowhere near the cause.
--
-- THE FIX
--
-- A security-definer function that backfills the caller's own profile. This is
-- the same defensive upsert create_organization_and_owner() and accept_invite()
-- already perform ("in case the auth.users trigger has not fired yet"); it just
-- needed to be reachable on its own, before either of those is ever called.
--
-- WHY THIS IS SAFE TO EXPOSE
--
--   * It takes NO arguments. There is nothing to tamper with.
--   * It reads auth.uid() only, so a caller can only ever create their OWN row.
--     They cannot name another user, and cannot pass an organization id.
--   * on conflict (auth_id) do nothing — it can never overwrite an existing
--     profile, so it is not a way to change your own name or email.
--   * It grants no membership. A backfilled user has zero organizations and
--     lands on /onboarding, exactly like any new signup.
--
-- The `users` table deliberately has no client-facing INSERT policy, and that
-- stays true: this function runs as its owner, which is why it can insert at
-- all, and why it is written to do exactly one narrow thing.
-- =============================================================================

create or replace function public.ensure_current_user_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- No session, nothing to do. Returning null rather than raising keeps this
  -- callable from a page that has not yet established whether anyone is signed
  -- in.
  if auth.uid() is null then
    return null;
  end if;

  select id into v_user_id from public.users where auth_id = auth.uid();
  if v_user_id is not null then
    return v_user_id;
  end if;

  -- Same shape as the on_auth_user_created trigger, so a backfilled profile is
  -- indistinguishable from one created normally.
  insert into public.users (auth_id, name, email, avatar_url)
  select
    au.id,
    coalesce(
      au.raw_user_meta_data ->> 'name',
      au.raw_user_meta_data ->> 'full_name',
      split_part(au.email, '@', 1)
    ),
    au.email,
    au.raw_user_meta_data ->> 'avatar_url'
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();
  return v_user_id;
end;
$$;

revoke all on function public.ensure_current_user_profile() from public, anon;
grant execute on function public.ensure_current_user_profile() to authenticated;

-- =============================================================================
-- Backfill anyone already stranded.
--
-- Runs once, as the migration author, for every auth user with no profile. A
-- deployment that applies 0001 and 0017 together will match nothing here; a
-- database where people signed up first — which is exactly how this was found —
-- gets them unstuck without each of them having to clear cookies.
-- =============================================================================
insert into public.users (auth_id, name, email, avatar_url)
select
  au.id,
  coalesce(
    au.raw_user_meta_data ->> 'name',
    au.raw_user_meta_data ->> 'full_name',
    split_part(au.email, '@', 1)
  ),
  au.email,
  au.raw_user_meta_data ->> 'avatar_url'
from auth.users au
left join public.users u on u.auth_id = au.id
where u.id is null
  and au.email is not null
on conflict (auth_id) do nothing;


-- ############################################################################
-- ## 0018_bulk_resume_intake.sql
-- ############################################################################

-- =============================================================================
-- Bulk resume intake — "drop N resumes on a job, get N applications"
--
-- Connects Module 3 (Jobs), 4 (Candidates), 5 (Applications) and 6 (Resume AI).
-- Each uploaded file resolves INDEPENDENTLY to one of six outcomes, recorded
-- here so the batch survives the browser tab that started it.
--
-- WHY A TABLE AND NOT CLIENT STATE
--
-- Five of the six outcomes create a durable row somewhere else (a candidate, an
-- application, a resume, a parse result). The sixth — 'match_conflict', where a
-- resume's email points at one candidate and its phone at another — creates
-- NOTHING, by design: the spec forbids guessing. Without this table that file's
-- existence would live only in React state, and closing the modal would destroy
-- the one record that a human still has to act on.
--
-- Storing every outcome rather than only the conflicts also buys the thing the
-- spec asks for directly: "let users close and check back".
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resume_intake_status') then
    create type public.resume_intake_status as enum (
      'queued',              -- accepted, nothing done yet
      'processing',          -- extracting or parsing right now
      'candidate_created',   -- no existing match; new candidate + application
      'candidate_matched',   -- matched an existing candidate; application added
      'already_applied',     -- matched, but this candidate+job pair already existed
      'match_conflict',      -- email matches one candidate, phone another — NOT resolved
      'failed'               -- extraction or parsing failed; see error_message
    );
  end if;
end $$;

-- =============================================================================
-- resume_intake_items
--
-- One row per uploaded file. `batch_id` groups the files a recruiter dropped in
-- together; it is a plain grouping key rather than a foreign key to a batches
-- table, because a batch has no attributes of its own — every question about it
-- ("how many succeeded?") is an aggregate over these rows.
-- =============================================================================
create table if not exists public.resume_intake_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  job_id uuid not null references public.jobs (id) on delete cascade,

  file_name text not null,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),
  file_hash text,

  -- Set only for 'match_conflict'. Every other outcome either attaches the file
  -- to a candidate (and so stores it via public.resumes) or never stores it at
  -- all. A conflicted file is parked at <organization_id>/_intake/... so the
  -- recruiter can still download and read it while deciding.
  storage_path text,

  status public.resume_intake_status not null default 'queued',

  -- The resolved records. Nullable because which ones exist depends on the
  -- outcome: a failure has none, a conflict has none, 'already_applied' has a
  -- candidate and the PRE-EXISTING application.
  candidate_id uuid references public.candidates (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,

  -- 'match_conflict' only: the two (or more) candidates the file pointed at.
  -- Deliberately NOT foreign keys — this is evidence about a decision that was
  -- refused, and it must survive one of those candidates being archived.
  conflict_candidate_ids uuid[] not null default '{}',

  -- 'match_conflict' only: the validated parse output, kept so resolving the
  -- conflict later does not mean paying for the AI call twice.
  parsed_json jsonb,

  -- How many profile fields the resume disagreed with on a MATCHED candidate.
  -- These are queued as an unreviewed resume_parse_results row (Module 6's
  -- existing pattern); this column is the count, so the modal and the profile
  -- banner can say "3 profile updates need your review" without recomputing the
  -- whole comparison.
  queued_conflict_count integer not null default 0 check (queued_conflict_count >= 0),

  error_message text,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_resume_intake_items_org
  on public.resume_intake_items (organization_id);
create index if not exists idx_resume_intake_items_batch
  on public.resume_intake_items (organization_id, batch_id, created_at);
create index if not exists idx_resume_intake_items_job
  on public.resume_intake_items (organization_id, job_id, created_at desc);

-- Backs the job-page "unresolved conflicts" banner. Partial, because conflicts
-- are the rare case and a full index would be almost entirely dead weight.
create index if not exists idx_resume_intake_items_conflicts
  on public.resume_intake_items (organization_id, job_id)
  where status = 'match_conflict';

-- =============================================================================
-- Cross-tenant integrity
--
-- Same reasoning as Modules 5 and 6: a foreign key proves the row exists, not
-- that it belongs to this tenant. Without this, a caller could point an intake
-- item at another organization's job and the FK would happily accept it.
-- =============================================================================
create or replace function public.enforce_resume_intake_tenant_integrity()
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

  if new.candidate_id is not null then
    select organization_id into v_org from public.candidates where id = new.candidate_id;
    if v_org is null or v_org <> new.organization_id then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  if new.application_id is not null then
    select organization_id into v_org from public.applications where id = new.application_id;
    if v_org is null or v_org <> new.organization_id then
      raise exception 'Application does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resume_intake_tenant_integrity on public.resume_intake_items;
create trigger trg_resume_intake_tenant_integrity
  before insert or update of job_id, candidate_id, application_id, organization_id
  on public.resume_intake_items
  for each row execute function public.enforce_resume_intake_tenant_integrity();

-- =============================================================================
-- Row-Level Security
--
-- The API checks the role too, for a readable error message. This is the part
-- that actually holds: the browser has an authenticated PostgREST client, so a
-- Viewer can POST straight to /rest/v1/resume_intake_items and never touch a
-- route handler. WITH CHECK is what stops them.
-- =============================================================================
alter table public.resume_intake_items enable row level security;

drop policy if exists resume_intake_select_member on public.resume_intake_items;
create policy resume_intake_select_member on public.resume_intake_items
  for select using (public.is_org_member(organization_id));

drop policy if exists resume_intake_insert_staff on public.resume_intake_items;
create policy resume_intake_insert_staff on public.resume_intake_items
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists resume_intake_update_staff on public.resume_intake_items;
create policy resume_intake_update_staff on public.resume_intake_items
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists resume_intake_delete_owner_admin on public.resume_intake_items;
create policy resume_intake_delete_owner_admin on public.resume_intake_items
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

-- =============================================================================
-- Storage note
--
-- Conflicted files are parked at <organization_id>/_intake/<uuid>-<name> in the
-- existing private 'resumes' bucket. No new policy is needed: the Module 6
-- policies authorise on the FIRST path segment, which is still the organization
-- id, so a member of org A can neither read nor write anything under org B's
-- _intake folder either.
-- =============================================================================


-- ############################################################################
-- ## 0019_intake_manual_reconnect.sql
-- ############################################################################

-- =============================================================================
-- Bulk intake — manual "connect to existing candidate"
--
-- Automatic matching is right most of the time and wrong some of the time. This
-- migration adds what is needed to CORRECT it after the fact, on any file, in
-- any state — not only on the ambiguous ones the matcher refused to decide.
--
-- Correcting an auto-match is a destructive operation: it can delete a
-- candidate record and an application that were created seconds earlier. The
-- columns below exist so that what was undone is recoverable as a fact even
-- though the rows themselves are gone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 'manually_connected' — a seventh outcome.
--
-- Deliberately NOT reusing 'candidate_matched'. A recruiter reading the list a
-- week later needs to know which links a human made and which the matcher made;
-- collapsing them would erase exactly the audit the correction exists to leave.
--
-- Guarded rather than bare, because ALTER TYPE ... ADD VALUE is not idempotent
-- and every migration in this project must be re-runnable.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'resume_intake_status' and e.enumlabel = 'manually_connected'
  ) then
    alter type public.resume_intake_status add value 'manually_connected';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- What the correction replaced.
-- -----------------------------------------------------------------------------
alter table public.resume_intake_items
  -- The candidate automatic matching chose, kept even after that candidate is
  -- deleted. NOT a foreign key, on purpose: the whole point of a reconnection
  -- is that this row may no longer exist, and an FK would either block the
  -- cleanup or null out the evidence of it.
  add column if not exists auto_candidate_id uuid,
  -- The status before the correction, so "was this originally a new candidate
  -- or a wrong match?" survives.
  add column if not exists auto_status public.resume_intake_status,
  -- What actually happened to the orphaned auto-created candidate:
  --   'deleted'  — it was still pristine and was hard-deleted
  --   'archived' — it had picked up other work and was archived instead
  --   'kept'     — nothing to clean up (the auto-match found an existing person)
  add column if not exists cleanup_action text
    check (cleanup_action is null or cleanup_action in ('deleted', 'archived', 'kept')),
  add column if not exists reconnected_at timestamptz,
  add column if not exists reconnected_by uuid references public.users (id) on delete set null;

-- =============================================================================
-- Deleting a candidate must not silently delete their history.
--
-- public.resumes.candidate_id is ON DELETE CASCADE, so hard-deleting an
-- orphaned candidate would take any resume still attached to them with it —
-- including the file the recruiter just uploaded, if the application code
-- re-pointed the rows in the wrong order.
--
-- The application does re-point first. This trigger is the guarantee that it
-- had to: a delete that would take a resume with it is refused outright, which
-- turns a silent data loss into a loud error.
-- =============================================================================
create or replace function public.guard_candidate_delete_with_resumes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resumes integer;
begin
  select count(*) into v_resumes from public.resumes where candidate_id = old.id;

  if v_resumes > 0 then
    raise exception
      'Cannot delete a candidate with % resume(s) on file; move or delete them first', v_resumes;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_candidates_guard_delete on public.candidates;
create trigger trg_candidates_guard_delete
  before delete on public.candidates
  for each row execute function public.guard_candidate_delete_with_resumes();

-- =============================================================================
-- Deleting a candidate at all.
--
-- Module 4 gave candidates no DELETE policy — archiving was the only removal,
-- which was right when every candidate was created by a human. Bulk intake
-- creates them automatically, so an automatic mistake needs an automatic undo.
--
-- Owner/Admin/Recruiter, matching who may create one. The trigger above plus
-- the application's own pristine-check are what keep this narrow; the policy
-- only decides who may ask.
-- =============================================================================
drop policy if exists candidates_delete_staff on public.candidates;
create policy candidates_delete_staff on public.candidates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- Backs the "does this candidate appear in any other intake item?" check that
-- decides between deleting and archiving.
create index if not exists idx_resume_intake_items_candidate
  on public.resume_intake_items (organization_id, candidate_id)
  where candidate_id is not null;


-- ############################################################################
-- ## 0020_job_hiring_stages.sql
-- ############################################################################

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


-- ############################################################################
-- ## 0021_pipeline_stage_redefinition.sql
-- ############################################################################

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


-- ############################################################################
-- ## 0022_application_evaluations.sql
-- ############################################################################

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
