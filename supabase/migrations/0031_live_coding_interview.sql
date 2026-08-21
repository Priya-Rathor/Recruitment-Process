-- =============================================================================
-- Module 20: Live Coding Interview
--
-- Makes the Written Assessment hiring stage real. Until now that stage was
-- configuration-only — a job could describe a coding test and nothing ran it.
--
-- WHERE THIS SITS IN THE EXISTING MODEL, and why it adds no duplicate ids:
--
--   interviews.id  ->  coding_sessions.interview_id
--   interviews.application_id -> applications -> candidate_id + job_id
--
-- So a coding session already knows who the candidate is, which job they applied
-- for, and which interview it belongs to, through rows that already exist.
-- organization_id is carried for RLS and for the same defence-in-depth every
-- other table in this schema uses, and a trigger checks it against the parent
-- interview so it can never drift.
--
-- THE CANDIDATE IS NOT A USER OF THIS PRODUCT.
--
-- They have no login. Access is a signed HMAC over the session id (the same
-- construction lib/communications/optout.ts uses for the unsubscribe link), so
-- NOTHING is stored here that a leaked database row could turn into a working
-- link, and the URL exposes only this table's own id — never a candidate id, an
-- application id or an interview id.
--
-- Because the candidate has no session, their reads and writes go through route
-- handlers using the service-role client, scoped explicitly by session id. That
-- is the same pattern the Bolna webhook uses, for the same reason. RLS below
-- therefore governs the INTERVIEWER's access only; the candidate never touches
-- PostgREST directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coding_session_status') then
    /**
     * Deliberately five states, not the seven a generic lifecycle would have.
     *
     * There is no separate ACTIVE and IN_PROGRESS: "the link has been opened"
     * and "they have typed something" are the same fact to everyone who looks at
     * this screen, and two states nobody can tell apart is how a status column
     * stops meaning anything. `in_progress` is entered on the first save.
     *
     * There is no COMPLETED distinct from SUBMITTED either. The candidate's act
     * of submitting IS the completion of their side, and the interviewer's
     * judgement is recorded as an application_evaluations row — which is where
     * every other stage's verdict already lives.
     */
    create type public.coding_session_status as enum (
      'created',
      'in_progress',
      'submitted',
      'expired',
      'cancelled'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- coding_sessions
-- -----------------------------------------------------------------------------
create table if not exists public.coding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- The parent. Everything else about who this is for is reachable from here.
  interview_id uuid not null references public.interviews (id) on delete cascade,

  /**
   * Denormalised from interviews.application_id, and that is deliberate.
   *
   * The submission is written against the APPLICATION (application_evaluations),
   * and the candidate-facing routes resolve their tenant from this row alone.
   * Making them join through interviews on every autosave would put a second
   * table in the hot path of a request that fires every few seconds.
   *
   * A trigger keeps it honest — see enforce_coding_session_integrity() below.
   */
  application_id uuid not null references public.applications (id) on delete cascade,

  -- Who started it. NULL if that user is later deleted; the session survives.
  created_by uuid references public.users (id) on delete set null,

  /**
   * The question, captured AT CREATION TIME.
   *
   * Copied from the job's Written Assessment configuration rather than joined to
   * it, because a job's question list is edited freely and a candidate must be
   * judged on the question they were actually shown. The same reason
   * client_feedback_events stores the submission text verbatim.
   */
  question_title text not null check (btrim(question_title) <> '' and length(question_title) <= 200),
  question_description text not null check (btrim(question_description) <> ''),
  /** Extra instructions — time expectations, constraints, what to optimise for. */
  instructions text check (instructions is null or length(instructions) <= 4000),

  status public.coding_session_status not null default 'created',

  /**
   * Languages this session offers, in display order.
   *
   * Stored per session rather than read from a global list so a job that only
   * wants Python does not have to explain away four other options, and so a
   * session's offer cannot change under a candidate mid-test.
   */
  languages text[] not null default array['python', 'javascript', 'java', 'cpp', 'sql'],

  /**
   * Wall-clock minutes the candidate is told they have. ADVISORY.
   *
   * Nothing auto-submits on expiry: cutting someone off mid-sentence over a
   * clock this product cannot see the candidate's side of (a dropped connection,
   * a lift, a laptop asleep) would destroy real work. `expires_at` below is the
   * hard boundary and it is generous by comparison.
   */
  time_limit_minutes integer
    check (time_limit_minutes is null or (time_limit_minutes >= 5 and time_limit_minutes <= 480)),

  /**
   * When the LINK stops working. Not the same thing as the time limit.
   *
   * A link that lives forever is a link that still opens a candidate's editor
   * six months after the interview.
   */
  expires_at timestamptz not null default (now() + interval '24 hours'),

  /** First time the candidate opened the link. NULL until they do. */
  opened_at timestamptz,
  submitted_at timestamptz,

  /** Set when an interviewer cancels; shown to the candidate instead of the editor. */
  cancelled_reason text check (cancelled_reason is null or length(cancelled_reason) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /**
   * ONE LIVE SESSION PER INTERVIEW is NOT enforced here.
   *
   * A coding round genuinely gets re-run — the candidate's connection dropped,
   * the question was wrong, they asked to start again. A unique constraint would
   * make the recovery path "delete the evidence of the first attempt". The API
   * reuses an existing open session instead of creating a second one, and the UI
   * shows the history; both attempts stay on the record.
   */

  -- A status is a claim about this row's own contents. These stop the claim and
  -- the contents drifting apart, whichever client wrote the row.
  constraint coding_sessions_submitted_has_timestamp check (
    (status = 'submitted') = (submitted_at is not null)
  ),
  constraint coding_sessions_cancelled_has_reason check (
    status <> 'cancelled' or btrim(coalesce(cancelled_reason, '')) <> ''
  )
);

create index if not exists idx_coding_sessions_organization on public.coding_sessions (organization_id);
create index if not exists idx_coding_sessions_interview on public.coding_sessions (interview_id);
create index if not exists idx_coding_sessions_application on public.coding_sessions (application_id);
create index if not exists idx_coding_sessions_status on public.coding_sessions (organization_id, status);

-- -----------------------------------------------------------------------------
-- coding_submissions
--
-- ONE ROW PER SESSION, upserted by every autosave.
--
-- Not an append-only keystroke log: the product's question is "what is their
-- code right now?" and "what did they finally submit?", and a row per save would
-- answer neither without an aggregate, while writing thousands of rows per
-- interview. The same shape resume_parse_results uses — one current row per
-- parent, replaced in place.
-- -----------------------------------------------------------------------------
create table if not exists public.coding_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  coding_session_id uuid not null unique
    references public.coding_sessions (id) on delete cascade,

  /** One of coding_sessions.languages. Validated in lib/coding/languages.ts. */
  programming_language text not null check (btrim(programming_language) <> ''),

  /**
   * The candidate's code. Capped, because an editor is a text box on the public
   * internet and an uncapped one is an upload endpoint.
   */
  code text not null default '' check (length(code) <= 200000),

  /** Bumped on every successful save, so the monitor can say "just now". */
  last_saved_at timestamptz not null default now(),
  /** Set once, at submission. The frozen final state. */
  submitted_at timestamptz,

  /** How many times the candidate saved, manual and automatic. Diagnostic only. */
  save_count integer not null default 0 check (save_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coding_submissions_organization on public.coding_submissions (organization_id);

-- =============================================================================
-- Triggers
-- =============================================================================

/**
 * The denormalised application_id must match the parent interview's, and both
 * must belong to the row's own organization.
 *
 * Enforced here rather than only in the route because the browser holds an
 * authenticated PostgREST client: a rule that lives only in a handler is not
 * enforced. This is the same guard every other cross-row table in this schema
 * carries.
 */
create or replace function public.enforce_coding_session_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview_org uuid;
  v_interview_application uuid;
begin
  select organization_id, application_id
    into v_interview_org, v_interview_application
  from public.interviews
  where id = new.interview_id;

  if v_interview_org is null then
    raise exception 'Interview % does not exist', new.interview_id;
  end if;

  if v_interview_org <> new.organization_id then
    raise exception 'Coding session organization does not match its interview';
  end if;

  if v_interview_application <> new.application_id then
    raise exception 'Coding session application does not match its interview';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coding_sessions_integrity on public.coding_sessions;
create trigger trg_coding_sessions_integrity
  before insert or update on public.coding_sessions
  for each row execute function public.enforce_coding_session_integrity();

/** A submission belongs to the same organization as its session. */
create or replace function public.enforce_coding_submission_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_org uuid;
begin
  select organization_id into v_session_org
  from public.coding_sessions
  where id = new.coding_session_id;

  if v_session_org is null then
    raise exception 'Coding session % does not exist', new.coding_session_id;
  end if;

  if v_session_org <> new.organization_id then
    raise exception 'Coding submission organization does not match its session';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coding_submissions_integrity on public.coding_submissions;
create trigger trg_coding_submissions_integrity
  before insert or update on public.coding_submissions
  for each row execute function public.enforce_coding_submission_integrity();

/**
 * A SUBMITTED submission is frozen.
 *
 * The candidate's editor is disabled after submitting and the API refuses a
 * later save, but neither of those is the enforcement — this is. Without it,
 * "the code they submitted" would be a claim the product could not stand behind
 * if it were ever disputed, which is the same reason screening_reports freezes
 * its ai_* columns.
 */
create or replace function public.freeze_submitted_coding_code()
returns trigger
language plpgsql
as $$
begin
  if old.submitted_at is not null then
    if new.code is distinct from old.code
       or new.programming_language is distinct from old.programming_language
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'This coding submission has been submitted and can no longer be edited';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coding_submissions_freeze on public.coding_submissions;
create trigger trg_coding_submissions_freeze
  before update on public.coding_submissions
  for each row execute function public.freeze_submitted_coding_code();

drop trigger if exists trg_coding_sessions_touch on public.coding_sessions;
create trigger trg_coding_sessions_touch
  before update on public.coding_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_coding_submissions_touch on public.coding_submissions;
create trigger trg_coding_submissions_touch
  before update on public.coding_submissions
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
--
-- Governs INTERVIEWER access. The candidate has no session and never reaches
-- PostgREST — their routes use the service-role client, scoped by session id.
-- =============================================================================
alter table public.coding_sessions enable row level security;
alter table public.coding_submissions enable row level security;

-- Every member may see that a coding round happened and read its result. Same
-- floor as interviews and screening reports: a Viewer reads, and reading a
-- submission is how a hiring manager forms an opinion.
drop policy if exists coding_sessions_select_member on public.coding_sessions;
create policy coding_sessions_select_member on public.coding_sessions
  for select using (public.is_org_member(organization_id));

-- Starting a coding round is the same class of act as scheduling an interview,
-- so it takes the same roles. A Viewer must never be able to make the product
-- send a link to a real candidate.
drop policy if exists coding_sessions_insert_staff on public.coding_sessions;
create policy coding_sessions_insert_staff on public.coding_sessions
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists coding_sessions_update_staff on public.coding_sessions;
create policy coding_sessions_update_staff on public.coding_sessions
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists coding_submissions_select_member on public.coding_submissions;
create policy coding_submissions_select_member on public.coding_submissions
  for select using (public.is_org_member(organization_id));

/**
 * NO INSERT OR UPDATE POLICY, and that is the point.
 *
 * The only writer of a candidate's code is the candidate, through the
 * token-authorised routes running under the service role. Granting an
 * interviewer a write path here would mean a member of staff could silently
 * alter what a candidate submitted — the one thing this table exists to be able
 * to prove they did not.
 */

-- =============================================================================
-- Grants. Mirrors every other table: the API layer and RLS do the work.
-- =============================================================================
grant select, insert, update on public.coding_sessions to authenticated;
grant select on public.coding_submissions to authenticated;
