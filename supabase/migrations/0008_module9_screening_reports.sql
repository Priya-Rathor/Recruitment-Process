-- =============================================================================
-- Module 9: AI Screening Report (Summarization)
--
-- Turns an 8-minute Bolna conversation into a 60-second structured report.
--
-- Two properties are enforced by the schema rather than by convention:
--
--   1. "Recruiter corrections persist and are DISTINGUISHABLE from the original
--      AI output" (spec test). Every extracted field is stored twice: ai_* holds
--      what the model said and never changes; the plain column holds the current
--      authoritative value. corrected_fields records which the human overrode.
--
--   2. A transcript is only usable WITH CONSENT. Module 8 records
--      consent_confirmed on the call; a trigger here refuses to attach a report
--      to a call that has none. That is the downstream half of the promise made
--      to the candidate at the start of the call.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'interest_level') then
    -- 'unclear' is a first-class value, not a null: the spec requires ambiguous
    -- answers to be FLAGGED rather than guessed confidently.
    create type public.interest_level as enum ('high', 'medium', 'low', 'unclear');
  end if;

  if not exists (select 1 from pg_type where typname = 'location_acceptance') then
    create type public.location_acceptance as enum ('accepted', 'rejected', 'unclear');
  end if;
end $$;

create table if not exists public.screening_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  screening_call_id uuid not null references public.screening_calls (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  -- ---- Current, authoritative values -------------------------------------
  summary_text text not null,
  interest_level public.interest_level not null default 'unclear',
  expected_ctc numeric(12, 2) check (expected_ctc is null or expected_ctc >= 0),
  notice_period_days integer
    check (notice_period_days is null or (notice_period_days >= 0 and notice_period_days <= 365)),
  location_accepted public.location_acceptance not null default 'unclear',
  availability_notes text,

  -- ---- What the AI originally said. NEVER updated after insert. -----------
  ai_summary_text text not null,
  ai_interest_level public.interest_level not null,
  ai_expected_ctc numeric(12, 2),
  ai_notice_period_days integer,
  ai_location_accepted public.location_acceptance not null,
  ai_availability_notes text,

  -- Fields the model itself was unsure about. Surfaced in the UI so a recruiter
  -- checks them first.
  uncertain_fields text[] not null default '{}',
  -- Fields a human changed. Together with ai_*, this makes every edit visible.
  corrected_fields text[] not null default '{}',

  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One report per call; regenerating replaces it.
  unique (screening_call_id)
);

create index if not exists idx_screening_reports_organization_id
  on public.screening_reports (organization_id);
create index if not exists idx_screening_reports_application_id
  on public.screening_reports (application_id);
create index if not exists idx_screening_reports_screening_call_id
  on public.screening_reports (screening_call_id);
create index if not exists idx_screening_reports_org_created_at
  on public.screening_reports (organization_id, created_at desc);
-- Module 2's attention queue wants reports still awaiting review, and Module 10
-- prioritises on the same signal.
create index if not exists idx_screening_reports_pending_review
  on public.screening_reports (organization_id, created_at desc)
  where reviewed_at is null;

drop trigger if exists trg_screening_reports_touch on public.screening_reports;
create trigger trg_screening_reports_touch
  before update on public.screening_reports
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Consent gate + tenant integrity
--
-- The Privacy chapter requires consent_confirmed to be true "before a
-- transcript/recording is treated as usable in Module 9". Enforced in the
-- database so it holds even for a direct PostgREST insert, and so no future
-- automation can quietly bypass it.
-- =============================================================================
create or replace function public.enforce_screening_report_preconditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call record;
  v_application_org uuid;
begin
  select organization_id, application_id, consent_confirmed, status, transcript
    into v_call
  from public.screening_calls
  where id = new.screening_call_id;

  if v_call is null then
    raise exception 'Screening call not found';
  end if;

  if v_call.organization_id <> new.organization_id then
    raise exception 'Screening call does not belong to this organization';
  end if;

  if v_call.application_id <> new.application_id then
    raise exception 'Screening call belongs to a different application';
  end if;

  select organization_id into v_application_org
  from public.applications where id = new.application_id;

  if v_application_org is null or v_application_org <> new.organization_id then
    raise exception 'Application does not belong to this organization';
  end if;

  -- The consent gate. The candidate was told the call was recorded so a
  -- recruiter could review it; without that confirmation the recording is not
  -- ours to process.
  if not v_call.consent_confirmed then
    raise exception 'This call has no recorded consent, so its transcript cannot be summarised';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_screening_reports_preconditions on public.screening_reports;
create trigger trg_screening_reports_preconditions
  before insert on public.screening_reports
  for each row execute function public.enforce_screening_report_preconditions();

-- =============================================================================
-- The AI original is immutable.
--
-- Without this, a correction could overwrite what the model said and the audit
-- question "did AI get this wrong, or did a human change it?" becomes
-- unanswerable.
-- =============================================================================
create or replace function public.protect_ai_screening_original()
returns trigger
language plpgsql
as $$
begin
  if new.ai_summary_text is distinct from old.ai_summary_text
     or new.ai_interest_level is distinct from old.ai_interest_level
     or new.ai_expected_ctc is distinct from old.ai_expected_ctc
     or new.ai_notice_period_days is distinct from old.ai_notice_period_days
     or new.ai_location_accepted is distinct from old.ai_location_accepted
     or new.ai_availability_notes is distinct from old.ai_availability_notes
  then
    raise exception 'The original AI extraction cannot be edited. Correct the current values instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_screening_reports_protect_ai on public.screening_reports;
create trigger trg_screening_reports_protect_ai
  before update on public.screening_reports
  for each row execute function public.protect_ai_screening_original();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.screening_reports enable row level security;

-- "View screening report" is Yes for all four roles.
drop policy if exists screening_reports_select_member on public.screening_reports;
create policy screening_reports_select_member on public.screening_reports
  for select using (public.is_org_member(organization_id));

-- "Review/correct report" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists screening_reports_insert_staff on public.screening_reports;
create policy screening_reports_insert_staff on public.screening_reports
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists screening_reports_update_staff on public.screening_reports;
create policy screening_reports_update_staff on public.screening_reports
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists screening_reports_delete_owner_admin on public.screening_reports;
create policy screening_reports_delete_owner_admin on public.screening_reports
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );
