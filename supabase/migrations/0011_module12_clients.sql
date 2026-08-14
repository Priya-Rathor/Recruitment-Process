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
