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
