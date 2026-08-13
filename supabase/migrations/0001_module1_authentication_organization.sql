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
