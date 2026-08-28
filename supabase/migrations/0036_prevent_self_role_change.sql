-- =============================================================================
-- Module 1 hardening: nobody changes their own role.
--
-- Before this, app/api/members/[id]/route.ts guarded escalation (only an Owner
-- may grant or revoke Owner) and enforce_owner_remains() guarded the last
-- Owner — but neither compared the actor to the target. An Admin could demote
-- themselves to Viewer in one click and then lacked the very permission needed
-- to undo it. app/team/invite/TeamManager.tsx hid the "Remove" button on your
-- own row but left the role dropdown live next to it, which is what made the
-- omission visible.
--
-- Role changes now always require a second person, Owner included. Stepping
-- down as Owner is a two-sided flow: promote someone else to Owner, then they
-- demote you. enforce_owner_remains() still guarantees the workspace is never
-- left with zero Owners.
--
-- Why a trigger and not the RLS policy: the rule compares the row's OLD role
-- to its NEW role, which a policy cannot express — USING sees only the old row
-- and WITH CHECK only the new one. A policy predicate on user_id would block
-- every self-update, including the soft-remove that writes status.
-- =============================================================================

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- current_app_user_id() is null when there is no end-user session — the
  -- service-role client (lib/supabase/admin.ts), the SQL Editor, migrations.
  -- The comparison then yields null rather than true, so those contexts can
  -- still repair a workspace that has locked itself out. That is deliberate:
  -- an operator with the secret key is already past every other check here.
  if new.role is distinct from old.role
     and old.user_id = public.current_app_user_id()
  then
    raise exception
      'You cannot change your own role. Ask another Owner or Admin to do it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_self_role_change on public.organization_members;

-- `of role` narrows the trigger to statements that actually name the column,
-- so the soft-remove path (status -> 'removed') and any future column write
-- are untouched. `is distinct from` above then filters out a no-op rewrite.
create trigger prevent_self_role_change
  before update of role on public.organization_members
  for each row
  execute function public.prevent_self_role_change();
