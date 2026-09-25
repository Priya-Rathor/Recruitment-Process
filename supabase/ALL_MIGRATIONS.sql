-- =============================================================================
-- ALL MIGRATIONS, concatenated in order.
-- Generated from supabase/migrations/. Paste into the Supabase SQL Editor.
--
-- REGENERATE THIS FILE WHENEVER YOU ADD A MIGRATION. It went stale once —  it
-- stopped at 0031 while nine more had landed, so a workspace built from it was
-- missing privacy settings, forms, voice agents, stage workflows, custom fields
-- and the S-01 invite fix, and every symptom looked like an application bug.
--
--   python3 - <<'EOF'
--   import glob
--   files = sorted(glob.glob("supabase/migrations/*.sql"))
--   ...  (the generator lives in docs/DEPLOYMENT.md section 5)
--   EOF
--
-- Order is filename order and is load-bearing: later files reference tables,
-- enums and functions the earlier ones create.
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

-- ############################################################################
-- ## 0023_application_edit_candidate_profile.sql
-- ############################################################################

-- =============================================================================
-- Editable application fields, and a fuller candidate profile.
--
-- Two small additions, one boundary made explicit.
--
-- THE BOUNDARY: name, email and phone belong to the CANDIDATE, not to an
-- application. A candidate can hold five applications, and letting any of them
-- edit the person's phone number means five screens racing to own one fact.
-- The application API refuses those fields outright (see
-- lib/applications/validation.ts), and this migration adds nothing to
-- `applications` that could be mistaken for identity.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- applications.priority
--
-- Same vocabulary as notifications.priority (migration 0014) rather than a new
-- enum: two "priority" scales in one product means every reader has to ask
-- which one they are looking at. A plain text CHECK, matching that precedent.
-- -----------------------------------------------------------------------------
alter table public.applications
  add column if not exists priority text not null default 'normal';

alter table public.applications drop constraint if exists applications_priority_valid;
alter table public.applications
  add constraint applications_priority_valid
  check (priority in ('low', 'normal', 'high'));

comment on column public.applications.priority is
  'Recruiter-set urgency for this application. Not derived from stage or SLA.';

-- Partial: 'normal' is the default and the overwhelming majority, so indexing it
-- would be indexing the whole table to find nothing interesting.
create index if not exists idx_applications_priority
  on public.applications (organization_id, priority)
  where priority <> 'normal';

-- -----------------------------------------------------------------------------
-- candidates.education and candidates.employment_history
--
-- jsonb arrays rather than two child tables. The deciding question is whether
-- anything will ever QUERY inside them — filter candidates by institution, or
-- aggregate by employer. Nothing in the spec does; they are displayed on one
-- profile and edited as a block. A child table would add two more RLS policies,
-- two more tenant triggers and a join to every profile read, to support
-- ordering and querying that nobody asked for.
--
-- If that changes, the promotion path is a normal one: create the table,
-- backfill from the jsonb, drop the column.
--
-- Shape is validated in lib/candidates/profile.ts before anything is written.
-- The browser holds a PostgREST client and can write these columns directly, so
-- that is a "keep the UI's input sane" guard, not a security boundary — RLS
-- decides who may write, and it already does.
-- -----------------------------------------------------------------------------
alter table public.candidates
  add column if not exists education jsonb not null default '[]'::jsonb,
  add column if not exists employment_history jsonb not null default '[]'::jsonb;

comment on column public.candidates.education is
  'Array of {degree, institution, year}. Display and edit only — not queried into.';
comment on column public.candidates.employment_history is
  'Array of {company, role, duration}. The candidate''s previous employers.';

-- Both must be ARRAYS. Without this a caller could store an object or a string
-- and every reader would need its own defensive check.
alter table public.candidates drop constraint if exists candidates_education_is_array;
alter table public.candidates
  add constraint candidates_education_is_array
  check (jsonb_typeof(education) = 'array');

alter table public.candidates drop constraint if exists candidates_employment_is_array;
alter table public.candidates
  add constraint candidates_employment_is_array
  check (jsonb_typeof(employment_history) = 'array');

-- ############################################################################
-- ## 0024_structured_evaluation.sql
-- ############################################################################

-- =============================================================================
-- Structured evaluation results: strengths and concerns alongside the score.
--
-- The pattern, applied to every round that produces a result:
--
--   score  +  status  +  key strengths  +  key concerns  (+ the narrative)
--
-- The narrative summary STAYS. A summary answers "what happened"; the lists
-- answer "what should I look at". Collapsing either into the other loses one of
-- them, so both are kept.
--
-- WHAT THIS MIGRATION DOES *NOT* ADD, because it already exists:
--
--   * The resume/match round. application_matches (Module 7) already stores
--     strong_matches, gaps and needs_verification — labelled lists that ARE
--     strengths and concerns, each tagged with whether code or AI produced it.
--     Adding parallel columns would create a second source of truth for the
--     same judgement, so the read model derives from those instead.
--
--   * Per-stage passing thresholds for the four configurable stages. Those live
--     in job_hiring_stages.config, which is jsonb and needs no DDL — see
--     lib/hiring-stages/config.ts.
--
-- A NOTE ON THE BRIEF: it asked to "reuse the passing_score pattern already
-- built for Written Assessment". No such pattern existed — that stage's config
-- was questions + timeLimitMinutes only. The threshold is therefore new, and is
-- added to all four stages plus the resume gate at once rather than to one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Screening call results (Modules 8/9).
--
-- text[] rather than jsonb: these are lists of sentences with no internal
-- structure, and an array keeps them queryable with the ordinary array
-- operators rather than needing a jsonb path everywhere they are read.
-- -----------------------------------------------------------------------------
alter table public.screening_reports
  add column if not exists key_strengths text[] not null default '{}',
  add column if not exists key_concerns text[] not null default '{}';

comment on column public.screening_reports.key_strengths is
  'Two to four short points in the candidate''s favour. Supplements summary_text.';
comment on column public.screening_reports.key_concerns is
  'Two to four short points against. Supplements summary_text, never replaces it.';

-- -----------------------------------------------------------------------------
-- Manually logged rounds (phone, video, assessment, director).
--
-- OPTIONAL here, deliberately. These entries are typed by a recruiter after a
-- conversation, and requiring two bulleted lists before a call can be recorded
-- would push people into logging nothing at all.
-- -----------------------------------------------------------------------------
alter table public.application_evaluations
  add column if not exists key_strengths text[] not null default '{}',
  add column if not exists key_concerns text[] not null default '{}';

comment on column public.application_evaluations.key_strengths is
  'Optional. Free text when a human logged the round; AI-produced when graded.';

-- -----------------------------------------------------------------------------
-- The resume/match gate's threshold.
--
-- On `jobs` rather than in job_hiring_stages.config, because the resume match
-- is not one of the four toggleable stages — every application is scored
-- against its job whether or not any stage is switched on.
--
-- Nullable with no default. A threshold nobody set must read as "not judged"
-- rather than silently failing every candidate below an invented number: see
-- statusFor() in lib/evaluation/verdict.ts, where a missing threshold yields
-- Needs Review rather than Fail.
-- -----------------------------------------------------------------------------
alter table public.jobs
  add column if not exists resume_passing_score integer
    check (resume_passing_score is null
           or (resume_passing_score >= 0 and resume_passing_score <= 100));

comment on column public.jobs.resume_passing_score is
  'Match percentage at or above which a resume passes this job''s first gate. Null = no gate configured; results read as Needs Review.';

-- ############################################################################
-- ## 0025_retire_standalone_interview_questions.sql
-- ############################################################################

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

-- ############################################################################
-- ## 0026_module19_onboarding_documents.sql
-- ############################################################################

-- =============================================================================
-- Module 19: Onboarding & Document Management
--
-- Collects and verifies every document a new hire owes, from the moment an
-- application reaches Hired.
--
-- THREE DECISIONS IN THIS FILE ARE LOAD-BEARING.
--
-- 1. CREATION IS A TRIGGER, NOT ROUTE CODE.
--    The browser holds an authenticated PostgREST client, and a stage change
--    also arrives from the pipeline board and from Module 13's automation
--    engine. A record created in the PATCH handler would simply not exist for
--    any of those paths, and a hire with no onboarding record is invisible —
--    there is no manual "start onboarding" action to recover with, by design.
--    Same reasoning as trg_applications_stage_history in migration 0004.
--
-- 2. DOCUMENTS ARE COPIED FROM THE TEMPLATES, NOT JOINED TO THEM.
--    name and expected_from are snapshotted at creation. The spec requires that
--    editing the checklist never disturbs a hire already midway through it, and
--    a join would make every in-progress checklist change under them the moment
--    an Admin renamed a row.
--
-- 3. WHAT A ROW MAY BECOME IS ENFORCED IN THE POLICY.
--    "Recruiters cannot verify" is a rule about a status transition, so it lives
--    in WITH CHECK. A recruiter with the anon key and a REST client would
--    otherwise self-verify their own uploads, and the whole point of the
--    verification step is that a second person looked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_owner') then
    create type public.document_owner as enum ('candidate', 'recruiter');
  end if;

  if not exists (select 1 from pg_type where typname = 'onboarding_status') then
    create type public.onboarding_status as enum ('in_progress', 'completed', 'on_hold');
  end if;

  if not exists (select 1 from pg_type where typname = 'onboarding_document_status') then
    create type public.onboarding_document_status as enum
      ('pending', 'uploaded', 'verified', 'rejected');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- organization_document_templates — the checklist an org defines once
-- -----------------------------------------------------------------------------
create table if not exists public.organization_document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (btrim(name) <> '' and length(name) <= 120),
  description text check (description is null or length(description) <= 500),

  required boolean not null default true,

  -- Who is EXPECTED to provide it. Not who did — that is on the document row.
  expected_from public.document_owner not null default 'candidate',

  display_order integer not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Two identically-named document types in one checklist is always a mistake,
  -- and it makes the checklist unreadable ("PAN Card" twice, one verified).
  constraint organization_document_templates_unique_name
    unique (organization_id, name)
);

create index if not exists idx_document_templates_org
  on public.organization_document_templates (organization_id, display_order, created_at);
create index if not exists idx_document_templates_org_active
  on public.organization_document_templates (organization_id) where active;

-- -----------------------------------------------------------------------------
-- onboarding_records — one per hire
-- -----------------------------------------------------------------------------
create table if not exists public.onboarding_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- UNIQUE, and that is the whole "exactly one record per hire" guarantee.
  -- An application moved out of Hired and back in must not get a second
  -- checklist, nor have its first one reset.
  application_id uuid not null unique references public.applications (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,

  status public.onboarding_status not null default 'in_progress',

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  assigned_to uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- completed_at and status cannot disagree. Analytics reads both.
  constraint onboarding_records_completed_at_matches_status check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists idx_onboarding_records_org
  on public.onboarding_records (organization_id, status, started_at);
create index if not exists idx_onboarding_records_candidate
  on public.onboarding_records (candidate_id);
create index if not exists idx_onboarding_records_assigned
  on public.onboarding_records (organization_id, assigned_to);

-- -----------------------------------------------------------------------------
-- onboarding_documents — one row per document per hire
-- -----------------------------------------------------------------------------
--
-- organization_id is here even though it is reachable through the parent. Every
-- table in this product carries it and is filtered on it directly: the admin
-- client bypasses RLS and every query made with it must filter the tenant
-- explicitly, which a join-only column cannot support.
--
-- expected_from vs uploaded_by: the spec called both of these "uploaded_by",
-- which are two different facts — who OUGHT to provide the file, and which user
-- actually put it there. One name for both would have been a bug waiting to be
-- written, so they are separate columns.
-- -----------------------------------------------------------------------------
create table if not exists public.onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  onboarding_record_id uuid not null
    references public.onboarding_records (id) on delete cascade,

  -- Null for a one-off document added for this hire alone. Set null rather than
  -- cascading when a template is deleted: the document itself is still real.
  template_id uuid references public.organization_document_templates (id) on delete set null,

  name text not null check (btrim(name) <> '' and length(name) <= 120),
  required boolean not null default true,
  expected_from public.document_owner not null default 'candidate',
  display_order integer not null default 0,

  status public.onboarding_document_status not null default 'pending',

  -- Storage object path inside the private 'onboarding-documents' bucket.
  file_url text,
  file_name text,
  file_type text,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),

  uploaded_by uuid references public.users (id) on delete set null,
  uploaded_at timestamptz,

  verified_by uuid references public.users (id) on delete set null,
  verified_at timestamptz,

  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 500),
  notes text check (notes is null or length(notes) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A status is a claim about the row's own contents. These stop the claim and
  -- the contents drifting apart, whichever client wrote the row.
  constraint onboarding_documents_uploaded_has_file check (
    status = 'pending' or file_url is not null
  ),
  constraint onboarding_documents_verified_has_verifier check (
    (status = 'verified') = (verified_by is not null and verified_at is not null)
  ),
  -- The spec: "Reject requires a short reason". Enforced here so it holds for a
  -- direct PostgREST write too, not only in the form.
  constraint onboarding_documents_rejected_has_reason check (
    status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> ''
  ),
  -- One row per template per hire. Without this, re-running generation would
  -- silently duplicate the checklist.
  constraint onboarding_documents_unique_template
    unique (onboarding_record_id, template_id)
);

create index if not exists idx_onboarding_documents_record
  on public.onboarding_documents (onboarding_record_id, required desc, display_order);
create index if not exists idx_onboarding_documents_org_status
  on public.onboarding_documents (organization_id, status);

-- updated_at maintenance (touch_updated_at() from Module 3).
drop trigger if exists trg_document_templates_touch on public.organization_document_templates;
create trigger trg_document_templates_touch
  before update on public.organization_document_templates
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_onboarding_records_touch on public.onboarding_records;
create trigger trg_onboarding_records_touch
  before update on public.onboarding_records
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_onboarding_documents_touch on public.onboarding_documents;
create trigger trg_onboarding_documents_touch
  before update on public.onboarding_documents
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Tenant integrity
--
-- RLS proves the WRITER belongs to the org named on the row. It does not prove
-- the row's own foreign keys point inside that org. A member of org A inserting
-- with organization_id = A and a record_id belonging to org B satisfies every
-- policy and creates a cross-tenant link. Same trap Module 4 hit, same guard.
-- =============================================================================
create or replace function public.enforce_onboarding_document_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_org uuid;
  v_template_org uuid;
begin
  select organization_id into v_record_org
  from public.onboarding_records where id = new.onboarding_record_id;

  if v_record_org is null or v_record_org <> new.organization_id then
    raise exception 'Onboarding record does not belong to this organization';
  end if;

  if new.template_id is not null then
    select organization_id into v_template_org
    from public.organization_document_templates where id = new.template_id;

    if v_template_org is null or v_template_org <> new.organization_id then
      raise exception 'Document template does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_onboarding_documents_tenant_integrity on public.onboarding_documents;
create trigger trg_onboarding_documents_tenant_integrity
  before insert or update of onboarding_record_id, template_id, organization_id
  on public.onboarding_documents
  for each row execute function public.enforce_onboarding_document_tenant_integrity();

-- =============================================================================
-- The default checklist
--
-- Seeded ONCE per organization, and only when it has no templates at all. An
-- org that deliberately deleted every row is not re-seeded on the next call —
-- putting "PAN Card" back after somebody removed it would be the product
-- overruling a decision it was told about.
-- =============================================================================
create or replace function public.seed_default_document_templates(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if exists (
    select 1 from public.organization_document_templates
    where organization_id = p_organization_id
  ) then
    return 0;
  end if;

  -- Required-first ordering, and the two documents a recruiter produces sit
  -- where they actually happen: the signed offer letter comes before the
  -- candidate's paperwork chase.
  insert into public.organization_document_templates
    (organization_id, name, description, required, expected_from, display_order)
  values
    (p_organization_id, 'Signed Offer Letter',
     'The countersigned offer, filed by the recruiter.', true, 'recruiter', 1),
    (p_organization_id, 'PAN Card',
     'Permanent Account Number card, for payroll and tax.', true, 'candidate', 2),
    (p_organization_id, 'Aadhaar / Government ID',
     'Any government photo ID. Aadhaar is the usual one in India.', true, 'candidate', 3),
    (p_organization_id, 'Educational Certificates',
     'Degree or diploma certificates for the highest qualification claimed.',
     true, 'candidate', 4),
    (p_organization_id, 'Bank Account Details',
     'Cancelled cheque or bank letter, for salary credit.', true, 'candidate', 5),
    (p_organization_id, 'Background Verification Consent',
     'Written consent before any background check is run. Not optional — a check '
     || 'run without it is unlawful in most jurisdictions.',
     true, 'candidate', 6),
    (p_organization_id, 'Previous Employment Relieving Letter',
     'From the last employer. Optional: a first-time employee has none, and a '
     || 'candidate serving notice may not have it yet.',
     false, 'candidate', 7)
  on conflict (organization_id, name) do nothing;

  select count(*)::integer into v_inserted
  from public.organization_document_templates
  where organization_id = p_organization_id;

  return v_inserted;
end;
$$;

revoke all on function public.seed_default_document_templates(uuid) from public, anon;
grant execute on function public.seed_default_document_templates(uuid) to authenticated;

-- Every organization that already exists. Without this, only orgs created after
-- this migration would have a checklist, and the Settings screen would open
-- empty for everyone currently using the product.
do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    perform public.seed_default_document_templates(v_org.id);
  end loop;
end $$;

-- New organizations. create_organization_and_owner() is re-created rather than
-- wrapped, so there is still exactly one place an organization is born.
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

  -- Module 19. A new org gets a working onboarding checklist without having to
  -- discover the Settings screen first.
  perform public.seed_default_document_templates(v_org.id);

  return v_org;
end;
$$;

revoke all on function public.create_organization_and_owner(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_organization_and_owner(text, text, text, text, text)
  to authenticated;

-- =============================================================================
-- Auto-creation on Hired
--
-- ON CONFLICT DO NOTHING against the unique application_id: moving an
-- application out of Hired and back in finds the existing record and leaves it
-- exactly as it was. Re-generating would wipe verified documents, which is the
-- worst possible outcome of a stage correction.
--
-- The documents are generated in the SAME transaction from the templates active
-- at that moment. That is what makes "editing the checklist does not disturb a
-- hire in progress" true by construction rather than by convention.
-- =============================================================================
create or replace function public.create_onboarding_on_hire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
begin
  if new.stage <> 'hired' then
    return new;
  end if;

  -- Only on entry. An UPDATE that touches nothing else about a row already at
  -- hired must not re-run generation.
  if tg_op = 'UPDATE' and old.stage = 'hired' then
    return new;
  end if;

  insert into public.onboarding_records
    (organization_id, application_id, candidate_id, job_id, status, started_at, assigned_to)
  values
    (new.organization_id, new.id, new.candidate_id, new.job_id, 'in_progress', now(),
     -- Whoever owns the application owns the paperwork. Null is fine and shows
     -- as Unassigned; inventing an assignee would put work on someone silently.
     new.assigned_recruiter_id)
  on conflict (application_id) do nothing
  returning id into v_record_id;

  -- Nothing inserted: this hire already has a record. Leave it alone.
  if v_record_id is null then
    return new;
  end if;

  insert into public.onboarding_documents
    (organization_id, onboarding_record_id, template_id, name, required,
     expected_from, display_order, status)
  select
    new.organization_id,
    v_record_id,
    t.id,
    t.name,
    t.required,
    t.expected_from,
    t.display_order,
    'pending'
  from public.organization_document_templates t
  where t.organization_id = new.organization_id
    and t.active
  order by t.display_order, t.created_at;

  return new;
end;
$$;

drop trigger if exists trg_applications_create_onboarding on public.applications;
create trigger trg_applications_create_onboarding
  after insert or update of stage on public.applications
  for each row execute function public.create_onboarding_on_hire();

-- =============================================================================
-- Applications ALREADY at Hired
--
-- These reached Hired before this module existed, so no trigger ever saw them.
-- They are backfilled deliberately: there is no manual "start onboarding"
-- action anywhere in the product, so without this their paperwork would be
-- permanently unmanageable — a dead end rather than a missing feature.
--
-- started_at is taken from when the application actually entered Hired, so the
-- list's "waiting longest first" sort tells the truth on day one.
-- =============================================================================
insert into public.onboarding_records
  (organization_id, application_id, candidate_id, job_id, status, started_at, assigned_to)
select
  a.organization_id,
  a.id,
  a.candidate_id,
  a.job_id,
  'in_progress',
  coalesce(
    (select max(h.entered_at) from public.application_stage_history h
     where h.application_id = a.id and h.stage = 'hired'),
    a.updated_at,
    a.created_at
  ),
  a.assigned_recruiter_id
from public.applications a
where a.stage = 'hired'
on conflict (application_id) do nothing;

insert into public.onboarding_documents
  (organization_id, onboarding_record_id, template_id, name, required,
   expected_from, display_order, status)
select
  r.organization_id, r.id, t.id, t.name, t.required, t.expected_from, t.display_order, 'pending'
from public.onboarding_records r
join public.organization_document_templates t
  on t.organization_id = r.organization_id and t.active
on conflict (onboarding_record_id, template_id) do nothing;

-- =============================================================================
-- Who may manage a record
--
-- Owner/Admin: any record. Recruiter: the ones assigned to them, plus
-- unassigned ones — the same rule Module 5 applies to applications, and for the
-- same reason: a recruiter has to be able to pick up work nobody has claimed.
--
-- SECURITY DEFINER so a policy can call it without needing to read
-- organization_members itself.
-- =============================================================================
create or replace function public.can_manage_onboarding(p_record_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org uuid;
  v_assigned uuid;
begin
  select organization_id, assigned_to into v_org, v_assigned
  from public.onboarding_records where id = p_record_id;

  if v_org is null then
    return false;
  end if;

  if public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    return true;
  end if;

  if not public.has_org_role(v_org, array['recruiter']::public.org_role[]) then
    return false;
  end if;

  return v_assigned is null or v_assigned = public.current_app_user_id();
end;
$$;

revoke all on function public.can_manage_onboarding(uuid) from public, anon;
grant execute on function public.can_manage_onboarding(uuid) to authenticated;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organization_document_templates enable row level security;
alter table public.onboarding_records enable row level security;
alter table public.onboarding_documents enable row level security;

-- ---- templates: read by any member, written by Owner/Admin only -------------
--
-- A Recruiter reads them because the checklist names appear on every hire's
-- page. They do not write them: the checklist is an organization-wide policy
-- decision, and one recruiter deciding a relieving letter is optional changes
-- it for every hire from then on.
drop policy if exists document_templates_select_member on public.organization_document_templates;
create policy document_templates_select_member on public.organization_document_templates
  for select using (public.is_org_member(organization_id));

drop policy if exists document_templates_insert_admin on public.organization_document_templates;
create policy document_templates_insert_admin on public.organization_document_templates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists document_templates_update_admin on public.organization_document_templates;
create policy document_templates_update_admin on public.organization_document_templates
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists document_templates_delete_admin on public.organization_document_templates;
create policy document_templates_delete_admin on public.organization_document_templates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

-- ---- records ----------------------------------------------------------------
--
-- NO INSERT POLICY. The only writer is the SECURITY DEFINER trigger above.
-- Creation is a consequence of a stage change, never an action, so a client
-- that could insert one could manufacture a hire nobody hired.
drop policy if exists onboarding_records_select_member on public.onboarding_records;
create policy onboarding_records_select_member on public.onboarding_records
  for select using (public.is_org_member(organization_id));

-- Status and assignment, by whoever may manage this record.
--
-- The WITH CHECK re-states can_manage_onboarding so a Recruiter cannot reassign
-- a record to themselves and then act on it, nor hand their own record to
-- someone else and lose it. It also pins organization_id and application_id:
-- moving a record between tenants or between hires is never a legitimate edit.
drop policy if exists onboarding_records_update_staff on public.onboarding_records;
create policy onboarding_records_update_staff on public.onboarding_records
  for update
  using (public.can_manage_onboarding(id))
  with check (
    public.can_manage_onboarding(id)
    and public.is_org_member(organization_id)
  );

-- No DELETE policy: a hire's paperwork history is not disposable. An onboarding
-- record dies only with its application.

-- ---- documents --------------------------------------------------------------
drop policy if exists onboarding_documents_select_member on public.onboarding_documents;
create policy onboarding_documents_select_member on public.onboarding_documents
  for select using (public.is_org_member(organization_id));

-- Adding a one-off document. Never pre-verified: a row may only be born
-- 'pending', so "upload and verify in one step" is not reachable even by an
-- Admin writing directly.
drop policy if exists onboarding_documents_insert_staff on public.onboarding_documents;
create policy onboarding_documents_insert_staff on public.onboarding_documents
  for insert with check (
    public.can_manage_onboarding(onboarding_record_id)
    and status = 'pending'
    and verified_by is null
    and verified_at is null
  );

-- THE VERIFICATION BOUNDARY.
--
-- Two update policies, OR'ed. Owner/Admin get the unrestricted one. Recruiters
-- get a narrower one that cannot produce a verified or rejected row — the
-- transition itself is refused by the database, not just by a button that is
-- not rendered.
--
-- The Recruiter policy also refuses to touch a row that is already verified:
-- silently replacing a checked document with a new file would undo the check
-- without anyone being told.
drop policy if exists onboarding_documents_update_admin on public.onboarding_documents;
create policy onboarding_documents_update_admin on public.onboarding_documents
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    -- A verification records WHO verified. Stamping someone else's name on your
    -- own review defeats the second-pair-of-eyes rule the step exists for.
    and (status <> 'verified' or verified_by = public.current_app_user_id())
  );

drop policy if exists onboarding_documents_update_recruiter on public.onboarding_documents;
create policy onboarding_documents_update_recruiter on public.onboarding_documents
  for update
  using (
    public.has_org_role(organization_id, array['recruiter']::public.org_role[])
    and public.can_manage_onboarding(onboarding_record_id)
    and status <> 'verified'
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.org_role[])
    and public.can_manage_onboarding(onboarding_record_id)
    -- The whole rule, in one line: a Recruiter may move a document to pending or
    -- uploaded, and nowhere else.
    and status in ('pending', 'uploaded')
    and verified_by is null
    and verified_at is null
  );

-- Deleting a one-off document somebody added by mistake. Template-generated
-- rows are NOT deletable: they are the organization's checklist, and removing
-- one would quietly shrink what this hire owes.
drop policy if exists onboarding_documents_delete_admin on public.onboarding_documents;
create policy onboarding_documents_delete_admin on public.onboarding_documents
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and template_id is null
  );

-- =============================================================================
-- Storage — the private 'onboarding-documents' bucket
--
-- Paths are `<organization_id>/<onboarding_record_id>/<uuid>-<filename>` and the
-- policies authorise on the FIRST segment, exactly as Module 6's resumes bucket
-- does. Identity documents are the most sensitive files in this product; the
-- bucket is private and every read goes through a short-lived signed URL.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onboarding-documents',
  'onboarding-documents',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists onboarding_docs_storage_select on storage.objects;
create policy onboarding_docs_storage_select on storage.objects
  for select using (
    bucket_id = 'onboarding-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists onboarding_docs_storage_insert on storage.objects;
create policy onboarding_docs_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'onboarding-documents'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin', 'recruiter']::public.org_role[]
    )
  );

drop policy if exists onboarding_docs_storage_delete on storage.objects;
create policy onboarding_docs_storage_delete on storage.objects
  for delete using (
    bucket_id = 'onboarding-documents'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.org_role[]
    )
  );

-- =============================================================================
-- Reminder configuration lives on organization_settings, next to every other
-- org-level default, rather than in a table of its own.
-- =============================================================================
alter table public.organization_settings
  add column if not exists onboarding_settings jsonb not null default
    '{"pendingReminderDays": 3}'::jsonb;

comment on column public.organization_settings.onboarding_settings is
  'Module 19. pendingReminderDays: how long a required document may sit Pending before the assignee is reminded. 0 disables the reminder.';

comment on table public.onboarding_records is
  'Module 19. One per hire, created by trg_applications_create_onboarding when an application enters the hired stage. No client INSERT policy exists.';

comment on table public.onboarding_documents is
  'Module 19. Snapshotted from organization_document_templates at creation — never joined to them, so editing the checklist cannot disturb a hire already in progress.';

-- ############################################################################
-- ## 0027_resume_score_stage.sql
-- ############################################################################

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

-- ############################################################################
-- ## 0028_agency_mode.sql
-- ############################################################################

-- =============================================================================
-- Agency mode — one product, two kinds of buyer.
--
-- The product was built for a recruitment AGENCY: an organization that recruits
-- on behalf of other companies, and therefore has `clients` (Module 12),
-- candidate submissions, and feedback-turnaround SLAs.
--
-- It is also sold to IN-HOUSE teams, who hire for themselves. For them there is
-- no third party to submit a candidate to, so every client-facing surface is
-- dead weight: a nav item leading to a page that will always be empty, a "no
-- client" dropdown on every job, an analytics tab with nothing in it.
--
-- This flag says which one an organization is. It is a VISIBILITY switch, not a
-- permission:
--
--   * It hides client-facing UI. It does not restrict access to anything, so it
--     is deliberately NOT enforced in RLS — there would be nothing to enforce.
--     Role checks continue to be the security boundary (see 0011).
--   * It destroys nothing. An organization that switches to in-house keeps its
--     clients, submissions and feedback history; switching back shows them
--     again, unchanged. Turning a toggle off must never be a delete.
--
-- Defaults to TRUE so every organization that exists today keeps exactly the
-- behaviour it has now. Only new organizations answer the question, in
-- onboarding step 2.
--
-- No new policy: `organizations_update_owner_admin` (migration 0001) already
-- gates every column of this table to Owner/Admin, this one included.
-- =============================================================================

alter table public.organizations
  add column if not exists agency_mode boolean not null default true;

comment on column public.organizations.agency_mode is
  'True = recruits for client companies (Module 12 clients, submissions and '
  'feedback SLAs are shown). False = hires for itself; those surfaces are '
  'hidden. Visibility only — no data is deleted when this is turned off.';

-- ############################################################################
-- ## 0029_automation_upgrade.sql
-- ############################################################################

-- =============================================================================
-- Module 13 upgrade — scheduler, approvals, guardrails.
--
-- Five things happen here, in order of how badly they were needed:
--
--   1. A BUG FIX. Migration 0012 gave automation_runs a SELECT and an INSERT
--      policy and deliberately no UPDATE policy, reasoning that "a run record is
--      the evidence of what the system did to a candidate". But the engine
--      CLAIMS a run row first and then completes it with an UPDATE — so RLS
--      silently discarded every completion, and every run in the product has
--      been stuck at status='skipped', reason='Running…' since Module 13
--      shipped. The intent was right; the policy was too wide a ban.
--
--      The fix keeps the intent: a run may be completed ONCE and never rewritten.
--      Enforced by a trigger, not by route code, because the browser holds an
--      authenticated PostgREST client.
--
--   2. TIME BECOMES A TRIGGER. Nothing in this product runs on a clock — see the
--      comment on /api/notifications/reminders. automation_sweeps records each
--      pass so the UI can say when the scheduler last ran, or say plainly that
--      it never has, instead of implying rules fire on time.
--
--   3. HUMAN OVERSIGHT AS A SETTING. automations.requires_approval turns an
--      action into a PROPOSAL: the run stops at awaiting_approval and a named
--      person approves or rejects it. The EU AI Act's high-risk employment rules
--      (Annex III, applying from 2 August 2026) require an overseer with "the
--      effective capacity to intervene"; this is that capacity, as a feature
--      rather than a promise.
--
--   4. GUARDRAILS. A per-rule daily cap and an organization-wide kill switch.
--      0012's dedupe index bounds how often a rule can fire for ONE application;
--      neither bounds a rule loose across a thousand of them.
--
--   5. CONCURRENT EDITS. automations.version, bumped by a trigger, so two admins
--      editing one rule can be told rather than silently overwriting each other.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New run status: awaiting_approval.
--
-- add value if not exists, not a type swap. Migration 0021 is the cautionary
-- tale for swapping an enum type out from under dependent views and triggers.
-- -----------------------------------------------------------------------------
alter type public.automation_run_status add value if not exists 'awaiting_approval';

-- -----------------------------------------------------------------------------
-- 2. automations — oversight, guardrails, concurrency.
-- -----------------------------------------------------------------------------
alter table public.automations
  -- Human-in-the-loop. When true, the rule's actions are PROPOSED and a person
  -- approves them. Forced true by the API for any action that contacts a
  -- candidate directly; an admin may also switch it on for any rule.
  add column if not exists requires_approval boolean not null default false,

  -- Guardrail. Null means no cap. Counted per organization-day in the org's own
  -- timezone, not the server's.
  add column if not exists daily_run_cap integer
    check (daily_run_cap is null or daily_run_cap > 0),

  -- Optimistic concurrency. Bumped by a trigger on every update, so it is
  -- truthful even for a direct PostgREST write; the API compares against it and
  -- refuses a stale edit with a readable message.
  add column if not exists version integer not null default 1,

  -- Why a rule stopped. Set when the engine pauses a rule itself — a cap hit, a
  -- repeated failure. A rule that went quiet without explanation is the thing
  -- this avoids.
  add column if not exists paused_reason text;

-- -----------------------------------------------------------------------------
-- 3. automation_runs — the trigger that produced it, and what it spent.
-- -----------------------------------------------------------------------------
alter table public.automation_runs
  -- Which trigger fired. Previously only derivable from the dedupe key's prefix,
  -- which is a parsing exercise, and impossible to index on.
  add column if not exists trigger text,

  -- True when the scheduler produced this run rather than a person's action.
  -- "Why did this happen at 3am with nobody logged in?" needs an answer.
  add column if not exists scheduled boolean not null default false,

  /**
   * THE COST LEDGER, and what it deliberately is NOT.
   *
   * It counts the CHARGEABLE ACTIONS a run executed. It does not hold a money
   * figure, because nothing in this product measures tokens or call minutes yet
   * (docs/modules/00-cost-tracking.md is unbuilt), and a rupee number derived
   * from a guess would be a fabricated fact on a screen a manager reads.
   *
   * A count is true, and combined with daily_run_cap it is the number that
   * actually bounds spend.
   */
  add column if not exists chargeable_actions integer not null default 0
    check (chargeable_actions >= 0),

  -- Who caused it. Null for a scheduled run — nobody did.
  add column if not exists triggered_by uuid references public.users (id) on delete set null;

create index if not exists idx_automation_runs_org_trigger
  on public.automation_runs (organization_id, trigger);
-- The daily-cap count: runs for one rule since the start of the org's day.
create index if not exists idx_automation_runs_automation_started
  on public.automation_runs (automation_id, started_at desc);

-- -----------------------------------------------------------------------------
-- 4. THE BUG FIX — a run may be completed once, never rewritten.
--
-- The trigger is the real rule. It refuses:
--   - any update to a run that already finished;
--   - any change to the identity columns, which are what the dedupe index and
--     the audit trail rest on.
--
-- So the UPDATE policy can be simple, and a direct PostgREST write is held to
-- exactly the same limit as the engine.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_automation_run_completion_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.finished_at is not null then
    raise exception 'A finished automation run cannot be modified';
  end if;

  if new.automation_id is distinct from old.automation_id
     or new.application_id is distinct from old.application_id
     or new.organization_id is distinct from old.organization_id
     or new.dedupe_key is distinct from old.dedupe_key
     or new.started_at is distinct from old.started_at then
    raise exception 'An automation run''s identity cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automation_runs_completion_only on public.automation_runs;
create trigger trg_automation_runs_completion_only
  before update on public.automation_runs
  for each row execute function public.enforce_automation_run_completion_only();

drop policy if exists automation_runs_update_member on public.automation_runs;
create policy automation_runs_update_member on public.automation_runs
  for update
  using (public.is_org_member(organization_id) and finished_at is null)
  with check (public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- 5. automation_approvals — the human-oversight queue.
--
-- One row per run that stopped for a decision. The ACTIONS ARE SNAPSHOTTED here
-- rather than re-read from the rule at approval time: the same reasoning as
-- Module 19's document snapshots. Somebody approves the actions they were shown,
-- and editing the rule in the meantime must not change what their click does.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'automation_approval_status') then
    create type public.automation_approval_status as enum (
      'pending',
      'approved',
      'rejected',
      -- Nobody decided in time. Distinct from rejected: "we let it lapse" and
      -- "we said no" are different facts about a candidate's application.
      'expired'
    );
  end if;
end $$;

create table if not exists public.automation_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  run_id uuid not null references public.automation_runs (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  -- The proposal, as shown to the approver. [{ type, config }]
  actions jsonb not null default '[]',
  -- The rule's own words at proposal time, so the queue reads as sentences.
  summary text not null,

  status public.automation_approval_status not null default 'pending',

  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  -- A proposal about a candidate goes stale. Left pending forever it becomes an
  -- action taken weeks after the reason for it.
  expires_at timestamptz not null default (now() + interval '7 days'),

  created_at timestamptz not null default now(),

  -- One open decision per run. A run proposes once.
  unique (run_id)
);

create index if not exists idx_automation_approvals_organization_id
  on public.automation_approvals (organization_id);
create index if not exists idx_automation_approvals_status
  on public.automation_approvals (organization_id, status, created_at desc);
create index if not exists idx_automation_approvals_application_id
  on public.automation_approvals (application_id);
create index if not exists idx_automation_approvals_automation_id
  on public.automation_approvals (automation_id);

-- Cross-tenant integrity, same shape as automation_runs'.
create or replace function public.enforce_automation_approval_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_org uuid;
  v_application_org uuid;
begin
  select organization_id into v_run_org
  from public.automation_runs where id = new.run_id;

  if v_run_org is null or v_run_org <> new.organization_id then
    raise exception 'Automation run does not belong to this organization';
  end if;

  select organization_id into v_application_org
  from public.applications where id = new.application_id;

  if v_application_org is null or v_application_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automation_approvals_tenant_integrity on public.automation_approvals;
create trigger trg_automation_approvals_tenant_integrity
  before insert or update of run_id, application_id, organization_id
  on public.automation_approvals
  for each row execute function public.enforce_automation_approval_tenant_integrity();

/**
 * A DECISION IS FINAL, AND IT IS NAMED.
 *
 * The oversight requirement is worth nothing if the record of who intervened can
 * be edited afterwards, or if a decision can be recorded with nobody attached.
 * Both are refused here rather than in the route, because the route is not the
 * boundary.
 */
create or replace function public.enforce_automation_approval_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  if new.status in ('approved', 'rejected') then
    if new.decided_by is null then
      raise exception 'An approval decision must name the person who made it';
    end if;
    if new.decided_at is null then
      new.decided_at := now();
    end if;
  end if;

  -- 'expired' is the system's own verdict and has no decider, by definition.
  if new.status = 'expired' and new.decided_by is not null then
    raise exception 'An expired approval cannot name a decider';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_automation_approvals_decision on public.automation_approvals;
create trigger trg_automation_approvals_decision
  before insert or update on public.automation_approvals
  for each row execute function public.enforce_automation_approval_decision();

alter table public.automation_approvals enable row level security;

-- Everyone sees the queue: an automation waiting to act on your candidate should
-- not be invisible to you.
drop policy if exists automation_approvals_select_member on public.automation_approvals;
create policy automation_approvals_select_member on public.automation_approvals
  for select using (public.is_org_member(organization_id));

-- Deciding is an act of oversight over a rule, so it follows the same role line
-- as creating one: Owner/Admin.
drop policy if exists automation_approvals_insert_member on public.automation_approvals;
create policy automation_approvals_insert_member on public.automation_approvals
  for insert with check (public.is_org_member(organization_id));

drop policy if exists automation_approvals_update_owner_admin on public.automation_approvals;
create policy automation_approvals_update_owner_admin on public.automation_approvals
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- -----------------------------------------------------------------------------
-- 6. automation_sweeps — evidence the scheduler ran.
--
-- Without this the honest UI copy is impossible. A time-based rule that looks
-- active but whose cron was never configured does nothing, and the screen would
-- have no way to know the difference between "nothing matched" and "nothing
-- ran". Every sweep writes a row; the automations page reads the latest one.
-- -----------------------------------------------------------------------------
create table if not exists public.automation_sweeps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- 'cron' or 'manual'. A manual sweep is a person pressing a button, which is
  -- the fallback when no cron is configured.
  source text not null default 'cron' check (source in ('cron', 'manual')),

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  -- What it looked at and what came of it.
  rules_considered integer not null default 0,
  applications_scanned integer not null default 0,
  runs_created integer not null default 0,

  -- Null on success. A sweep that failed halfway must not read as a quiet one.
  error_message text,

  triggered_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists idx_automation_sweeps_org_started
  on public.automation_sweeps (organization_id, started_at desc);

alter table public.automation_sweeps enable row level security;

drop policy if exists automation_sweeps_select_member on public.automation_sweeps;
create policy automation_sweeps_select_member on public.automation_sweeps
  for select using (public.is_org_member(organization_id));

-- Written by the cron under the service role (which bypasses RLS) or by an
-- Owner/Admin pressing the manual button.
drop policy if exists automation_sweeps_insert_owner_admin on public.automation_sweeps;
create policy automation_sweeps_insert_owner_admin on public.automation_sweeps
  for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists automation_sweeps_update_owner_admin on public.automation_sweeps;
create policy automation_sweeps_update_owner_admin on public.automation_sweeps
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- -----------------------------------------------------------------------------
-- 7. THE KILL SWITCH.
--
-- One column, checked by the engine before it loads a single rule. When an
-- organization has a rule misbehaving at 2am, "turn all of it off" must not
-- require opening eight rules one at a time.
--
-- Default true so existing organizations are unaffected.
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists automations_enabled boolean not null default true;

-- -----------------------------------------------------------------------------
-- 8. Version bumping, for the concurrent-edit check.
--
-- In a trigger so it is true however the row was written. The API's stale-edit
-- refusal is a courteous message on top of a number it can trust.
-- -----------------------------------------------------------------------------
create or replace function public.bump_automation_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := coalesce(old.version, 1) + 1;
  return new;
end;
$$;

drop trigger if exists trg_automations_bump_version on public.automations;
create trigger trg_automations_bump_version
  before update on public.automations
  for each row execute function public.bump_automation_version();

-- ############################################################################
-- ## 0030_module15_candidate_messaging.sql
-- ############################################################################

-- =============================================================================
-- INTENTIONALLY EMPTY. Module 15's schema is 0035, not this file.
--
-- This file was a 4-byte truncated write containing the fragment `writ` and
-- nothing else. It is not valid SQL, so ANY attempt to replay the migration set
-- from empty died right here — `ERROR: syntax error at or near "writ"` — and
-- took every migration after it with it. That is 0031 through 0040: live coding,
-- privacy, forms, voice agents, workflows, custom fields and the S-01 invite fix.
--
-- The number is kept and the file left in place rather than deleted, because
-- filename order IS the apply order and a gap invites the question of whether
-- something was lost. Nothing was: the schema this file was meant to contain was
-- written later, in full, as
--
--     0035_module15_candidate_messaging.sql
--
-- which carries its own explanation of how the application layer came to be
-- built against tables no migration had created.
--
-- Do not put anything here. A later module needing Module 15's tables should
-- depend on 0035.
-- =============================================================================

-- No statements. Deliberately.

-- ############################################################################
-- ## 0031_live_coding_interview.sql
-- ############################################################################

-- =============================================================================
-- Module 20: Live Coding Interview
--
-- Makes the Written Assessment hiring stage real. Until now that stage was
-- configuration-only — a job could describe a coding test and nothing ran it.
--
-- WHERE THIS SITS IN THE EXISTING MODEL, and why it adds no duplicate ids:
--
--   interviews.id  ->  coding_sessions.interview_id
--   interviews.application_id -> applications -> candidate_id + job_id
--
-- So a coding session already knows who the candidate is, which job they applied
-- for, and which interview it belongs to, through rows that already exist.
-- organization_id is carried for RLS and for the same defence-in-depth every
-- other table in this schema uses, and a trigger checks it against the parent
-- interview so it can never drift.
--
-- THE CANDIDATE IS NOT A USER OF THIS PRODUCT.
--
-- They have no login. Access is a signed HMAC over the session id (the same
-- construction lib/communications/optout.ts uses for the unsubscribe link), so
-- NOTHING is stored here that a leaked database row could turn into a working
-- link, and the URL exposes only this table's own id — never a candidate id, an
-- application id or an interview id.
--
-- Because the candidate has no session, their reads and writes go through route
-- handlers using the service-role client, scoped explicitly by session id. That
-- is the same pattern the Bolna webhook uses, for the same reason. RLS below
-- therefore governs the INTERVIEWER's access only; the candidate never touches
-- PostgREST directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coding_session_status') then
    /**
     * Deliberately five states, not the seven a generic lifecycle would have.
     *
     * There is no separate ACTIVE and IN_PROGRESS: "the link has been opened"
     * and "they have typed something" are the same fact to everyone who looks at
     * this screen, and two states nobody can tell apart is how a status column
     * stops meaning anything. `in_progress` is entered on the first save.
     *
     * There is no COMPLETED distinct from SUBMITTED either. The candidate's act
     * of submitting IS the completion of their side, and the interviewer's
     * judgement is recorded as an application_evaluations row — which is where
     * every other stage's verdict already lives.
     */
    create type public.coding_session_status as enum (
      'created',
      'in_progress',
      'submitted',
      'expired',
      'cancelled'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- coding_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.coding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- The parent. Everything else about who this is for is reachable from here.
  interview_id uuid not null references public.interviews (id) on delete cascade,

  /**
   * Denormalised from interviews.application_id, and that is deliberate.
   *
   * The submission is written against the APPLICATION (application_evaluations),
   * and the candidate-facing routes resolve their tenant from this row alone.
   * Making them join through interviews on every autosave would put a second
   * table in the hot path of a request that fires every few seconds.
   *
   * A trigger keeps it honest — see enforce_coding_session_integrity() below.
   */
  application_id uuid not null references public.applications (id) on delete cascade,

  -- Who started it. NULL if that user is later deleted; the session survives.
  created_by uuid references public.users (id) on delete set null,

  /**
   * The question, captured AT CREATION TIME.
   *
   * Copied from the job's Written Assessment configuration rather than joined to
   * it, because a job's question list is edited freely and a candidate must be
   * judged on the question they were actually shown. The same reason
   * client_feedback_events stores the submission text verbatim.
   */
  question_title text not null check (btrim(question_title) <> '' and length(question_title) <= 200),
  question_description text not null check (btrim(question_description) <> ''),
  /** Extra instructions — time expectations, constraints, what to optimise for. */
  instructions text check (instructions is null or length(instructions) <= 4000),

  status public.coding_session_status not null default 'created',

  /**
   * Languages this session offers, in display order.
   *
   * Stored per session rather than read from a global list so a job that only
   * wants Python does not have to explain away four other options, and so a
   * session's offer cannot change under a candidate mid-test.
   */
  languages text[] not null default array['python', 'javascript', 'java', 'cpp', 'sql'],

  /**
   * Wall-clock minutes the candidate is told they have. ADVISORY.
   *
   * Nothing auto-submits on expiry: cutting someone off mid-sentence over a
   * clock this product cannot see the candidate's side of (a dropped connection,
   * a lift, a laptop asleep) would destroy real work. `expires_at` below is the
   * hard boundary and it is generous by comparison.
   */
  time_limit_minutes integer
    check (time_limit_minutes is null or (time_limit_minutes >= 5 and time_limit_minutes <= 480)),

  /**
   * When the LINK stops working. Not the same thing as the time limit.
   *
   * A link that lives forever is a link that still opens a candidate's editor
   * six months after the interview.
   */
  expires_at timestamptz not null default (now() + interval '24 hours'),

  /** First time the candidate opened the link. NULL until they do. */
  opened_at timestamptz,
  submitted_at timestamptz,

  /** Set when an interviewer cancels; shown to the candidate instead of the editor. */
  cancelled_reason text check (cancelled_reason is null or length(cancelled_reason) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /**
   * ONE LIVE SESSION PER INTERVIEW is NOT enforced here.
   *
   * A coding round genuinely gets re-run — the candidate's connection dropped,
   * the question was wrong, they asked to start again. A unique constraint would
   * make the recovery path "delete the evidence of the first attempt". The API
   * reuses an existing open session instead of creating a second one, and the UI
   * shows the history; both attempts stay on the record.
   */

  -- A status is a claim about this row's own contents. These stop the claim and
  -- the contents drifting apart, whichever client wrote the row.
  constraint coding_sessions_submitted_has_timestamp check (
    (status = 'submitted') = (submitted_at is not null)
  ),
  constraint coding_sessions_cancelled_has_reason check (
    status <> 'cancelled' or btrim(coalesce(cancelled_reason, '')) <> ''
  )
);

create index if not exists idx_coding_sessions_organization on public.coding_sessions (organization_id);
create index if not exists idx_coding_sessions_interview on public.coding_sessions (interview_id);
create index if not exists idx_coding_sessions_application on public.coding_sessions (application_id);
create index if not exists idx_coding_sessions_status on public.coding_sessions (organization_id, status);

-- -----------------------------------------------------------------------------
-- coding_submissions
--
-- ONE ROW PER SESSION, upserted by every autosave.
--
-- Not an append-only keystroke log: the product's question is "what is their
-- code right now?" and "what did they finally submit?", and a row per save would
-- answer neither without an aggregate, while writing thousands of rows per
-- interview. The same shape resume_parse_results uses — one current row per
-- parent, replaced in place.
-- -----------------------------------------------------------------------------
create table if not exists public.coding_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  coding_session_id uuid not null unique
    references public.coding_sessions (id) on delete cascade,

  /** One of coding_sessions.languages. Validated in lib/coding/languages.ts. */
  programming_language text not null check (btrim(programming_language) <> ''),

  /**
   * The candidate's code. Capped, because an editor is a text box on the public
   * internet and an uncapped one is an upload endpoint.
   */
  code text not null default '' check (length(code) <= 200000),

  /** Bumped on every successful save, so the monitor can say "just now". */
  last_saved_at timestamptz not null default now(),
  /** Set once, at submission. The frozen final state. */
  submitted_at timestamptz,

  /** How many times the candidate saved, manual and automatic. Diagnostic only. */
  save_count integer not null default 0 check (save_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coding_submissions_organization on public.coding_submissions (organization_id);

-- =============================================================================
-- Triggers
-- =============================================================================

/**
 * The denormalised application_id must match the parent interview's, and both
 * must belong to the row's own organization.
 *
 * Enforced here rather than only in the route because the browser holds an
 * authenticated PostgREST client: a rule that lives only in a handler is not
 * enforced. This is the same guard every other cross-row table in this schema
 * carries.
 */
create or replace function public.enforce_coding_session_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview_org uuid;
  v_interview_application uuid;
begin
  select organization_id, application_id
    into v_interview_org, v_interview_application
  from public.interviews
  where id = new.interview_id;

  if v_interview_org is null then
    raise exception 'Interview % does not exist', new.interview_id;
  end if;

  if v_interview_org <> new.organization_id then
    raise exception 'Coding session organization does not match its interview';
  end if;

  if v_interview_application <> new.application_id then
    raise exception 'Coding session application does not match its interview';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coding_sessions_integrity on public.coding_sessions;
create trigger trg_coding_sessions_integrity
  before insert or update on public.coding_sessions
  for each row execute function public.enforce_coding_session_integrity();

/** A submission belongs to the same organization as its session. */
create or replace function public.enforce_coding_submission_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_org uuid;
begin
  select organization_id into v_session_org
  from public.coding_sessions
  where id = new.coding_session_id;

  if v_session_org is null then
    raise exception 'Coding session % does not exist', new.coding_session_id;
  end if;

  if v_session_org <> new.organization_id then
    raise exception 'Coding submission organization does not match its session';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coding_submissions_integrity on public.coding_submissions;
create trigger trg_coding_submissions_integrity
  before insert or update on public.coding_submissions
  for each row execute function public.enforce_coding_submission_integrity();

/**
 * A SUBMITTED submission is frozen.
 *
 * The candidate's editor is disabled after submitting and the API refuses a
 * later save, but neither of those is the enforcement — this is. Without it,
 * "the code they submitted" would be a claim the product could not stand behind
 * if it were ever disputed, which is the same reason screening_reports freezes
 * its ai_* columns.
 */
create or replace function public.freeze_submitted_coding_code()
returns trigger
language plpgsql
as $$
begin
  if old.submitted_at is not null then
    if new.code is distinct from old.code
       or new.programming_language is distinct from old.programming_language
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'This coding submission has been submitted and can no longer be edited';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coding_submissions_freeze on public.coding_submissions;
create trigger trg_coding_submissions_freeze
  before update on public.coding_submissions
  for each row execute function public.freeze_submitted_coding_code();

drop trigger if exists trg_coding_sessions_touch on public.coding_sessions;
create trigger trg_coding_sessions_touch
  before update on public.coding_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_coding_submissions_touch on public.coding_submissions;
create trigger trg_coding_submissions_touch
  before update on public.coding_submissions
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
--
-- Governs INTERVIEWER access. The candidate has no session and never reaches
-- PostgREST — their routes use the service-role client, scoped by session id.
-- =============================================================================
alter table public.coding_sessions enable row level security;
alter table public.coding_submissions enable row level security;

-- Every member may see that a coding round happened and read its result. Same
-- floor as interviews and screening reports: a Viewer reads, and reading a
-- submission is how a hiring manager forms an opinion.
drop policy if exists coding_sessions_select_member on public.coding_sessions;
create policy coding_sessions_select_member on public.coding_sessions
  for select using (public.is_org_member(organization_id));

-- Starting a coding round is the same class of act as scheduling an interview,
-- so it takes the same roles. A Viewer must never be able to make the product
-- send a link to a real candidate.
drop policy if exists coding_sessions_insert_staff on public.coding_sessions;
create policy coding_sessions_insert_staff on public.coding_sessions
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists coding_sessions_update_staff on public.coding_sessions;
create policy coding_sessions_update_staff on public.coding_sessions
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists coding_submissions_select_member on public.coding_submissions;
create policy coding_submissions_select_member on public.coding_submissions
  for select using (public.is_org_member(organization_id));

/**
 * NO INSERT OR UPDATE POLICY, and that is the point.
 *
 * The only writer of a candidate's code is the candidate, through the
 * token-authorised routes running under the service role. Granting an
 * interviewer a write path here would mean a member of staff could silently
 * alter what a candidate submitted — the one thing this table exists to be able
 * to prove they did not.
 */

-- =============================================================================
-- Grants. Mirrors every other table: the API layer and RLS do the work.
-- =============================================================================
grant select, insert, update on public.coding_sessions to authenticated;
grant select on public.coding_submissions to authenticated;

-- ############################################################################
-- ## 0032_module21_privacy_consent.sql
-- ############################################################################

-- =============================================================================
-- Module 21 — Privacy, consent and data settings.
--
-- Four things, in dependency order:
--   1. organization_settings.privacy_settings — the configuration (§1-§9)
--   2. screening_call_status gains 'consent_declined' (§2)
--   3. screening_calls gains consent provenance columns (§2, rule 3)
--   4. A trigger that makes rule 5 structural rather than aspirational (§1)
--
-- Re-runnable, per the project convention: `if not exists`, `drop ... if exists`,
-- and enum additions guarded by a catalogue lookup.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The configuration column.
--
-- JSONB on the existing settings row rather than a new table, matching
-- screening_settings / retention_settings / communication_settings. It inherits
-- organization_settings' RLS unchanged, which is what makes these settings
-- organization-specific (rule 1) without a new policy to get wrong.
--
-- Default '{}' rather than a populated object: lib/privacy/settings.ts
-- normalizes on read, so an empty object and a missing row both resolve to the
-- documented defaults. Writing defaults into SQL as well would give two sources
-- of truth that drift the first time one is edited.
-- -----------------------------------------------------------------------------
alter table public.organization_settings
  add column if not exists privacy_settings jsonb not null default '{}'::jsonb;

comment on column public.organization_settings.privacy_settings is
  'Module 21 privacy, consent, retention and access configuration. Shape and '
  'defaults are owned by lib/privacy/settings.ts, which normalises on read and '
  'on write; treat values here as untrusted input, not as validated config.';

-- -----------------------------------------------------------------------------
-- 2. 'consent_declined' as a first-class call outcome.
--
-- The brief requires the interview be marked "Consent Declined". It is a real
-- status and not a failure: 'failed' means the provider or network broke, and
-- filing a refusal there would put a lawful, correctly handled refusal in the
-- same bucket as an outage — which then feeds the retry policy, the dashboard
-- counts and the analytics funnel as though it were a technical fault to be
-- retried. It must also never be retried, which lib/screening/retry.ts enforces.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'screening_call_status'
      and e.enumlabel = 'consent_declined'
  ) then
    alter type public.screening_call_status add value 'consent_declined';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Consent provenance on every call (rule 3: "Consent status must be stored
--    with every interview").
--
-- consent_confirmed and consent_confirmed_at already exist from Module 8. What
-- they cannot express is HOW consent was obtained, and rule 4 asks for exactly
-- that distinction — an explicit spoken "yes" and a candidate who simply carried
-- on are both consent, but they are not the same evidence. A privacy log that
-- reported them identically would overstate the weaker one.
--
-- consent_declined_at is separate from consent_confirmed = false, because false
-- is also the state of a call that has not reached the question yet. Silence and
-- refusal are different facts and a subject access request has to tell them
-- apart.
-- -----------------------------------------------------------------------------
alter table public.screening_calls
  add column if not exists consent_mode text
    check (consent_mode is null or consent_mode in ('explicit', 'continuation')),
  add column if not exists consent_declined_at timestamptz,
  -- What the configuration said at the moment of the call. Settings change; a
  -- call has to be auditable against the policy that was live when it happened,
  -- not whatever is configured on the day somebody asks.
  add column if not exists recording_permitted boolean not null default false,
  add column if not exists ai_disclosure_given boolean not null default false;

comment on column public.screening_calls.consent_mode is
  'How consent was obtained: explicit (the candidate said yes) or continuation '
  '(the candidate was told and carried on). Null until the disclosure is answered.';

comment on column public.screening_calls.recording_permitted is
  'Whether recording was permitted for THIS call, evaluated at dial time against '
  'the then-current privacy settings. Historical fact, not a live setting.';

-- -----------------------------------------------------------------------------
-- 4. The trigger that makes rule 5 structural.
--
--    "If recording is disabled, do not accidentally create or retain recordings."
--
-- WHY THIS IS A TRIGGER AND NOT A CHECK IN THE ROUTE HANDLER.
--
-- AGENTS.md states the rule this implements: the browser holds an authenticated
-- PostgREST client, so any signed-in user can write to this table directly and
-- skip the route entirely. A rule that only exists in a webhook handler is not
-- enforced — and the writer here IS a webhook, i.e. a path driven by an external
-- provider's payload rather than by our own UI.
--
-- So the invariant lives where it cannot be bypassed: a recording_url may only be
-- set on a call where recording was permitted. Anything else is refused, loudly,
-- rather than being silently nulled — a silent null would hide a bug in the
-- dial-time evaluation and leave everyone believing recordings were being stored
-- when they were not.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_recording_permission()
returns trigger
language plpgsql
as $$
begin
  if new.recording_url is not null and new.recording_permitted = false then
    raise exception
      'Cannot store a recording for call %: recording was not permitted for it. '
      'Check the organization''s privacy settings and the candidate''s consent.',
      new.id
      using errcode = 'check_violation';
  end if;

  -- A declined call is a call that stopped. It cannot also be carrying consent.
  if new.consent_declined_at is not null and new.consent_confirmed = true then
    raise exception
      'Call % cannot be both consented and declined.', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_recording_permission on public.screening_calls;

create trigger trg_enforce_recording_permission
  before insert or update on public.screening_calls
  for each row
  execute function public.enforce_recording_permission();

-- -----------------------------------------------------------------------------
-- 5. Index for the retention sweep.
--
-- The sweep asks "which completed calls have artifacts older than N days", per
-- organization. Without this it is a full scan of screening_calls on every run,
-- which grows with the table and runs on a schedule.
--
-- Partial: rows with no ended_at have no artifacts to expire, and
-- planRetentionActions() skips them anyway, so there is no reason to index them.
-- -----------------------------------------------------------------------------
create index if not exists screening_calls_retention_idx
  on public.screening_calls (organization_id, ended_at)
  where ended_at is not null;

-- -----------------------------------------------------------------------------
-- 6. Index for the §10 privacy log.
--
-- The privacy view filters activity_events to the privacy.* event types for one
-- organization, newest first. activity_events already has an organization index;
-- this makes the event_type filter selective rather than a scan of every event
-- the organization has ever recorded.
-- -----------------------------------------------------------------------------
create index if not exists activity_events_privacy_idx
  on public.activity_events (organization_id, created_at desc)
  where event_type like 'privacy.%';

-- ############################################################################
-- ## 0033_module23_forms_public_applications.sql
-- ############################################################################

-- =============================================================================
-- Module 23: Forms & Public Applications
--
-- ONE FORM ENGINE, NOT TWO. A job's public application form is a `forms` row
-- with purpose='job_application' and a job_id; a pre-interview questionnaire is
-- the same row with a different purpose and no job. There is deliberately no
-- separate "job_application_forms" table: the second one would grow its own
-- field editor, its own validation and its own drift.
--
-- THIS IS NOT job_screening_questions. That table (migration 0002) holds the
-- questions the Module 8 AI voice screen asks. These are questions a candidate
-- types answers to on a public web page. Two different asks, two different
-- audiences, two tables.
--
-- THE CANDIDATE IS NOT A USER OF THIS PRODUCT.
--
-- They have no login, so the public page is authorised by a signed HMAC over
-- (form id, token_version) — the same construction lib/coding/token.ts and
-- lib/communications/optout.ts already use. NOTHING here stores a working link:
-- a leaked database dump yields no URL anybody can open, and there is no token
-- column for a mistaken SELECT to expose.
--
-- token_version is what makes "regenerate link" possible without a stored
-- token. Bumping it invalidates every previously shared link and printed QR
-- code in one UPDATE.
--
-- Because the applicant has no session, their reads and their submission go
-- through route handlers using the service-role client, scoped by the form id
-- that came out of a verified signature. RLS below therefore governs the
-- RECRUITER's access only; the applicant never touches PostgREST.
--
-- WHY THERE IS NO submission_count COLUMN. The browser holds an authenticated
-- PostgREST client, so a counter column is a number any signed-in user can set
-- to anything. "24 applications received" has to be a count of rows that exist,
-- so it is read as count(form_responses) and never stored.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A new candidate/application source.
--
-- applications.source and candidates.source are both public.candidate_source.
-- 'career_page' is the closest existing value and it is not the same thing: a
-- career page is a jobs board somebody browsed, this is a link a recruiter sent
-- to one person. Analytics would silently merge the two.
--
-- SEPARATE do BLOCK, FIRST IN THE FILE, ON PURPOSE. A newly added enum label
-- cannot be USED by the transaction that added it, so nothing below may
-- reference 'application_form' as a default or an insert. Nothing does.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'candidate_source'
      and e.enumlabel = 'application_form'
  ) then
    alter type public.candidate_source add value 'application_form';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1b. activity_entity_type gains 'form' — AND the two values that were missing.
--
-- THIS FIXES A LATENT BUG, not just this module's need.
--
-- lib/activity/types.ts has declared 'message_template' (Module 15) and
-- 'privacy' (Module 22) for some time, but neither was ever added to the
-- database enum. logActivity() does not throw on a failed insert — it logs and
-- returns false — so every audit row written against those two entity types has
-- been silently dropped since. That includes the privacy log's "who viewed this
-- transcript" rows, which is exactly the kind of gap an audit trail must not
-- have.
--
-- Added here with `if not exists` so this migration stays re-runnable, and in
-- the same first-in-the-file block as the candidate_source value above because
-- a new enum label cannot be used by the transaction that added it.
-- -----------------------------------------------------------------------------
alter type public.activity_entity_type add value if not exists 'message_template';
alter type public.activity_entity_type add value if not exists 'privacy';
alter type public.activity_entity_type add value if not exists 'form';

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'form_purpose') then
    /**
     * What the form is FOR, which decides how it behaves rather than merely
     * labelling it: only 'job_application' carries a job_id, is auto-created
     * with default fields, and creates candidates and applications on submit.
     */
    create type public.form_purpose as enum (
      'job_application',
      'pre_interview',
      'general'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'form_status') then
    /**
     * THREE STATES, and 'disabled' is not the same as 'draft'.
     *
     * A draft has never been shared. A disabled form has a link in circulation
     * — on WhatsApp, in an email, printed as a QR code on a poster — that must
     * now say "no longer accepting applications" rather than 404. Collapsing
     * them would mean closing a role either kept accepting submissions or
     * started lying about whether the link ever existed.
     */
    create type public.form_status as enum ('draft', 'published', 'disabled');
  end if;

  if not exists (select 1 from pg_type where typname = 'form_field_type') then
    create type public.form_field_type as enum (
      'short_text',
      'long_text',
      'email',
      'phone',
      'number',
      'dropdown',
      'radio',
      'checkbox',
      'date',
      'file_upload',
      'url',
      'yes_no'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'form_response_status') then
    /**
     * A SUBMISSION THAT REACHED THIS DATABASE IS NEVER SILENTLY DROPPED.
     *
     * The applicant has already been told "thank you, we got it", so a failure
     * in the steps after the insert (storage, parsing, candidate creation) must
     * leave a row a recruiter can see and act on — not a lost application and a
     * person waiting for a reply that will never come.
     *
     *   received       — stored, resolution not finished yet
     *   linked         — candidate and application resolved
     *   needs_review   — resolved, but a matched candidate's profile disagrees
     *                    with what was typed, so fields are queued for review
     *   needs_attention— something downstream failed; processing_error says what
     */
    create type public.form_response_status as enum (
      'received',
      'linked',
      'needs_review',
      'needs_attention'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. forms
-- -----------------------------------------------------------------------------
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (btrim(name) <> '' and length(name) <= 200),
  description text check (description is null or length(description) <= 2000),

  purpose public.form_purpose not null default 'general',

  /**
   * Set for a job application form, null for everything else. The CHECK is what
   * makes that a rule rather than a convention — an application form with no
   * job has no pipeline to put anybody into, and a general form with a job_id
   * would silently start creating applications.
   */
  job_id uuid references public.jobs (id) on delete cascade,

  status public.form_status not null default 'draft',

  /**
   * Bumped to revoke every link ever issued for this form. See the header:
   * the token is an HMAC over (id, token_version), so this integer IS the
   * revocation mechanism, and it is the only thing about the link that is
   * stored anywhere.
   */
  token_version integer not null default 1 check (token_version >= 1),

  created_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint forms_job_matches_purpose check (
    (purpose = 'job_application' and job_id is not null)
    or (purpose <> 'job_application' and job_id is null)
  )
);

create index if not exists idx_forms_organization on public.forms (organization_id);
create index if not exists idx_forms_org_status on public.forms (organization_id, status);

/**
 * ONE application form per job.
 *
 * Two would mean two public links for the same role, both live, with
 * submissions split between them and no way for the job page to say which one
 * the QR code on the poster points at. Standalone forms are unconstrained —
 * an organization may have as many questionnaires as it likes.
 */
create unique index if not exists uq_forms_job_application
  on public.forms (job_id)
  where purpose = 'job_application';

-- -----------------------------------------------------------------------------
-- 4. form_fields
-- -----------------------------------------------------------------------------
create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),

  /**
   * Denormalised from forms.organization_id so RLS keys on this row alone
   * rather than joining on every read — the same choice
   * job_screening_questions made. A trigger below keeps it honest.
   */
  organization_id uuid not null references public.organizations (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,

  /**
   * The stable identifier answers are stored under.
   *
   * form_responses.raw_answers is keyed on THIS, not on the label, so a
   * recruiter renaming "Current CTC" to "Current package" does not orphan
   * every answer already collected.
   */
  field_key text not null check (
    field_key ~ '^[a-z][a-z0-9_]{0,58}[a-z0-9]$'
  ),

  label text not null check (btrim(label) <> '' and length(label) <= 200),
  help_text text check (help_text is null or length(help_text) <= 500),

  field_type public.form_field_type not null,

  /** Choices for dropdown/radio/checkbox. Validated in lib/forms/validation.ts. */
  options jsonb not null default '[]'::jsonb,

  required boolean not null default false,

  /**
   * True for the fields shipped with a job application form, false for a
   * recruiter's own questions. Drives two things: which answers map onto
   * candidate columns, and which appear in the "Application form responses"
   * card (the custom ones, since the standard ones are already on the profile).
   */
  is_standard boolean not null default false,

  -- display_order, not "order": ORDER is a reserved word and every other
  -- ordered table in this schema already spells it this way.
  display_order integer not null default 0,

  created_at timestamptz not null default now(),

  constraint form_fields_options_is_array check (jsonb_typeof(options) = 'array')
);

create unique index if not exists uq_form_fields_key on public.form_fields (form_id, field_key);
create index if not exists idx_form_fields_form on public.form_fields (form_id, display_order);
create index if not exists idx_form_fields_organization on public.form_fields (organization_id);

-- -----------------------------------------------------------------------------
-- 5. form_responses
-- -----------------------------------------------------------------------------
create table if not exists public.form_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,

  /**
   * Both NULL at insert time, and that ordering is the whole design.
   *
   * The response is written BEFORE the candidate is matched and the application
   * created, so a failure in either of those still leaves the applicant's
   * answers in the database. Filled in by the same request a moment later.
   */
  application_id uuid references public.applications (id) on delete set null,
  candidate_id uuid references public.candidates (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,

  /** field_key -> value, exactly as submitted. The record of what they typed. */
  raw_answers jsonb not null default '{}'::jsonb,

  status public.form_response_status not null default 'received',
  processing_error text check (processing_error is null or length(processing_error) <= 1000),

  /**
   * A SALTED HASH, NOT AN IP ADDRESS.
   *
   * Rate limiting needs to know "same source as before?", which a hash answers
   * completely. An IP address is personal data under GDPR and Module 22 exists
   * precisely so this product does not collect things casually — so the raw
   * value is never written, here or anywhere else.
   */
  submitter_ip_hash text check (submitter_ip_hash is null or length(submitter_ip_hash) <= 64),

  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint form_responses_answers_is_object check (jsonb_typeof(raw_answers) = 'object')
);

create index if not exists idx_form_responses_form on public.form_responses (form_id, submitted_at desc);
create index if not exists idx_form_responses_organization on public.form_responses (organization_id);
create index if not exists idx_form_responses_application on public.form_responses (application_id);
create index if not exists idx_form_responses_candidate on public.form_responses (candidate_id);

-- -----------------------------------------------------------------------------
-- 6. form_submission_attempts — the rate limiter's ledger
--
-- IN THE DATABASE, NOT IN MEMORY. This app runs serverless: an in-process Map
-- is per-instance and resets on every cold start, so it is not a limit, it is a
-- suggestion. A public unauthenticated endpoint that reaches an AI provider
-- needs an actual one.
-- -----------------------------------------------------------------------------
create table if not exists public.form_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  /** Same salted hash as form_responses.submitter_ip_hash. Never a raw IP. */
  ip_hash text not null check (length(ip_hash) <= 64),
  attempted_at timestamptz not null default now()
);

create index if not exists idx_form_attempts_window
  on public.form_submission_attempts (form_id, ip_hash, attempted_at desc);

-- =============================================================================
-- 7. Triggers
-- =============================================================================

/**
 * A field's denormalised organization_id must match its parent form's.
 *
 * In a trigger rather than only in the route because the browser holds an
 * authenticated PostgREST client: a rule that lives in a handler is not
 * enforced. Without this, a member of org A could insert a field carrying org
 * A's id against org B's form and have it render on org B's public page.
 */
create or replace function public.enforce_form_field_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_org uuid;
begin
  select organization_id into v_form_org from public.forms where id = new.form_id;

  if v_form_org is null then
    raise exception 'Form % does not exist', new.form_id;
  end if;

  if v_form_org <> new.organization_id then
    raise exception 'Form field organization does not match its form';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_fields_integrity on public.form_fields;
create trigger trg_form_fields_integrity
  before insert or update on public.form_fields
  for each row execute function public.enforce_form_field_integrity();

/** The same guard for a response. */
create or replace function public.enforce_form_response_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_org uuid;
begin
  select organization_id into v_form_org from public.forms where id = new.form_id;

  if v_form_org is null then
    raise exception 'Form % does not exist', new.form_id;
  end if;

  if v_form_org <> new.organization_id then
    raise exception 'Form response organization does not match its form';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_responses_integrity on public.form_responses;
create trigger trg_form_responses_integrity
  before insert or update on public.form_responses
  for each row execute function public.enforce_form_response_integrity();

/**
 * EMAIL AND RESUME UPLOAD ARE LOAD-BEARING ON A JOB APPLICATION FORM.
 *
 * Email is what duplicate matching keys on (lib/candidates/dedupe.ts), and the
 * resume is what the Module 6 parsing pipeline needs. A form without them still
 * looks fine on the page and then quietly produces uncontactable, undedupable
 * candidate records — one new person per submission, forever.
 *
 * So they may be RENAMED (an organization can call the upload whatever it
 * likes) but not removed and not made optional. Enforced here because the field
 * editor is not the only thing that can write this table.
 *
 * Standalone forms are unaffected: a pre-interview questionnaire has no
 * candidate to create.
 */
create or replace function public.protect_required_application_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose public.form_purpose;
  v_key text;
  v_form uuid;
begin
  -- OLD, not NEW. The trigger fires only on UPDATE and DELETE, so OLD
  -- always exists — and it is the EXISTING field's key that
  -- decides whether this row is protected. Reading NEW would let a rename to
  -- some other key walk the field straight out of the protected set, which is
  -- exactly what the last check below refuses.
  v_key := old.field_key;
  v_form := old.form_id;

  if v_key not in ('email', 'resume') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select purpose into v_purpose from public.forms where id = v_form;

  if v_purpose is distinct from 'job_application' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'The % field cannot be removed from a job application form - candidate matching and resume parsing depend on it',
      v_key;
  end if;

  if new.required = false then
    raise exception
      'The % field cannot be made optional on a job application form', v_key;
  end if;

  -- Renaming the KEY (not the label) would orphan every answer already
  -- collected under it, and would take the field out of the protected set.
  if new.field_key <> v_key then
    raise exception 'The % field cannot be renamed to a different key', v_key;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_fields_protect on public.form_fields;
create trigger trg_form_fields_protect
  before update or delete on public.form_fields
  for each row execute function public.protect_required_application_fields();

drop trigger if exists trg_forms_touch on public.forms;
create trigger trg_forms_touch
  before update on public.forms
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- 8. Row-Level Security
--
-- Governs the RECRUITER's access. The applicant has no session and never
-- reaches PostgREST — their page and their submission use the service-role
-- client, scoped by a form id that came out of a verified signature.
-- =============================================================================
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_responses enable row level security;
alter table public.form_submission_attempts enable row level security;

-- Every member may read a form's configuration and its submissions. Same floor
-- as jobs and applications: a Viewer reads, and reading what a candidate
-- submitted is how a hiring manager forms an opinion.
drop policy if exists forms_select_member on public.forms;
create policy forms_select_member on public.forms
  for select using (public.is_org_member(organization_id));

/**
 * PUBLISHING A FORM MAKES A URL WORLD-REACHABLE, so it takes the same roles as
 * scheduling an interview or starting a coding round — and the check is HERE,
 * not only in the route. Without a policy, a Viewer with the browser's
 * PostgREST client could flip status to 'published' from a console.
 */
drop policy if exists forms_insert_staff on public.forms;
create policy forms_insert_staff on public.forms
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists forms_update_staff on public.forms;
create policy forms_update_staff on public.forms
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

/**
 * Deleting a form deletes its responses with it (ON DELETE CASCADE), which
 * destroys applicants' submitted answers. Owner/Admin only, the same bar
 * archiving a job takes.
 */
drop policy if exists forms_delete_admin on public.forms;
create policy forms_delete_admin on public.forms
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists form_fields_select_member on public.form_fields;
create policy form_fields_select_member on public.form_fields
  for select using (public.is_org_member(organization_id));

drop policy if exists form_fields_write_staff on public.form_fields;
create policy form_fields_write_staff on public.form_fields
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_fields_update_staff on public.form_fields;
create policy form_fields_update_staff on public.form_fields
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_fields_delete_staff on public.form_fields;
create policy form_fields_delete_staff on public.form_fields
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_responses_select_member on public.form_responses;
create policy form_responses_select_member on public.form_responses
  for select using (public.is_org_member(organization_id));

/**
 * NO INSERT, UPDATE OR DELETE POLICY ON form_responses, and that is the point.
 *
 * The only writer is the applicant, through the token-authorised route running
 * under the service role. Giving staff a write path here would mean a recruiter
 * could edit or delete what somebody submitted — the one thing this table
 * exists to be able to show faithfully. The same call coding_submissions made.
 */

/**
 * The rate-limit ledger is invisible to every client.
 *
 * It is written only by the service-role path, and there is nothing in it a
 * recruiter needs: "how many times did this hashed source try?" is an
 * operational detail, and exposing it would put a per-applicant activity trail
 * on a screen nobody asked for. No policy at all = no rows for anybody.
 */

-- =============================================================================
-- 9. Grants. Mirrors every other table: the API layer and RLS do the work.
-- =============================================================================
grant select, insert, update, delete on public.forms to authenticated;
grant select, insert, update, delete on public.form_fields to authenticated;
grant select on public.form_responses to authenticated;

comment on table public.forms is
  'Module 23. One form engine: job application forms (purpose=job_application, '
  'job_id set, public link) and standalone questionnaires. The public link is a '
  'signed HMAC over (id, token_version) — no token is stored.';
comment on column public.forms.token_version is
  'Bump to revoke every previously issued public link and QR code for this form.';
comment on table public.form_submission_attempts is
  'Module 23 rate-limit ledger. Salted IP hashes only, never raw addresses.';

-- ############################################################################
-- ## 0034_module24_voice_agent_console.sql
-- ############################################################################

-- =============================================================================
-- Module 24: Voice Agent Console
--
-- One page — /settings/integrations/bolna — that configures the voice agent
-- which places AI screening calls, plus the ORGANIZATION-WIDE FALLBACKS a
-- screening call uses when a job has not configured its own.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES **NOT** CREATE
-- ---------------------------------------------------
--   * No second question list. The spec for this console says the Default Call
--     Data section must "connect to, not duplicate, the per-job AI Screening
--     Call configuration". A job's questions live in job_screening_questions
--     (Module 3/8) and stay there; `default_call_data.fallbackQuestions` here is
--     used ONLY when a job has AI screening enabled and its own list is empty.
--     Precedence is resolved in lib/voice/callData.ts, with tests.
--
--   * No second credential store. The API key stays in
--     organization_integrations.encrypted_credentials, unreadable by any browser
--     session (column-level REVOKE, Module 8). Nothing in this migration holds a
--     secret.
--
--   * No copy of language / max-attempts / retry policy. Those are Module 17's
--     organization_settings.screening_settings and are read from there.
--
-- WHY A TABLE RATHER THAN organization_integrations.settings
-- ---------------------------------------------------------
-- The console's own spec requires MULTIPLE agents per organization (different
-- agents per language or job category, chosen with a switcher). A jsonb blob on
-- the single integration row cannot hold a list with per-row identity, a default
-- flag, or a per-row provider sync state without becoming a hand-rolled table.
-- =============================================================================

-- =============================================================================
-- voice_agents
--
-- One row per configured agent. `config` is the NEUTRAL AgentSettings object the
-- browser sends — greeting, persona, guardrails, voice/STT selections (as opaque
-- catalogue keys), conversation behaviour, handoff. It is normalised by
-- lib/voice/settings.ts on every read AND every write, so a value edited straight
-- into the column cannot make the agent stay on a call for an hour.
-- =============================================================================
create table if not exists public.voice_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 120),

  -- What this agent is FOR. Free-ish, but constrained so the switcher can group
  -- and so a purpose cannot arrive as a paragraph.
  purpose text not null default 'screening'
    check (purpose in ('screening', 'confirmation', 'follow_up', 'other')),

  -- Prefilled from organizations.name, but editable: the name a candidate should
  -- hear is not always the legal entity name on the account.
  company_name text,

  -- The number candidates see. Not a credential; a display/dial-from choice.
  caller_number text,

  /**
   * Exactly one default per organization, enforced by a PARTIAL UNIQUE INDEX
   * below rather than by application code.
   *
   * It matters because this flag decides which agent actually dials: placeCall()
   * resolves the default agent's provider id and falls back to the credential's
   * agent id only when there is no synced default. Two defaults would make that
   * resolution depend on row order.
   */
  is_default boolean not null default false,

  /** The neutral AgentSettings blob. See lib/voice/settings.ts for the shape. */
  config jsonb not null default '{}',

  /**
   * Organization-wide fallbacks for the AI screening call:
   *   { fields: [{ key, value }], fallbackQuestions: [text, ...] }
   *
   * A JOB'S OWN CONFIGURATION ALWAYS WINS. This is the value used when the job
   * did not specify one — never an override of it.
   */
  default_call_data jsonb not null default '{}',

  -- ---------------------------------------------------------------------------
  -- PROVIDER-SIDE STATE. Read only through lib/supabase/admin.ts.
  --
  -- SELECT on both columns is REVOKED from authenticated and anon below, for the
  -- same reason encrypted_credentials is: the browser holds a PostgREST client,
  -- so a column a policy exposes is a column a browser can read. The console's
  -- spec requires that no provider-identifying value ever reaches the frontend,
  -- and a REVOKE is the only way to mean that — a route handler that declines to
  -- serialise a column is not a boundary.
  -- ---------------------------------------------------------------------------
  provider text not null default 'bolna' check (provider in ('bolna')),
  provider_agent_id text,

  -- Sync bookkeeping. A save that stored locally but failed at the provider must
  -- be VISIBLE as such, not silently reported as saved.
  last_synced_at timestamptz,
  sync_error text,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_voice_agents_organization
  on public.voice_agents (organization_id);

-- At most one default per organization. Partial, so the many non-default rows
-- are unconstrained.
create unique index if not exists uq_voice_agents_one_default
  on public.voice_agents (organization_id)
  where is_default;

drop trigger if exists trg_voice_agents_touch on public.voice_agents;
create trigger trg_voice_agents_touch
  before update on public.voice_agents
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- voice_agent_test_calls
--
-- The Test Agent section's "Call me". A SEPARATE table from screening_calls, on
-- purpose:
--
--   * screening_calls.application_id is NOT NULL, and a test call has no
--     application. Making that column nullable would weaken a constraint every
--     other reader relies on.
--   * A test dial must never appear in a candidate's screening history, in the
--     retry-cap arithmetic, or in Module 9's report inputs. Sharing the table
--     would put it in all three.
--
-- The status enum IS shared, so one CallStatusBadge renders both.
-- =============================================================================
create table if not exists public.voice_agent_test_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  voice_agent_id uuid not null references public.voice_agents (id) on delete cascade,

  -- The tester's own number. Stored so the readout can name who was called, and
  -- so the hard per-hour cap below can be counted.
  phone_number text not null,

  status public.screening_call_status not null default 'queued',
  provider_call_id text,

  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript text,
  failure_reason text,

  requested_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint voice_agent_test_calls_end_after_start
    check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists idx_voice_agent_test_calls_org_created
  on public.voice_agent_test_calls (organization_id, created_at desc);

create index if not exists idx_voice_agent_test_calls_agent
  on public.voice_agent_test_calls (voice_agent_id);

drop trigger if exists trg_voice_agent_test_calls_touch on public.voice_agent_test_calls;
create trigger trg_voice_agent_test_calls_touch
  before update on public.voice_agent_test_calls
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.voice_agents enable row level security;
alter table public.voice_agent_test_calls enable row level security;

/**
 * voice_agents SELECT: any member.
 *
 * Not Owner/Admin-only, and the reason is functional rather than a relaxation.
 * startScreeningCall() runs under the SESSION of whoever pressed the button —
 * usually a Recruiter — and it reads this row for the organization's fallback
 * call data. An Owner-only SELECT would mean a Recruiter's call silently lost
 * the org defaults, which is precisely the kind of "works for me" bug that RLS
 * on a config table produces.
 *
 * Nothing readable here is a secret: the provider columns are REVOKED below, and
 * a greeting message is not confidential to the team that reads it aloud.
 * EDITING is still Owner/Admin, per this console's spec.
 */
drop policy if exists voice_agents_select_member on public.voice_agents;
create policy voice_agents_select_member on public.voice_agents
  for select using (public.is_org_member(organization_id));

/**
 * Writes: Owner/Admin only — "consistent with the rest of Module 17's
 * integration configuration permissions".
 *
 * Stated as three policies rather than FOR ALL so that the INSERT check and the
 * UPDATE's USING/WITH CHECK pair are each explicit. The rule constrains what a
 * row may BECOME as well as who may touch it: without organization_id in WITH
 * CHECK, an Admin could move their agent into another tenant.
 */
drop policy if exists voice_agents_insert_owner_admin on public.voice_agents;
create policy voice_agents_insert_owner_admin on public.voice_agents
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists voice_agents_update_owner_admin on public.voice_agents;
create policy voice_agents_update_owner_admin on public.voice_agents
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists voice_agents_delete_owner_admin on public.voice_agents;
create policy voice_agents_delete_owner_admin on public.voice_agents
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/**
 * Test calls: Owner/Admin only, read as well as write.
 *
 * Unlike the agent config there is no reason for anyone else to see them, and a
 * test transcript is a recording of a colleague.
 */
drop policy if exists voice_agent_test_calls_select_owner_admin on public.voice_agent_test_calls;
create policy voice_agent_test_calls_select_owner_admin on public.voice_agent_test_calls
  for select using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists voice_agent_test_calls_insert_owner_admin on public.voice_agent_test_calls;
create policy voice_agent_test_calls_insert_owner_admin on public.voice_agent_test_calls
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/**
 * NO UPDATE POLICY, deliberately.
 *
 * A test call's outcome is written by the provider webhook through the
 * service-role client, which bypasses RLS. Nobody's browser session has any
 * business rewriting a transcript or a status — that would let an Admin edit the
 * record of a call that was made, which is exactly what an audit trail must not
 * allow. Deletion is likewise absent: rows age out with the organization.
 */

-- =============================================================================
-- COLUMN-LEVEL REVOKE — the provider boundary.
--
-- Even an Owner's browser session must not be able to read which provider backs
-- this product or what its internal agent id is. These two columns are therefore
-- readable only through lib/supabase/admin.ts (service role), the same treatment
-- organization_integrations.encrypted_credentials gets.
--
-- `revoke select (col)` on a table whose SELECT is granted at table level is the
-- documented way to carve out a column: PostgREST's request then fails if the
-- column is named, and `select *` from a browser returns the other columns.
-- =============================================================================
revoke select (provider, provider_agent_id) on public.voice_agents from authenticated;
revoke select (provider, provider_agent_id) on public.voice_agents from anon;

revoke select (provider_call_id) on public.voice_agent_test_calls from authenticated;
revoke select (provider_call_id) on public.voice_agent_test_calls from anon;

-- =============================================================================
-- Cross-tenant integrity.
--
-- voice_agent_test_calls carries its own organization_id (the global rule) AND a
-- foreign key to voice_agents. A foreign key proves the agent exists, not that it
-- is OURS — without this trigger, an Admin could log a test call against another
-- tenant's agent and read its config back through the join.
-- =============================================================================
create or replace function public.enforce_voice_test_call_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.voice_agents a
    where a.id = new.voice_agent_id
      and a.organization_id = new.organization_id
  ) then
    raise exception 'Voice agent does not belong to this organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_voice_test_call_tenant_integrity() from public, anon;

drop trigger if exists trg_voice_agent_test_calls_tenant_integrity
  on public.voice_agent_test_calls;
create trigger trg_voice_agent_test_calls_tenant_integrity
  before insert or update of voice_agent_id, organization_id
  on public.voice_agent_test_calls
  for each row execute function public.enforce_voice_test_call_tenant_integrity();

-- =============================================================================
-- "Always exactly one default" — the other half of the partial unique index.
--
-- The index stops TWO defaults. This trigger stops ZERO: the first agent an
-- organization creates becomes the default, and promoting a new default demotes
-- the old one in the same statement rather than relying on the client to send two
-- writes (check-then-write across two statements is the TOCTOU race Module 1
-- already hit).
-- =============================================================================
create or replace function public.enforce_single_default_voice_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- First agent for this organization is the default whether asked for or not,
  -- so "which agent dials?" always has an answer.
  if not exists (
    select 1 from public.voice_agents
    where organization_id = new.organization_id
      and id <> new.id
  ) then
    new.is_default := true;
    return new;
  end if;

  if new.is_default then
    -- Lock the sibling rows before demoting, so two concurrent promotions
    -- serialise instead of both believing they won.
    perform 1
    from public.voice_agents
    where organization_id = new.organization_id
      and id <> new.id
    for update;

    update public.voice_agents
    set is_default = false
    where organization_id = new.organization_id
      and id <> new.id
      and is_default;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_single_default_voice_agent() from public, anon;

drop trigger if exists trg_voice_agents_single_default on public.voice_agents;
create trigger trg_voice_agents_single_default
  before insert or update of is_default on public.voice_agents
  for each row execute function public.enforce_single_default_voice_agent();

-- =============================================================================
-- Deleting the default promotes another, so an organization with agents always
-- has one that dials.
-- =============================================================================
create or replace function public.promote_next_default_voice_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not old.is_default then
    return old;
  end if;

  update public.voice_agents
  set is_default = true
  where id = (
    select id from public.voice_agents
    where organization_id = old.organization_id
    order by created_at
    limit 1
  );

  return old;
end;
$$;

revoke all on function public.promote_next_default_voice_agent() from public, anon;

drop trigger if exists trg_voice_agents_promote_next on public.voice_agents;
create trigger trg_voice_agents_promote_next
  after delete on public.voice_agents
  for each row execute function public.promote_next_default_voice_agent();

-- =============================================================================
-- Documentation the next reader sees before they see this file.
-- =============================================================================
comment on table public.voice_agents is
  'Voice agent configuration for AI screening calls. config holds the neutral AgentSettings object (lib/voice/settings.ts); default_call_data holds ORG FALLBACKS that a job''s own AI Screening Call configuration always overrides. provider/provider_agent_id are service-role only.';

comment on column public.voice_agents.default_call_data is
  'Organization fallbacks: { fields: [{key,value}], fallbackQuestions: [] }. Used only where a job did not configure its own. Precedence resolved in lib/voice/callData.ts.';

comment on column public.voice_agents.provider_agent_id is
  'The provider''s own agent id. SELECT is revoked from authenticated/anon — read only through lib/supabase/admin.ts.';

comment on table public.voice_agent_test_calls is
  'Test dials from the Voice Agent Console. Separate from screening_calls so a test never enters a candidate''s history, the retry cap, or a screening report.';

-- ############################################################################
-- ## 0035_module15_candidate_messaging.sql
-- ############################################################################

-- =============================================================================
-- Module 15 (candidate communication) — the schema that was never written.
--
-- WHY THIS FILE EXISTS AT 0035 AND NOT AS A FIX TO 0030
--
-- `0030_module15_candidate_messaging.sql` is a 4-byte truncated file containing
-- the text `writ`. Module 15's application layer — 3,098 lines across
-- lib/communications/, the template library, the editor, the send pipeline, the
-- opt-out flow and the communication log on two pages — was built against tables
-- that no migration ever created. `/settings/templates` errors on load, and
-- lib/communications/ has no isMissingRelation() guard to soften it.
--
-- 0030 is left in place rather than rewritten: migrations here are applied by
-- hand, deployments may already have recorded it, and silently changing the
-- contents of a migration somebody has run is how two environments stop matching.
-- This is additive and re-runnable, so applying it to a database that somehow
-- already has these tables is a no-op.
--
-- THE SCHEMA IS DERIVED FROM THE CODE, NOT INVENTED.
--
-- The column lists come from `TEMPLATE_COLUMNS` and `LOG_COLUMNS` in
-- lib/communications/queries.ts, the enums from TEMPLATE_CHANNELS,
-- COMMUNICATION_EVENTS and MessageStatus. Every name and every value below
-- matches what the existing code already selects, inserts and filters on — this
-- migration fits the application, not the other way round.
--
-- One detail worth naming: `message_log.sent_by` must produce a foreign key
-- called `message_log_sent_by_fkey`, because queries.ts embeds the sender with
-- `sender:users!message_log_sent_by_fkey(name, email)`. Postgres' default
-- constraint naming gives exactly that, so it is not spelled out — but renaming
-- the column later would break that join.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  -- Channels a TEMPLATE may target. `both` is a template that carries an email
  -- body and a WhatsApp body; it is not a channel anything sends on — see
  -- deliveryChannelsFor() in lib/communications/templates.ts.
  if not exists (select 1 from pg_type where typname = 'message_template_channel') then
    create type public.message_template_channel as enum ('email', 'whatsapp', 'both');
  end if;

  -- Channels a MESSAGE actually went out on. Deliberately narrower than the
  -- template enum: a log row records one delivery, so `both` is meaningless here
  -- and a row can never claim it.
  if not exists (select 1 from pg_type where typname = 'message_delivery_channel') then
    create type public.message_delivery_channel as enum ('email', 'whatsapp');
  end if;

  /*
    Delivery status.

    `skipped` is the one that matters and the reason this is an enum rather than
    a boolean: a message not sent because the candidate opted out, or because the
    channel was disconnected, is NOT a failure — it is the product correctly
    declining to send. Recording it as `failed` would make an opt-out look like a
    bug, and recording nothing at all would make it look like the message went.
  */
  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type public.message_status as enum (
      'queued',     -- accepted by us, not yet handed to a provider
      'sent',       -- the provider accepted it
      'delivered',  -- the provider confirmed delivery
      'opened',     -- email only; WhatsApp gives us no read signal we trust
      'bounced',    -- a hard delivery failure at the recipient
      'failed',     -- we or the provider could not send
      'skipped'     -- deliberately not sent. See above.
    );
  end if;

  /*
    The pipeline events a template can attach to.

    Exactly COMMUNICATION_EVENTS from lib/communications/events.ts, in its order.
    An enum rather than free text because a template pointing at an event the
    product never raises is a template that silently never sends.
  */
  if not exists (select 1 from pg_type where typname = 'communication_event') then
    create type public.communication_event as enum (
      'application_received',
      'shortlisted',
      'ai_screening_call_scheduled',
      'phone_interview_scheduled',
      'video_interview_scheduled',
      'interview_reminder',
      'assessment_assigned',
      'director_round_scheduled',
      'offer_extended',
      'hired',
      'rejected',
      'unqualified'
    );
  end if;
end $$;

-- =============================================================================
-- message_templates
--
-- What a candidate is told, and when. One row per (event, channel) an
-- organization chooses to automate.
-- =============================================================================
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Internal label. Never shown to a candidate.
  name text not null check (length(btrim(name)) between 1 and 120),

  event_key public.communication_event not null,
  channel public.message_template_channel not null,

  /*
    Email only, and NOT NULL-checked here.

    parseTemplatePayload() refuses an email template with no subject, and this
    constraint is the same rule at the boundary the browser can reach directly:
    an email with no subject line is a deliverability problem, not a style
    choice. A whatsapp-only template must leave it null rather than storing an
    unused string that a future reader would try to display.
  */
  subject text,
  constraint message_templates_subject_matches_channel check (
    (channel in ('email', 'both') and subject is not null and length(btrim(subject)) > 0)
    or (channel = 'whatsapp' and subject is null)
  ),

  -- The email body, or the only body for a whatsapp-only template.
  body text not null check (length(btrim(body)) > 0),

  /*
    The WhatsApp body for a `both` template.

    A separate column rather than one shared body, because the two channels are
    not the same medium: an email can carry a paragraph and a signature, a
    WhatsApp message is read on a phone and has a much shorter useful length.
    One body would have to be wrong for one of them.
  */
  whatsapp_body text,
  constraint message_templates_whatsapp_body_matches_channel check (
    (channel = 'both' and whatsapp_body is not null and length(btrim(whatsapp_body)) > 0)
    or (channel <> 'both')
  ),

  active boolean not null default false,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_message_templates_organization
  on public.message_templates (organization_id);

-- The lookup the send pipeline does on every pipeline event: "is there an active
-- template for this event in this org?"
create index if not exists idx_message_templates_active_event
  on public.message_templates (organization_id, event_key)
  where active;

drop trigger if exists trg_message_templates_touch on public.message_templates;
create trigger trg_message_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- message_log
--
-- Every message this product sent a candidate, or deliberately did not send.
--
-- ONE LOG, TWO SURFACES. The Application page and the Candidate page both read
-- this table — see components/CommunicationLog.tsx, rendered by both. There is no
-- second history view and this migration does not create one.
-- =============================================================================
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    Both parents, and both nullable-by-context.

    A message about an application has both; a message to a candidate with no
    application in play has only the candidate. The check below refuses a row
    that belongs to neither, which would be a log entry nothing can display.
  */
  application_id uuid references public.applications (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  constraint message_log_has_a_subject check (
    application_id is not null or candidate_id is not null
  ),

  channel public.message_delivery_channel not null,

  /*
    The template used, if any.

    ON DELETE SET NULL, not CASCADE. Deleting a template must not erase the
    record of messages already sent through it — that history is the evidence
    that a candidate was told something, and it outlives the wording.
  */
  template_id uuid references public.message_templates (id) on delete set null,
  event_key public.communication_event,

  -- What was actually sent, AFTER placeholder substitution. Stored rather than
  -- re-rendered on read: the template may have changed since, and the log has to
  -- say what this person received, not what they would receive today.
  subject text,
  body_sent text not null,

  status public.message_status not null default 'queued',
  error_message text,

  /*
    A masked recipient — "r••••@example.com", "+91 •••• ••43 10".

    The full address is on the candidate record; repeating it on every log row
    would spread personal data across a table that exists to be read by anyone
    who can see the application. The hint is enough to confirm which address was
    used.
  */
  recipient_hint text,

  provider_message_id text,

  -- NULL for an automatic send: an automation is not a person, and naming the
  -- recruiter who happened to trigger the stage change would be a false record.
  sent_by uuid references public.users (id) on delete set null,

  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_log_application
  on public.message_log (application_id, created_at desc);

create index if not exists idx_message_log_candidate
  on public.message_log (candidate_id, created_at desc);

create index if not exists idx_message_log_organization
  on public.message_log (organization_id, created_at desc);

-- =============================================================================
-- candidate_communication_preferences
--
-- Opt-out state, per candidate per channel.
--
-- Keyed by (organization_id, candidate_id) with no surrogate id: there can only
-- ever be one row per candidate, and a surrogate key invites two — at which point
-- "has this person opted out?" depends on which row you read.
-- =============================================================================
create table if not exists public.candidate_communication_preferences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,

  email_opted_out boolean not null default false,
  whatsapp_opted_out boolean not null default false,

  opted_out_at timestamptz,
  -- Free text: "replied STOP", "asked on a call". Recorded because an opt-out a
  -- recruiter entered by hand and one the candidate made through the unsubscribe
  -- link are different facts if anyone ever disputes it.
  opted_out_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (organization_id, candidate_id)
);

drop trigger if exists trg_candidate_comm_prefs_touch
  on public.candidate_communication_preferences;
create trigger trg_candidate_comm_prefs_touch
  before update on public.candidate_communication_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- organization_settings.communication_settings
--
-- The other half of the same omission. lib/settings/queries.ts reads and writes
-- this column and app/settings/recruitment/RecruitmentForm.tsx sends it in the
-- SAME payload as currency, default recruiter, default stage and interview
-- duration — so with the column absent, /settings/recruitment cannot save
-- anything at all, not merely the reminder fields.
--
-- Shape: { interviewReminderHours: number, interviewReminderChannels: string[] }.
-- Read through normalizeCommunicationSettings(), which clamps it.
-- =============================================================================
alter table public.organization_settings
  add column if not exists communication_settings jsonb not null default '{}';

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.message_templates enable row level security;
alter table public.message_log enable row level security;
alter table public.candidate_communication_preferences enable row level security;

/**
 * Templates: every member reads, Owner/Admin writes.
 *
 * The read is deliberately open to Recruiter and Viewer. A recruiter about to
 * move somebody to Rejected should be able to see exactly what that candidate is
 * about to receive, without being able to reword it for the whole organization.
 * That is the permission split the module's spec asks for, and it only means
 * anything if it is here as well as in the route.
 */
drop policy if exists message_templates_select_member on public.message_templates;
create policy message_templates_select_member on public.message_templates
  for select using (public.is_org_member(organization_id));

drop policy if exists message_templates_insert_owner_admin on public.message_templates;
create policy message_templates_insert_owner_admin on public.message_templates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/*
  USING *and* WITH CHECK on update.

  Without organization_id in WITH CHECK, an Admin could take their own template
  and move it into another tenant — the rule constrains what the row may BECOME,
  not just who may touch it. Same shape the rest of this schema uses.

  It also matters for `active`: activating a template is what makes it send to
  real people, and that transition must not be reachable by a Recruiter through
  the browser's PostgREST client just because a route handler said no.
*/
drop policy if exists message_templates_update_owner_admin on public.message_templates;
create policy message_templates_update_owner_admin on public.message_templates
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists message_templates_delete_owner_admin on public.message_templates;
create policy message_templates_delete_owner_admin on public.message_templates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/**
 * message_log: every member reads. NOBODY writes through a session.
 *
 * There is no INSERT, UPDATE or DELETE policy, on purpose. Log rows are written
 * by the send pipeline through lib/supabase/admin.ts, which bypasses RLS — and a
 * message history that a user's browser could edit is not a history. An Owner
 * must not be able to delete the record of what a candidate was told, and the
 * append-only guarantee the audit log makes would be worthless here without the
 * same treatment.
 */
drop policy if exists message_log_select_member on public.message_log;
create policy message_log_select_member on public.message_log
  for select using (public.is_org_member(organization_id));

/**
 * Opt-out state: every member reads; Owner/Admin/Recruiter write.
 *
 * Recruiters included because recording "she asked me on the call not to text
 * again" is a thing that happens to a recruiter, and making them file a request
 * to honour it is how an opt-out gets ignored. The unsubscribe route writes
 * through the service role, since the candidate has no session.
 */
drop policy if exists candidate_comm_prefs_select_member
  on public.candidate_communication_preferences;
create policy candidate_comm_prefs_select_member
  on public.candidate_communication_preferences
  for select using (public.is_org_member(organization_id));

drop policy if exists candidate_comm_prefs_write_staff
  on public.candidate_communication_preferences;
create policy candidate_comm_prefs_write_staff
  on public.candidate_communication_preferences
  for all using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- Cross-tenant integrity.
--
-- Every row here carries organization_id AND a foreign key to a parent. A foreign
-- key proves the parent exists, not that it is OURS — without these triggers, a
-- log row could point at another tenant's application and expose it through a
-- join, which is precisely the class of bug organization_id-on-every-table is
-- meant to prevent.
-- =============================================================================
create or replace function public.enforce_message_log_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.application_id is not null then
    if not exists (
      select 1 from public.applications a
      where a.id = new.application_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Application does not belong to this organization';
    end if;
  end if;

  if new.candidate_id is not null then
    if not exists (
      select 1 from public.candidates c
      where c.id = new.candidate_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  if new.template_id is not null then
    if not exists (
      select 1 from public.message_templates t
      where t.id = new.template_id and t.organization_id = new.organization_id
    ) then
      raise exception 'Template does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_message_log_tenant_integrity() from public, anon;

drop trigger if exists trg_message_log_tenant_integrity on public.message_log;
create trigger trg_message_log_tenant_integrity
  before insert or update of application_id, candidate_id, template_id, organization_id
  on public.message_log
  for each row execute function public.enforce_message_log_tenant_integrity();

create or replace function public.enforce_comm_prefs_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.candidates c
    where c.id = new.candidate_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Candidate does not belong to this organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_comm_prefs_tenant_integrity() from public, anon;

drop trigger if exists trg_comm_prefs_tenant_integrity
  on public.candidate_communication_preferences;
create trigger trg_comm_prefs_tenant_integrity
  before insert or update of candidate_id, organization_id
  on public.candidate_communication_preferences
  for each row execute function public.enforce_comm_prefs_tenant_integrity();

-- =============================================================================
-- Documentation the next reader sees first.
-- =============================================================================
comment on table public.message_templates is
  'What a candidate is told, and when. Owner/Admin write; every member reads, so a recruiter can see what a candidate will receive without being able to reword it org-wide.';

comment on table public.message_log is
  'Every message sent to a candidate, or deliberately skipped. APPEND-ONLY from a session''s point of view: there is no insert/update/delete policy, so only the send pipeline (service role) writes. Read by components/CommunicationLog.tsx on BOTH the application and candidate pages — there is no second history view.';

comment on column public.message_log.status is
  '''skipped'' is not a failure — it records the product declining to send, e.g. an opt-out or a disconnected channel. Logging that as ''failed'' would make an honoured opt-out look like a bug.';

comment on column public.message_log.body_sent is
  'The rendered message AS SENT, after placeholder substitution. Stored rather than re-rendered, because the template may have changed since and the log must say what this person actually received.';

comment on table public.candidate_communication_preferences is
  'Per-candidate opt-out, one row per (organization, candidate). Recruiters may write it: honouring "don''t text me again" should not need an Admin.';

-- ############################################################################
-- ## 0036_prevent_self_role_change.sql
-- ############################################################################

-- =============================================================================
-- Module 1 hardening: nobody changes their own role.
--
-- Before this, app/api/members/[id]/route.ts guarded escalation (only an Owner
-- may grant or revoke Owner) and enforce_owner_remains() guarded the last
-- Owner — but neither compared the actor to the target. An Admin could demote
-- themselves to Viewer in one click and then lacked the very permission needed
-- to undo it. app/team/invite/TeamManager.tsx hid the "Remove" button on your
-- own row but left the role dropdown live next to it, which is what made the
-- omission visible.
--
-- Role changes now always require a second person, Owner included. Stepping
-- down as Owner is a two-sided flow: promote someone else to Owner, then they
-- demote you. enforce_owner_remains() still guarantees the workspace is never
-- left with zero Owners.
--
-- Why a trigger and not the RLS policy: the rule compares the row's OLD role
-- to its NEW role, which a policy cannot express — USING sees only the old row
-- and WITH CHECK only the new one. A policy predicate on user_id would block
-- every self-update, including the soft-remove that writes status.
-- =============================================================================

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- current_app_user_id() is null when there is no end-user session — the
  -- service-role client (lib/supabase/admin.ts), the SQL Editor, migrations.
  -- The comparison then yields null rather than true, so those contexts can
  -- still repair a workspace that has locked itself out. That is deliberate:
  -- an operator with the secret key is already past every other check here.
  if new.role is distinct from old.role
     and old.user_id = public.current_app_user_id()
  then
    raise exception
      'You cannot change your own role. Ask another Owner or Admin to do it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_self_role_change on public.organization_members;

-- `of role` narrows the trigger to statements that actually name the column,
-- so the soft-remove path (status -> 'removed') and any future column write
-- are untouched. `is distinct from` above then filters out a no-op rewrite.
create trigger prevent_self_role_change
  before update of role on public.organization_members
  for each row
  execute function public.prevent_self_role_change();

-- ############################################################################
-- ## 0037_stage_workflow_builder.sql
-- ############################################################################

-- =============================================================================
-- Module 25 — Stage Workflow Builder
--
-- This migration adds NO new engine, NO new pipeline, and NO new stage.
--
-- It does three things:
--
--   1. Gives `automations` enough provenance to say "this rule belongs to
--      job X, stage Y, branch Z". A stage workflow IS an automations row. The
--      Automations settings page keeps listing it, the run history keeps
--      recording it, and the engine keeps executing it — the builder is a
--      second, stage-centric editor for rows that already had a home.
--
--   2. Adds the Not Shortlisted flag to `applications`. NOT a stage, NOT a
--      status enum value: three nullable columns. The 8-stage structure
--      (lib/applications/stages.ts) is untouched, so Analytics funnels, SLA
--      config and job_hiring_stages toggles all keep working unchanged.
--
--   3. Records which branch a run took, so "why did this email go out?" has an
--      answer in the run history rather than only in the rule.
--
-- WHY PROVENANCE COLUMNS RATHER THAN A SEPARATE TABLE.
--
-- A `stage_workflows` table would have needed its own actions column, its own
-- validation, its own executor and its own run log — four copies of Module 13
-- that would drift from the original within one release. The brief is explicit
-- that this "connects [the modules], it does not replace any of them", so the
-- rows stay where the engine already looks for them and the new columns only
-- answer "who is editing this, and from where".
-- =============================================================================

-- =============================================================================
-- automations — provenance
-- =============================================================================

alter table public.automations
  -- NULL means org-wide, which is what every rule written before this migration
  -- is. A stage workflow always names its job: the same stage on two jobs is two
  -- independent workflows, because the whole point is that a Senior Engineer
  -- pipeline can email different words than a Support pipeline.
  add column if not exists job_id uuid references public.jobs (id) on delete cascade,

  -- Which pipeline stage this fires on. Deliberately plain text validated
  -- against lib/applications/stages.ts, matching how `trigger` is stored: a new
  -- stage would then be a catalogue change, not a migration. NULL for org-wide
  -- rules that are not attached to a stage at all.
  add column if not exists stage_key text,

  -- 'always' for a stage with no pass/fail concept, 'pass'/'fail' for the two
  -- branches of a scored stage. An 'always' rule fires on every entry into the
  -- stage; a branch rule fires only when the engine dispatched that outcome.
  add column if not exists branch text not null default 'always'
    check (branch in ('always', 'pass', 'fail')),

  -- How this rule is edited. 'stage_workflow' rows are owned by the builder and
  -- round-tripped by it; 'manual' rows are the Module 13 builder's. Kept so the
  -- Automations page can label where a rule came from instead of showing a list
  -- where half the rows cannot be edited where they appear.
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'stage_workflow'));

comment on column public.automations.job_id is
  'Job this rule is scoped to. NULL = organization-wide (every rule before Module 25).';
comment on column public.automations.stage_key is
  'Pipeline stage this rule is attached to. Validated in lib/applications/stages.ts.';
comment on column public.automations.branch is
  'always | pass | fail. Branch rules fire only when the engine dispatched that outcome.';
comment on column public.automations.source is
  'manual = Module 13 builder. stage_workflow = the per-stage builder on the job page.';

-- One workflow row per job + stage + branch. A second row for the same slot
-- would make "the actions on this stage" depend on row order, which is the
-- ambiguity the builder's ordered action list exists to remove.
--
-- Partial, so it constrains ONLY builder-owned rows: an admin may still write as
-- many org-wide Module 13 rules against the same stage as they like.
create unique index if not exists uq_automations_stage_workflow_slot
  on public.automations (job_id, stage_key, branch)
  where source = 'stage_workflow';

-- The dispatch query gains a job filter: "active rules for this trigger, that
-- are either org-wide or scoped to this application's job".
create index if not exists idx_automations_job_stage
  on public.automations (organization_id, job_id, stage_key)
  where status = 'active';

/**
 * THE UNIQUE (organization_id, name) CONSTRAINT IS THE REASON FOR THIS BLOCK.
 *
 * Module 13 named rules uniquely per organization, which is right for
 * hand-written rules a person has to find in a list. A stage workflow's name is
 * generated ("Shortlisted — On Pass"), and the same stage on two different jobs
 * would generate the same name and collide on save — the builder would refuse to
 * create a workflow on the second job for a reason that has nothing to do with
 * anything the user did.
 *
 * The constraint is replaced with one that treats a builder-owned row's name as
 * unique within its JOB. Hand-written rules keep exactly the old guarantee,
 * because their job_id is NULL and the two partial indexes below are disjoint.
 */
alter table public.automations
  drop constraint if exists automations_organization_id_name_key;

create unique index if not exists uq_automations_org_name_global
  on public.automations (organization_id, name)
  where job_id is null;

create unique index if not exists uq_automations_org_job_name
  on public.automations (organization_id, job_id, name)
  where job_id is not null;

/**
 * A stage workflow must name its stage; an org-wide rule must not name a job it
 * is not scoped to. Enforced in the database rather than only in the API for the
 * standing reason in AGENTS.md: the browser holds an authenticated PostgREST
 * client, so a rule inserted directly would otherwise skip every check the route
 * makes.
 */
alter table public.automations
  drop constraint if exists automations_stage_workflow_shape;

alter table public.automations
  add constraint automations_stage_workflow_shape check (
    source <> 'stage_workflow'
    or (job_id is not null and stage_key is not null)
  );

-- =============================================================================
-- automation_runs — which branch ran
-- =============================================================================

alter table public.automation_runs
  add column if not exists branch text not null default 'always'
    check (branch in ('always', 'pass', 'fail'));

comment on column public.automation_runs.branch is
  'The outcome branch this run was dispatched for. Answers "why did this fire?".';

-- =============================================================================
-- message_log — who a message actually went to
--
-- Module 25 lets a stage workflow send a templated message to a COLLEAGUE about
-- a candidate ("Rahul just passed the assessment with 82%"). The row keeps its
-- candidate_id, because the message is part of that application's story and the
-- communication history is where somebody goes to find out what happened.
--
-- Without this column that row would be indistinguishable from a message the
-- CANDIDATE received. "We told them on the 4th" would then be a false statement
-- generated from a true row — the worst kind, because nothing looks wrong.
-- =============================================================================

alter table public.message_log
  add column if not exists internal_recipient_user_id uuid
    references public.users (id) on delete set null;

comment on column public.message_log.internal_recipient_user_id is
  'Set when this message went to a colleague ABOUT the candidate, not to the '
  'candidate. NULL = a candidate-facing message, which is every row before '
  'Module 25.';

create index if not exists idx_message_log_internal_recipient
  on public.message_log (organization_id, internal_recipient_user_id)
  where internal_recipient_user_id is not null;

-- =============================================================================
-- applications — the Not Shortlisted flag
--
-- THIS IS NOT A STAGE AND NOT A REJECTION.
--
-- The brief is explicit: an automatic screen-out is "distinct from Rejected,
-- since this was an automatic screen-out rather than a human decision after
-- review", and it "must remain visible and reversible by a human, never a hard
-- rejection with no way back".
--
-- So the application STAYS in whatever stage it was in (Applied), keeps its row
-- on the pipeline board, and carries a flag. Three consequences fall out of that
-- choice, all of them wanted:
--
--   - public.application_stage is untouched, so the funnel in Module 16, the SLA
--     config in Module 10 and the stage toggles in job_hiring_stages all keep
--     working with no retrofit at all.
--   - Clearing the flag is a single UPDATE to NULL. There is no stage to move
--     back to and no history entry to unpick, which is what makes "reversible"
--     true rather than aspirational.
--   - The board can show the card with a marker instead of hiding it, so an
--     over-aggressive threshold is visible as a column full of flags rather than
--     as candidates who quietly stopped appearing.
-- =============================================================================

alter table public.applications
  add column if not exists not_shortlisted_at timestamptz,

  -- The score that failed, frozen at the moment of the decision. Read from
  -- match_score at flag time rather than joined at read time, because match_score
  -- is recalculated and a later recalculation would rewrite the history of a
  -- decision that was made on the old number.
  add column if not exists not_shortlisted_score numeric(5, 2)
    check (not_shortlisted_score is null
           or (not_shortlisted_score >= 0 and not_shortlisted_score <= 100)),

  -- The threshold it was measured against, for the same reason. "62% did not
  -- reach 70%" is a complete explanation; "62%" on its own is not.
  add column if not exists not_shortlisted_threshold numeric(5, 2)
    check (not_shortlisted_threshold is null
           or (not_shortlisted_threshold >= 0 and not_shortlisted_threshold <= 100)),

  add column if not exists not_shortlisted_reason text
    check (not_shortlisted_reason is null or length(not_shortlisted_reason) <= 500);

comment on column public.applications.not_shortlisted_at is
  'Set by the AI Resume Shortlisting action on a fail. NOT a rejection: the '
  'application keeps its stage and stays on the board. NULL = not flagged, and '
  'setting it back to NULL is how a human reverses the automatic screen-out.';

-- The board and the "show me what the screen rejected" filter both ask for
-- flagged rows within an organization.
create index if not exists idx_applications_not_shortlisted
  on public.applications (organization_id, not_shortlisted_at)
  where not_shortlisted_at is not null;

/**
 * The flag may never coexist with a terminal stage.
 *
 * "Not Shortlisted" means "the automatic screen said no, and a human has not
 * looked yet". Once somebody rejects the application, the human decision is the
 * one that stands and the flag becomes a second, contradictory answer to the
 * same question. Clearing it on the way into a terminal stage is done by the
 * trigger below rather than refused, because refusing would block a legitimate
 * rejection behind an unrelated tidy-up.
 */
create or replace function public.clear_not_shortlisted_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage in ('rejected', 'withdrawn', 'hired')
     and new.not_shortlisted_at is not null then
    new.not_shortlisted_at := null;
    new.not_shortlisted_score := null;
    new.not_shortlisted_threshold := null;
    new.not_shortlisted_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_applications_clear_not_shortlisted on public.applications;
create trigger trg_applications_clear_not_shortlisted
  before insert or update of stage, not_shortlisted_at on public.applications
  for each row execute function public.clear_not_shortlisted_on_terminal();

-- ############################################################################
-- ## 0038_default_recruitment_flow.sql
-- ############################################################################

-- =============================================================================
-- Module 26 — Default Recruitment Flow, and the two primitives it needs.
--
-- Three things:
--
--   1. automation_delayed_actions — the "Wait, then…" queue. NOT a second
--      scheduler: the existing hourly cron at /api/automations/sweep drains it,
--      in the same pass, under the same service-role client, recording runs in
--      the same automation_runs table. See the block comment on the table.
--
--   2. organization_settings.office_address — the one new organisation-level
--      placeholder the Director Round invitation needs.
--
--   3. Nothing at all for the form-answer-to-field primitive, deliberately.
--      Surfacing an answer reads form_responses.raw_answers BY REFERENCE. A
--      column, a table or a copied value would be a second home for an answer
--      the candidate already gave once, and the day somebody edited a response
--      the two would disagree about what was submitted.
-- =============================================================================

-- =============================================================================
-- automation_delayed_actions
--
-- WHY A QUEUE AND NOT A WINDOW QUERY.
--
-- Interview reminders — the existing scheduled feature — ask a WINDOW question:
-- "which interviews start in the next N hours?" That works because an interview
-- has a row with a time on it, so the question can be asked fresh every sweep
-- and nothing needs remembering.
--
-- A delayed action has no such row. "Wait 30 minutes, then email" is a promise
-- made at a moment that has otherwise left no trace: by the time the sweep runs,
-- the screening call it followed looks exactly like one that finished 30 minutes
-- earlier and was never followed by a wait. So the promise itself is stored.
--
-- This is still the SAME scheduling mechanism, not a second one. The cron
-- endpoint is unchanged, the sweep function is unchanged in shape, and this adds
-- one more pass to it — the way the sweep already has a pass for stale-stage
-- rules and a pass for expiring approvals.
--
-- WHY IT CANCELS ON A STAGE CHANGE.
--
-- The brief is explicit: "If the application moves to a different stage before
-- the delay elapses, the pending delayed action is automatically cancelled —
-- never fire a stale action against an application that's moved on."
--
-- `stage_at_schedule` is the mechanism. The trigger below cancels on the stage
-- change itself rather than leaving it to the sweep to notice, so the pending row
-- is already cancelled the instant the recruiter clicks — not up to an hour
-- later, and not in a race with a sweep that started before the click.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'delayed_action_status') then
    create type public.delayed_action_status as enum (
      'pending',
      'fired',
      -- The application moved on. Not a failure — the correct outcome.
      'cancelled',
      'failed'
    );
  end if;
end $$;

create table if not exists public.automation_delayed_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /**
   * The rule that scheduled this. Cascade-deleted with it: a pending action
   * belonging to a rule somebody deleted has nothing left to explain it, and
   * firing it would send a message no rule accounts for.
   */
  automation_id uuid not null references public.automations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  /** For the run record and for the cancellation comparison. */
  stage_key text not null,
  branch text not null default 'always' check (branch in ('always', 'pass', 'fail')),

  /**
   * THE STAGE THE APPLICATION WAS IN WHEN THE WAIT STARTED.
   *
   * Compared against the live stage by the trigger below. Stored rather than
   * re-derived because `stage_key` is the stage the RULE is attached to, and for
   * a fail branch those differ — a failed resume screen schedules a Shortlisted
   * rule while the application sits in Applied.
   */
  stage_at_schedule text not null,

  /** When this becomes due. The sweep drains everything at or before now(). */
  run_at timestamptz not null,

  /**
   * The nested actions, frozen at schedule time.
   *
   * COPIED, not read from the rule when it fires. A wait is a promise about what
   * was configured when it started; if an admin edits the rule during the wait,
   * the candidate should get what the rule said when their application reached
   * that point, not a message from a rule they never went through. It also means
   * a rule edited mid-wait cannot turn a queued email into a phone call.
   */
  actions jsonb not null default '[]'::jsonb,

  status public.delayed_action_status not null default 'pending',

  /** Set when cancelled or failed. Always shown, never inferred. */
  detail text check (detail is null or length(detail) <= 500),

  scheduled_at timestamptz not null default now(),
  resolved_at timestamptz,

  /**
   * IDEMPOTENCY. One pending wait per (rule, application, occasion).
   *
   * Without it a re-delivered webhook or two overlapping sweeps would queue the
   * same wait twice, and the candidate would get the follow-up twice. Partial,
   * so a completed wait does not block a legitimate second one later — a
   * candidate who re-enters a stage genuinely earns a fresh wait.
   */
  dedupe_key text not null
);

create unique index if not exists uq_delayed_actions_pending
  on public.automation_delayed_actions (automation_id, application_id, dedupe_key)
  where status = 'pending';

-- The sweep's only query: everything due, oldest first.
create index if not exists idx_delayed_actions_due
  on public.automation_delayed_actions (run_at)
  where status = 'pending';

create index if not exists idx_delayed_actions_application
  on public.automation_delayed_actions (organization_id, application_id);

comment on table public.automation_delayed_actions is
  'The "Wait, then…" queue. Drained by the existing sweep at '
  '/api/automations/sweep — this is not a second scheduler.';

-- =============================================================================
-- RLS
--
-- READ for any member, WRITE for nobody through the browser.
--
-- Rows here are created by the engine and resolved by the sweep, both of which
-- hold either the acting user's session or the service-role client. A browser
-- that could insert one could schedule an arbitrary action list against any
-- application in its organization, which is a strictly larger power than the
-- automations table's own insert policy grants — so there is no insert policy at
-- all, matching how application_stage_history is handled.
--
-- Cancelling is the one thing a person legitimately does, and it happens through
-- the trigger below rather than through a direct write.
-- =============================================================================
alter table public.automation_delayed_actions enable row level security;

drop policy if exists delayed_actions_select_member on public.automation_delayed_actions;
create policy delayed_actions_select_member on public.automation_delayed_actions
  for select using (public.is_org_member(organization_id));

-- =============================================================================
-- Cancellation on a stage change
-- =============================================================================
create or replace function public.cancel_delayed_actions_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    update public.automation_delayed_actions
       set status = 'cancelled',
           resolved_at = now(),
           detail = 'Cancelled — the application moved to ' || new.stage::text
                    || ' before the wait finished.'
     where application_id = new.id
       and organization_id = new.organization_id
       and status = 'pending'
       /**
        * Only waits that started in the stage being LEFT.
        *
        * A wait scheduled by a rule on the stage being ENTERED — the same
        * dispatch that produced this stage change — must survive. Without this
        * clause a pass branch that both moves the application and starts a wait
        * would cancel its own wait microseconds after creating it, and the
        * failure would look like "delays just don't work".
        */
       and stage_at_schedule = old.stage::text;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_applications_cancel_delayed on public.applications;
create trigger trg_applications_cancel_delayed
  after update of stage on public.applications
  for each row execute function public.cancel_delayed_actions_on_stage_change();

-- =============================================================================
-- organization_settings.office_address
--
-- The Director Round invitation says "please visit our office at
-- {{organization.office_address}}". Nothing in this product held an address
-- before: organizations has a name, a timezone and a country, and a job has a
-- location, which is where the ROLE is, not where the office is.
--
-- A column rather than a key inside an existing jsonb blob, because it is a
-- single scalar an admin types into a settings field — the same shape as
-- logo_url and brand_color, which sit beside it.
-- =============================================================================
alter table public.organization_settings
  add column if not exists office_address text
    check (office_address is null or length(office_address) <= 500);

comment on column public.organization_settings.office_address is
  'Where candidates are asked to attend in person. Renders as '
  '{{organization.office_address}}. NULL renders as an em dash, never as a '
  'blank in the middle of a sentence.';

-- ############################################################################
-- ## 0039_module27_custom_fields.sql
-- ############################################################################

-- =============================================================================
-- Module 27 — Custom Fields for Jobs, Candidates and Applications.
--
-- NUMBERED 27, NOT 19. The brief calls this "Module 19", but Module 19 is
-- Onboarding & Document Management — docs/modules/19-onboarding-documents.md,
-- shipped in migration 0026_module19_onboarding_documents. Two modules with one
-- number would make every later "see Module 19" ambiguous, so this takes the
-- next free number. Nothing about the feature changed; only the label.
--
-- -----------------------------------------------------------------------------
-- STRICTLY ADDITIVE. NOT ONE EXISTING COLUMN IS TOUCHED.
--
-- This migration creates two tables and nothing else. It does not alter, rename,
-- drop or re-type any column on jobs, candidates or applications. The fixed
-- fields stay fixed and keep their existing editability rules — in particular
-- migration 0023's rule that a candidate's name, email and phone are editable
-- only from the Candidate page. Custom fields sit BESIDE that rule; they are
-- not a second door into it. See the reserved-key constraint below, which is
-- what stops somebody re-creating "email" as a custom field and editing it
-- somewhere the rule does not reach.
--
-- -----------------------------------------------------------------------------
-- ONE FIELD-TYPE TAXONOMY, ENFORCED BY THE TYPE SYSTEM.
--
-- field_type is public.form_field_type — the ENUM migration 0033 created for
-- Module 23's form_fields. Not a new enum, not a text column with its own CHECK
-- list. Postgres itself now refuses a value the forms engine does not know,
-- which is a stronger guarantee than two lists that agree today.
--
-- Three of that enum's twelve values are excluded here, and the exclusions are
-- the interesting part:
--
--   email, phone  — identity. A custom "email" field on a candidate would be a
--                   second place an email address lives, disagreeing with
--                   candidates.email the first time somebody edited one. The
--                   reserved-key constraint blocks the KEY; excluding the TYPE
--                   blocks the same idea wearing a different label.
--   file_upload   — there is no bucket for it. lib/forms/fields.ts already
--                   excludes it from custom questions for exactly this reason:
--                   offering the type would accept a file and silently drop it.
--                   Adding it needs its own bucket, storage policies and a
--                   Module 22 retention answer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which entity a definition belongs to.
--
-- An enum rather than text: these three are the whole scope of this module, and
-- a typo'd 'candidates' would otherwise create a definition that renders on
-- nothing and is invisible to debug.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'custom_field_entity') then
    create type public.custom_field_entity as enum ('job', 'candidate', 'application');
  end if;
end $$;

-- =============================================================================
-- custom_field_definitions — the org's field vocabulary
-- =============================================================================
create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  entity_type public.custom_field_entity not null,

  -- Stable, generated from the label once and NEVER regenerated on rename.
  -- The key is what {{custom.*}} tokens and stored values point at; rewriting it
  -- when somebody fixes a typo in the label would orphan every value and break
  -- every message template that referenced it.
  field_key text not null
    check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) between 2 and 60),

  label text not null check (btrim(label) <> '' and length(label) <= 120),

  field_type public.form_field_type not null,

  -- Choice options. Same shape as form_fields.options, so the renderer that
  -- draws a dropdown on a public form draws this one too.
  options jsonb not null default '[]'::jsonb,

  required boolean not null default false,

  -- Only meaningful for entity_type = 'job' — see the CHECK below.
  show_on_public_form boolean not null default false,

  -- `order` is a reserved word in SQL, and the repo already settled on
  -- display_order (organization_document_templates). Same name, same meaning.
  display_order integer not null default 0,

  active boolean not null default true,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One key per entity per org. Scoped to entity_type on purpose: a job's
  -- "region" and a candidate's "region" are different questions and must not
  -- collide with each other.
  constraint custom_field_definitions_unique_key
    unique (organization_id, entity_type, field_key),

  -- The excluded types, explained in the header.
  constraint custom_field_definitions_type_allowed
    check (field_type not in ('email', 'phone', 'file_upload')),

  -- Choice types need options; everything else must not carry them. Without the
  -- second half, changing a dropdown to a number leaves stale options behind
  -- that reappear if it is ever changed back.
  constraint custom_field_definitions_options_match_type check (
    case
      when field_type in ('dropdown', 'radio', 'checkbox')
        then jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0
      else options = '[]'::jsonb
    end
  ),

  -- A candidate-level field cannot appear on a job's public form: the form
  -- belongs to a job, and the value it collects lands on an application. Left
  -- unconstrained, the settings UI would offer a toggle that silently does
  -- nothing, which is how people learn a checkbox is broken.
  constraint custom_field_definitions_public_form_is_job_only
    check (show_on_public_form = false or entity_type = 'job'),

  -- ---------------------------------------------------------------------------
  -- THE COLLISION RULE, IN THE DATABASE.
  --
  -- AGENTS.md rule 6: a rule about the data belongs in a CHECK, not only in a
  -- route handler. The browser holds an authenticated PostgREST client, so a
  -- rule enforced only in the API is a rule any signed-in user can skip — and
  -- skipping THIS one is how "email" becomes an editable custom field on the
  -- Application page, in defiance of migration 0023.
  --
  -- The lists are every real column on each table as of migration 0038, plus
  -- the UI-facing aliases somebody would naturally type (experience, salary,
  -- skills, first_name, recruiter, status). Over-inclusive on purpose: refusing
  -- a key costs somebody one rename, while allowing a colliding one costs a
  -- silent disagreement between two fields that look identical.
  -- ---------------------------------------------------------------------------
  constraint custom_field_definitions_key_not_reserved check (
    case entity_type
      when 'job' then field_key <> all (array[
        'id', 'organization_id', 'client_id', 'owner_recruiter_id',
        'title', 'description', 'location', 'work_mode',
        'experience_min', 'experience_max', 'experience',
        'salary_min', 'salary_max', 'salary',
        'required_skills', 'preferred_skills', 'skills',
        'status', 'archived_at', 'created_at', 'updated_at',
        'resume_passing_score', 'automations_enabled', 'client_name'
      ])
      when 'candidate' then field_key <> all (array[
        'id', 'organization_id',
        'name', 'first_name', 'last_name',
        'email', 'email_normalized', 'phone', 'phone_normalized',
        'location', 'current_company', 'current_role',
        'total_experience_years', 'experience',
        'expected_salary', 'salary', 'current_ctc',
        'notice_period_days', 'notice_period',
        'skills', 'source', 'resume_url',
        'education', 'employment_history',
        'archived_at', 'created_at', 'updated_at'
      ])
      when 'application' then field_key <> all (array[
        'id', 'organization_id', 'job_id', 'candidate_id',
        'assigned_recruiter_id', 'recruiter',
        'stage', 'status', 'source', 'priority', 'match_score',
        'not_shortlisted_at', 'not_shortlisted_reason',
        'not_shortlisted_score', 'not_shortlisted_threshold',
        'rejected_at_stage', 'archived_at', 'created_at', 'updated_at'
      ])
    end
  )
);

create index if not exists idx_custom_field_defs_org_entity
  on public.custom_field_definitions (organization_id, entity_type, display_order, created_at);

-- The render path: "active fields for this entity type", the query every form
-- runs. Partial, because inactive definitions are never rendered.
create index if not exists idx_custom_field_defs_active
  on public.custom_field_definitions (organization_id, entity_type, display_order)
  where active;

-- The public-form path, narrower still.
create index if not exists idx_custom_field_defs_public_form
  on public.custom_field_definitions (organization_id, display_order)
  where active and show_on_public_form;

-- =============================================================================
-- custom_field_values — one answer per field per record
-- =============================================================================
create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),

  -- ---------------------------------------------------------------------------
  -- organization_id IS NOT IN THE BRIEF'S SCHEMA, AND IT IS NOT OPTIONAL.
  --
  -- The brief lists only (definition_id, entity_type, entity_id, value). Every
  -- RLS policy on this table would then have to JOIN to the definition to learn
  -- the tenant, and AGENTS.md rule 8 requires that every query made with the
  -- admin client filter organization_id EXPLICITLY — which is impossible on a
  -- table that does not carry it. Denormalised here, and kept honest by the
  -- trigger below rather than by hoping callers pass the right one.
  -- ---------------------------------------------------------------------------
  organization_id uuid not null references public.organizations (id) on delete cascade,

  custom_field_definition_id uuid not null
    references public.custom_field_definitions (id) on delete cascade,

  -- ---------------------------------------------------------------------------
  -- POLYMORPHIC, SO THERE IS NO FOREIGN KEY. This is the one real cost of the
  -- design and it is worth naming: entity_id points at a job, a candidate or an
  -- application depending on entity_type, and Postgres cannot express "references
  -- whichever table this other column names". The cleanup triggers at the bottom
  -- of this file are what stands in for ON DELETE CASCADE. Without them, deleting
  -- a job leaves its custom values behind for ever.
  -- ---------------------------------------------------------------------------
  entity_type public.custom_field_entity not null,
  entity_id uuid not null,

  -- jsonb because the shape genuinely varies: a string for text, a number for
  -- number, a boolean for yes_no, an ARRAY for checkbox. A text column would
  -- force every reader to re-parse, and the checkbox case would become CSV.
  value jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One value per field per record. This is what makes saving an upsert rather
  -- than a delete-then-insert, so a failed save cannot lose the old answer.
  constraint custom_field_values_unique_per_record
    unique (custom_field_definition_id, entity_id)
);

create index if not exists idx_custom_field_values_entity
  on public.custom_field_values (organization_id, entity_type, entity_id);
create index if not exists idx_custom_field_values_definition
  on public.custom_field_values (custom_field_definition_id);

-- -----------------------------------------------------------------------------
-- The value's tenant and entity_type must match its definition's.
--
-- A cross-row invariant, so a CHECK cannot express it. Without this, a caller
-- could store a value under another org's definition id, or file a candidate
-- answer against a job definition — and both would read back as legitimate
-- data. SECURITY DEFINER so it can see the definition row regardless of the
-- caller's own visibility.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_custom_field_value_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def record;
begin
  select organization_id, entity_type, active, show_on_public_form
    into v_def
    from public.custom_field_definitions
   where id = new.custom_field_definition_id;

  if not found then
    raise exception 'custom field definition % does not exist',
      new.custom_field_definition_id;
  end if;

  if v_def.organization_id <> new.organization_id then
    raise exception 'custom field value organization does not match its definition';
  end if;

  -- ---------------------------------------------------------------------------
  -- THE ONE PLACE A VALUE'S entity_type MAY DIFFER FROM ITS DEFINITION'S.
  --
  -- A job field marked show_on_public_form is asked of every APPLICANT, so the
  -- DEFINITION belongs to the job while each VALUE it collects belongs to the
  -- application that came through that job's form. The brief is explicit about
  -- this ("saved ... against the resulting application (not the job)"), and it
  -- is the right shape: one question, one definition, and an answer per
  -- applicant rather than one answer overwritten by every candidate in turn.
  --
  -- Everything else must still match. Without the second half of this check a
  -- candidate answer could be filed against a job definition by mistake and
  -- would read back as legitimate data.
  --
  -- Note the unique constraint still holds: (definition_id, entity_id) differs
  -- per application, so a job may ALSO carry its own value for the same
  -- definition — what the job requires, beside what each applicant answered.
  -- ---------------------------------------------------------------------------
  if v_def.entity_type <> new.entity_type
     and not (v_def.entity_type = 'job'
              and new.entity_type = 'application'
              and v_def.show_on_public_form)
  then
    raise exception 'custom field value entity_type (%) does not match its definition (%)',
      new.entity_type, v_def.entity_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_custom_field_values_integrity on public.custom_field_values;
create trigger trg_custom_field_values_integrity
  before insert or update on public.custom_field_values
  for each row execute function public.enforce_custom_field_value_integrity();

-- -----------------------------------------------------------------------------
-- updated_at (touch_updated_at() was created by Module 3).
-- -----------------------------------------------------------------------------
drop trigger if exists trg_custom_field_defs_touch_updated_at on public.custom_field_definitions;
create trigger trg_custom_field_defs_touch_updated_at
  before update on public.custom_field_definitions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_custom_field_values_touch_updated_at on public.custom_field_values;
create trigger trg_custom_field_values_touch_updated_at
  before update on public.custom_field_values
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS
--
-- DEFINITIONS: every member reads (the render path needs them); Owner/Admin
-- writes. Matches the brief's §6 exactly, and mirrors
-- organization_document_templates, the closest existing analogue.
--
-- VALUES: every member reads; Owner/Admin/Recruiter writes. A value is ordinary
-- record data — the same people who may edit a job's fixed fields may fill in
-- its custom ones. Viewer is read-only on both, which falls out of not being in
-- either write array.
-- =============================================================================
alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_field_defs_select_member on public.custom_field_definitions;
create policy custom_field_defs_select_member on public.custom_field_definitions
  for select using (public.is_org_member(organization_id));

drop policy if exists custom_field_defs_insert_admin on public.custom_field_definitions;
create policy custom_field_defs_insert_admin on public.custom_field_definitions
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists custom_field_defs_update_admin on public.custom_field_definitions;
create policy custom_field_defs_update_admin on public.custom_field_definitions
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists custom_field_defs_delete_admin on public.custom_field_definitions;
create policy custom_field_defs_delete_admin on public.custom_field_definitions
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists custom_field_values_select_member on public.custom_field_values;
create policy custom_field_values_select_member on public.custom_field_values
  for select using (public.is_org_member(organization_id));

drop policy if exists custom_field_values_insert_editor on public.custom_field_values;
create policy custom_field_values_insert_editor on public.custom_field_values
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists custom_field_values_update_editor on public.custom_field_values;
create policy custom_field_values_update_editor on public.custom_field_values
  for update
  using (public.has_org_role(organization_id,
         array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (public.has_org_role(organization_id,
         array['owner', 'admin', 'recruiter']::public.org_role[]));

drop policy if exists custom_field_values_delete_editor on public.custom_field_values;
create policy custom_field_values_delete_editor on public.custom_field_values
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- Orphan cleanup — the stand-in for the foreign key this table cannot have.
--
-- One trigger per entity table, all calling the same function. AFTER DELETE, so
-- the row is already gone and nothing can re-reference it. Note these fire on
-- HARD delete only: archiving a job sets archived_at and keeps its values,
-- which is correct — an archived job that is restored still has its data.
-- =============================================================================
create or replace function public.delete_custom_field_values_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.custom_field_values
   where entity_type = tg_argv[0]::public.custom_field_entity
     and entity_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_jobs_delete_custom_values on public.jobs;
create trigger trg_jobs_delete_custom_values
  after delete on public.jobs
  for each row execute function public.delete_custom_field_values_for_entity('job');

drop trigger if exists trg_candidates_delete_custom_values on public.candidates;
create trigger trg_candidates_delete_custom_values
  after delete on public.candidates
  for each row execute function public.delete_custom_field_values_for_entity('candidate');

drop trigger if exists trg_applications_delete_custom_values on public.applications;
create trigger trg_applications_delete_custom_values
  after delete on public.applications
  for each row execute function public.delete_custom_field_values_for_entity('application');

comment on table public.custom_field_definitions is
  'Module 27. Per-organization extra fields on jobs/candidates/applications. '
  'Additive only — never replaces or renames a fixed column.';
comment on table public.custom_field_values is
  'Module 27. One answer per definition per record. entity_id is polymorphic; '
  'see the cleanup triggers, which replace the foreign key it cannot have.';

-- ############################################################################
-- ## 0040_bind_invite_to_identity.sql
-- ############################################################################

-- =============================================================================
-- S-01 (P0) — invite tokens were bearer credentials, not identity-bound.
--
-- docs/SECURITY.md §S-01. The original accept_invite() checked that the invite
-- was pending and unexpired and then trusted whoever presented the token:
--
--   * Anyone who obtained a token — a forwarded email, a screenshot in a group
--     chat, a proxy log, a synced browser history — could join that workspace
--     WITH THE INVITED ROLE, including admin or owner.
--   * It ended with `on conflict … do update set role = excluded.role`, so an
--     EXISTING member who got hold of an admin invite meant for someone else
--     escalated their own role by accepting it.
--
-- The invite page said "Use the email address the invite was sent to". That is
-- advice printed next to the door, not a lock.
--
-- Two fixes, below: bind the invite to the identity it was issued to, and stop
-- an invite from ever re-writing an existing member's role.
--
-- -----------------------------------------------------------------------------
-- THE NEAR MISS THAT DECIDES WHERE THE EMAIL IS READ FROM
-- -----------------------------------------------------------------------------
--
-- The obvious implementation compares the invite to `public.users.email`. IT IS
-- WORTHLESS, and worse than no check because it looks like one.
--
-- `users_update_self` (migration 0001) is `for update using (auth_id =
-- auth.uid())` with no column restriction, and the browser holds an
-- authenticated PostgREST client. So any signed-in user can run
--
--     update public.users set email = 'victim@example.com' where auth_id = …
--
-- against their own profile row and walk straight through a check written that
-- way. The comparison below therefore reads `auth.users.email`, which is
-- Supabase Auth's own record and can only be changed through a verified email
-- change flow.
--
-- If a future migration tightens `users_update_self` to a column allowlist, this
-- function should STILL read auth.users. The authority for "who is this person"
-- belongs with the identity provider, not with a profile table any feature may
-- write to.
-- =============================================================================

create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_auth_email text;
  v_invite public.invites;
  v_existing public.organization_members;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- The identity, from the identity provider. See the header above.
  select lower(btrim(email)) into v_auth_email
  from auth.users
  where id = auth.uid();

  select * into v_invite
  from public.invites
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_invite.id is null then
    raise exception 'Invalid or expired invite';
  end if;

  -- ---------------------------------------------------------------------------
  -- S-01, part 1: the invite is for one address, and only that address.
  --
  -- Checked BEFORE anything is written, so a mismatch leaves the invite pending
  -- and the real recipient can still use it. Accepting on the wrong account
  -- must not burn the invite — otherwise a forwarded link becomes a denial of
  -- service against the person it was meant for.
  --
  -- A null email is a phone-only auth identity. It cannot prove it is the
  -- invited recipient, so it is refused rather than allowed through a null
  -- comparison.
  -- ---------------------------------------------------------------------------
  if v_auth_email is null
     or v_auth_email is distinct from lower(btrim(v_invite.email))
  then
    -- A custom SQLSTATE, so the API layer can tell this apart from "expired"
    -- without matching on message text — the same reason isSchemaOutOfDate()
    -- matches on codes. The message deliberately does NOT name the invited
    -- address: whoever is holding a forwarded token should not learn a
    -- colleague's email from the error.
    raise exception 'This invite was issued to a different email address'
      using errcode = 'INV01';
  end if;

  -- Defensive upsert, in case the auth.users trigger has not fired yet
  -- (sign-up with email confirmation disabled). Unchanged, only moved below the
  -- checks so a refused attempt writes nothing at all.
  insert into public.users (auth_id, name, email)
  select auth.uid(), split_part(au.email, '@', 1), au.email
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();

  select * into v_existing
  from public.organization_members
  where organization_id = v_invite.organization_id
    and user_id = v_user_id
  for update;

  -- ---------------------------------------------------------------------------
  -- S-01, part 2: an invite grants membership. It never re-grades a member.
  --
  -- The old `do update set role = excluded.role` was the escalation half of the
  -- finding. Role changes belong to the Team page, which has its own guards
  -- (only an Owner may grant Owner; migration 0036 stops anyone changing their
  -- own role). Two mechanisms for one decision is how they drift apart.
  --
  -- Three cases, stated rather than folded into an upsert:
  -- ---------------------------------------------------------------------------
  if v_existing.id is null then
    -- New member. The ordinary path.
    insert into public.organization_members
      (organization_id, user_id, role, status, invited_by, joined_at)
    values
      (v_invite.organization_id, v_user_id, v_invite.role, 'active', v_invite.invited_by, now());

  elsif v_existing.status <> 'active' then
    -- A removed member rejoining. The role on the invite IS what the inviter
    -- chose for this address, and the address has now been proven, so it is
    -- applied — someone removed as a Viewer and re-invited as an Admin comes
    -- back as an Admin. See the trigger change below for why this is allowed
    -- to change a role when nothing else may.
    update public.organization_members
       set role = v_invite.role,
           status = 'active',
           invited_by = coalesce(v_invite.invited_by, invited_by),
           joined_at = now()
     where id = v_existing.id;

  end if;
  -- An ALREADY-ACTIVE member keeps the role they have. Accepting is a silent
  -- success so they still land in the workspace rather than meeting an error on
  -- a link that is, from their point of view, working correctly.

  update public.invites set status = 'accepted' where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

-- =============================================================================
-- Let a rejoin carry a new role, and nothing else.
--
-- Migration 0036 blocks changing your OWN role, which is exactly right for the
-- Team page and would otherwise break the rejoin branch above: the accepting
-- user is the target of that update, so a Viewer re-invited as an Admin would
-- be refused with "You cannot change your own role" on a link that is
-- legitimate.
--
-- WHY THIS EXEMPTION CANNOT BE TURNED INTO AN ESCALATION. It applies only to a
-- row moving from 'removed' to 'active', and that transition is unreachable
-- outside accept_invite():
--
--   * organization_members has NO client-facing INSERT policy.
--   * org_members_update_owner_admin requires has_org_role(...), which requires
--     an ACTIVE membership row for the caller in that organization. There is at
--     most one row per (organization, user), so a member whose own row is
--     'removed' has no active membership and cannot update that row at all.
--   * An active Owner/Admin reactivating SOMEBODY ELSE is a different user_id,
--     so this trigger never applied to them in the first place.
--
-- So the only way to present old.status='removed' → new.status='active' on your
-- own row is through the SECURITY DEFINER function above, which now proves the
-- email first.
-- =============================================================================

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A rejoin: accept_invite() reactivating a removed member at the role their
  -- invite names. See the block comment above for why this is not a hole.
  if old.status = 'removed' and new.status = 'active' then
    return new;
  end if;

  -- current_app_user_id() is null when there is no end-user session — the
  -- service-role client (lib/supabase/admin.ts), the SQL Editor, migrations.
  -- The comparison then yields null rather than true, so those contexts can
  -- still repair a workspace that has locked itself out. That is deliberate:
  -- an operator with the secret key is already past every other check here.
  if new.role is distinct from old.role
     and old.user_id = public.current_app_user_id()
  then
    raise exception
      'You cannot change your own role. Ask another Owner or Admin to do it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The trigger definition itself is unchanged from 0036 and is re-stated only so
-- this file replays cleanly against a database that has never seen it.
drop trigger if exists prevent_self_role_change on public.organization_members;
create trigger prevent_self_role_change
  before update of role on public.organization_members
  for each row
  execute function public.prevent_self_role_change();

-- Unchanged from 0001, re-stated so a replay of this file leaves the grants in
-- the state the function expects.
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ############################################################################
-- ## 0041_whatsapp_inbox.sql
-- ############################################################################

-- =============================================================================
-- 0041 — WhatsApp inbox: inbound messages, conversations, real delivery status.
--
-- Module 15 shipped a one-way pipe. message_log recorded what this product SAID
-- to a candidate; nothing recorded what they said back, because there was no
-- inbound webhook. lib/integrations/whatsapp/index.ts states that limitation in
-- its own header ("OPT-OUT IS 'REPLY STOP', AND NOBODY IS LISTENING YET") and it
-- had two consequences worth naming:
--
--   1. A candidate who replied STOP was only honoured if a human happened to
--      read the reply on their phone and record it on the candidate page.
--   2. `opened` was documented as "email only; WhatsApp gives us no read signal
--      we trust" — true only because nothing was receiving Meta's status
--      callbacks. Those callbacks are exactly a delivery and read signal, and
--      they are now consumed.
--
-- EXTENDS message_log RATHER THAN ADDING A SECOND TABLE.
--
-- A conversation is one timeline. Storing what we sent in message_log and what
-- they replied in a separate table would mean every read of "what happened
-- between us and this person" is a UNION that two future authors will write
-- differently, and one of them will forget to filter organization_id. So an
-- inbound message is a message_log row with direction = 'inbound', and the
-- existing indexes, RLS, tenant-integrity trigger and masking all apply to it
-- unchanged.
--
-- THE CHECK CONSTRAINT HAD TO BE RELAXED, AND THAT IS THE INTERESTING PART.
--
-- message_log_has_a_subject required application_id or candidate_id, because a
-- row belonging to neither could not be displayed anywhere. An inbound message
-- from a number nobody recognises belongs to neither — and dropping it is not an
-- option (it may be a candidate texting from a second phone, or a wrong number
-- that a recruiter needs to see once to dismiss). A conversation is a third
-- valid home for such a row, so the constraint now admits it. The invariant is
-- unchanged in spirit: every row is reachable from some page.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================

/*
  Direction.

  Defaulted to 'outbound' so the backfill of existing rows is the correct answer
  rather than a guess: before this migration, every row in message_log was
  something this product sent.
*/
do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_direction') then
    create type public.message_direction as enum ('outbound', 'inbound');
  end if;
end $$;

/*
  'received' — the status of an inbound message.

  NOT 'delivered'. The existing statuses all describe how far something WE sent
  got; reusing one of them for a message somebody sent US would put a green
  "Delivered" chip on a candidate's own reply, which reads as a claim about our
  delivery rather than a fact about theirs.

  Added with ALTER TYPE rather than by recreating the enum, so existing rows and
  the columns that reference it are untouched. Nothing in this file may USE the
  new value: Postgres forbids reading an enum value added in the same
  transaction, and the SQL Editor runs a script as one.
*/
alter type public.message_status add value if not exists 'received';

-- =============================================================================
-- whatsapp_conversations
--
-- One row per (organization, phone number). The inbox's left pane.
--
-- KEYED ON THE PHONE NUMBER, NOT THE CANDIDATE, and that is deliberate: the
-- number is what Meta gives us and the only thing known at the moment a stranger
-- texts in. candidate_id is an ANNOTATION on the conversation — filled when we
-- recognise the number, filled later by a human through "Link to candidate", and
-- null in between. Keying on the candidate would have left nowhere to put an
-- unmatched message, which is the case this table mostly exists to handle.
-- =============================================================================
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    NULL means "we do not know who this is" — an unmatched sender.

    ON DELETE SET NULL, not CASCADE. Deleting a candidate must not silently erase
    the record of a conversation that happened; it becomes an unmatched thread,
    which is the truth (we no longer know who that number belongs to) rather than
    a hole. The message rows themselves still cascade with the candidate, which is
    what the privacy module's erasure path requires.
  */
  candidate_id uuid references public.candidates (id) on delete set null,

  /*
    Digits only, country code included, no '+' — exactly the form
    normalizeWhatsAppNumber() produces and Meta expects. Stored normalised so the
    webhook's lookup is an index hit rather than a scan with a format guess, and
    so "+91 98765 43210" and "919876543210" can never open two threads.
  */
  phone_number text not null check (phone_number ~ '^[0-9]{7,15}$'),

  last_message_at timestamptz not null default now(),

  /*
    Separate from last_message_at because the two answer different questions and
    only this one can answer Meta's.

    Meta permits free-form text only within 24 hours of the candidate's last
    INBOUND message; an outbound message does not reopen that window. A single
    last_message_at would make a thread we just wrote to look repliable when it is
    not. Null means they have never written to us.
  */
  last_inbound_at timestamptz,

  -- Truncated at write time, not at render time: the list reads 200 rows and
  -- has no business pulling 200 message bodies to show one line of each.
  last_message_preview text,

  /*
    Inbound messages nobody on the team has opened yet.

    Per ORGANIZATION, not per user. This is a shared inbox — if a colleague has
    already answered the candidate, the thread is handled, and showing it as
    still-unread to everyone else would have three people answering it.
  */
  unread_count integer not null default 0 check (unread_count >= 0),

  created_at timestamptz not null default now(),

  /*
    One thread per number per tenant.

    A unique constraint rather than "check then insert" in the webhook: Meta
    retries, and two deliveries of the same first message arriving together would
    otherwise open two threads through a TOCTOU race that no amount of care in
    TypeScript can close. The webhook upserts onto this constraint.
  */
  unique (organization_id, phone_number)
);

create index if not exists idx_whatsapp_conversations_recent
  on public.whatsapp_conversations (organization_id, last_message_at desc);

create index if not exists idx_whatsapp_conversations_candidate
  on public.whatsapp_conversations (candidate_id)
  where candidate_id is not null;

-- =============================================================================
-- message_log — the inbound half
-- =============================================================================

alter table public.message_log
  add column if not exists direction public.message_direction not null default 'outbound';

alter table public.message_log
  add column if not exists conversation_id uuid
    references public.whatsapp_conversations (id) on delete cascade;

/*
  The relaxed home rule. See this file's header.

  Dropped and recreated rather than added alongside: two overlapping CHECKs with
  similar names is how a later reader concludes the stricter one is dead and
  removes the wrong one.
*/
alter table public.message_log
  drop constraint if exists message_log_has_a_subject;

alter table public.message_log
  add constraint message_log_has_a_subject check (
    application_id is not null
    or candidate_id is not null
    or conversation_id is not null
  );

create index if not exists idx_message_log_conversation
  on public.message_log (conversation_id, created_at)
  where conversation_id is not null;

/*
  IDEMPOTENCY, enforced by the database rather than by the handler.

  Meta redelivers a webhook event until it gets a 2xx, and a retry after a slow
  write is the normal case, not the rare one. The handler checks for an existing
  row first — but check-then-insert across two statements is the same TOCTOU race
  AGENTS.md names, and two concurrent redeliveries would both pass the check.

  INBOUND ONLY. Outbound rows cannot join this index: sendWhatsApp() stores the
  literal string 'unknown' when Meta's response carries no message id, so a
  second such send would collide and a UNIQUE violation would fail a message that
  had already reached a real person. Narrowing the index to inbound makes the
  guarantee exactly as wide as the fact that supports it.
*/
create unique index if not exists idx_message_log_inbound_provider_id
  on public.message_log (organization_id, provider_message_id)
  where direction = 'inbound' and provider_message_id is not null;

/*
  Outbound status callbacks arrive keyed by Meta's message id and nothing else,
  so the lookup that finds the row to update needs its own index. Partial, because
  the vast majority of rows are email and can never be the target.
*/
create index if not exists idx_message_log_provider_id
  on public.message_log (organization_id, provider_message_id)
  where provider_message_id is not null;

-- =============================================================================
-- Cross-tenant integrity.
--
-- Extends 0035's trigger rather than adding a second one. A foreign key proves
-- the conversation exists, not that it is OURS — without this, a log row could
-- point at another tenant's thread and surface in their inbox.
-- =============================================================================
create or replace function public.enforce_message_log_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.application_id is not null then
    if not exists (
      select 1 from public.applications a
      where a.id = new.application_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Application does not belong to this organization';
    end if;
  end if;

  if new.candidate_id is not null then
    if not exists (
      select 1 from public.candidates c
      where c.id = new.candidate_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  if new.template_id is not null then
    if not exists (
      select 1 from public.message_templates t
      where t.id = new.template_id and t.organization_id = new.organization_id
    ) then
      raise exception 'Template does not belong to this organization';
    end if;
  end if;

  -- 0041.
  if new.conversation_id is not null then
    if not exists (
      select 1 from public.whatsapp_conversations w
      where w.id = new.conversation_id and w.organization_id = new.organization_id
    ) then
      raise exception 'Conversation does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_message_log_tenant_integrity() from public, anon;

-- Recreated so conversation_id joins the UPDATE OF list; without it, moving a row
-- into another tenant's thread would not re-run the check.
drop trigger if exists trg_message_log_tenant_integrity on public.message_log;
create trigger trg_message_log_tenant_integrity
  before insert or update of
    application_id, candidate_id, template_id, conversation_id, organization_id
  on public.message_log
  for each row execute function public.enforce_message_log_tenant_integrity();

create or replace function public.enforce_whatsapp_conversation_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.candidate_id is not null then
    if not exists (
      select 1 from public.candidates c
      where c.id = new.candidate_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_whatsapp_conversation_tenant_integrity()
  from public, anon;

drop trigger if exists trg_whatsapp_conversations_tenant_integrity
  on public.whatsapp_conversations;
create trigger trg_whatsapp_conversations_tenant_integrity
  before insert or update of candidate_id, organization_id
  on public.whatsapp_conversations
  for each row execute function public.enforce_whatsapp_conversation_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.whatsapp_conversations enable row level security;

/**
 * Every member reads.
 *
 * DELIBERATELY ORG-WIDE, matching message_log's own SELECT policy and the
 * pipeline board. The "a Recruiter only sees conversations for candidates on
 * their assigned applications" rule is a SCOPING rule applied in the query
 * (lib/messaging/queries.ts), exactly as getBoard() applies it — it decides what
 * is useful to show, not what is safe to show. The tenant is the security
 * boundary here; a Recruiter can already read every message_log row in their own
 * organization through PostgREST, and pretending otherwise in one table while
 * leaving the other open would be a comforting lie.
 */
drop policy if exists whatsapp_conversations_select_member on public.whatsapp_conversations;
create policy whatsapp_conversations_select_member on public.whatsapp_conversations
  for select using (public.is_org_member(organization_id));

/**
 * Owner/Admin/Recruiter insert and update. NOBODY deletes.
 *
 * INSERT is needed because a thread is not only opened by an inbound message: a
 * recruiter sending the first WhatsApp to a candidate opens one too, through
 * their own session, from lib/messaging/thread.ts. Requiring the service role
 * for that would mean the send pipeline holding a privileged client to write a
 * row the caller is perfectly entitled to write.
 *
 * UPDATE covers the two edits a person makes — "link this number to a candidate"
 * and "mark this thread read" — plus the bump that follows an outbound message.
 *
 * NO DELETE POLICY, for the reason message_log has none: a thread with a real
 * person in it is a record of what was said, and an Owner being able to erase it
 * is the outcome most of this schema's constraints exist to prevent.
 *
 * Viewer is absent from both. A Viewer reads the inbox and cannot reply, so they
 * have nothing to write — and "mark as read" is a write, which is why the inbox
 * does not offer it to them rather than offering it and failing.
 *
 * WITH CHECK repeats the role test against the NEW row so organization_id cannot
 * be edited into a tenant the caller does not belong to — the same shape
 * migration 0035 uses on message_templates, and the reason it is there.
 */
drop policy if exists whatsapp_conversations_insert_staff on public.whatsapp_conversations;
create policy whatsapp_conversations_insert_staff on public.whatsapp_conversations
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists whatsapp_conversations_update_staff on public.whatsapp_conversations;
create policy whatsapp_conversations_update_staff on public.whatsapp_conversations
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- bump_whatsapp_conversation
--
-- One statement, because "read the count, add one, write it back" across two
-- statements loses a message whenever two arrive together — and Meta delivers in
-- batches, so they do. AGENTS.md names this race for the "always at least one
-- Owner" invariant; a badge that reads 2 when three people wrote is the same bug
-- with a smaller blast radius, and the same fix.
--
-- last_message_at only ever moves FORWARD (greatest), because Meta redelivers
-- and its batches are not ordered. An older event arriving second must not drag
-- a thread back down the list.
--
-- SECURITY DEFINER with organization_id as an argument would be exactly the
-- "database function that accepts a tenant from the browser" that Module 15's
-- own migration forbids. It is NOT security definer: it runs with the caller's
-- rights, so the service-role webhook can call it and a browser cannot reach
-- past its own RLS policies. The organization_id argument is a filter for
-- safety-in-depth, not the authorisation.
-- =============================================================================
create or replace function public.bump_whatsapp_conversation(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_preview text,
  p_message_at timestamptz,
  p_inbound boolean
)
returns void
language sql
as $$
  update public.whatsapp_conversations
     set last_message_at    = greatest(last_message_at, p_message_at),
         last_inbound_at    = case
                                when p_inbound
                                then greatest(coalesce(last_inbound_at, p_message_at), p_message_at)
                                else last_inbound_at
                              end,
         last_message_preview = p_preview,
         unread_count       = case when p_inbound then unread_count + 1 else unread_count end
   where id = p_conversation_id
     and organization_id = p_organization_id;
$$;

revoke all on function public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean)
  to authenticated, service_role;

-- ############################################################################
-- ## 0042_auto_reply_agent.sql
-- ############################################################################

-- =============================================================================
-- 0042 — the WhatsApp auto-reply agent.
--
-- 0041 gave candidates a way to write to us. This lets an AI answer them, which
-- is a materially different kind of feature from every other AI function in this
-- product and the schema is shaped by that difference.
--
-- WHY THIS IS THE HIGHEST-STAKES AI SURFACE HERE, AND WHAT THE SCHEMA DOES
-- ABOUT IT.
--
-- Every other AI function in lib/ai/ produces something a human reads and then
-- accepts or discards: a summary on a page, a draft in a composer, a suggested
-- rule. The Raw Data → AI → Validation → HUMAN REVIEW → Business Action sequence
-- has a person in the middle. This one does not. Its output leaves the building
-- and arrives on a real person's phone, and **a WhatsApp message cannot be
-- unsent**. There is no undo to build, so the schema's job is to make the
-- feature (a) off unless somebody deliberately turned it on, (b) stoppable
-- instantly, and (c) impossible to mistake for a human afterwards:
--
--   - `organization_settings.auto_reply_master_enabled` DEFAULTS FALSE. An
--     existing organization that applies this migration does not start
--     messaging its candidates. Nothing about a schema change should be able to
--     cause an outbound message.
--   - It is a separate boolean from `auto_reply_config.enabled`, not a
--     convenience duplicate: one is the kill switch a recruiter reaches for
--     in the inbox when the agent says something wrong, the other is
--     configuration an admin tunes. Collapsing them would mean the fastest way
--     to stop the agent was to edit its settings.
--   - `message_log.auto_replied` is on the LOG ROW, so what the agent said is
--     permanently distinguishable from what a person said. The UI labels it from
--     this column; there is no path that writes an auto-reply as an ordinary
--     outbound message.
--   - `whatsapp_conversations.needs_human` is how a refusal becomes visible. An
--     agent that declines to answer and tells nobody is an agent that silently
--     drops candidates.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'auto_reply_timing') then
    create type public.auto_reply_timing as enum ('immediate', 'delayed');
  end if;

  /*
    The life of one queued reply.

    'skipped' is the interesting one and the reason this is an enum rather than a
    boolean: an auto-reply that did not go because a human had just replied, or
    because the candidate had opted out, is the agent behaving correctly. Filing
    that as 'failed' would make correct restraint look like a bug, and filing it
    as nothing at all would make it invisible — and "why didn't the agent answer
    this one?" is a question an admin will ask in the first week.
  */
  if not exists (select 1 from pg_type where typname = 'auto_reply_queue_status') then
    create type public.auto_reply_queue_status as enum (
      'pending',   -- due now or later; the sweep will take it
      'sent',      -- a reply reached the provider
      'skipped',   -- deliberately not answered. See above.
      'failed'     -- we could not complete it
    );
  end if;
end $$;

-- =============================================================================
-- auto_reply_config
--
-- One row per scope: `job_id IS NULL` is the organization-wide default, a set
-- `job_id` overrides it for that job. Exactly the precedence shape Module 24's
-- Default Call Data established (lib/voice/callData.ts), and resolved by one
-- pure function in lib/autoReply/config.ts that both the settings preview and
-- the webhook call — a preview that computes precedence differently from the
-- code that sends is worse than no preview, because it is believed.
-- =============================================================================
create table if not exists public.auto_reply_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    NULL = the organization-wide default. Set = this job's override.

    ON DELETE CASCADE: an override for a deleted job is configuration for
    something that no longer exists, and leaving it would make the settings page
    list an override nobody can see the job for.
  */
  job_id uuid references public.jobs (id) on delete cascade,

  enabled boolean not null default false,

  response_timing public.auto_reply_timing not null default 'immediate',

  /*
    Only meaningful for 'delayed', and the CHECK makes that structural rather
    than conventional.

    Capped at 24 hours (1440) for a reason that is Meta's, not ours: free-form
    text is only permitted within 24 hours of the candidate's last inbound
    message, so a delay longer than the window guarantees the reply is refused
    by WhatsApp at the moment it finally fires. A setting that cannot work is
    not a setting.
  */
  delay_minutes integer check (delay_minutes is null or (delay_minutes between 1 and 1440)),
  constraint auto_reply_config_delay_matches_timing check (
    (response_timing = 'delayed' and delay_minutes is not null)
    or (response_timing = 'immediate' and delay_minutes is null)
  ),

  -- Free-form guidance, not a template. Capped so a pasted essay cannot push
  -- the real facts out of the model's context window.
  tone_instructions text check (tone_instructions is null or length(tone_instructions) <= 2000),
  context_instructions text
    check (context_instructions is null or length(context_instructions) <= 4000),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One override per job per tenant.
  unique (organization_id, job_id)
);

/*
  ONE organization-wide row per tenant.

  A separate partial unique index because `unique (organization_id, job_id)`
  does NOT constrain the default: in SQL two NULLs are not equal, so that
  constraint happily admits five organization-wide rows. Whichever one a query
  happened to read would then decide how the agent behaves — the same class of
  bug migration 0035 avoided by giving candidate_communication_preferences a
  composite primary key instead of a surrogate id.
*/
create unique index if not exists idx_auto_reply_config_org_default
  on public.auto_reply_config (organization_id)
  where job_id is null;

create index if not exists idx_auto_reply_config_job
  on public.auto_reply_config (organization_id, job_id)
  where job_id is not null;

drop trigger if exists trg_auto_reply_config_touch on public.auto_reply_config;
create trigger trg_auto_reply_config_touch
  before update on public.auto_reply_config
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- auto_reply_queue
--
-- One row per inbound message the agent intends to answer.
--
-- WHY A QUEUE EXISTS AT ALL — and why it is not a second clock. AGENTS.md: "Do
-- not add a second cron, a worker, or a timer — add a pass to the existing
-- sweep." A delayed reply is therefore a row with a `due_at`, drained by the
-- one sweep that already drains the `wait_then` delay queue and approval expiry.
--
-- IT IS ALSO THE IDEMPOTENCY KEY, AND THAT MATTERS MORE THAN THE DELAY.
-- `inbound_message_id` is unique, so Meta redelivering a webhook cannot produce
-- a second reply to the same message. Without it, a function frozen mid-send
-- (the normal serverless failure) plus Meta's retry would message a candidate
-- twice about one question.
--
-- An 'immediate' reply is queued too, with `due_at = now()`, and then attempted
-- inline. If the inline attempt never finishes — Meta's timeout, a frozen
-- function — the row is still pending and the sweep picks it up. The queue is
-- the backstop, not just the delay mechanism.
-- =============================================================================
create table if not exists public.auto_reply_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  conversation_id uuid not null
    references public.whatsapp_conversations (id) on delete cascade,

  /*
    The inbound message this is an answer to.

    UNIQUE, which is the whole idempotency guarantee. ON DELETE CASCADE because a
    queued answer to a message that no longer exists has nothing to answer.
  */
  inbound_message_id uuid not null unique
    references public.message_log (id) on delete cascade,

  due_at timestamptz not null default now(),
  status public.auto_reply_queue_status not null default 'pending',

  /*
    Attempts, so a reply that keeps failing stops rather than being retried by
    every sweep forever. The drain gives up at 3 — an LLM or provider failure
    that has persisted across three sweeps is a configuration problem a person
    needs to see, not something to keep spending tokens on.
  */
  attempts integer not null default 0 check (attempts >= 0),

  /** Human-readable, and safe to show an admin. Why it was skipped or failed. */
  detail text,

  /** The reply row, once one exists. Ties the queue to what was actually said. */
  reply_message_id uuid references public.message_log (id) on delete set null,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);

/*
  The drain's own index: pending work, oldest first.

  Partial, because a processed row is never read by the drain again and the
  overwhelming majority of rows are processed.
*/
create index if not exists idx_auto_reply_queue_due
  on public.auto_reply_queue (organization_id, due_at)
  where status = 'pending';

create index if not exists idx_auto_reply_queue_conversation
  on public.auto_reply_queue (conversation_id, created_at desc);

-- =============================================================================
-- Columns on the tables 0041 created
-- =============================================================================

/*
  Was this said by the agent?

  DEFAULTS FALSE, so every row written before this migration — and every row
  written by the manual composer, the templated sends and the automation
  engine — is correctly "a person or a configured template said this". Only
  lib/autoReply/ ever sets it true.

  The UI reads this column to label the bubble. Section 8 of the spec: never
  disguise an auto-reply as a human-sent message. A boolean on the row is how
  that becomes impossible rather than remembered.
*/
alter table public.message_log
  add column if not exists auto_replied boolean not null default false;

create index if not exists idx_message_log_auto_replied
  on public.message_log (organization_id, created_at desc)
  where auto_replied;

/*
  The agent declined and a person is needed.

  On the CONVERSATION rather than the message, because it is a state of the
  thread — "somebody has to answer these people" — and the inbox sorts and
  filters on it. Cleared when a human replies, which is the only thing that can
  honestly clear it.
*/
alter table public.whatsapp_conversations
  add column if not exists needs_human boolean not null default false;

/** Why, in words an admin can act on. Never shown to the candidate. */
alter table public.whatsapp_conversations
  add column if not exists needs_human_reason text;

alter table public.whatsapp_conversations
  add column if not exists needs_human_at timestamptz;

create index if not exists idx_whatsapp_conversations_needs_human
  on public.whatsapp_conversations (organization_id, last_message_at desc)
  where needs_human;

/*
  THE MASTER KILL SWITCH.

  DEFAULT FALSE, and that is the single most important default in this
  migration: applying a schema change must never be able to start messaging real
  candidates. An organization that wants the agent turns it on deliberately, in
  the inbox, as an Owner or Admin.

  Checked FIRST, before any per-job or organization-wide config is read — see
  resolveAutoReply() in lib/autoReply/config.ts. A recruiter watching the agent
  say something wrong needs one switch that stops all of it, not a settings page
  to audit.

  On organization_settings rather than in a jsonb blob because it is a boolean
  the product branches on, not a preference it carries around; the existing
  owner/admin write policy on that table is already exactly the permission the
  spec asks for.
*/
alter table public.organization_settings
  add column if not exists auto_reply_master_enabled boolean not null default false;

-- =============================================================================
-- Cross-tenant integrity.
--
-- A foreign key proves the parent exists, not that it is OURS. Same reasoning
-- and same shape as 0035 and 0041.
-- =============================================================================
create or replace function public.enforce_auto_reply_config_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_id is not null then
    if not exists (
      select 1 from public.jobs j
      where j.id = new.job_id and j.organization_id = new.organization_id
    ) then
      raise exception 'Job does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_auto_reply_config_tenant_integrity() from public, anon;

drop trigger if exists trg_auto_reply_config_tenant_integrity on public.auto_reply_config;
create trigger trg_auto_reply_config_tenant_integrity
  before insert or update of job_id, organization_id
  on public.auto_reply_config
  for each row execute function public.enforce_auto_reply_config_tenant_integrity();

create or replace function public.enforce_auto_reply_queue_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.whatsapp_conversations w
    where w.id = new.conversation_id and w.organization_id = new.organization_id
  ) then
    raise exception 'Conversation does not belong to this organization';
  end if;

  if not exists (
    select 1 from public.message_log m
    where m.id = new.inbound_message_id and m.organization_id = new.organization_id
  ) then
    raise exception 'Message does not belong to this organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_auto_reply_queue_tenant_integrity() from public, anon;

drop trigger if exists trg_auto_reply_queue_tenant_integrity on public.auto_reply_queue;
create trigger trg_auto_reply_queue_tenant_integrity
  before insert or update of conversation_id, inbound_message_id, organization_id
  on public.auto_reply_queue
  for each row execute function public.enforce_auto_reply_queue_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.auto_reply_config enable row level security;
alter table public.auto_reply_queue enable row level security;

/**
 * Config: every member reads, Owner/Admin writes.
 *
 * The read is open to Recruiter and Viewer on purpose, and it is the same
 * judgement migration 0035 made about message templates: a recruiter looking at
 * a thread the agent answered should be able to see what the agent was told to
 * do, without being able to change it for the whole organization. Hiding the
 * configuration would make the agent's behaviour unexplainable to the people
 * living with it.
 *
 * WITH CHECK repeats the role test against the NEW row, so organization_id
 * cannot be edited into a tenant the caller does not belong to, and — the part
 * that matters here — `enabled` cannot be flipped true by a Recruiter through
 * the browser's PostgREST client just because a route handler said no. AGENTS.md:
 * a rule that constrains what a row may BECOME belongs in the policy.
 */
drop policy if exists auto_reply_config_select_member on public.auto_reply_config;
create policy auto_reply_config_select_member on public.auto_reply_config
  for select using (public.is_org_member(organization_id));

drop policy if exists auto_reply_config_write_owner_admin on public.auto_reply_config;
create policy auto_reply_config_write_owner_admin on public.auto_reply_config
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

/**
 * Queue: every member reads. NOBODY writes through a session.
 *
 * No INSERT, UPDATE or DELETE policy, deliberately — the same treatment
 * message_log gets, for the same reason. Rows are written by the inbound webhook
 * and the sweep through the service-role client, both of which have no session
 * by definition. A queue a browser could edit is a queue a browser could use to
 * make the agent message somebody, which is the one thing this table must not
 * allow.
 *
 * The read is open because "what did the agent do, and why did it skip that
 * one?" is the question the inbox's oversight view exists to answer.
 */
drop policy if exists auto_reply_queue_select_member on public.auto_reply_queue;
create policy auto_reply_queue_select_member on public.auto_reply_queue
  for select using (public.is_org_member(organization_id));

-- =============================================================================
-- The inbox needs to show "the agent already handled this" at a glance.
--
-- DENORMALISED ONTO THE CONVERSATION, like last_message_preview beside it, and
-- for the same reason: the list reads up to 200 threads and cannot run a
-- latest-message-per-conversation lookup to render one icon each. The value is
-- written by the same statement that already moves the thread up the list, so
-- there is no second write to forget and nothing to drift.
-- =============================================================================
alter table public.whatsapp_conversations
  add column if not exists last_message_auto_replied boolean not null default false;

/*
  The bump function gains a parameter.

  DROPPED FIRST, deliberately. Adding an argument to a Postgres function creates
  an OVERLOAD rather than replacing it, and PostgREST resolving an rpc() call
  against two candidate signatures is a failure that shows up as "could not
  choose the best candidate function" at run time — i.e. on the webhook, in
  production, for one tenant. Dropping by exact signature keeps this migration
  re-runnable and leaves exactly one function.
*/
drop function if exists public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean);

create or replace function public.bump_whatsapp_conversation(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_preview text,
  p_message_at timestamptz,
  p_inbound boolean,
  p_auto_replied boolean default false
)
returns void
language sql
as $$
  update public.whatsapp_conversations
     set last_message_at    = greatest(last_message_at, p_message_at),
         last_inbound_at    = case
                                when p_inbound
                                then greatest(coalesce(last_inbound_at, p_message_at), p_message_at)
                                else last_inbound_at
                              end,
         last_message_preview = p_preview,
         unread_count       = case when p_inbound then unread_count + 1 else unread_count end,
         -- An inbound message is never an auto-reply, so arriving clears the
         -- flag: the newest thing in the thread is the candidate waiting again.
         last_message_auto_replied = case when p_inbound then false else p_auto_replied end
   where id = p_conversation_id
     and organization_id = p_organization_id;
$$;

revoke all on function
  public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean, boolean)
  from public, anon;
grant execute on function
  public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean, boolean)
  to authenticated, service_role;

-- ############################################################################
-- ## 0043_agent_center.sql
-- ############################################################################

-- =============================================================================
-- 0043 — the Agent Center.
--
-- ONE TABLE FOR AGENT IDENTITY, TWO AXES KEPT APART. `type` is what an agent
-- does; `provider` is who executes it. A provider is only present for the types
-- that take one, and nothing provider-specific lives on this row — Bolna's own
-- agent id, caller number and voice settings stay on `voice_agents`, which
-- becomes this table's 1:1 extension for voice screening agents.
--
-- WHY voice_agents IS EXTENDED RATHER THAN REPLACED.
--
-- Existing voice agents are live: stage workflows name them by id
-- (`automations.actions[].config.agent_id`), the dialling path reads them, and
-- the 1,200-line Voice Agent Console edits them. So every existing row is copied
-- here WITH ITS OWN UUID, `voice_agents.id` becomes a foreign key to
-- `agents.id`, and a trigger creates the identity row for any agent the console
-- creates later. Nothing that already holds an agent id has to change.
--
-- THE RULES THAT MATTER ARE CONSTRAINTS, NOT UI. The browser holds a PostgREST
-- client, so anything enforced only in a route handler is a suggestion:
--   - a type that takes a provider has one; a type that doesn't, doesn't;
--   - only a type something can actually run may be ACTIVE (lib/agents/types.ts
--     `runnable` is the readable copy of that list, and a test compares them);
--   - an agent a workflow still names cannot be deleted, by any path;
--   - type and organization never change after creation.
--
-- Re-runnable. Apply after 0042.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'agent_type') then
    create type public.agent_type as enum (
      'voice_screening',
      'voice_interview',
      'video_interview',
      'whatsapp_reply',
      'email_reply',
      'assessment',
      'universal',
      'custom_llm'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'agent_status') then
    create type public.agent_status as enum ('draft', 'active', 'paused', 'archived');
  end if;
end;
$$;

-- =============================================================================
-- agents
-- =============================================================================
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  type public.agent_type not null,
  -- Who executes it. No credential, key or provider-side id ever lives here;
  -- those are in organization_integrations (encrypted) and voice_agents.
  provider text check (provider in ('bolna', 'sarvam')),
  status public.agent_status not null default 'draft',
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agents_provider_matches_type check (
    (type in ('voice_screening', 'voice_interview') and provider is not null)
    or (type not in ('voice_screening', 'voice_interview') and provider is null)
  ),

  /*
    ONLY WHAT SOMETHING RUNS MAY BE ACTIVE.

    "Active" is read by the dialling path (voice screening) and will be read by
    each later module's runtime. For every other type nothing runs the agent
    yet, so ACTIVE would be a claim with nothing behind it. Each engine module
    widens this list in its own migration, at the moment it starts reading the
    status.
  */
  constraint agents_status_runnable check (
    status <> 'active' or type = 'voice_screening'
  ),

  /*
    WhatsApp reply agents are configured by migration 0042's tables, with a kill
    switch of their own. A second configuration here would be a second place to
    switch an unattended sender off — and the one somebody forgot would keep
    messaging candidates. Refused until the WhatsApp module merges the two.
  */
  constraint agents_whatsapp_managed_elsewhere check (type <> 'whatsapp_reply')
);

create index if not exists idx_agents_org_updated
  on public.agents (organization_id, updated_at desc);

drop trigger if exists trg_agents_touch on public.agents;
create trigger trg_agents_touch before update on public.agents
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS — the tenant boundary. Members read; Owner/Admin write.
-- =============================================================================
alter table public.agents enable row level security;

drop policy if exists agents_select_member on public.agents;
create policy agents_select_member on public.agents
  for select using (public.is_org_member(organization_id));

drop policy if exists agents_insert_owner_admin on public.agents;
create policy agents_insert_owner_admin on public.agents
  for insert
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists agents_update_owner_admin on public.agents;
create policy agents_update_owner_admin on public.agents
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists agents_delete_owner_admin on public.agents;
create policy agents_delete_owner_admin on public.agents
  for delete
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- =============================================================================
-- Type, provider and organization are fixed at creation.
--
-- Changing a voice screening agent's type would strand its voice_agents row;
-- moving an agent between organizations is a cross-tenant write with extra
-- steps. Neither has a legitimate use, so neither is possible.
-- =============================================================================
create or replace function public.enforce_agent_immutable_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id <> old.organization_id
     or new.type <> old.type
     or new.provider is distinct from old.provider then
    raise exception 'An agent''s organization, type and provider cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_agent_immutable_columns() from public, anon;

drop trigger if exists trg_agents_immutable on public.agents;
create trigger trg_agents_immutable
  before update of organization_id, type, provider on public.agents
  for each row execute function public.enforce_agent_immutable_columns();

-- =============================================================================
-- An agent a workflow still names cannot be deleted.
--
-- A trigger rather than a route check, because a route check is skipped by a
-- DELETE sent straight to PostgREST — and because the Voice Agent Console's own
-- delete now passes through here too (deleting its voice_agents row deletes
-- this one), so both places are guarded by the same rule. Any action whose
-- config names the agent counts, disabled rules included: "remove its
-- assignments" is the instruction, and a disabled rule is one click from live.
--
-- lib/agents/config.ts countAgentUsage() is the same test, in TypeScript, for
-- the list's "used by" column.
-- =============================================================================
create or replace function public.guard_agent_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.automations a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.actions) = 'array' then a.actions else '[]'::jsonb end
    ) as action
    where a.organization_id = old.organization_id
      and action -> 'config' ->> 'agent_id' = old.id::text
  ) then
    raise exception using
      errcode = '23503',
      message = 'agent_in_use',
      detail = 'This agent is currently used by one or more workflows.';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_agent_in_use() from public, anon;

drop trigger if exists trg_agents_guard_in_use on public.agents;
create trigger trg_agents_guard_in_use
  before delete on public.agents
  for each row execute function public.guard_agent_in_use();

-- =============================================================================
-- Existing voice agents become agents, keeping their ids.
--
-- ACTIVE, because they are: they dial today, and a migration must not change
-- what happens on a candidate's phone. Their `purpose` (screening,
-- confirmation, follow-up, other) stays on voice_agents as a sub-label — every
-- one of them is an outbound call placed by the screening path.
-- =============================================================================
insert into public.agents (
  id, organization_id, name, type, provider, status, created_by, created_at, updated_at
)
select
  v.id, v.organization_id, v.name, 'voice_screening', v.provider, 'active',
  v.created_by, v.created_at, v.updated_at
from public.voice_agents v
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voice_agents_agent_fk'
  ) then
    alter table public.voice_agents
      add constraint voice_agents_agent_fk
      foreign key (id) references public.agents(id) on delete cascade;
  end if;
end;
$$;

-- =============================================================================
-- Keeping the two rows in step, whichever side is written.
--
-- The console inserts into voice_agents directly, as it always has; this gives
-- that row its identity. SECURITY DEFINER because the existence check must see
-- every organization's rows — an invoker would be blind to another tenant's
-- agent with the same id, and the foreign key (which ignores RLS) would then
-- happily attach to it. RLS on voice_agents still decides whether the insert
-- is allowed at all; this only runs for inserts that policy has let through.
-- =============================================================================
create or replace function public.ensure_agent_for_voice_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.agents
    where id = new.id
      and (organization_id <> new.organization_id or type <> 'voice_screening')
  ) then
    raise exception 'Voice agent id belongs to a different agent';
  end if;

  insert into public.agents (id, organization_id, name, type, provider, status, created_by)
  values (new.id, new.organization_id, new.name, 'voice_screening', new.provider, 'active', new.created_by)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.ensure_agent_for_voice_agent() from public, anon;

drop trigger if exists trg_voice_agents_ensure_agent on public.voice_agents;
create trigger trg_voice_agents_ensure_agent
  before insert on public.voice_agents
  for each row execute function public.ensure_agent_for_voice_agent();

-- A rename in either place is a rename in both. `is distinct from` is what
-- stops the pair of triggers from ping-ponging: the echo updates nothing.
create or replace function public.sync_voice_agent_name_to_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agents set name = new.name
  where id = new.id and name is distinct from new.name;
  return new;
end;
$$;

revoke all on function public.sync_voice_agent_name_to_agent() from public, anon;

drop trigger if exists trg_voice_agents_sync_name on public.voice_agents;
create trigger trg_voice_agents_sync_name
  after update of name on public.voice_agents
  for each row execute function public.sync_voice_agent_name_to_agent();

create or replace function public.sync_agent_name_to_voice_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.voice_agents set name = new.name
  where id = new.id and name is distinct from new.name;
  return new;
end;
$$;

revoke all on function public.sync_agent_name_to_voice_agent() from public, anon;

drop trigger if exists trg_agents_sync_voice_name on public.agents;
create trigger trg_agents_sync_voice_name
  after update of name on public.agents
  for each row execute function public.sync_agent_name_to_voice_agent();

-- Deleting in the console deletes the agent — through the in-use guard above.
-- (Deleting the agent removes the voice row by the foreign key's cascade; this
-- trigger then finds nothing left to delete.)
create or replace function public.delete_agent_for_voice_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.agents where id = old.id;
  return old;
end;
$$;

revoke all on function public.delete_agent_for_voice_agent() from public, anon;

drop trigger if exists trg_voice_agents_delete_agent on public.voice_agents;
create trigger trg_voice_agents_delete_agent
  after delete on public.voice_agents
  for each row execute function public.delete_agent_for_voice_agent();

-- =============================================================================
-- organization_integrations.provider — a bug fix, and room for Sarvam.
--
-- 0007 wrote the CHECK as ('bolna','calendar','email','llm','n8n'). The
-- WhatsApp adapter (lib/integrations/store.ts PROVIDERS) saves 'whatsapp', and
-- no migration ever added it — so on a database built from these files,
-- connecting WhatsApp fails at the constraint. 'sarvam' is added for the
-- adapter the Agent Center already lists; nothing writes it yet.
-- =============================================================================
do $$
declare
  existing text;
begin
  select conname into existing
  from pg_constraint
  where conrelid = 'public.organization_integrations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%provider%'
    and pg_get_constraintdef(oid) like '%bolna%';

  if existing is not null then
    execute format('alter table public.organization_integrations drop constraint %I', existing);
  end if;

  alter table public.organization_integrations
    add constraint organization_integrations_provider_check
    check (provider in ('bolna', 'calendar', 'email', 'llm', 'n8n', 'whatsapp', 'sarvam'));
end;
$$;

comment on table public.agents is
  'Agent Center identity rows. type = what it does, provider = who runs it. '
  'Voice screening agents extend into voice_agents (same id). See migration 0043.';
