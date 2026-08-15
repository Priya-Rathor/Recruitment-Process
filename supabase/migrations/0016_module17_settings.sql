-- =============================================================================
-- Module 17: Settings & Integrations
--
-- The last core module, and mostly a completion rather than a new build.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES **NOT** CREATE
-- ----------------------------------------------------
-- The spec's schema for this module lists several JSONB columns that would
-- duplicate tables earlier modules already own. Creating them would give the
-- product two places to configure the same thing, and they would drift within a
-- week.
--
--   * `pipeline_settings` — Module 10 built `pipeline_sla_config` as ROWS (one
--     per stage, with a check constraint). The spec's own retrofit instruction
--     for this module says to "point this module's /settings/pipeline page at
--     the pipeline_sla_config table Module 10 already created rather than
--     creating a duplicate". So there is no pipeline_settings column.
--
--   * `notification_settings` / `user_preferences.notification_preferences` —
--     Module 15 built `notification_preferences` as rows, one per
--     (organization, user, type), specifically so that "I never chose this" and
--     "I chose the same as the default" are different facts. Collapsing that
--     into a blob would destroy the distinction its inheritance depends on.
--
-- `organization_settings` therefore holds only what nothing else owns.
-- =============================================================================

-- =============================================================================
-- organization_settings
--
-- One row per organization, keyed BY organization_id rather than a surrogate id
-- — there can only ever be one, and a surrogate key invites two.
-- =============================================================================
create table if not exists public.organization_settings (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  /**
   * Timezone lives on `organizations` (Module 1) and every date calculation in
   * the product already reads it from there via lib/time.ts. It is NOT
   * duplicated here — two timezones would mean the dashboard and the analytics
   * could disagree about what "today" is, which is exactly the bug lib/time.ts
   * exists to prevent.
   */

  currency text not null default 'INR'
    check (currency ~ '^[A-Z]{3}$'),

  -- Applied when an application is created with no explicit recruiter.
  default_recruiter_id uuid references public.users (id) on delete set null,

  default_application_stage public.application_stage not null default 'new',

  default_interview_duration_minutes integer not null default 60
    check (default_interview_duration_minutes between 5 and 480),

  /**
   * Screening defaults: max attempts, retry delay, language, whether recording
   * is enabled. Read by lib/screening/retry.ts and lib/screening/script.ts.
   *
   * JSONB rather than columns because this set genuinely changes as the
   * screening product evolves, and every reader already normalises it through
   * a typed helper.
   */
  screening_settings jsonb not null default '{}',

  /**
   * Retention: how long to keep transcripts, recordings and archived records.
   * The Privacy & Compliance retrofit implements the actual deletion; this is
   * the setting it will read, defined now so the shape is fixed before anything
   * depends on it.
   */
  retention_settings jsonb not null default '{}',

  -- Branding. A logo URL, not a blob — Supabase storage owns files.
  logo_url text,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_settings_default_recruiter
  on public.organization_settings (default_recruiter_id);

drop trigger if exists trg_organization_settings_touch on public.organization_settings;
create trigger trg_organization_settings_touch
  before update on public.organization_settings
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- user_preferences
--
-- Per-user, per-organization. The same person in two organizations can
-- legitimately want different display settings, so the key is the pair.
-- =============================================================================
create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,

  /**
   * A DISPLAY-ONLY override. Every stored calculation ("today", SLA breaches,
   * analytics ranges) uses the ORGANIZATION's timezone, because a report whose
   * numbers change depending on who opened it is not a report. This only
   * affects how a timestamp is rendered to this person.
   */
  display_timezone text,

  date_format text not null default 'dd MMM yyyy'
    check (date_format in ('dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')),

  -- Density, default landing page, collapsed nav — cosmetic only.
  ui_preferences jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, user_id)
);

create index if not exists idx_user_preferences_user_id on public.user_preferences (user_id);
create index if not exists idx_user_preferences_organization_id
  on public.user_preferences (organization_id);

drop trigger if exists trg_user_preferences_touch on public.user_preferences;
create trigger trg_user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- organization_integrations — the columns Module 8's version was missing.
--
-- EXTENDED, not replaced. The spec is explicit that Module 17 "must extend
-- organization_integrations rather than create a second table, and must not
-- change placeCall()'s external interface". Both hold: this is `add column if
-- not exists`, and no adapter signature changes.
-- =============================================================================

-- A machine-readable failure reason, so the UI can offer the right remedy
-- (reconnect vs retry vs check the provider) without parsing English.
alter table public.organization_integrations
  add column if not exists error_code text;

/**
 * platform_managed vs organization_managed.
 *
 * The spec requires both. platform_managed means a shared account this product
 * operates (a managed Bolna number); organization_managed means the customer's
 * own credentials (their Google Calendar OAuth, their email domain).
 *
 * It matters beyond bookkeeping: a platform_managed integration must NOT expose
 * a disconnect button that would break other tenants, and an
 * organization_managed one must never fall back to platform credentials — a
 * customer whose OAuth expired would otherwise silently start sending invites
 * from our account.
 */
alter table public.organization_integrations
  add column if not exists credential_mode text not null default 'organization_managed'
    check (credential_mode in ('platform_managed', 'organization_managed'));

-- Who connected it, for the audit trail. NULL for platform-managed rows, which
-- no customer user connected.
alter table public.organization_integrations
  add column if not exists connected_by uuid references public.users (id) on delete set null;

create index if not exists idx_organization_integrations_status
  on public.organization_integrations (status);

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.organization_settings enable row level security;
alter table public.user_preferences enable row level security;

/**
 * organization_settings SELECT: any member.
 *
 * Deliberately not Owner/Admin-only. These are operating defaults — the default
 * interview duration, the currency — that the whole team's UI reads. Hiding
 * them would mean a Recruiter's interview form could not show the right
 * default, and nothing here is a secret. Credentials live in a different table
 * with a different policy.
 */
drop policy if exists organization_settings_select_member on public.organization_settings;
create policy organization_settings_select_member on public.organization_settings
  for select using (public.is_org_member(organization_id));

-- "Manage organization settings | Owner Yes | Admin Yes | Recruiter No | Viewer No".
drop policy if exists organization_settings_write_owner_admin on public.organization_settings;
create policy organization_settings_write_owner_admin on public.organization_settings
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

/**
 * user_preferences: your own, and only your own.
 *
 * user_id = caller appears in WITH CHECK as well as USING, because the rule
 * constrains what the row may BECOME — without it, a caller could take their own
 * row and reassign its user_id to a colleague, overwriting that person's
 * settings. The same shape Module 15's notification preferences use.
 */
drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all
  using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  )
  with check (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

-- =============================================================================
-- Cross-tenant integrity.
--
-- The default recruiter must be a member of the organization they are the
-- default for. A foreign key to users proves the person exists, not that they
-- are ours — without this, an organization could name a stranger as the default
-- assignee for every new application.
-- =============================================================================
create or replace function public.enforce_settings_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_recruiter_id is not null then
    if not exists (
      select 1
      from public.organization_members m
      where m.user_id = new.default_recruiter_id
        and m.organization_id = new.organization_id
        and m.status = 'active'
    ) then
      raise exception 'Default recruiter is not an active member of this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_organization_settings_tenant_integrity on public.organization_settings;
create trigger trg_organization_settings_tenant_integrity
  before insert or update of default_recruiter_id, organization_id
  on public.organization_settings
  for each row execute function public.enforce_settings_tenant_integrity();

create or replace function public.enforce_user_preferences_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organization_members m
    where m.user_id = new.user_id
      and m.organization_id = new.organization_id
  ) then
    raise exception 'User is not a member of this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_preferences_tenant_integrity on public.user_preferences;
create trigger trg_user_preferences_tenant_integrity
  before insert or update of user_id, organization_id
  on public.user_preferences
  for each row execute function public.enforce_user_preferences_tenant_integrity();

-- =============================================================================
-- Re-assert the credential REVOKE.
--
-- Module 8 revoked column-level SELECT on encrypted_credentials. Restated here
-- because this migration ALTERs the table, and because it is the single control
-- standing between an Owner's browser session and every provider secret the
-- organization owns. Re-running it costs nothing and makes the guarantee
-- present in the file that most obviously touches credentials.
-- =============================================================================
revoke select (encrypted_credentials) on public.organization_integrations from authenticated;
revoke select (encrypted_credentials) on public.organization_integrations from anon;
