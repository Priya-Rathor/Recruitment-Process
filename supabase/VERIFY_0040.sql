-- =============================================================================
-- VERIFY_0040.sql — proves the S-01 fix actually holds.
--
-- Run AFTER applying 0040_bind_invite_to_identity.sql. Paste the whole file
-- into the Supabase SQL Editor and run it once.
--
-- It creates its own throwaway users, organization and invites, exercises the
-- attack four ways, and ROLLS BACK. Nothing survives a successful run; the
-- fixtures use obviously-fake ids and an `example.invalid` domain so that even
-- a half-finished run is recognisable.
--
-- Every check RAISES on failure, so the script either prints six PASS notices
-- or stops on the first thing that is wrong. Reading "no rows returned" as a
-- pass is exactly the mistake this file exists to prevent.
--
-- IF THE auth.users INSERT COMPLAINS about a NOT NULL column, add it to the
-- insert — that table's shape varies a little between Supabase versions, and
-- nothing else here depends on it.
-- =============================================================================

begin;

do $$
declare
  -- Deliberately recognisable as fixtures.
  k_org        uuid := '00000000-0000-4000-8000-00000000f000';
  k_auth_owner uuid := '00000000-0000-4000-8000-00000000000e';
  k_auth_alice uuid := '00000000-0000-4000-8000-0000000000a1';
  k_auth_mal   uuid := '00000000-0000-4000-8000-0000000000b2';
  k_auth_bob   uuid := '00000000-0000-4000-8000-0000000000c3';

  v_owner_id   uuid;
  v_alice_id   uuid;
  v_mal_id     uuid;
  v_bob_id     uuid;

  v_token_alice uuid;
  v_token_bob   uuid;

  v_result     uuid;
  v_role       public.org_role;
  v_status     text;
  v_count      integer;
  v_raised     boolean;
begin
  -- ---------------------------------------------------------------------------
  -- Fixtures. The on_auth_user_created trigger mirrors each into public.users.
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email) values
    (k_auth_owner, 'owner@example.invalid'),
    (k_auth_alice, 'alice@example.invalid'),
    (k_auth_mal,   'mallory@example.invalid'),
    (k_auth_bob,   'bob@example.invalid');

  select id into v_owner_id from public.users where auth_id = k_auth_owner;
  select id into v_alice_id from public.users where auth_id = k_auth_alice;
  select id into v_mal_id   from public.users where auth_id = k_auth_mal;
  select id into v_bob_id   from public.users where auth_id = k_auth_bob;

  insert into public.organizations (id, name) values (k_org, 'S-01 verification org');

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (k_org, v_owner_id, 'owner', 'active', now());

  -- Bob is already a low-privileged member. He is the escalation test.
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (k_org, v_bob_id, 'viewer', 'active', now());

  -- An ADMIN invite addressed to Alice. This is the token that used to be a
  -- bearer credential for an admin seat.
  insert into public.invites (organization_id, email, role, invited_by)
  values (k_org, 'alice@example.invalid', 'admin', v_owner_id)
  returning token into v_token_alice;

  -- An ADMIN invite addressed to Bob, who is already a viewer.
  insert into public.invites (organization_id, email, role, invited_by)
  values (k_org, 'bob@example.invalid', 'admin', v_owner_id)
  returning token into v_token_bob;

  -- ===========================================================================
  -- CHECK 1 — Mallory cannot accept an invite addressed to Alice.
  --           This is S-01 itself.
  -- ===========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', k_auth_mal)::text, true);

  v_raised := false;
  begin
    v_result := public.accept_invite(v_token_alice);
  exception when sqlstate 'INV01' then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 1): Mallory accepted an invite addressed to Alice. S-01 is NOT fixed.';
  end if;
  raise notice 'PASS 1 — a stolen/forwarded invite is refused for the wrong identity';

  -- ===========================================================================
  -- CHECK 2 — the refusal wrote nothing, and did not burn the invite.
  --
  -- A refusal that marked the invite accepted would turn a forwarded link into
  -- a denial of service against the person it was meant for.
  -- ===========================================================================
  select count(*) into v_count
  from public.organization_members
  where organization_id = k_org and user_id = v_mal_id;

  if v_count <> 0 then
    raise exception 'FAIL (check 2a): a membership row was created for the wrong identity.';
  end if;

  select status into v_status from public.invites where token = v_token_alice;
  if v_status <> 'pending' then
    raise exception
      'FAIL (check 2b): the invite is now %, so the real recipient can no longer use it.', v_status;
  end if;
  raise notice 'PASS 2 — the refusal wrote nothing and left the invite pending';

  -- ===========================================================================
  -- CHECK 3 — THE NEAR MISS. Mallory rewrites her own profile email to Alice's
  --           and tries again.
  --
  -- users_update_self lets any signed-in user edit their own public.users row,
  -- so a check written against that table would pass right here. This is the
  -- whole reason 0040 reads auth.users instead.
  -- ===========================================================================
  update public.users set email = 'alice@example.invalid' where id = v_mal_id;

  v_raised := false;
  begin
    v_result := public.accept_invite(v_token_alice);
  exception when sqlstate 'INV01' then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 3): rewriting public.users.email defeated the check. '
      'accept_invite must read auth.users, not the profile table.';
  end if;
  raise notice 'PASS 3 — rewriting the profile email does not defeat the check';

  update public.users set email = 'mallory@example.invalid' where id = v_mal_id;

  -- ===========================================================================
  -- CHECK 4 — Alice, the real recipient, can still accept and lands as admin.
  --           The fix must not break the feature.
  -- ===========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', k_auth_alice)::text, true);

  v_result := public.accept_invite(v_token_alice);

  if v_result is distinct from k_org then
    raise exception 'FAIL (check 4a): Alice did not receive the organization id.';
  end if;

  select role, status into v_role, v_status
  from public.organization_members
  where organization_id = k_org and user_id = v_alice_id;

  if v_role <> 'admin' or v_status <> 'active' then
    raise exception 'FAIL (check 4b): Alice joined as %/% instead of admin/active.', v_role, v_status;
  end if;
  raise notice 'PASS 4 — the invited person still joins normally, at the invited role';

  -- ===========================================================================
  -- CHECK 5 — the escalation half. Bob is a viewer; the invite addressed to him
  --           names admin. Accepting must NOT promote him.
  --
  -- This is the `on conflict do update set role = excluded.role` branch that
  -- let an existing member re-grade themselves with a token.
  -- ===========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', k_auth_bob)::text, true);

  v_result := public.accept_invite(v_token_bob);

  select role into v_role
  from public.organization_members
  where organization_id = k_org and user_id = v_bob_id;

  if v_role <> 'viewer' then
    raise exception
      'FAIL (check 5): an existing member was re-graded to % by accepting an invite.', v_role;
  end if;
  raise notice 'PASS 5 — an invite never re-grades an existing member';

  -- ===========================================================================
  -- CHECK 6 — a removed member rejoining DOES take the invited role, and the
  --           self-role-change trigger does not block the legitimate path.
  -- ===========================================================================
  update public.organization_members
     set status = 'removed'
   where organization_id = k_org and user_id = v_bob_id;

  insert into public.invites (organization_id, email, role, invited_by)
  values (k_org, 'bob@example.invalid', 'recruiter', v_owner_id)
  returning token into v_token_bob;

  v_result := public.accept_invite(v_token_bob);

  select role, status into v_role, v_status
  from public.organization_members
  where organization_id = k_org and user_id = v_bob_id;

  if v_role <> 'recruiter' or v_status <> 'active' then
    raise exception
      'FAIL (check 6): a rejoining member came back as %/% instead of recruiter/active.',
      v_role, v_status;
  end if;
  raise notice 'PASS 6 — a removed member rejoins at the role their new invite names';

  raise notice '---';
  raise notice 'ALL SIX CHECKS PASSED. S-01 is fixed. Rolling back the fixtures.';
end $$;

rollback;

-- Belt and braces: if your client auto-committed each statement above rather
-- than honouring the transaction, this removes the fixtures. It is a no-op
-- after a successful rollback.
delete from public.organizations where id = '00000000-0000-4000-8000-00000000f000';
delete from auth.users where email like '%@example.invalid';
