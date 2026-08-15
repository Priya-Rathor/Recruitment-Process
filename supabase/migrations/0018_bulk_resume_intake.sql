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
