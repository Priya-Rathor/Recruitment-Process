-- =============================================================================
-- Fix: an authenticated session with no public.users row causes an infinite
-- redirect loop.
--
-- HOW IT HAPPENS
--
-- public.users rows are created by the on_auth_user_created trigger in
-- migration 0001. Anyone who signed up BEFORE that migration was applied — or
-- during any window where the trigger was absent or failed — has a row in
-- auth.users and none in public.users.
--
-- The application then loops:
--
--   proxy.ts sees a valid Supabase session   -> allows /dashboard
--   /dashboard: getCurrentUser() is null     -> redirect /login
--   proxy.ts sees a valid session on /login  -> redirect /dashboard
--   ...
--
-- The browser gives up with ERR_TOO_MANY_REDIRECTS. Clearing cookies works
-- around it, but the same trap catches the next person it happens to, and the
-- symptom points nowhere near the cause.
--
-- THE FIX
--
-- A security-definer function that backfills the caller's own profile. This is
-- the same defensive upsert create_organization_and_owner() and accept_invite()
-- already perform ("in case the auth.users trigger has not fired yet"); it just
-- needed to be reachable on its own, before either of those is ever called.
--
-- WHY THIS IS SAFE TO EXPOSE
--
--   * It takes NO arguments. There is nothing to tamper with.
--   * It reads auth.uid() only, so a caller can only ever create their OWN row.
--     They cannot name another user, and cannot pass an organization id.
--   * on conflict (auth_id) do nothing — it can never overwrite an existing
--     profile, so it is not a way to change your own name or email.
--   * It grants no membership. A backfilled user has zero organizations and
--     lands on /onboarding, exactly like any new signup.
--
-- The `users` table deliberately has no client-facing INSERT policy, and that
-- stays true: this function runs as its owner, which is why it can insert at
-- all, and why it is written to do exactly one narrow thing.
-- =============================================================================

create or replace function public.ensure_current_user_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- No session, nothing to do. Returning null rather than raising keeps this
  -- callable from a page that has not yet established whether anyone is signed
  -- in.
  if auth.uid() is null then
    return null;
  end if;

  select id into v_user_id from public.users where auth_id = auth.uid();
  if v_user_id is not null then
    return v_user_id;
  end if;

  -- Same shape as the on_auth_user_created trigger, so a backfilled profile is
  -- indistinguishable from one created normally.
  insert into public.users (auth_id, name, email, avatar_url)
  select
    au.id,
    coalesce(
      au.raw_user_meta_data ->> 'name',
      au.raw_user_meta_data ->> 'full_name',
      split_part(au.email, '@', 1)
    ),
    au.email,
    au.raw_user_meta_data ->> 'avatar_url'
  from auth.users au
  where au.id = auth.uid()
  on conflict (auth_id) do nothing;

  select id into v_user_id from public.users where auth_id = auth.uid();
  return v_user_id;
end;
$$;

revoke all on function public.ensure_current_user_profile() from public, anon;
grant execute on function public.ensure_current_user_profile() to authenticated;

-- =============================================================================
-- Backfill anyone already stranded.
--
-- Runs once, as the migration author, for every auth user with no profile. A
-- deployment that applies 0001 and 0017 together will match nothing here; a
-- database where people signed up first — which is exactly how this was found —
-- gets them unstuck without each of them having to clear cookies.
-- =============================================================================
insert into public.users (auth_id, name, email, avatar_url)
select
  au.id,
  coalesce(
    au.raw_user_meta_data ->> 'name',
    au.raw_user_meta_data ->> 'full_name',
    split_part(au.email, '@', 1)
  ),
  au.email,
  au.raw_user_meta_data ->> 'avatar_url'
from auth.users au
left join public.users u on u.auth_id = au.id
where u.id is null
  and au.email is not null
on conflict (auth_id) do nothing;
