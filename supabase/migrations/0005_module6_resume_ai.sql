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
