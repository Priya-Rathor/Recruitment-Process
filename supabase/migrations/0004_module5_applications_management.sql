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
