-- =============================================================================
-- Editable application fields, and a fuller candidate profile.
--
-- Two small additions, one boundary made explicit.
--
-- THE BOUNDARY: name, email and phone belong to the CANDIDATE, not to an
-- application. A candidate can hold five applications, and letting any of them
-- edit the person's phone number means five screens racing to own one fact.
-- The application API refuses those fields outright (see
-- lib/applications/validation.ts), and this migration adds nothing to
-- `applications` that could be mistaken for identity.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- applications.priority
--
-- Same vocabulary as notifications.priority (migration 0014) rather than a new
-- enum: two "priority" scales in one product means every reader has to ask
-- which one they are looking at. A plain text CHECK, matching that precedent.
-- -----------------------------------------------------------------------------
alter table public.applications
  add column if not exists priority text not null default 'normal';

alter table public.applications drop constraint if exists applications_priority_valid;
alter table public.applications
  add constraint applications_priority_valid
  check (priority in ('low', 'normal', 'high'));

comment on column public.applications.priority is
  'Recruiter-set urgency for this application. Not derived from stage or SLA.';

-- Partial: 'normal' is the default and the overwhelming majority, so indexing it
-- would be indexing the whole table to find nothing interesting.
create index if not exists idx_applications_priority
  on public.applications (organization_id, priority)
  where priority <> 'normal';

-- -----------------------------------------------------------------------------
-- candidates.education and candidates.employment_history
--
-- jsonb arrays rather than two child tables. The deciding question is whether
-- anything will ever QUERY inside them — filter candidates by institution, or
-- aggregate by employer. Nothing in the spec does; they are displayed on one
-- profile and edited as a block. A child table would add two more RLS policies,
-- two more tenant triggers and a join to every profile read, to support
-- ordering and querying that nobody asked for.
--
-- If that changes, the promotion path is a normal one: create the table,
-- backfill from the jsonb, drop the column.
--
-- Shape is validated in lib/candidates/profile.ts before anything is written.
-- The browser holds a PostgREST client and can write these columns directly, so
-- that is a "keep the UI's input sane" guard, not a security boundary — RLS
-- decides who may write, and it already does.
-- -----------------------------------------------------------------------------
alter table public.candidates
  add column if not exists education jsonb not null default '[]'::jsonb,
  add column if not exists employment_history jsonb not null default '[]'::jsonb;

comment on column public.candidates.education is
  'Array of {degree, institution, year}. Display and edit only — not queried into.';
comment on column public.candidates.employment_history is
  'Array of {company, role, duration}. The candidate''s previous employers.';

-- Both must be ARRAYS. Without this a caller could store an object or a string
-- and every reader would need its own defensive check.
alter table public.candidates drop constraint if exists candidates_education_is_array;
alter table public.candidates
  add constraint candidates_education_is_array
  check (jsonb_typeof(education) = 'array');

alter table public.candidates drop constraint if exists candidates_employment_is_array;
alter table public.candidates
  add constraint candidates_employment_is_array
  check (jsonb_typeof(employment_history) = 'array');
