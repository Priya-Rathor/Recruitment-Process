-- =============================================================================
-- Module 4: Candidates Management
--
-- The single source of truth for candidate identity, regardless of how the
-- candidate entered the system. Read by Applications (5), Resume AI (6, which
-- writes confirmed fields back here), Matching (7), Screening (8), Screening
-- Reports (9) and Clients (12). Treat these column names as stable.
--
-- Reuses Module 1's is_org_member()/has_org_role() helpers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Intake sources, from the spec's feature list. A fixed vocabulary so Analytics
-- (Module 16) can group "source performance" reliably.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'candidate_source') then
    create type public.candidate_source as enum (
      'career_page',
      'resume_upload',
      'email',
      'referral',
      'job_board',
      'agency_database',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'duplicate_status') then
    create type public.duplicate_status as enum ('open', 'confirmed', 'dismissed');
  end if;
end $$;

-- =============================================================================
-- candidates
-- =============================================================================
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),
  email text,
  phone text,

  -- Normalised forms, maintained by a trigger below. Dedup matches on THESE,
  -- never on the raw values: "Rahul@Example.COM " and "rahul@example.com" are
  -- the same person, and an index on a normalised column keeps the lookup fast
  -- at scale (a per-row function call would force a sequential scan).
  email_normalized text,
  phone_normalized text,

  location text,
  current_company text,
  current_role text,
  total_experience_years numeric(4, 1)
    check (total_experience_years is null or (total_experience_years >= 0 and total_experience_years <= 60)),
  skills text[] not null default '{}',
  expected_salary numeric(12, 2) check (expected_salary is null or expected_salary >= 0),
  notice_period_days integer
    check (notice_period_days is null or (notice_period_days >= 0 and notice_period_days <= 365)),

  source public.candidate_source not null default 'manual',
  resume_url text,

  -- Archive marker: candidates are archived, never destroyed, because
  -- Applications (5) and Analytics (16) reference them. True erasure is the
  -- Privacy & Compliance retrofit's job, and is a different operation.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- At least one way to reach the person, or the record is not actionable.
  constraint candidates_contactable
    check (email is not null or phone is not null)
);

create index if not exists idx_candidates_organization_id on public.candidates (organization_id);
create index if not exists idx_candidates_created_at on public.candidates (created_at);
create index if not exists idx_candidates_org_created_at
  on public.candidates (organization_id, created_at desc);
create index if not exists idx_candidates_source on public.candidates (source);

-- Dedup lookups: scoped per tenant, so the same person may legitimately exist
-- in two different organizations.
create index if not exists idx_candidates_org_email_normalized
  on public.candidates (organization_id, email_normalized)
  where email_normalized is not null;
create index if not exists idx_candidates_org_phone_normalized
  on public.candidates (organization_id, phone_normalized)
  where phone_normalized is not null;

-- Skill filtering (Module 7 will lean on this too).
create index if not exists idx_candidates_skills on public.candidates using gin (skills);

-- =============================================================================
-- candidate_duplicates
--
-- Records a SUSPECTED duplicate for a human to confirm or dismiss. Deliberately
-- not auto-merging: merging two people's histories wrongly is far worse than
-- carrying a duplicate for a day.
-- =============================================================================
create table if not exists public.candidate_duplicates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  candidate_id uuid not null references public.candidates (id) on delete cascade,
  duplicate_of_id uuid not null references public.candidates (id) on delete cascade,

  -- What actually collided: 'email', 'phone', or 'email,phone'.
  matched_on text not null,
  status public.duplicate_status not null default 'open',

  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),

  -- A record cannot be its own duplicate.
  constraint candidate_duplicates_distinct check (candidate_id <> duplicate_of_id),
  -- One open pairing per direction; re-running the check must not pile up rows.
  unique (candidate_id, duplicate_of_id)
);

create index if not exists idx_candidate_duplicates_organization_id
  on public.candidate_duplicates (organization_id);
create index if not exists idx_candidate_duplicates_candidate_id
  on public.candidate_duplicates (candidate_id);
create index if not exists idx_candidate_duplicates_duplicate_of_id
  on public.candidate_duplicates (duplicate_of_id);
create index if not exists idx_candidate_duplicates_status
  on public.candidate_duplicates (status);
create index if not exists idx_candidate_duplicates_org_created_at
  on public.candidate_duplicates (organization_id, created_at desc);

-- =============================================================================
-- Normalisation trigger
--
-- Kept in the database rather than the API so that a direct PostgREST write
-- (or a later module's insert) can never bypass it and create a record that
-- silently escapes duplicate detection.
--
-- Must match lib/candidates/dedupe.ts exactly — that file has the unit tests
-- and the reasoning; this is the enforcement.
-- =============================================================================
create or replace function public.normalize_candidate_contact()
returns trigger
language plpgsql
as $$
declare
  v_digits text;
begin
  new.email_normalized :=
    case
      when new.email is null or btrim(new.email) = '' then null
      else lower(btrim(new.email))
    end;

  if new.phone is null or btrim(new.phone) = '' then
    new.phone_normalized := null;
  else
    -- Keep digits only, then compare on the last 10 — enough to make
    -- "+91 98765 43210", "098765 43210" and "9876543210" the same person
    -- without needing a full libphonenumber dependency.
    v_digits := regexp_replace(new.phone, '[^0-9]', '', 'g');
    if length(v_digits) >= 10 then
      new.phone_normalized := right(v_digits, 10);
    elsif length(v_digits) = 0 then
      new.phone_normalized := null;
    else
      new.phone_normalized := v_digits;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_candidates_normalize_contact on public.candidates;
create trigger trg_candidates_normalize_contact
  before insert or update of email, phone on public.candidates
  for each row execute function public.normalize_candidate_contact();

-- updated_at maintenance (touch_updated_at() was created by Module 3).
drop trigger if exists trg_candidates_touch_updated_at on public.candidates;
create trigger trg_candidates_touch_updated_at
  before update on public.candidates
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.candidates enable row level security;
alter table public.candidate_duplicates enable row level security;

-- "View all candidates" is Yes for every role including Viewer.
drop policy if exists candidates_select_member on public.candidates;
create policy candidates_select_member on public.candidates
  for select using (public.is_org_member(organization_id));

-- "Create/edit candidate" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists candidates_insert_staff on public.candidates;
create policy candidates_insert_staff on public.candidates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists candidates_update_staff on public.candidates;
create policy candidates_update_staff on public.candidates
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: archive instead. Hard erasure belongs to the Privacy &
-- Compliance retrofit, which must also clear resumes, screening calls and notes
-- in one audited operation — not a stray DELETE from the browser.

drop policy if exists candidate_duplicates_select_member on public.candidate_duplicates;
create policy candidate_duplicates_select_member on public.candidate_duplicates
  for select using (public.is_org_member(organization_id));

drop policy if exists candidate_duplicates_write_staff on public.candidate_duplicates;
create policy candidate_duplicates_write_staff on public.candidate_duplicates
  for all
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );
