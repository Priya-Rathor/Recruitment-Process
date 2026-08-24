-- =============================================================================
-- Module 23: Forms & Public Applications
--
-- ONE FORM ENGINE, NOT TWO. A job's public application form is a `forms` row
-- with purpose='job_application' and a job_id; a pre-interview questionnaire is
-- the same row with a different purpose and no job. There is deliberately no
-- separate "job_application_forms" table: the second one would grow its own
-- field editor, its own validation and its own drift.
--
-- THIS IS NOT job_screening_questions. That table (migration 0002) holds the
-- questions the Module 8 AI voice screen asks. These are questions a candidate
-- types answers to on a public web page. Two different asks, two different
-- audiences, two tables.
--
-- THE CANDIDATE IS NOT A USER OF THIS PRODUCT.
--
-- They have no login, so the public page is authorised by a signed HMAC over
-- (form id, token_version) — the same construction lib/coding/token.ts and
-- lib/communications/optout.ts already use. NOTHING here stores a working link:
-- a leaked database dump yields no URL anybody can open, and there is no token
-- column for a mistaken SELECT to expose.
--
-- token_version is what makes "regenerate link" possible without a stored
-- token. Bumping it invalidates every previously shared link and printed QR
-- code in one UPDATE.
--
-- Because the applicant has no session, their reads and their submission go
-- through route handlers using the service-role client, scoped by the form id
-- that came out of a verified signature. RLS below therefore governs the
-- RECRUITER's access only; the applicant never touches PostgREST.
--
-- WHY THERE IS NO submission_count COLUMN. The browser holds an authenticated
-- PostgREST client, so a counter column is a number any signed-in user can set
-- to anything. "24 applications received" has to be a count of rows that exist,
-- so it is read as count(form_responses) and never stored.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A new candidate/application source.
--
-- applications.source and candidates.source are both public.candidate_source.
-- 'career_page' is the closest existing value and it is not the same thing: a
-- career page is a jobs board somebody browsed, this is a link a recruiter sent
-- to one person. Analytics would silently merge the two.
--
-- SEPARATE do BLOCK, FIRST IN THE FILE, ON PURPOSE. A newly added enum label
-- cannot be USED by the transaction that added it, so nothing below may
-- reference 'application_form' as a default or an insert. Nothing does.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'candidate_source'
      and e.enumlabel = 'application_form'
  ) then
    alter type public.candidate_source add value 'application_form';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1b. activity_entity_type gains 'form' — AND the two values that were missing.
--
-- THIS FIXES A LATENT BUG, not just this module's need.
--
-- lib/activity/types.ts has declared 'message_template' (Module 15) and
-- 'privacy' (Module 22) for some time, but neither was ever added to the
-- database enum. logActivity() does not throw on a failed insert — it logs and
-- returns false — so every audit row written against those two entity types has
-- been silently dropped since. That includes the privacy log's "who viewed this
-- transcript" rows, which is exactly the kind of gap an audit trail must not
-- have.
--
-- Added here with `if not exists` so this migration stays re-runnable, and in
-- the same first-in-the-file block as the candidate_source value above because
-- a new enum label cannot be used by the transaction that added it.
-- -----------------------------------------------------------------------------
alter type public.activity_entity_type add value if not exists 'message_template';
alter type public.activity_entity_type add value if not exists 'privacy';
alter type public.activity_entity_type add value if not exists 'form';

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'form_purpose') then
    /**
     * What the form is FOR, which decides how it behaves rather than merely
     * labelling it: only 'job_application' carries a job_id, is auto-created
     * with default fields, and creates candidates and applications on submit.
     */
    create type public.form_purpose as enum (
      'job_application',
      'pre_interview',
      'general'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'form_status') then
    /**
     * THREE STATES, and 'disabled' is not the same as 'draft'.
     *
     * A draft has never been shared. A disabled form has a link in circulation
     * — on WhatsApp, in an email, printed as a QR code on a poster — that must
     * now say "no longer accepting applications" rather than 404. Collapsing
     * them would mean closing a role either kept accepting submissions or
     * started lying about whether the link ever existed.
     */
    create type public.form_status as enum ('draft', 'published', 'disabled');
  end if;

  if not exists (select 1 from pg_type where typname = 'form_field_type') then
    create type public.form_field_type as enum (
      'short_text',
      'long_text',
      'email',
      'phone',
      'number',
      'dropdown',
      'radio',
      'checkbox',
      'date',
      'file_upload',
      'url',
      'yes_no'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'form_response_status') then
    /**
     * A SUBMISSION THAT REACHED THIS DATABASE IS NEVER SILENTLY DROPPED.
     *
     * The applicant has already been told "thank you, we got it", so a failure
     * in the steps after the insert (storage, parsing, candidate creation) must
     * leave a row a recruiter can see and act on — not a lost application and a
     * person waiting for a reply that will never come.
     *
     *   received       — stored, resolution not finished yet
     *   linked         — candidate and application resolved
     *   needs_review   — resolved, but a matched candidate's profile disagrees
     *                    with what was typed, so fields are queued for review
     *   needs_attention— something downstream failed; processing_error says what
     */
    create type public.form_response_status as enum (
      'received',
      'linked',
      'needs_review',
      'needs_attention'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. forms
-- -----------------------------------------------------------------------------
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (btrim(name) <> '' and length(name) <= 200),
  description text check (description is null or length(description) <= 2000),

  purpose public.form_purpose not null default 'general',

  /**
   * Set for a job application form, null for everything else. The CHECK is what
   * makes that a rule rather than a convention — an application form with no
   * job has no pipeline to put anybody into, and a general form with a job_id
   * would silently start creating applications.
   */
  job_id uuid references public.jobs (id) on delete cascade,

  status public.form_status not null default 'draft',

  /**
   * Bumped to revoke every link ever issued for this form. See the header:
   * the token is an HMAC over (id, token_version), so this integer IS the
   * revocation mechanism, and it is the only thing about the link that is
   * stored anywhere.
   */
  token_version integer not null default 1 check (token_version >= 1),

  created_by uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint forms_job_matches_purpose check (
    (purpose = 'job_application' and job_id is not null)
    or (purpose <> 'job_application' and job_id is null)
  )
);

create index if not exists idx_forms_organization on public.forms (organization_id);
create index if not exists idx_forms_org_status on public.forms (organization_id, status);

/**
 * ONE application form per job.
 *
 * Two would mean two public links for the same role, both live, with
 * submissions split between them and no way for the job page to say which one
 * the QR code on the poster points at. Standalone forms are unconstrained —
 * an organization may have as many questionnaires as it likes.
 */
create unique index if not exists uq_forms_job_application
  on public.forms (job_id)
  where purpose = 'job_application';

-- -----------------------------------------------------------------------------
-- 4. form_fields
-- -----------------------------------------------------------------------------
create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),

  /**
   * Denormalised from forms.organization_id so RLS keys on this row alone
   * rather than joining on every read — the same choice
   * job_screening_questions made. A trigger below keeps it honest.
   */
  organization_id uuid not null references public.organizations (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,

  /**
   * The stable identifier answers are stored under.
   *
   * form_responses.raw_answers is keyed on THIS, not on the label, so a
   * recruiter renaming "Current CTC" to "Current package" does not orphan
   * every answer already collected.
   */
  field_key text not null check (
    field_key ~ '^[a-z][a-z0-9_]{0,58}[a-z0-9]$'
  ),

  label text not null check (btrim(label) <> '' and length(label) <= 200),
  help_text text check (help_text is null or length(help_text) <= 500),

  field_type public.form_field_type not null,

  /** Choices for dropdown/radio/checkbox. Validated in lib/forms/validation.ts. */
  options jsonb not null default '[]'::jsonb,

  required boolean not null default false,

  /**
   * True for the fields shipped with a job application form, false for a
   * recruiter's own questions. Drives two things: which answers map onto
   * candidate columns, and which appear in the "Application form responses"
   * card (the custom ones, since the standard ones are already on the profile).
   */
  is_standard boolean not null default false,

  -- display_order, not "order": ORDER is a reserved word and every other
  -- ordered table in this schema already spells it this way.
  display_order integer not null default 0,

  created_at timestamptz not null default now(),

  constraint form_fields_options_is_array check (jsonb_typeof(options) = 'array')
);

create unique index if not exists uq_form_fields_key on public.form_fields (form_id, field_key);
create index if not exists idx_form_fields_form on public.form_fields (form_id, display_order);
create index if not exists idx_form_fields_organization on public.form_fields (organization_id);

-- -----------------------------------------------------------------------------
-- 5. form_responses
-- -----------------------------------------------------------------------------
create table if not exists public.form_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,

  /**
   * Both NULL at insert time, and that ordering is the whole design.
   *
   * The response is written BEFORE the candidate is matched and the application
   * created, so a failure in either of those still leaves the applicant's
   * answers in the database. Filled in by the same request a moment later.
   */
  application_id uuid references public.applications (id) on delete set null,
  candidate_id uuid references public.candidates (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,

  /** field_key -> value, exactly as submitted. The record of what they typed. */
  raw_answers jsonb not null default '{}'::jsonb,

  status public.form_response_status not null default 'received',
  processing_error text check (processing_error is null or length(processing_error) <= 1000),

  /**
   * A SALTED HASH, NOT AN IP ADDRESS.
   *
   * Rate limiting needs to know "same source as before?", which a hash answers
   * completely. An IP address is personal data under GDPR and Module 22 exists
   * precisely so this product does not collect things casually — so the raw
   * value is never written, here or anywhere else.
   */
  submitter_ip_hash text check (submitter_ip_hash is null or length(submitter_ip_hash) <= 64),

  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint form_responses_answers_is_object check (jsonb_typeof(raw_answers) = 'object')
);

create index if not exists idx_form_responses_form on public.form_responses (form_id, submitted_at desc);
create index if not exists idx_form_responses_organization on public.form_responses (organization_id);
create index if not exists idx_form_responses_application on public.form_responses (application_id);
create index if not exists idx_form_responses_candidate on public.form_responses (candidate_id);

-- -----------------------------------------------------------------------------
-- 6. form_submission_attempts — the rate limiter's ledger
--
-- IN THE DATABASE, NOT IN MEMORY. This app runs serverless: an in-process Map
-- is per-instance and resets on every cold start, so it is not a limit, it is a
-- suggestion. A public unauthenticated endpoint that reaches an AI provider
-- needs an actual one.
-- -----------------------------------------------------------------------------
create table if not exists public.form_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  /** Same salted hash as form_responses.submitter_ip_hash. Never a raw IP. */
  ip_hash text not null check (length(ip_hash) <= 64),
  attempted_at timestamptz not null default now()
);

create index if not exists idx_form_attempts_window
  on public.form_submission_attempts (form_id, ip_hash, attempted_at desc);

-- =============================================================================
-- 7. Triggers
-- =============================================================================

/**
 * A field's denormalised organization_id must match its parent form's.
 *
 * In a trigger rather than only in the route because the browser holds an
 * authenticated PostgREST client: a rule that lives in a handler is not
 * enforced. Without this, a member of org A could insert a field carrying org
 * A's id against org B's form and have it render on org B's public page.
 */
create or replace function public.enforce_form_field_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_org uuid;
begin
  select organization_id into v_form_org from public.forms where id = new.form_id;

  if v_form_org is null then
    raise exception 'Form % does not exist', new.form_id;
  end if;

  if v_form_org <> new.organization_id then
    raise exception 'Form field organization does not match its form';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_fields_integrity on public.form_fields;
create trigger trg_form_fields_integrity
  before insert or update on public.form_fields
  for each row execute function public.enforce_form_field_integrity();

/** The same guard for a response. */
create or replace function public.enforce_form_response_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_org uuid;
begin
  select organization_id into v_form_org from public.forms where id = new.form_id;

  if v_form_org is null then
    raise exception 'Form % does not exist', new.form_id;
  end if;

  if v_form_org <> new.organization_id then
    raise exception 'Form response organization does not match its form';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_responses_integrity on public.form_responses;
create trigger trg_form_responses_integrity
  before insert or update on public.form_responses
  for each row execute function public.enforce_form_response_integrity();

/**
 * EMAIL AND RESUME UPLOAD ARE LOAD-BEARING ON A JOB APPLICATION FORM.
 *
 * Email is what duplicate matching keys on (lib/candidates/dedupe.ts), and the
 * resume is what the Module 6 parsing pipeline needs. A form without them still
 * looks fine on the page and then quietly produces uncontactable, undedupable
 * candidate records — one new person per submission, forever.
 *
 * So they may be RENAMED (an organization can call the upload whatever it
 * likes) but not removed and not made optional. Enforced here because the field
 * editor is not the only thing that can write this table.
 *
 * Standalone forms are unaffected: a pre-interview questionnaire has no
 * candidate to create.
 */
create or replace function public.protect_required_application_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose public.form_purpose;
  v_key text;
  v_form uuid;
begin
  -- OLD, not NEW. The trigger fires only on UPDATE and DELETE, so OLD
  -- always exists — and it is the EXISTING field's key that
  -- decides whether this row is protected. Reading NEW would let a rename to
  -- some other key walk the field straight out of the protected set, which is
  -- exactly what the last check below refuses.
  v_key := old.field_key;
  v_form := old.form_id;

  if v_key not in ('email', 'resume') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select purpose into v_purpose from public.forms where id = v_form;

  if v_purpose is distinct from 'job_application' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'The % field cannot be removed from a job application form - candidate matching and resume parsing depend on it',
      v_key;
  end if;

  if new.required = false then
    raise exception
      'The % field cannot be made optional on a job application form', v_key;
  end if;

  -- Renaming the KEY (not the label) would orphan every answer already
  -- collected under it, and would take the field out of the protected set.
  if new.field_key <> v_key then
    raise exception 'The % field cannot be renamed to a different key', v_key;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_form_fields_protect on public.form_fields;
create trigger trg_form_fields_protect
  before update or delete on public.form_fields
  for each row execute function public.protect_required_application_fields();

drop trigger if exists trg_forms_touch on public.forms;
create trigger trg_forms_touch
  before update on public.forms
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- 8. Row-Level Security
--
-- Governs the RECRUITER's access. The applicant has no session and never
-- reaches PostgREST — their page and their submission use the service-role
-- client, scoped by a form id that came out of a verified signature.
-- =============================================================================
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_responses enable row level security;
alter table public.form_submission_attempts enable row level security;

-- Every member may read a form's configuration and its submissions. Same floor
-- as jobs and applications: a Viewer reads, and reading what a candidate
-- submitted is how a hiring manager forms an opinion.
drop policy if exists forms_select_member on public.forms;
create policy forms_select_member on public.forms
  for select using (public.is_org_member(organization_id));

/**
 * PUBLISHING A FORM MAKES A URL WORLD-REACHABLE, so it takes the same roles as
 * scheduling an interview or starting a coding round — and the check is HERE,
 * not only in the route. Without a policy, a Viewer with the browser's
 * PostgREST client could flip status to 'published' from a console.
 */
drop policy if exists forms_insert_staff on public.forms;
create policy forms_insert_staff on public.forms
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists forms_update_staff on public.forms;
create policy forms_update_staff on public.forms
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

/**
 * Deleting a form deletes its responses with it (ON DELETE CASCADE), which
 * destroys applicants' submitted answers. Owner/Admin only, the same bar
 * archiving a job takes.
 */
drop policy if exists forms_delete_admin on public.forms;
create policy forms_delete_admin on public.forms
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists form_fields_select_member on public.form_fields;
create policy form_fields_select_member on public.form_fields
  for select using (public.is_org_member(organization_id));

drop policy if exists form_fields_write_staff on public.form_fields;
create policy form_fields_write_staff on public.form_fields
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_fields_update_staff on public.form_fields;
create policy form_fields_update_staff on public.form_fields
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_fields_delete_staff on public.form_fields;
create policy form_fields_delete_staff on public.form_fields
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists form_responses_select_member on public.form_responses;
create policy form_responses_select_member on public.form_responses
  for select using (public.is_org_member(organization_id));

/**
 * NO INSERT, UPDATE OR DELETE POLICY ON form_responses, and that is the point.
 *
 * The only writer is the applicant, through the token-authorised route running
 * under the service role. Giving staff a write path here would mean a recruiter
 * could edit or delete what somebody submitted — the one thing this table
 * exists to be able to show faithfully. The same call coding_submissions made.
 */

/**
 * The rate-limit ledger is invisible to every client.
 *
 * It is written only by the service-role path, and there is nothing in it a
 * recruiter needs: "how many times did this hashed source try?" is an
 * operational detail, and exposing it would put a per-applicant activity trail
 * on a screen nobody asked for. No policy at all = no rows for anybody.
 */

-- =============================================================================
-- 9. Grants. Mirrors every other table: the API layer and RLS do the work.
-- =============================================================================
grant select, insert, update, delete on public.forms to authenticated;
grant select, insert, update, delete on public.form_fields to authenticated;
grant select on public.form_responses to authenticated;

comment on table public.forms is
  'Module 23. One form engine: job application forms (purpose=job_application, '
  'job_id set, public link) and standalone questionnaires. The public link is a '
  'signed HMAC over (id, token_version) — no token is stored.';
comment on column public.forms.token_version is
  'Bump to revoke every previously issued public link and QR code for this form.';
comment on table public.form_submission_attempts is
  'Module 23 rate-limit ledger. Salted IP hashes only, never raw addresses.';
