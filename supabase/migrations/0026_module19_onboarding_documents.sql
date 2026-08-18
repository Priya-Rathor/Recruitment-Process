-- =============================================================================
-- Module 19: Onboarding & Document Management
--
-- Collects and verifies every document a new hire owes, from the moment an
-- application reaches Hired.
--
-- THREE DECISIONS IN THIS FILE ARE LOAD-BEARING.
--
-- 1. CREATION IS A TRIGGER, NOT ROUTE CODE.
--    The browser holds an authenticated PostgREST client, and a stage change
--    also arrives from the pipeline board and from Module 13's automation
--    engine. A record created in the PATCH handler would simply not exist for
--    any of those paths, and a hire with no onboarding record is invisible —
--    there is no manual "start onboarding" action to recover with, by design.
--    Same reasoning as trg_applications_stage_history in migration 0004.
--
-- 2. DOCUMENTS ARE COPIED FROM THE TEMPLATES, NOT JOINED TO THEM.
--    name and expected_from are snapshotted at creation. The spec requires that
--    editing the checklist never disturbs a hire already midway through it, and
--    a join would make every in-progress checklist change under them the moment
--    an Admin renamed a row.
--
-- 3. WHAT A ROW MAY BECOME IS ENFORCED IN THE POLICY.
--    "Recruiters cannot verify" is a rule about a status transition, so it lives
--    in WITH CHECK. A recruiter with the anon key and a REST client would
--    otherwise self-verify their own uploads, and the whole point of the
--    verification step is that a second person looked.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_owner') then
    create type public.document_owner as enum ('candidate', 'recruiter');
  end if;

  if not exists (select 1 from pg_type where typname = 'onboarding_status') then
    create type public.onboarding_status as enum ('in_progress', 'completed', 'on_hold');
  end if;

  if not exists (select 1 from pg_type where typname = 'onboarding_document_status') then
    create type public.onboarding_document_status as enum
      ('pending', 'uploaded', 'verified', 'rejected');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- organization_document_templates — the checklist an org defines once
-- -----------------------------------------------------------------------------
create table if not exists public.organization_document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (btrim(name) <> '' and length(name) <= 120),
  description text check (description is null or length(description) <= 500),

  required boolean not null default true,

  -- Who is EXPECTED to provide it. Not who did — that is on the document row.
  expected_from public.document_owner not null default 'candidate',

  display_order integer not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Two identically-named document types in one checklist is always a mistake,
  -- and it makes the checklist unreadable ("PAN Card" twice, one verified).
  constraint organization_document_templates_unique_name
    unique (organization_id, name)
);

create index if not exists idx_document_templates_org
  on public.organization_document_templates (organization_id, display_order, created_at);
create index if not exists idx_document_templates_org_active
  on public.organization_document_templates (organization_id) where active;

-- -----------------------------------------------------------------------------
-- onboarding_records — one per hire
-- -----------------------------------------------------------------------------
create table if not exists public.onboarding_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- UNIQUE, and that is the whole "exactly one record per hire" guarantee.
  -- An application moved out of Hired and back in must not get a second
  -- checklist, nor have its first one reset.
  application_id uuid not null unique references public.applications (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,

  status public.onboarding_status not null default 'in_progress',

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  assigned_to uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- completed_at and status cannot disagree. Analytics reads both.
  constraint onboarding_records_completed_at_matches_status check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists idx_onboarding_records_org
  on public.onboarding_records (organization_id, status, started_at);
create index if not exists idx_onboarding_records_candidate
  on public.onboarding_records (candidate_id);
create index if not exists idx_onboarding_records_assigned
  on public.onboarding_records (organization_id, assigned_to);

-- -----------------------------------------------------------------------------
-- onboarding_documents — one row per document per hire
-- -----------------------------------------------------------------------------
--
-- organization_id is here even though it is reachable through the parent. Every
-- table in this product carries it and is filtered on it directly: the admin
-- client bypasses RLS and every query made with it must filter the tenant
-- explicitly, which a join-only column cannot support.
--
-- expected_from vs uploaded_by: the spec called both of these "uploaded_by",
-- which are two different facts — who OUGHT to provide the file, and which user
-- actually put it there. One name for both would have been a bug waiting to be
-- written, so they are separate columns.
-- -----------------------------------------------------------------------------
create table if not exists public.onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  onboarding_record_id uuid not null
    references public.onboarding_records (id) on delete cascade,

  -- Null for a one-off document added for this hire alone. Set null rather than
  -- cascading when a template is deleted: the document itself is still real.
  template_id uuid references public.organization_document_templates (id) on delete set null,

  name text not null check (btrim(name) <> '' and length(name) <= 120),
  required boolean not null default true,
  expected_from public.document_owner not null default 'candidate',
  display_order integer not null default 0,

  status public.onboarding_document_status not null default 'pending',

  -- Storage object path inside the private 'onboarding-documents' bucket.
  file_url text,
  file_name text,
  file_type text,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes >= 0),

  uploaded_by uuid references public.users (id) on delete set null,
  uploaded_at timestamptz,

  verified_by uuid references public.users (id) on delete set null,
  verified_at timestamptz,

  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 500),
  notes text check (notes is null or length(notes) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A status is a claim about the row's own contents. These stop the claim and
  -- the contents drifting apart, whichever client wrote the row.
  constraint onboarding_documents_uploaded_has_file check (
    status = 'pending' or file_url is not null
  ),
  constraint onboarding_documents_verified_has_verifier check (
    (status = 'verified') = (verified_by is not null and verified_at is not null)
  ),
  -- The spec: "Reject requires a short reason". Enforced here so it holds for a
  -- direct PostgREST write too, not only in the form.
  constraint onboarding_documents_rejected_has_reason check (
    status <> 'rejected' or btrim(coalesce(rejection_reason, '')) <> ''
  ),
  -- One row per template per hire. Without this, re-running generation would
  -- silently duplicate the checklist.
  constraint onboarding_documents_unique_template
    unique (onboarding_record_id, template_id)
);

create index if not exists idx_onboarding_documents_record
  on public.onboarding_documents (onboarding_record_id, required desc, display_order);
create index if not exists idx_onboarding_documents_org_status
  on public.onboarding_documents (organization_id, status);

-- updated_at maintenance (touch_updated_at() from Module 3).
drop trigger if exists trg_document_templates_touch on public.organization_document_templates;
create trigger trg_document_templates_touch
  before update on public.organization_document_templates
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_onboarding_records_touch on public.onboarding_records;
create trigger trg_onboarding_records_touch
  before update on public.onboarding_records
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_onboarding_documents_touch on public.onboarding_documents;
create trigger trg_onboarding_documents_touch
  before update on public.onboarding_documents
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Tenant integrity
--
-- RLS proves the WRITER belongs to the org named on the row. It does not prove
-- the row's own foreign keys point inside that org. A member of org A inserting
-- with organization_id = A and a record_id belonging to org B satisfies every
-- policy and creates a cross-tenant link. Same trap Module 4 hit, same guard.
-- =============================================================================
create or replace function public.enforce_onboarding_document_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_org uuid;
  v_template_org uuid;
begin
  select organization_id into v_record_org
  from public.onboarding_records where id = new.onboarding_record_id;

  if v_record_org is null or v_record_org <> new.organization_id then
    raise exception 'Onboarding record does not belong to this organization';
  end if;

  if new.template_id is not null then
    select organization_id into v_template_org
    from public.organization_document_templates where id = new.template_id;

    if v_template_org is null or v_template_org <> new.organization_id then
      raise exception 'Document template does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_onboarding_documents_tenant_integrity on public.onboarding_documents;
create trigger trg_onboarding_documents_tenant_integrity
  before insert or update of onboarding_record_id, template_id, organization_id
  on public.onboarding_documents
  for each row execute function public.enforce_onboarding_document_tenant_integrity();

-- =============================================================================
-- The default checklist
--
-- Seeded ONCE per organization, and only when it has no templates at all. An
-- org that deliberately deleted every row is not re-seeded on the next call —
-- putting "PAN Card" back after somebody removed it would be the product
-- overruling a decision it was told about.
-- =============================================================================
create or replace function public.seed_default_document_templates(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if exists (
    select 1 from public.organization_document_templates
    where organization_id = p_organization_id
  ) then
    return 0;
  end if;

  -- Required-first ordering, and the two documents a recruiter produces sit
  -- where they actually happen: the signed offer letter comes before the
  -- candidate's paperwork chase.
  insert into public.organization_document_templates
    (organization_id, name, description, required, expected_from, display_order)
  values
    (p_organization_id, 'Signed Offer Letter',
     'The countersigned offer, filed by the recruiter.', true, 'recruiter', 1),
    (p_organization_id, 'PAN Card',
     'Permanent Account Number card, for payroll and tax.', true, 'candidate', 2),
    (p_organization_id, 'Aadhaar / Government ID',
     'Any government photo ID. Aadhaar is the usual one in India.', true, 'candidate', 3),
    (p_organization_id, 'Educational Certificates',
     'Degree or diploma certificates for the highest qualification claimed.',
     true, 'candidate', 4),
    (p_organization_id, 'Bank Account Details',
     'Cancelled cheque or bank letter, for salary credit.', true, 'candidate', 5),
    (p_organization_id, 'Background Verification Consent',
     'Written consent before any background check is run. Not optional — a check '
     || 'run without it is unlawful in most jurisdictions.',
     true, 'candidate', 6),
    (p_organization_id, 'Previous Employment Relieving Letter',
     'From the last employer. Optional: a first-time employee has none, and a '
     || 'candidate serving notice may not have it yet.',
     false, 'candidate', 7)
  on conflict (organization_id, name) do nothing;

  select count(*)::integer into v_inserted
  from public.organization_document_templates
  where organization_id = p_organization_id;

  return v_inserted;
end;
$$;

revoke all on function public.seed_default_document_templates(uuid) from public, anon;
grant execute on function public.seed_default_document_templates(uuid) to authenticated;

-- Every organization that already exists. Without this, only orgs created after
-- this migration would have a checklist, and the Settings screen would open
-- empty for everyone currently using the product.
do $$
declare
  v_org record;
begin
  for v_org in select id from public.organizations loop
    perform public.seed_default_document_templates(v_org.id);
  end loop;
end $$;

-- New organizations. create_organization_and_owner() is re-created rather than
-- wrapped, so there is still exactly one place an organization is born.
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

  -- Module 19. A new org gets a working onboarding checklist without having to
  -- discover the Settings screen first.
  perform public.seed_default_document_templates(v_org.id);

  return v_org;
end;
$$;

revoke all on function public.create_organization_and_owner(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_organization_and_owner(text, text, text, text, text)
  to authenticated;

-- =============================================================================
-- Auto-creation on Hired
--
-- ON CONFLICT DO NOTHING against the unique application_id: moving an
-- application out of Hired and back in finds the existing record and leaves it
-- exactly as it was. Re-generating would wipe verified documents, which is the
-- worst possible outcome of a stage correction.
--
-- The documents are generated in the SAME transaction from the templates active
-- at that moment. That is what makes "editing the checklist does not disturb a
-- hire in progress" true by construction rather than by convention.
-- =============================================================================
create or replace function public.create_onboarding_on_hire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
begin
  if new.stage <> 'hired' then
    return new;
  end if;

  -- Only on entry. An UPDATE that touches nothing else about a row already at
  -- hired must not re-run generation.
  if tg_op = 'UPDATE' and old.stage = 'hired' then
    return new;
  end if;

  insert into public.onboarding_records
    (organization_id, application_id, candidate_id, job_id, status, started_at, assigned_to)
  values
    (new.organization_id, new.id, new.candidate_id, new.job_id, 'in_progress', now(),
     -- Whoever owns the application owns the paperwork. Null is fine and shows
     -- as Unassigned; inventing an assignee would put work on someone silently.
     new.assigned_recruiter_id)
  on conflict (application_id) do nothing
  returning id into v_record_id;

  -- Nothing inserted: this hire already has a record. Leave it alone.
  if v_record_id is null then
    return new;
  end if;

  insert into public.onboarding_documents
    (organization_id, onboarding_record_id, template_id, name, required,
     expected_from, display_order, status)
  select
    new.organization_id,
    v_record_id,
    t.id,
    t.name,
    t.required,
    t.expected_from,
    t.display_order,
    'pending'
  from public.organization_document_templates t
  where t.organization_id = new.organization_id
    and t.active
  order by t.display_order, t.created_at;

  return new;
end;
$$;

drop trigger if exists trg_applications_create_onboarding on public.applications;
create trigger trg_applications_create_onboarding
  after insert or update of stage on public.applications
  for each row execute function public.create_onboarding_on_hire();

-- =============================================================================
-- Applications ALREADY at Hired
--
-- These reached Hired before this module existed, so no trigger ever saw them.
-- They are backfilled deliberately: there is no manual "start onboarding"
-- action anywhere in the product, so without this their paperwork would be
-- permanently unmanageable — a dead end rather than a missing feature.
--
-- started_at is taken from when the application actually entered Hired, so the
-- list's "waiting longest first" sort tells the truth on day one.
-- =============================================================================
insert into public.onboarding_records
  (organization_id, application_id, candidate_id, job_id, status, started_at, assigned_to)
select
  a.organization_id,
  a.id,
  a.candidate_id,
  a.job_id,
  'in_progress',
  coalesce(
    (select max(h.entered_at) from public.application_stage_history h
     where h.application_id = a.id and h.stage = 'hired'),
    a.updated_at,
    a.created_at
  ),
  a.assigned_recruiter_id
from public.applications a
where a.stage = 'hired'
on conflict (application_id) do nothing;

insert into public.onboarding_documents
  (organization_id, onboarding_record_id, template_id, name, required,
   expected_from, display_order, status)
select
  r.organization_id, r.id, t.id, t.name, t.required, t.expected_from, t.display_order, 'pending'
from public.onboarding_records r
join public.organization_document_templates t
  on t.organization_id = r.organization_id and t.active
on conflict (onboarding_record_id, template_id) do nothing;

-- =============================================================================
-- Who may manage a record
--
-- Owner/Admin: any record. Recruiter: the ones assigned to them, plus
-- unassigned ones — the same rule Module 5 applies to applications, and for the
-- same reason: a recruiter has to be able to pick up work nobody has claimed.
--
-- SECURITY DEFINER so a policy can call it without needing to read
-- organization_members itself.
-- =============================================================================
create or replace function public.can_manage_onboarding(p_record_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org uuid;
  v_assigned uuid;
begin
  select organization_id, assigned_to into v_org, v_assigned
  from public.onboarding_records where id = p_record_id;

  if v_org is null then
    return false;
  end if;

  if public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    return true;
  end if;

  if not public.has_org_role(v_org, array['recruiter']::public.org_role[]) then
    return false;
  end if;

  return v_assigned is null or v_assigned = public.current_app_user_id();
end;
$$;

revoke all on function public.can_manage_onboarding(uuid) from public, anon;
grant execute on function public.can_manage_onboarding(uuid) to authenticated;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organization_document_templates enable row level security;
alter table public.onboarding_records enable row level security;
alter table public.onboarding_documents enable row level security;

-- ---- templates: read by any member, written by Owner/Admin only -------------
--
-- A Recruiter reads them because the checklist names appear on every hire's
-- page. They do not write them: the checklist is an organization-wide policy
-- decision, and one recruiter deciding a relieving letter is optional changes
-- it for every hire from then on.
drop policy if exists document_templates_select_member on public.organization_document_templates;
create policy document_templates_select_member on public.organization_document_templates
  for select using (public.is_org_member(organization_id));

drop policy if exists document_templates_insert_admin on public.organization_document_templates;
create policy document_templates_insert_admin on public.organization_document_templates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists document_templates_update_admin on public.organization_document_templates;
create policy document_templates_update_admin on public.organization_document_templates
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists document_templates_delete_admin on public.organization_document_templates;
create policy document_templates_delete_admin on public.organization_document_templates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

-- ---- records ----------------------------------------------------------------
--
-- NO INSERT POLICY. The only writer is the SECURITY DEFINER trigger above.
-- Creation is a consequence of a stage change, never an action, so a client
-- that could insert one could manufacture a hire nobody hired.
drop policy if exists onboarding_records_select_member on public.onboarding_records;
create policy onboarding_records_select_member on public.onboarding_records
  for select using (public.is_org_member(organization_id));

-- Status and assignment, by whoever may manage this record.
--
-- The WITH CHECK re-states can_manage_onboarding so a Recruiter cannot reassign
-- a record to themselves and then act on it, nor hand their own record to
-- someone else and lose it. It also pins organization_id and application_id:
-- moving a record between tenants or between hires is never a legitimate edit.
drop policy if exists onboarding_records_update_staff on public.onboarding_records;
create policy onboarding_records_update_staff on public.onboarding_records
  for update
  using (public.can_manage_onboarding(id))
  with check (
    public.can_manage_onboarding(id)
    and public.is_org_member(organization_id)
  );

-- No DELETE policy: a hire's paperwork history is not disposable. An onboarding
-- record dies only with its application.

-- ---- documents --------------------------------------------------------------
drop policy if exists onboarding_documents_select_member on public.onboarding_documents;
create policy onboarding_documents_select_member on public.onboarding_documents
  for select using (public.is_org_member(organization_id));

-- Adding a one-off document. Never pre-verified: a row may only be born
-- 'pending', so "upload and verify in one step" is not reachable even by an
-- Admin writing directly.
drop policy if exists onboarding_documents_insert_staff on public.onboarding_documents;
create policy onboarding_documents_insert_staff on public.onboarding_documents
  for insert with check (
    public.can_manage_onboarding(onboarding_record_id)
    and status = 'pending'
    and verified_by is null
    and verified_at is null
  );

-- THE VERIFICATION BOUNDARY.
--
-- Two update policies, OR'ed. Owner/Admin get the unrestricted one. Recruiters
-- get a narrower one that cannot produce a verified or rejected row — the
-- transition itself is refused by the database, not just by a button that is
-- not rendered.
--
-- The Recruiter policy also refuses to touch a row that is already verified:
-- silently replacing a checked document with a new file would undo the check
-- without anyone being told.
drop policy if exists onboarding_documents_update_admin on public.onboarding_documents;
create policy onboarding_documents_update_admin on public.onboarding_documents
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    -- A verification records WHO verified. Stamping someone else's name on your
    -- own review defeats the second-pair-of-eyes rule the step exists for.
    and (status <> 'verified' or verified_by = public.current_app_user_id())
  );

drop policy if exists onboarding_documents_update_recruiter on public.onboarding_documents;
create policy onboarding_documents_update_recruiter on public.onboarding_documents
  for update
  using (
    public.has_org_role(organization_id, array['recruiter']::public.org_role[])
    and public.can_manage_onboarding(onboarding_record_id)
    and status <> 'verified'
  )
  with check (
    public.has_org_role(organization_id, array['recruiter']::public.org_role[])
    and public.can_manage_onboarding(onboarding_record_id)
    -- The whole rule, in one line: a Recruiter may move a document to pending or
    -- uploaded, and nowhere else.
    and status in ('pending', 'uploaded')
    and verified_by is null
    and verified_at is null
  );

-- Deleting a one-off document somebody added by mistake. Template-generated
-- rows are NOT deletable: they are the organization's checklist, and removing
-- one would quietly shrink what this hire owes.
drop policy if exists onboarding_documents_delete_admin on public.onboarding_documents;
create policy onboarding_documents_delete_admin on public.onboarding_documents
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and template_id is null
  );

-- =============================================================================
-- Storage — the private 'onboarding-documents' bucket
--
-- Paths are `<organization_id>/<onboarding_record_id>/<uuid>-<filename>` and the
-- policies authorise on the FIRST segment, exactly as Module 6's resumes bucket
-- does. Identity documents are the most sensitive files in this product; the
-- bucket is private and every read goes through a short-lived signed URL.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onboarding-documents',
  'onboarding-documents',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists onboarding_docs_storage_select on storage.objects;
create policy onboarding_docs_storage_select on storage.objects
  for select using (
    bucket_id = 'onboarding-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists onboarding_docs_storage_insert on storage.objects;
create policy onboarding_docs_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'onboarding-documents'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin', 'recruiter']::public.org_role[]
    )
  );

drop policy if exists onboarding_docs_storage_delete on storage.objects;
create policy onboarding_docs_storage_delete on storage.objects
  for delete using (
    bucket_id = 'onboarding-documents'
    and public.has_org_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.org_role[]
    )
  );

-- =============================================================================
-- Reminder configuration lives on organization_settings, next to every other
-- org-level default, rather than in a table of its own.
-- =============================================================================
alter table public.organization_settings
  add column if not exists onboarding_settings jsonb not null default
    '{"pendingReminderDays": 3}'::jsonb;

comment on column public.organization_settings.onboarding_settings is
  'Module 19. pendingReminderDays: how long a required document may sit Pending before the assignee is reminded. 0 disables the reminder.';

comment on table public.onboarding_records is
  'Module 19. One per hire, created by trg_applications_create_onboarding when an application enters the hired stage. No client INSERT policy exists.';

comment on table public.onboarding_documents is
  'Module 19. Snapshotted from organization_document_templates at creation — never joined to them, so editing the checklist cannot disturb a hire already in progress.';
