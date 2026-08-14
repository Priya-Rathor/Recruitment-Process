-- =============================================================================
-- Module 11: Interviews
--
-- Schedules interviews, prepares interviewers, and captures structured feedback.
--
-- Two things shape the schema:
--
--   1. "Calendar integration failure does not block internal interview
--      scheduling" (spec test). calendar_event_id is NULLABLE and carries a
--      status, so an interview scheduled while Google Calendar is disconnected
--      is a complete, valid record — not a half-written one.
--
--   2. AI prepares, humans evaluate. There is no AI-authored verdict column
--      anywhere here. rating and recommendation are supplied by the interviewer,
--      and nothing else may write them.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'interview_status') then
    create type public.interview_status as enum (
      'scheduled',
      'completed',
      'cancelled',
      'no_show'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'interview_mode') then
    create type public.interview_mode as enum ('video', 'phone', 'onsite');
  end if;

  if not exists (select 1 from pg_type where typname = 'calendar_sync_status') then
    create type public.calendar_sync_status as enum (
      'not_attempted',  -- calendar isn't connected; the interview stands alone
      'synced',
      'failed'          -- we tried and it didn't work; the interview still stands
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'interview_recommendation') then
    create type public.interview_recommendation as enum (
      'strong_yes',
      'yes',
      'no',
      'strong_no'
    );
  end if;
end $$;

-- =============================================================================
-- interviews
-- =============================================================================
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  -- Present despite the spec's column list omitting it: the global rule requires
  -- organization_id on every table, and Module 2's dashboard filters this table
  -- directly by it.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60
    check (duration_minutes > 0 and duration_minutes <= 480),

  interviewer_id uuid references public.users (id) on delete set null,
  mode public.interview_mode not null default 'video',
  status public.interview_status not null default 'scheduled',

  -- Calendar is OPTIONAL. A null event id with 'not_attempted' is the normal
  -- state until Module 17 ships OAuth, and must never read as a failure.
  calendar_event_id text,
  calendar_sync_status public.calendar_sync_status not null default 'not_attempted',
  calendar_error text,
  meeting_url text,

  /** Free-text location for an onsite interview. */
  location text,
  notes text,

  cancelled_reason text,
  created_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_interviews_organization_id on public.interviews (organization_id);
create index if not exists idx_interviews_application_id on public.interviews (application_id);
create index if not exists idx_interviews_interviewer_id on public.interviews (interviewer_id);
create index if not exists idx_interviews_status on public.interviews (status);
create index if not exists idx_interviews_scheduled_at on public.interviews (scheduled_at);
create index if not exists idx_interviews_org_created_at
  on public.interviews (organization_id, created_at desc);
-- Module 2's "interviews today" tile: a window on scheduled_at, excluding
-- cancelled. The retrofit doc flagged that filter specifically.
create index if not exists idx_interviews_org_status_scheduled
  on public.interviews (organization_id, status, scheduled_at);

drop trigger if exists trg_interviews_touch on public.interviews;
create trigger trg_interviews_touch
  before update on public.interviews
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- interview_feedback
--
-- Written by the human interviewer. The spec is explicit that AI "prepares, it
-- does not evaluate the candidate" — there is deliberately no AI-authored
-- column in this table.
-- =============================================================================
create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  interview_id uuid not null references public.interviews (id) on delete cascade,

  rating integer not null check (rating >= 1 and rating <= 5),
  recommendation public.interview_recommendation not null,
  notes text,

  submitted_by uuid references public.users (id) on delete set null,
  submitted_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One submission per person per interview. Panel interviews with aggregated
  -- multi-interviewer scoring are Build Later, but the shape already allows
  -- several people to file feedback on the same interview.
  unique (interview_id, submitted_by)
);

create index if not exists idx_interview_feedback_organization_id
  on public.interview_feedback (organization_id);
create index if not exists idx_interview_feedback_interview_id
  on public.interview_feedback (interview_id);
create index if not exists idx_interview_feedback_submitted_by
  on public.interview_feedback (submitted_by);
create index if not exists idx_interview_feedback_org_submitted_at
  on public.interview_feedback (organization_id, submitted_at desc);

drop trigger if exists trg_interview_feedback_touch on public.interview_feedback;
create trigger trg_interview_feedback_touch
  before update on public.interview_feedback
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity — a foreign key proves the row exists, not that it is
-- ours. Same pattern as Modules 5-9.
-- =============================================================================
create or replace function public.enforce_interview_tenant_integrity()
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

drop trigger if exists trg_interviews_tenant_integrity on public.interviews;
create trigger trg_interviews_tenant_integrity
  before insert or update of application_id, organization_id on public.interviews
  for each row execute function public.enforce_interview_tenant_integrity();

create or replace function public.enforce_feedback_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview_org uuid;
begin
  select organization_id into v_interview_org
  from public.interviews where id = new.interview_id;

  if v_interview_org is null or v_interview_org <> new.organization_id then
    raise exception 'Interview does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_feedback_tenant_integrity on public.interview_feedback;
create trigger trg_feedback_tenant_integrity
  before insert or update of interview_id, organization_id on public.interview_feedback
  for each row execute function public.enforce_feedback_tenant_integrity();

-- =============================================================================
-- Submitting feedback completes the interview.
--
-- In the database rather than the API so the two can never disagree — an
-- interview with feedback but still marked "scheduled" would sit in the
-- missing-feedback queue forever.
-- =============================================================================
create or replace function public.complete_interview_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.interviews
    set status = 'completed'
    where id = new.interview_id
      and status = 'scheduled';
  return new;
end;
$$;

drop trigger if exists trg_feedback_completes_interview on public.interview_feedback;
create trigger trg_feedback_completes_interview
  after insert on public.interview_feedback
  for each row execute function public.complete_interview_on_feedback();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.interviews enable row level security;
alter table public.interview_feedback enable row level security;

-- Viewing: every active member. "View AI interview brief" is Yes for all four
-- roles, and the brief is meaningless without the interview.
drop policy if exists interviews_select_member on public.interviews;
create policy interviews_select_member on public.interviews
  for select using (public.is_org_member(organization_id));

-- "Schedule interview" is Owner/Admin/Recruiter; Viewer denied.
drop policy if exists interviews_insert_staff on public.interviews;
create policy interviews_insert_staff on public.interviews
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists interviews_update_staff on public.interviews;
create policy interviews_update_staff on public.interviews
  for update
  using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  )
  with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- No DELETE policy: interviews are cancelled, not erased. A cancelled interview
-- is part of the record of how a candidate was treated.

-- Feedback is readable by any member — Module 16 reports on it and a recruiter
-- needs to read what an interviewer wrote.
drop policy if exists interview_feedback_select_member on public.interview_feedback;
create policy interview_feedback_select_member on public.interview_feedback
  for select using (public.is_org_member(organization_id));

-- "Submit feedback" is Owner/Admin/Recruiter. submitted_by is pinned to the
-- caller so feedback cannot be attributed to someone else — an interviewer's
-- assessment must be theirs.
drop policy if exists interview_feedback_insert_staff on public.interview_feedback;
create policy interview_feedback_insert_staff on public.interview_feedback
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
    and submitted_by = public.current_app_user_id()
  );

-- Only the author may revise their own feedback.
drop policy if exists interview_feedback_update_author on public.interview_feedback;
create policy interview_feedback_update_author on public.interview_feedback
  for update
  using (submitted_by = public.current_app_user_id())
  with check (submitted_by = public.current_app_user_id());
