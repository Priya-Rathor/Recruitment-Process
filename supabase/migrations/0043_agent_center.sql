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
