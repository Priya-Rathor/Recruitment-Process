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
