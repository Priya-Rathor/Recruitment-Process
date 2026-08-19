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
