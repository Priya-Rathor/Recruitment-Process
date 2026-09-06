-- =============================================================================
-- RESET_DATA.sql — empty every table, keep the schema.
--
-- Run in the Supabase SQL Editor. NOT a migration: it is not numbered, it is
-- not re-run as part of the migration sequence, and it must never be applied
-- automatically. It destroys data and nothing else.
--
-- WHAT IT KEEPS: every table, column, index, constraint, function, trigger,
-- policy and RLS setting; both storage BUCKET definitions ('resumes',
-- 'onboarding-documents') — the buckets' allowed_mime_types is a real security
-- gate (AGENTS.md rule 7), so dropping the bucket rows would quietly remove it.
--
-- WHAT IT DESTROYS: every row in public, every stored file, every login.
--
-- WHY IT ALSO CLEARS auth.users (step 3):
--   public.users is written by a trigger on auth.users INSERT (migration 0001).
--   Emptying public.users while leaving auth.users behind leaves a login with
--   no profile row and no organisation — the exact breakage migration 0017 was
--   written to repair. A clean start means signing up again from /signup, which
--   recreates the user, the organisation, the owner membership and the default
--   onboarding document templates through create_organization().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Every table in `public`.
--
-- Built from pg_tables rather than a hard-coded list on purpose: migrations
-- 0032, 0037 and 0038 may or may not be applied on any given database, so a
-- literal list would either miss a table or fail on a missing one. One TRUNCATE
-- over all tables at once settles the foreign keys between them by itself.
-- -----------------------------------------------------------------------------
do $$
declare
  stmt text;
begin
  select 'truncate table '
         || string_agg(format('%I.%I', schemaname, tablename), ', ')
         || ' restart identity cascade'
    into stmt
    from pg_tables
   where schemaname = 'public';

  if stmt is null then
    raise notice 'public schema has no tables — nothing truncated.';
  else
    raise notice 'running: %', stmt;
    execute stmt;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Stored files — the rows, keeping the buckets.
--
-- NOTE: this clears the object RECORDS. Depending on your Supabase version the
-- underlying objects in the storage backend can be left orphaned. To reclaim
-- the space, empty the two buckets from Dashboard → Storage as well. Orphans
-- are unreachable by the app either way, since every download is a signed URL
-- issued from a row that no longer exists.
-- -----------------------------------------------------------------------------
delete from storage.objects
 where bucket_id in ('resumes', 'onboarding-documents');

-- -----------------------------------------------------------------------------
-- 3. Logins. Cascades to auth.identities, auth.sessions and auth.refresh_tokens.
--
-- Comment this statement out if you want to keep signing in with your existing
-- account. If you do, you MUST re-run migration 0017's backfill afterwards to
-- put your public.users row back, or the app will fail on first load.
-- -----------------------------------------------------------------------------
delete from auth.users;

-- -----------------------------------------------------------------------------
-- 4. Verification. Lists any public table still holding rows.
--    An EMPTY result set is the success condition.
-- -----------------------------------------------------------------------------
select table_name,
       (xpath('/row/cnt/text()', xml_count))[1]::text::int as remaining_rows
  from (
        select table_name,
               query_to_xml(format('select count(*) as cnt from public.%I', table_name),
                            false, true, '') as xml_count
          from information_schema.tables
         where table_schema = 'public'
           and table_type = 'BASE TABLE'
       ) counted
 where (xpath('/row/cnt/text()', xml_count))[1]::text::int > 0
 order by remaining_rows desc;
