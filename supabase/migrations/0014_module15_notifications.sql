-- =============================================================================
-- Module 15: Notifications & Communication
--
-- Three tables, and one policy that is deliberately STRICTER than every other
-- table in this product.
--
-- A NOTIFICATION IS READABLE ONLY BY ITS RECIPIENT.
--
-- Everywhere else, org membership is the read boundary — the team list, the
-- pipeline, the activity log. Not here. A notification body quotes candidate
-- names, interview times and screening outcomes, and it is addressed to one
-- person. "Rahul Sharma declined the automated call" delivered to a Viewer who
-- has no business with that application is a leak dressed up as a feature.
--
-- So the SELECT policy requires user_id = the caller. There is no org-wide read.
--
-- notification_preferences is here rather than in Module 1. The spec lists
-- "Module 1: users/roles + user_preferences" as a dependency, but Module 1 never
-- built such a table — see docs/modules/15-notifications-notes.md.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_channel') then
    create type public.notification_channel as enum ('in_app', 'email');
  end if;

  if not exists (select 1 from pg_type where typname = 'notification_delivery_status') then
    create type public.notification_delivery_status as enum (
      'pending',
      'sent',
      'failed',
      -- The integration is not connected. Distinct from 'failed': nothing broke,
      -- the channel simply does not exist yet, and the fix is different.
      'skipped'
    );
  end if;
end $$;

-- =============================================================================
-- notifications — the in-app record. Always written, whatever happens outside.
-- =============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- The recipient. NOT NULL: a notification addressed to nobody is not a
  -- notification, and a null here would make the RLS policy silently fail open.
  user_id uuid not null references public.users (id) on delete cascade,

  -- Vocabulary in lib/notifications/templates.ts, validated on write.
  type text not null check (length(btrim(type)) > 0),

  title text not null check (length(btrim(title)) > 0),
  body text not null,

  /**
   * Where to go when the notification is clicked. Stored as a relative path,
   * never a full URL — an absolute URL in a database column is an open redirect
   * waiting for someone to write to it.
   */
  link_path text check (link_path is null or link_path like '/%'),

  /** low | normal | high. Drives ordering in the centre, nothing else. */
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),

  -- Fixed facts and ids the template rendered from. Never the raw event payload.
  metadata jsonb not null default '{}',

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_organization_id
  on public.notifications (organization_id);
create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_notifications_created_at on public.notifications (created_at desc);
create index if not exists idx_notifications_org_created_at
  on public.notifications (organization_id, created_at desc);
-- The centre's main query, and the nav badge's count.
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- =============================================================================
-- notification_deliveries — one row per channel attempt.
--
-- Separate from notifications on purpose. The in-app notification is the record
-- that something happened; a delivery is the record of an ATTEMPT to send it
-- somewhere. Collapsing them would mean a failed email either destroys the
-- notification or silently reports success, and both are wrong.
-- =============================================================================
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  notification_id uuid not null references public.notifications (id) on delete cascade,

  channel public.notification_channel not null,
  status public.notification_delivery_status not null default 'pending',

  /** The provider's id, for reconciling bounces later. Never a credential. */
  provider_message_id text,

  /** Plain reason, safe to show a user. Provider bodies are not stored. */
  error_message text,

  /** Masked at write time — never a full address (see lib/notifications/notify.ts). */
  recipient_hint text,

  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_deliveries_organization_id
  on public.notification_deliveries (organization_id);
create index if not exists idx_notification_deliveries_notification_id
  on public.notification_deliveries (notification_id);
create index if not exists idx_notification_deliveries_status
  on public.notification_deliveries (status);
create index if not exists idx_notification_deliveries_provider_message_id
  on public.notification_deliveries (provider_message_id);
create index if not exists idx_notification_deliveries_org_created_at
  on public.notification_deliveries (organization_id, created_at desc);

-- One attempt row per notification per channel: retries update, never duplicate.
create unique index if not exists idx_notification_deliveries_unique
  on public.notification_deliveries (notification_id, channel);

-- =============================================================================
-- notification_preferences
--
-- One row per (organization, user, type). A NULL user_id is the ORGANIZATION
-- DEFAULT; a row with a user_id is that person's override.
--
-- Modelled as rows rather than a JSON blob on the user so a default and an
-- override are separate facts. With a blob, "I never chose this" and "I chose
-- the same thing the org did" are indistinguishable — so changing the org
-- default would either silently overwrite deliberate personal choices or never
-- reach anyone.
-- =============================================================================
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /** NULL = the organization default for this type. */
  user_id uuid references public.users (id) on delete cascade,

  notification_type text not null check (length(btrim(notification_type)) > 0),

  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_preferences_organization_id
  on public.notification_preferences (organization_id);
create index if not exists idx_notification_preferences_user_id
  on public.notification_preferences (user_id);

-- Two partial uniques rather than one: NULL never equals NULL in a unique
-- index, so a plain unique(organization_id, user_id, notification_type) would
-- happily allow twenty conflicting organization defaults for the same type.
create unique index if not exists idx_notification_preferences_org_default
  on public.notification_preferences (organization_id, notification_type)
  where user_id is null;

create unique index if not exists idx_notification_preferences_user
  on public.notification_preferences (organization_id, user_id, notification_type)
  where user_id is not null;

drop trigger if exists trg_notification_preferences_touch on public.notification_preferences;
create trigger trg_notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Cross-tenant integrity.
--
-- The recipient must be a member of the organization the notification belongs
-- to. A foreign key to users proves the person exists, not that they are ours —
-- without this, a bug in a notify() call-site could deliver an internal message
-- about a candidate to someone in another tenant.
-- =============================================================================
create or replace function public.enforce_notification_tenant_integrity()
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
    raise exception 'Recipient is not a member of this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notifications_tenant_integrity on public.notifications;
create trigger trg_notifications_tenant_integrity
  before insert on public.notifications
  for each row execute function public.enforce_notification_tenant_integrity();

create or replace function public.enforce_delivery_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.notifications where id = new.notification_id;

  if v_org is null or v_org <> new.organization_id then
    raise exception 'Notification does not belong to this organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deliveries_tenant_integrity on public.notification_deliveries;
create trigger trg_deliveries_tenant_integrity
  before insert or update of notification_id, organization_id
  on public.notification_deliveries
  for each row execute function public.enforce_delivery_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_preferences enable row level security;

-- READ: only your own. See the header — this is the strictest policy in the
-- product, and deliberately so.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

/**
 * INSERT: a member may create a notification for a colleague.
 *
 * Necessarily so — almost every notification is raised by one person's action
 * for someone else's attention ("your interview was cancelled"). The tenant
 * trigger above bounds it to the same organization, and the type must be one of
 * the approved templates, which the API validates.
 */
drop policy if exists notifications_insert_member on public.notifications;
create policy notifications_insert_member on public.notifications
  for insert with check (public.is_org_member(organization_id));

/**
 * UPDATE: mark your own as read. Nothing else.
 *
 * WITH CHECK repeats user_id = caller so an update cannot REASSIGN a
 * notification to someone else — a USING-only policy would let you hand your
 * notification to another user, and the row would then be theirs to read.
 */
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update
  using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  )
  with check (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (
    public.is_org_member(organization_id)
    and user_id = public.current_app_user_id()
  );

-- Deliveries follow their notification: you can see the send status of a message
-- addressed to you, and nobody else's.
drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own on public.notification_deliveries
  for select using (
    exists (
      select 1
      from public.notifications n
      where n.id = notification_id
        and n.user_id = public.current_app_user_id()
    )
    or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

-- Written by the send pipeline on behalf of a member.
drop policy if exists notification_deliveries_write_member on public.notification_deliveries;
create policy notification_deliveries_write_member on public.notification_deliveries
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Preferences: everyone reads (you need to see the default you inherit).
drop policy if exists notification_preferences_select_member on public.notification_preferences;
create policy notification_preferences_select_member on public.notification_preferences
  for select using (public.is_org_member(organization_id));

/**
 * PREFERENCE WRITES — the one that carries a real rule.
 *
 * "Configure organization notification defaults | Owner Yes | Admin Yes |
 *  Recruiter No | Viewer No".
 *
 * So a row with user_id IS NULL (the org default) requires Owner/Admin, and a
 * row with a user_id must be your OWN. Both halves are in WITH CHECK as well as
 * USING, because the rule constrains what the row may BECOME: without the
 * WITH CHECK, a Recruiter could take their own override row and null its
 * user_id, turning a personal setting into an organization-wide default.
 */
drop policy if exists notification_preferences_write on public.notification_preferences;
create policy notification_preferences_write on public.notification_preferences
  for all
  using (
    public.is_org_member(organization_id)
    and (
      case
        when user_id is null
          then public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
        else user_id = public.current_app_user_id()
      end
    )
  )
  with check (
    public.is_org_member(organization_id)
    and (
      case
        when user_id is null
          then public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
        else user_id = public.current_app_user_id()
      end
    )
  );
