-- =============================================================================
-- A minimal stand-in for the parts of Supabase these migrations depend on.
--
-- NOT a Supabase emulator — just enough to replay the migration set against a
-- vanilla Postgres and exercise the RPCs. Derived from an inventory of what the
-- 40 migrations actually reference: auth.uid(), auth.users (id, email, phone,
-- raw_user_meta_data), storage.buckets, storage.objects, storage.foldername(),
-- the three Supabase roles, and pgcrypto.
-- =============================================================================

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- auth.users — only the columns the migrations read.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The real auth.uid() reads the request's JWT claims. Same contract: whatever
-- the session has been told the current user is, or null.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Supabase's helper: splits an object path into its folder segments.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end
$$;

grant usage on schema auth, storage, public to anon, authenticated, service_role;
