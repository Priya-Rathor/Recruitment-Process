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
