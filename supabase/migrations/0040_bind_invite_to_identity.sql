-- =============================================================================
-- S-01 (P0) — invite tokens were bearer credentials, not identity-bound.
--
-- docs/SECURITY.md §S-01. The original accept_invite() checked that the invite
-- was pending and unexpired and then trusted whoever presented the token:
--
--   * Anyone who obtained a token — a forwarded email, a screenshot in a group
--     chat, a proxy log, a synced browser history — could join that workspace
--     WITH THE INVITED ROLE, including admin or owner.
--   * It ended with `on conflict … do update set role = excluded.role`, so an
--     EXISTING member who got hold of an admin invite meant for someone else
--     escalated their own role by accepting it.
--
-- The invite page said "Use the email address the invite was sent to". That is
-- advice printed next to the door, not a lock.
--
-- Two fixes, below: bind the invite to the identity it was issued to, and stop
-- an invite from ever re-writing an existing member's role.
--
-- -----------------------------------------------------------------------------
-- THE NEAR MISS THAT DECIDES WHERE THE EMAIL IS READ FROM
-- -----------------------------------------------------------------------------
--
-- The obvious implementation compares the invite to `public.users.email`. IT IS
-- WORTHLESS, and worse than no check because it looks like one.
--
-- `users_update_self` (migration 0001) is `for update using (auth_id =
-- auth.uid())` with no column restriction, and the browser holds an
-- authenticated PostgREST client. So any signed-in user can run
--
--     update public.users set email = 'victim@example.com' where auth_id = …
--
-- against their own profile row and walk straight through a check written that
-- way. The comparison below therefore reads `auth.users.email`, which is
-- Supabase Auth's own record and can only be changed through a verified email
-- change flow.
--
-- If a future migration tightens `users_update_self` to a column allowlist, this
-- function should STILL read auth.users. The authority for "who is this person"
-- belongs with the identity provider, not with a profile table any feature may
-- write to.
-- =============================================================================

create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_auth_email text;
  v_invite public.invites;
  v_existing public.organization_members;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- The identity, from the identity provider. See the header above.
  select lower(btrim(email)) into v_auth_email
  from auth.users
  where id = auth.uid();

  select * into v_invite
  from public.invites
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_invite.id is null then
    raise exception 'Invalid or expired invite';
  end if;

  -- ---------------------------------------------------------------------------
  -- S-01, part 1: the invite is for one address, and only that address.
  --
  -- Checked BEFORE anything is written, so a mismatch leaves the invite pending
  -- and the real recipient can still use it. Accepting on the wrong account
  -- must not burn the invite — otherwise a forwarded link becomes a denial of
  -- service against the person it was meant for.
  --
  -- A null email is a phone-only auth identity. It cannot prove it is the
  -- invited recipient, so it is refused rather than allowed through a null
  -- comparison.
  -- ---------------------------------------------------------------------------
  if v_auth_email is null
     or v_auth_email is distinct from lower(btrim(v_invite.email))
  then
    -- A custom SQLSTATE, so the API layer can tell this apart from "expired"
    -- without matching on message text — the same reason isSchemaOutOfDate()
    -- matches on codes. The message deliberately does NOT name the invited
    -- address: whoever is holding a forwarded token should not learn a
    -- colleague's email from the error.
    raise exception 'This invite was issued to a different email address'
      using errcode = 'INV01';
  end if;

  -- Defensive upsert, in case the auth.users trigger has not fired yet
  -- (sign-up with email confirmation disabled). Unchanged, only moved below the
  -- checks so a refused attempt writes nothing at all.
  insert into public.users (auth_id, name, email)
  select auth.uid(), split_part(au.email, '@', 1), au.email
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();

  select * into v_existing
  from public.organization_members
  where organization_id = v_invite.organization_id
    and user_id = v_user_id
  for update;

  -- ---------------------------------------------------------------------------
  -- S-01, part 2: an invite grants membership. It never re-grades a member.
  --
  -- The old `do update set role = excluded.role` was the escalation half of the
  -- finding. Role changes belong to the Team page, which has its own guards
  -- (only an Owner may grant Owner; migration 0036 stops anyone changing their
  -- own role). Two mechanisms for one decision is how they drift apart.
  --
  -- Three cases, stated rather than folded into an upsert:
  -- ---------------------------------------------------------------------------
  if v_existing.id is null then
    -- New member. The ordinary path.
    insert into public.organization_members
      (organization_id, user_id, role, status, invited_by, joined_at)
    values
      (v_invite.organization_id, v_user_id, v_invite.role, 'active', v_invite.invited_by, now());

  elsif v_existing.status <> 'active' then
    -- A removed member rejoining. The role on the invite IS what the inviter
    -- chose for this address, and the address has now been proven, so it is
    -- applied — someone removed as a Viewer and re-invited as an Admin comes
    -- back as an Admin. See the trigger change below for why this is allowed
    -- to change a role when nothing else may.
    update public.organization_members
       set role = v_invite.role,
           status = 'active',
           invited_by = coalesce(v_invite.invited_by, invited_by),
           joined_at = now()
     where id = v_existing.id;

  end if;
  -- An ALREADY-ACTIVE member keeps the role they have. Accepting is a silent
  -- success so they still land in the workspace rather than meeting an error on
  -- a link that is, from their point of view, working correctly.

  update public.invites set status = 'accepted' where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

-- =============================================================================
-- Let a rejoin carry a new role, and nothing else.
--
-- Migration 0036 blocks changing your OWN role, which is exactly right for the
-- Team page and would otherwise break the rejoin branch above: the accepting
-- user is the target of that update, so a Viewer re-invited as an Admin would
-- be refused with "You cannot change your own role" on a link that is
-- legitimate.
--
-- WHY THIS EXEMPTION CANNOT BE TURNED INTO AN ESCALATION. It applies only to a
-- row moving from 'removed' to 'active', and that transition is unreachable
-- outside accept_invite():
--
--   * organization_members has NO client-facing INSERT policy.
--   * org_members_update_owner_admin requires has_org_role(...), which requires
--     an ACTIVE membership row for the caller in that organization. There is at
--     most one row per (organization, user), so a member whose own row is
--     'removed' has no active membership and cannot update that row at all.
--   * An active Owner/Admin reactivating SOMEBODY ELSE is a different user_id,
--     so this trigger never applied to them in the first place.
--
-- So the only way to present old.status='removed' → new.status='active' on your
-- own row is through the SECURITY DEFINER function above, which now proves the
-- email first.
-- =============================================================================

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A rejoin: accept_invite() reactivating a removed member at the role their
  -- invite names. See the block comment above for why this is not a hole.
  if old.status = 'removed' and new.status = 'active' then
    return new;
  end if;

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

-- The trigger definition itself is unchanged from 0036 and is re-stated only so
-- this file replays cleanly against a database that has never seen it.
drop trigger if exists prevent_self_role_change on public.organization_members;
create trigger prevent_self_role_change
  before update of role on public.organization_members
  for each row
  execute function public.prevent_self_role_change();

-- Unchanged from 0001, re-stated so a replay of this file leaves the grants in
-- the state the function expects.
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;
