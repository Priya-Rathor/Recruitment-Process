-- =============================================================================
-- Bulk intake — manual "connect to existing candidate"
--
-- Automatic matching is right most of the time and wrong some of the time. This
-- migration adds what is needed to CORRECT it after the fact, on any file, in
-- any state — not only on the ambiguous ones the matcher refused to decide.
--
-- Correcting an auto-match is a destructive operation: it can delete a
-- candidate record and an application that were created seconds earlier. The
-- columns below exist so that what was undone is recoverable as a fact even
-- though the rows themselves are gone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 'manually_connected' — a seventh outcome.
--
-- Deliberately NOT reusing 'candidate_matched'. A recruiter reading the list a
-- week later needs to know which links a human made and which the matcher made;
-- collapsing them would erase exactly the audit the correction exists to leave.
--
-- Guarded rather than bare, because ALTER TYPE ... ADD VALUE is not idempotent
-- and every migration in this project must be re-runnable.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'resume_intake_status' and e.enumlabel = 'manually_connected'
  ) then
    alter type public.resume_intake_status add value 'manually_connected';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- What the correction replaced.
-- -----------------------------------------------------------------------------
alter table public.resume_intake_items
  -- The candidate automatic matching chose, kept even after that candidate is
  -- deleted. NOT a foreign key, on purpose: the whole point of a reconnection
  -- is that this row may no longer exist, and an FK would either block the
  -- cleanup or null out the evidence of it.
  add column if not exists auto_candidate_id uuid,
  -- The status before the correction, so "was this originally a new candidate
  -- or a wrong match?" survives.
  add column if not exists auto_status public.resume_intake_status,
  -- What actually happened to the orphaned auto-created candidate:
  --   'deleted'  — it was still pristine and was hard-deleted
  --   'archived' — it had picked up other work and was archived instead
  --   'kept'     — nothing to clean up (the auto-match found an existing person)
  add column if not exists cleanup_action text
    check (cleanup_action is null or cleanup_action in ('deleted', 'archived', 'kept')),
  add column if not exists reconnected_at timestamptz,
  add column if not exists reconnected_by uuid references public.users (id) on delete set null;

-- =============================================================================
-- Deleting a candidate must not silently delete their history.
--
-- public.resumes.candidate_id is ON DELETE CASCADE, so hard-deleting an
-- orphaned candidate would take any resume still attached to them with it —
-- including the file the recruiter just uploaded, if the application code
-- re-pointed the rows in the wrong order.
--
-- The application does re-point first. This trigger is the guarantee that it
-- had to: a delete that would take a resume with it is refused outright, which
-- turns a silent data loss into a loud error.
-- =============================================================================
create or replace function public.guard_candidate_delete_with_resumes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resumes integer;
begin
  select count(*) into v_resumes from public.resumes where candidate_id = old.id;

  if v_resumes > 0 then
    raise exception
      'Cannot delete a candidate with % resume(s) on file; move or delete them first', v_resumes;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_candidates_guard_delete on public.candidates;
create trigger trg_candidates_guard_delete
  before delete on public.candidates
  for each row execute function public.guard_candidate_delete_with_resumes();

-- =============================================================================
-- Deleting a candidate at all.
--
-- Module 4 gave candidates no DELETE policy — archiving was the only removal,
-- which was right when every candidate was created by a human. Bulk intake
-- creates them automatically, so an automatic mistake needs an automatic undo.
--
-- Owner/Admin/Recruiter, matching who may create one. The trigger above plus
-- the application's own pristine-check are what keep this narrow; the policy
-- only decides who may ask.
-- =============================================================================
drop policy if exists candidates_delete_staff on public.candidates;
create policy candidates_delete_staff on public.candidates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- Backs the "does this candidate appear in any other intake item?" check that
-- decides between deleting and archiving.
create index if not exists idx_resume_intake_items_candidate
  on public.resume_intake_items (organization_id, candidate_id)
  where candidate_id is not null;
