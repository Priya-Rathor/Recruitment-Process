-- =============================================================================
-- Module 14: Activity & Audit
--
-- One table, and almost all of its design is about what CANNOT happen to it.
--
-- IMMUTABLE. There is no UPDATE policy and no DELETE policy. Not an oversight —
-- the spec's section 6 lists PATCH and DELETE endpoints, and they are
-- deliberately not implemented (see docs/modules/14-activity-notes.md). A log a
-- user can edit is not an audit trail; it is a story. The one question this
-- table exists to answer is "what actually happened", and an editable row
-- cannot answer it.
--
-- SENSITIVE EVENTS ARE GATED IN RLS, NOT IN THE ROUTE. Section 9 restricts the
-- security/settings audit log to Owner/Admin. The browser holds an
-- authenticated PostgREST client, so a Recruiter could read the table directly;
-- a rule that lives only in a route handler would be no rule at all. The
-- is_sensitive flag is therefore enforced in the SELECT policy.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_entity_type') then
    create type public.activity_entity_type as enum (
      'organization',
      'member',
      'job',
      'candidate',
      'application',
      'resume',
      'screening_call',
      'screening_report',
      'interview',
      'client',
      'automation',
      'integration'
    );
  end if;
end $$;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  entity_type public.activity_entity_type not null,
  /**
   * The row this happened to.
   *
   * NO foreign key, on purpose. It points at twelve different tables, and more
   * importantly a log entry must outlive its subject: if a candidate is later
   * erased under the privacy retrofit, "this record was erased on this date by
   * this person" is exactly the row that has to survive. A cascade here would
   * delete the evidence along with the evidence's subject.
   */
  entity_id uuid,

  -- Vocabulary lives in lib/activity/events.ts and is validated on write.
  event_type text not null check (length(btrim(event_type)) > 0),

  -- Who did it. NULL means the system acted on its own — an automation, a
  -- webhook, a scheduled job. Never invent a user for those.
  actor_id uuid references public.users (id) on delete set null,
  /**
   * Preserved actor description.
   *
   * actor_id nulls out when a user is deleted, but "who closed this job?" must
   * still be answerable afterwards. This is a name/email snapshot at write time,
   * not a live join.
   */
  actor_label text,

  -- Summary-level context only. The AI-call events store a token/outcome
  -- summary, NEVER the prompt, the provider payload, or any credential.
  metadata jsonb not null default '{}',

  /**
   * Security/settings-sensitive. Owner/Admin only, enforced below in RLS.
   *
   * Stored rather than derived from event_type so the boundary survives a later
   * rename of an event, and so the policy is a simple column read rather than a
   * list the policy has to keep in step with application code.
   */
  is_sensitive boolean not null default false,

  created_at timestamptz not null default now()
);

-- Indexes named by the spec, plus the two composites the real queries use.
create index if not exists idx_activity_events_organization_id
  on public.activity_events (organization_id);
create index if not exists idx_activity_events_entity_id
  on public.activity_events (entity_id);
create index if not exists idx_activity_events_actor_id
  on public.activity_events (actor_id);
create index if not exists idx_activity_events_created_at
  on public.activity_events (created_at desc);
create index if not exists idx_activity_events_org_created_at
  on public.activity_events (organization_id, created_at desc);
-- The per-entity timeline query.
create index if not exists idx_activity_events_entity_timeline
  on public.activity_events (organization_id, entity_type, entity_id, created_at desc);
-- The audit log, which reads only the sensitive slice.
create index if not exists idx_activity_events_sensitive
  on public.activity_events (organization_id, created_at desc)
  where is_sensitive;

-- =============================================================================
-- Immutability, enforced.
--
-- Omitting the UPDATE/DELETE policies already blocks both for ordinary users.
-- This trigger also blocks them for the SERVICE ROLE, which bypasses RLS
-- entirely — lib/supabase/admin.ts is used by the Bolna webhook and the
-- integration adapters, and a bug there must not be able to rewrite history.
--
-- Deleting an ORGANIZATION still cascades. That is intentional: the tenant is
-- gone, and keeping its audit trail would be retaining personal data with no
-- controller, which the privacy chapter forbids.
-- =============================================================================
create or replace function public.reject_activity_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'activity_events is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists trg_activity_events_immutable on public.activity_events;
create trigger trg_activity_events_immutable
  before update or delete on public.activity_events
  for each row execute function public.reject_activity_event_mutation();

-- =============================================================================
-- Cross-tenant integrity.
--
-- The actor must belong to the organization the event is recorded against.
-- Without this, a caller could attribute an action in their own org to a user
-- from another one — which would be both a false record and a small identity
-- leak (the audit log renders actor names).
-- =============================================================================
create or replace function public.enforce_activity_event_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is not null then
    if not exists (
      select 1
      from public.organization_members m
      where m.user_id = new.actor_id
        and m.organization_id = new.organization_id
    ) then
      raise exception 'Actor is not a member of this organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_activity_events_tenant_integrity on public.activity_events;
create trigger trg_activity_events_tenant_integrity
  before insert on public.activity_events
  for each row execute function public.enforce_activity_event_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.activity_events enable row level security;

/**
 * SELECT.
 *
 * Ordinary events: any member of the organization. Section 9 gives all four
 * roles the entity timeline, and an activity trail that hid itself from the
 * people whose work it describes would be worse than useless.
 *
 * Sensitive events: Owner/Admin only. This is the security boundary from
 * section 9, and it is here — not merely in the route — because the browser can
 * query this table directly.
 */
drop policy if exists activity_events_select_member on public.activity_events;
create policy activity_events_select_member on public.activity_events
  for select using (
    public.is_org_member(organization_id)
    and (
      not is_sensitive
      or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    )
  );

/**
 * INSERT.
 *
 * Any member may write an event, because every member performs actions that
 * must be logged. Two things they may NOT do:
 *
 *   - attribute an action to someone else. actor_id must be the caller, or NULL
 *     for a genuinely system-driven event. A Recruiter writing a row that reads
 *     "Owner removed a member" would be forging the audit trail.
 *   - the tenant trigger above additionally requires the actor to be a member
 *     of this organization.
 *
 * Writing a *sensitive* event is not role-gated on insert: a failed permission
 * change is performed by whoever attempted it, and that attempt is precisely
 * what the audit log needs to capture.
 */
drop policy if exists activity_events_insert_member on public.activity_events;
create policy activity_events_insert_member on public.activity_events
  for insert with check (
    public.is_org_member(organization_id)
    and (actor_id is null or actor_id = public.current_app_user_id())
  );

-- No UPDATE policy. No DELETE policy. See the header.
