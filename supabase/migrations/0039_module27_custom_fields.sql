-- =============================================================================
-- Module 27 — Custom Fields for Jobs, Candidates and Applications.
--
-- NUMBERED 27, NOT 19. The brief calls this "Module 19", but Module 19 is
-- Onboarding & Document Management — docs/modules/19-onboarding-documents.md,
-- shipped in migration 0026_module19_onboarding_documents. Two modules with one
-- number would make every later "see Module 19" ambiguous, so this takes the
-- next free number. Nothing about the feature changed; only the label.
--
-- -----------------------------------------------------------------------------
-- STRICTLY ADDITIVE. NOT ONE EXISTING COLUMN IS TOUCHED.
--
-- This migration creates two tables and nothing else. It does not alter, rename,
-- drop or re-type any column on jobs, candidates or applications. The fixed
-- fields stay fixed and keep their existing editability rules — in particular
-- migration 0023's rule that a candidate's name, email and phone are editable
-- only from the Candidate page. Custom fields sit BESIDE that rule; they are
-- not a second door into it. See the reserved-key constraint below, which is
-- what stops somebody re-creating "email" as a custom field and editing it
-- somewhere the rule does not reach.
--
-- -----------------------------------------------------------------------------
-- ONE FIELD-TYPE TAXONOMY, ENFORCED BY THE TYPE SYSTEM.
--
-- field_type is public.form_field_type — the ENUM migration 0033 created for
-- Module 23's form_fields. Not a new enum, not a text column with its own CHECK
-- list. Postgres itself now refuses a value the forms engine does not know,
-- which is a stronger guarantee than two lists that agree today.
--
-- Three of that enum's twelve values are excluded here, and the exclusions are
-- the interesting part:
--
--   email, phone  — identity. A custom "email" field on a candidate would be a
--                   second place an email address lives, disagreeing with
--                   candidates.email the first time somebody edited one. The
--                   reserved-key constraint blocks the KEY; excluding the TYPE
--                   blocks the same idea wearing a different label.
--   file_upload   — there is no bucket for it. lib/forms/fields.ts already
--                   excludes it from custom questions for exactly this reason:
--                   offering the type would accept a file and silently drop it.
--                   Adding it needs its own bucket, storage policies and a
--                   Module 22 retention answer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which entity a definition belongs to.
--
-- An enum rather than text: these three are the whole scope of this module, and
-- a typo'd 'candidates' would otherwise create a definition that renders on
-- nothing and is invisible to debug.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'custom_field_entity') then
    create type public.custom_field_entity as enum ('job', 'candidate', 'application');
  end if;
end $$;

-- =============================================================================
-- custom_field_definitions — the org's field vocabulary
-- =============================================================================
create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  entity_type public.custom_field_entity not null,

  -- Stable, generated from the label once and NEVER regenerated on rename.
  -- The key is what {{custom.*}} tokens and stored values point at; rewriting it
  -- when somebody fixes a typo in the label would orphan every value and break
  -- every message template that referenced it.
  field_key text not null
    check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) between 2 and 60),

  label text not null check (btrim(label) <> '' and length(label) <= 120),

  field_type public.form_field_type not null,

  -- Choice options. Same shape as form_fields.options, so the renderer that
  -- draws a dropdown on a public form draws this one too.
  options jsonb not null default '[]'::jsonb,

  required boolean not null default false,

  -- Only meaningful for entity_type = 'job' — see the CHECK below.
  show_on_public_form boolean not null default false,

  -- `order` is a reserved word in SQL, and the repo already settled on
  -- display_order (organization_document_templates). Same name, same meaning.
  display_order integer not null default 0,

  active boolean not null default true,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One key per entity per org. Scoped to entity_type on purpose: a job's
  -- "region" and a candidate's "region" are different questions and must not
  -- collide with each other.
  constraint custom_field_definitions_unique_key
    unique (organization_id, entity_type, field_key),

  -- The excluded types, explained in the header.
  constraint custom_field_definitions_type_allowed
    check (field_type not in ('email', 'phone', 'file_upload')),

  -- Choice types need options; everything else must not carry them. Without the
  -- second half, changing a dropdown to a number leaves stale options behind
  -- that reappear if it is ever changed back.
  constraint custom_field_definitions_options_match_type check (
    case
      when field_type in ('dropdown', 'radio', 'checkbox')
        then jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0
      else options = '[]'::jsonb
    end
  ),

  -- A candidate-level field cannot appear on a job's public form: the form
  -- belongs to a job, and the value it collects lands on an application. Left
  -- unconstrained, the settings UI would offer a toggle that silently does
  -- nothing, which is how people learn a checkbox is broken.
  constraint custom_field_definitions_public_form_is_job_only
    check (show_on_public_form = false or entity_type = 'job'),

  -- ---------------------------------------------------------------------------
  -- THE COLLISION RULE, IN THE DATABASE.
  --
  -- AGENTS.md rule 6: a rule about the data belongs in a CHECK, not only in a
  -- route handler. The browser holds an authenticated PostgREST client, so a
  -- rule enforced only in the API is a rule any signed-in user can skip — and
  -- skipping THIS one is how "email" becomes an editable custom field on the
  -- Application page, in defiance of migration 0023.
  --
  -- The lists are every real column on each table as of migration 0038, plus
  -- the UI-facing aliases somebody would naturally type (experience, salary,
  -- skills, first_name, recruiter, status). Over-inclusive on purpose: refusing
  -- a key costs somebody one rename, while allowing a colliding one costs a
  -- silent disagreement between two fields that look identical.
  -- ---------------------------------------------------------------------------
  constraint custom_field_definitions_key_not_reserved check (
    case entity_type
      when 'job' then field_key <> all (array[
        'id', 'organization_id', 'client_id', 'owner_recruiter_id',
        'title', 'description', 'location', 'work_mode',
        'experience_min', 'experience_max', 'experience',
        'salary_min', 'salary_max', 'salary',
        'required_skills', 'preferred_skills', 'skills',
        'status', 'archived_at', 'created_at', 'updated_at',
        'resume_passing_score', 'automations_enabled', 'client_name'
      ])
      when 'candidate' then field_key <> all (array[
        'id', 'organization_id',
        'name', 'first_name', 'last_name',
        'email', 'email_normalized', 'phone', 'phone_normalized',
        'location', 'current_company', 'current_role',
        'total_experience_years', 'experience',
        'expected_salary', 'salary', 'current_ctc',
        'notice_period_days', 'notice_period',
        'skills', 'source', 'resume_url',
        'education', 'employment_history',
        'archived_at', 'created_at', 'updated_at'
      ])
      when 'application' then field_key <> all (array[
        'id', 'organization_id', 'job_id', 'candidate_id',
        'assigned_recruiter_id', 'recruiter',
        'stage', 'status', 'source', 'priority', 'match_score',
        'not_shortlisted_at', 'not_shortlisted_reason',
        'not_shortlisted_score', 'not_shortlisted_threshold',
        'rejected_at_stage', 'archived_at', 'created_at', 'updated_at'
      ])
    end
  )
);

create index if not exists idx_custom_field_defs_org_entity
  on public.custom_field_definitions (organization_id, entity_type, display_order, created_at);

-- The render path: "active fields for this entity type", the query every form
-- runs. Partial, because inactive definitions are never rendered.
create index if not exists idx_custom_field_defs_active
  on public.custom_field_definitions (organization_id, entity_type, display_order)
  where active;

-- The public-form path, narrower still.
create index if not exists idx_custom_field_defs_public_form
  on public.custom_field_definitions (organization_id, display_order)
  where active and show_on_public_form;

-- =============================================================================
-- custom_field_values — one answer per field per record
-- =============================================================================
create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),

  -- ---------------------------------------------------------------------------
  -- organization_id IS NOT IN THE BRIEF'S SCHEMA, AND IT IS NOT OPTIONAL.
  --
  -- The brief lists only (definition_id, entity_type, entity_id, value). Every
  -- RLS policy on this table would then have to JOIN to the definition to learn
  -- the tenant, and AGENTS.md rule 8 requires that every query made with the
  -- admin client filter organization_id EXPLICITLY — which is impossible on a
  -- table that does not carry it. Denormalised here, and kept honest by the
  -- trigger below rather than by hoping callers pass the right one.
  -- ---------------------------------------------------------------------------
  organization_id uuid not null references public.organizations (id) on delete cascade,

  custom_field_definition_id uuid not null
    references public.custom_field_definitions (id) on delete cascade,

  -- ---------------------------------------------------------------------------
  -- POLYMORPHIC, SO THERE IS NO FOREIGN KEY. This is the one real cost of the
  -- design and it is worth naming: entity_id points at a job, a candidate or an
  -- application depending on entity_type, and Postgres cannot express "references
  -- whichever table this other column names". The cleanup triggers at the bottom
  -- of this file are what stands in for ON DELETE CASCADE. Without them, deleting
  -- a job leaves its custom values behind for ever.
  -- ---------------------------------------------------------------------------
  entity_type public.custom_field_entity not null,
  entity_id uuid not null,

  -- jsonb because the shape genuinely varies: a string for text, a number for
  -- number, a boolean for yes_no, an ARRAY for checkbox. A text column would
  -- force every reader to re-parse, and the checkbox case would become CSV.
  value jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One value per field per record. This is what makes saving an upsert rather
  -- than a delete-then-insert, so a failed save cannot lose the old answer.
  constraint custom_field_values_unique_per_record
    unique (custom_field_definition_id, entity_id)
);

create index if not exists idx_custom_field_values_entity
  on public.custom_field_values (organization_id, entity_type, entity_id);
create index if not exists idx_custom_field_values_definition
  on public.custom_field_values (custom_field_definition_id);

-- -----------------------------------------------------------------------------
-- The value's tenant and entity_type must match its definition's.
--
-- A cross-row invariant, so a CHECK cannot express it. Without this, a caller
-- could store a value under another org's definition id, or file a candidate
-- answer against a job definition — and both would read back as legitimate
-- data. SECURITY DEFINER so it can see the definition row regardless of the
-- caller's own visibility.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_custom_field_value_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def record;
begin
  select organization_id, entity_type, active, show_on_public_form
    into v_def
    from public.custom_field_definitions
   where id = new.custom_field_definition_id;

  if not found then
    raise exception 'custom field definition % does not exist',
      new.custom_field_definition_id;
  end if;

  if v_def.organization_id <> new.organization_id then
    raise exception 'custom field value organization does not match its definition';
  end if;

  -- ---------------------------------------------------------------------------
  -- THE ONE PLACE A VALUE'S entity_type MAY DIFFER FROM ITS DEFINITION'S.
  --
  -- A job field marked show_on_public_form is asked of every APPLICANT, so the
  -- DEFINITION belongs to the job while each VALUE it collects belongs to the
  -- application that came through that job's form. The brief is explicit about
  -- this ("saved ... against the resulting application (not the job)"), and it
  -- is the right shape: one question, one definition, and an answer per
  -- applicant rather than one answer overwritten by every candidate in turn.
  --
  -- Everything else must still match. Without the second half of this check a
  -- candidate answer could be filed against a job definition by mistake and
  -- would read back as legitimate data.
  --
  -- Note the unique constraint still holds: (definition_id, entity_id) differs
  -- per application, so a job may ALSO carry its own value for the same
  -- definition — what the job requires, beside what each applicant answered.
  -- ---------------------------------------------------------------------------
  if v_def.entity_type <> new.entity_type
     and not (v_def.entity_type = 'job'
              and new.entity_type = 'application'
              and v_def.show_on_public_form)
  then
    raise exception 'custom field value entity_type (%) does not match its definition (%)',
      new.entity_type, v_def.entity_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_custom_field_values_integrity on public.custom_field_values;
create trigger trg_custom_field_values_integrity
  before insert or update on public.custom_field_values
  for each row execute function public.enforce_custom_field_value_integrity();

-- -----------------------------------------------------------------------------
-- updated_at (touch_updated_at() was created by Module 3).
-- -----------------------------------------------------------------------------
drop trigger if exists trg_custom_field_defs_touch_updated_at on public.custom_field_definitions;
create trigger trg_custom_field_defs_touch_updated_at
  before update on public.custom_field_definitions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_custom_field_values_touch_updated_at on public.custom_field_values;
create trigger trg_custom_field_values_touch_updated_at
  before update on public.custom_field_values
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS
--
-- DEFINITIONS: every member reads (the render path needs them); Owner/Admin
-- writes. Matches the brief's §6 exactly, and mirrors
-- organization_document_templates, the closest existing analogue.
--
-- VALUES: every member reads; Owner/Admin/Recruiter writes. A value is ordinary
-- record data — the same people who may edit a job's fixed fields may fill in
-- its custom ones. Viewer is read-only on both, which falls out of not being in
-- either write array.
-- =============================================================================
alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_values enable row level security;

drop policy if exists custom_field_defs_select_member on public.custom_field_definitions;
create policy custom_field_defs_select_member on public.custom_field_definitions
  for select using (public.is_org_member(organization_id));

drop policy if exists custom_field_defs_insert_admin on public.custom_field_definitions;
create policy custom_field_defs_insert_admin on public.custom_field_definitions
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists custom_field_defs_update_admin on public.custom_field_definitions;
create policy custom_field_defs_update_admin on public.custom_field_definitions
  for update
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists custom_field_defs_delete_admin on public.custom_field_definitions;
create policy custom_field_defs_delete_admin on public.custom_field_definitions
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists custom_field_values_select_member on public.custom_field_values;
create policy custom_field_values_select_member on public.custom_field_values
  for select using (public.is_org_member(organization_id));

drop policy if exists custom_field_values_insert_editor on public.custom_field_values;
create policy custom_field_values_insert_editor on public.custom_field_values
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists custom_field_values_update_editor on public.custom_field_values;
create policy custom_field_values_update_editor on public.custom_field_values
  for update
  using (public.has_org_role(organization_id,
         array['owner', 'admin', 'recruiter']::public.org_role[]))
  with check (public.has_org_role(organization_id,
         array['owner', 'admin', 'recruiter']::public.org_role[]));

drop policy if exists custom_field_values_delete_editor on public.custom_field_values;
create policy custom_field_values_delete_editor on public.custom_field_values
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- Orphan cleanup — the stand-in for the foreign key this table cannot have.
--
-- One trigger per entity table, all calling the same function. AFTER DELETE, so
-- the row is already gone and nothing can re-reference it. Note these fire on
-- HARD delete only: archiving a job sets archived_at and keeps its values,
-- which is correct — an archived job that is restored still has its data.
-- =============================================================================
create or replace function public.delete_custom_field_values_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.custom_field_values
   where entity_type = tg_argv[0]::public.custom_field_entity
     and entity_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_jobs_delete_custom_values on public.jobs;
create trigger trg_jobs_delete_custom_values
  after delete on public.jobs
  for each row execute function public.delete_custom_field_values_for_entity('job');

drop trigger if exists trg_candidates_delete_custom_values on public.candidates;
create trigger trg_candidates_delete_custom_values
  after delete on public.candidates
  for each row execute function public.delete_custom_field_values_for_entity('candidate');

drop trigger if exists trg_applications_delete_custom_values on public.applications;
create trigger trg_applications_delete_custom_values
  after delete on public.applications
  for each row execute function public.delete_custom_field_values_for_entity('application');

comment on table public.custom_field_definitions is
  'Module 27. Per-organization extra fields on jobs/candidates/applications. '
  'Additive only — never replaces or renames a fixed column.';
comment on table public.custom_field_values is
  'Module 27. One answer per definition per record. entity_id is polymorphic; '
  'see the cleanup triggers, which replace the foreign key it cannot have.';
