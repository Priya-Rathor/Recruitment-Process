-- =============================================================================
-- Module 15 (candidate communication) — the schema that was never written.
--
-- WHY THIS FILE EXISTS AT 0035 AND NOT AS A FIX TO 0030
--
-- `0030_module15_candidate_messaging.sql` is a 4-byte truncated file containing
-- the text `writ`. Module 15's application layer — 3,098 lines across
-- lib/communications/, the template library, the editor, the send pipeline, the
-- opt-out flow and the communication log on two pages — was built against tables
-- that no migration ever created. `/settings/templates` errors on load, and
-- lib/communications/ has no isMissingRelation() guard to soften it.
--
-- 0030 is left in place rather than rewritten: migrations here are applied by
-- hand, deployments may already have recorded it, and silently changing the
-- contents of a migration somebody has run is how two environments stop matching.
-- This is additive and re-runnable, so applying it to a database that somehow
-- already has these tables is a no-op.
--
-- THE SCHEMA IS DERIVED FROM THE CODE, NOT INVENTED.
--
-- The column lists come from `TEMPLATE_COLUMNS` and `LOG_COLUMNS` in
-- lib/communications/queries.ts, the enums from TEMPLATE_CHANNELS,
-- COMMUNICATION_EVENTS and MessageStatus. Every name and every value below
-- matches what the existing code already selects, inserts and filters on — this
-- migration fits the application, not the other way round.
--
-- One detail worth naming: `message_log.sent_by` must produce a foreign key
-- called `message_log_sent_by_fkey`, because queries.ts embeds the sender with
-- `sender:users!message_log_sent_by_fkey(name, email)`. Postgres' default
-- constraint naming gives exactly that, so it is not spelled out — but renaming
-- the column later would break that join.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  -- Channels a TEMPLATE may target. `both` is a template that carries an email
  -- body and a WhatsApp body; it is not a channel anything sends on — see
  -- deliveryChannelsFor() in lib/communications/templates.ts.
  if not exists (select 1 from pg_type where typname = 'message_template_channel') then
    create type public.message_template_channel as enum ('email', 'whatsapp', 'both');
  end if;

  -- Channels a MESSAGE actually went out on. Deliberately narrower than the
  -- template enum: a log row records one delivery, so `both` is meaningless here
  -- and a row can never claim it.
  if not exists (select 1 from pg_type where typname = 'message_delivery_channel') then
    create type public.message_delivery_channel as enum ('email', 'whatsapp');
  end if;

  /*
    Delivery status.

    `skipped` is the one that matters and the reason this is an enum rather than
    a boolean: a message not sent because the candidate opted out, or because the
    channel was disconnected, is NOT a failure — it is the product correctly
    declining to send. Recording it as `failed` would make an opt-out look like a
    bug, and recording nothing at all would make it look like the message went.
  */
  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type public.message_status as enum (
      'queued',     -- accepted by us, not yet handed to a provider
      'sent',       -- the provider accepted it
      'delivered',  -- the provider confirmed delivery
      'opened',     -- email only; WhatsApp gives us no read signal we trust
      'bounced',    -- a hard delivery failure at the recipient
      'failed',     -- we or the provider could not send
      'skipped'     -- deliberately not sent. See above.
    );
  end if;

  /*
    The pipeline events a template can attach to.

    Exactly COMMUNICATION_EVENTS from lib/communications/events.ts, in its order.
    An enum rather than free text because a template pointing at an event the
    product never raises is a template that silently never sends.
  */
  if not exists (select 1 from pg_type where typname = 'communication_event') then
    create type public.communication_event as enum (
      'application_received',
      'shortlisted',
      'ai_screening_call_scheduled',
      'phone_interview_scheduled',
      'video_interview_scheduled',
      'interview_reminder',
      'assessment_assigned',
      'director_round_scheduled',
      'offer_extended',
      'hired',
      'rejected',
      'unqualified'
    );
  end if;
end $$;

-- =============================================================================
-- message_templates
--
-- What a candidate is told, and when. One row per (event, channel) an
-- organization chooses to automate.
-- =============================================================================
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Internal label. Never shown to a candidate.
  name text not null check (length(btrim(name)) between 1 and 120),

  event_key public.communication_event not null,
  channel public.message_template_channel not null,

  /*
    Email only, and NOT NULL-checked here.

    parseTemplatePayload() refuses an email template with no subject, and this
    constraint is the same rule at the boundary the browser can reach directly:
    an email with no subject line is a deliverability problem, not a style
    choice. A whatsapp-only template must leave it null rather than storing an
    unused string that a future reader would try to display.
  */
  subject text,
  constraint message_templates_subject_matches_channel check (
    (channel in ('email', 'both') and subject is not null and length(btrim(subject)) > 0)
    or (channel = 'whatsapp' and subject is null)
  ),

  -- The email body, or the only body for a whatsapp-only template.
  body text not null check (length(btrim(body)) > 0),

  /*
    The WhatsApp body for a `both` template.

    A separate column rather than one shared body, because the two channels are
    not the same medium: an email can carry a paragraph and a signature, a
    WhatsApp message is read on a phone and has a much shorter useful length.
    One body would have to be wrong for one of them.
  */
  whatsapp_body text,
  constraint message_templates_whatsapp_body_matches_channel check (
    (channel = 'both' and whatsapp_body is not null and length(btrim(whatsapp_body)) > 0)
    or (channel <> 'both')
  ),

  active boolean not null default false,

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_message_templates_organization
  on public.message_templates (organization_id);

-- The lookup the send pipeline does on every pipeline event: "is there an active
-- template for this event in this org?"
create index if not exists idx_message_templates_active_event
  on public.message_templates (organization_id, event_key)
  where active;

drop trigger if exists trg_message_templates_touch on public.message_templates;
create trigger trg_message_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- message_log
--
-- Every message this product sent a candidate, or deliberately did not send.
--
-- ONE LOG, TWO SURFACES. The Application page and the Candidate page both read
-- this table — see components/CommunicationLog.tsx, rendered by both. There is no
-- second history view and this migration does not create one.
-- =============================================================================
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    Both parents, and both nullable-by-context.

    A message about an application has both; a message to a candidate with no
    application in play has only the candidate. The check below refuses a row
    that belongs to neither, which would be a log entry nothing can display.
  */
  application_id uuid references public.applications (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  constraint message_log_has_a_subject check (
    application_id is not null or candidate_id is not null
  ),

  channel public.message_delivery_channel not null,

  /*
    The template used, if any.

    ON DELETE SET NULL, not CASCADE. Deleting a template must not erase the
    record of messages already sent through it — that history is the evidence
    that a candidate was told something, and it outlives the wording.
  */
  template_id uuid references public.message_templates (id) on delete set null,
  event_key public.communication_event,

  -- What was actually sent, AFTER placeholder substitution. Stored rather than
  -- re-rendered on read: the template may have changed since, and the log has to
  -- say what this person received, not what they would receive today.
  subject text,
  body_sent text not null,

  status public.message_status not null default 'queued',
  error_message text,

  /*
    A masked recipient — "r••••@example.com", "+91 •••• ••43 10".

    The full address is on the candidate record; repeating it on every log row
    would spread personal data across a table that exists to be read by anyone
    who can see the application. The hint is enough to confirm which address was
    used.
  */
  recipient_hint text,

  provider_message_id text,

  -- NULL for an automatic send: an automation is not a person, and naming the
  -- recruiter who happened to trigger the stage change would be a false record.
  sent_by uuid references public.users (id) on delete set null,

  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_log_application
  on public.message_log (application_id, created_at desc);

create index if not exists idx_message_log_candidate
  on public.message_log (candidate_id, created_at desc);

create index if not exists idx_message_log_organization
  on public.message_log (organization_id, created_at desc);

-- =============================================================================
-- candidate_communication_preferences
--
-- Opt-out state, per candidate per channel.
--
-- Keyed by (organization_id, candidate_id) with no surrogate id: there can only
-- ever be one row per candidate, and a surrogate key invites two — at which point
-- "has this person opted out?" depends on which row you read.
-- =============================================================================
create table if not exists public.candidate_communication_preferences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,

  email_opted_out boolean not null default false,
  whatsapp_opted_out boolean not null default false,

  opted_out_at timestamptz,
  -- Free text: "replied STOP", "asked on a call". Recorded because an opt-out a
  -- recruiter entered by hand and one the candidate made through the unsubscribe
  -- link are different facts if anyone ever disputes it.
  opted_out_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (organization_id, candidate_id)
);

drop trigger if exists trg_candidate_comm_prefs_touch
  on public.candidate_communication_preferences;
create trigger trg_candidate_comm_prefs_touch
  before update on public.candidate_communication_preferences
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- organization_settings.communication_settings
--
-- The other half of the same omission. lib/settings/queries.ts reads and writes
-- this column and app/settings/recruitment/RecruitmentForm.tsx sends it in the
-- SAME payload as currency, default recruiter, default stage and interview
-- duration — so with the column absent, /settings/recruitment cannot save
-- anything at all, not merely the reminder fields.
--
-- Shape: { interviewReminderHours: number, interviewReminderChannels: string[] }.
-- Read through normalizeCommunicationSettings(), which clamps it.
-- =============================================================================
alter table public.organization_settings
  add column if not exists communication_settings jsonb not null default '{}';

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.message_templates enable row level security;
alter table public.message_log enable row level security;
alter table public.candidate_communication_preferences enable row level security;

/**
 * Templates: every member reads, Owner/Admin writes.
 *
 * The read is deliberately open to Recruiter and Viewer. A recruiter about to
 * move somebody to Rejected should be able to see exactly what that candidate is
 * about to receive, without being able to reword it for the whole organization.
 * That is the permission split the module's spec asks for, and it only means
 * anything if it is here as well as in the route.
 */
drop policy if exists message_templates_select_member on public.message_templates;
create policy message_templates_select_member on public.message_templates
  for select using (public.is_org_member(organization_id));

drop policy if exists message_templates_insert_owner_admin on public.message_templates;
create policy message_templates_insert_owner_admin on public.message_templates
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/*
  USING *and* WITH CHECK on update.

  Without organization_id in WITH CHECK, an Admin could take their own template
  and move it into another tenant — the rule constrains what the row may BECOME,
  not just who may touch it. Same shape the rest of this schema uses.

  It also matters for `active`: activating a template is what makes it send to
  real people, and that transition must not be reachable by a Recruiter through
  the browser's PostgREST client just because a route handler said no.
*/
drop policy if exists message_templates_update_owner_admin on public.message_templates;
create policy message_templates_update_owner_admin on public.message_templates
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

drop policy if exists message_templates_delete_owner_admin on public.message_templates;
create policy message_templates_delete_owner_admin on public.message_templates
  for delete using (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
  );

/**
 * message_log: every member reads. NOBODY writes through a session.
 *
 * There is no INSERT, UPDATE or DELETE policy, on purpose. Log rows are written
 * by the send pipeline through lib/supabase/admin.ts, which bypasses RLS — and a
 * message history that a user's browser could edit is not a history. An Owner
 * must not be able to delete the record of what a candidate was told, and the
 * append-only guarantee the audit log makes would be worthless here without the
 * same treatment.
 */
drop policy if exists message_log_select_member on public.message_log;
create policy message_log_select_member on public.message_log
  for select using (public.is_org_member(organization_id));

/**
 * Opt-out state: every member reads; Owner/Admin/Recruiter write.
 *
 * Recruiters included because recording "she asked me on the call not to text
 * again" is a thing that happens to a recruiter, and making them file a request
 * to honour it is how an opt-out gets ignored. The unsubscribe route writes
 * through the service role, since the candidate has no session.
 */
drop policy if exists candidate_comm_prefs_select_member
  on public.candidate_communication_preferences;
create policy candidate_comm_prefs_select_member
  on public.candidate_communication_preferences
  for select using (public.is_org_member(organization_id));

drop policy if exists candidate_comm_prefs_write_staff
  on public.candidate_communication_preferences;
create policy candidate_comm_prefs_write_staff
  on public.candidate_communication_preferences
  for all using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- Cross-tenant integrity.
--
-- Every row here carries organization_id AND a foreign key to a parent. A foreign
-- key proves the parent exists, not that it is OURS — without these triggers, a
-- log row could point at another tenant's application and expose it through a
-- join, which is precisely the class of bug organization_id-on-every-table is
-- meant to prevent.
-- =============================================================================
create or replace function public.enforce_message_log_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.application_id is not null then
    if not exists (
      select 1 from public.applications a
      where a.id = new.application_id and a.organization_id = new.organization_id
    ) then
      raise exception 'Application does not belong to this organization';
    end if;
  end if;

  if new.candidate_id is not null then
    if not exists (
      select 1 from public.candidates c
      where c.id = new.candidate_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  if new.template_id is not null then
    if not exists (
      select 1 from public.message_templates t
      where t.id = new.template_id and t.organization_id = new.organization_id
    ) then
      raise exception 'Template does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_message_log_tenant_integrity() from public, anon;

drop trigger if exists trg_message_log_tenant_integrity on public.message_log;
create trigger trg_message_log_tenant_integrity
  before insert or update of application_id, candidate_id, template_id, organization_id
  on public.message_log
  for each row execute function public.enforce_message_log_tenant_integrity();

create or replace function public.enforce_comm_prefs_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.candidates c
    where c.id = new.candidate_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Candidate does not belong to this organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_comm_prefs_tenant_integrity() from public, anon;

drop trigger if exists trg_comm_prefs_tenant_integrity
  on public.candidate_communication_preferences;
create trigger trg_comm_prefs_tenant_integrity
  before insert or update of candidate_id, organization_id
  on public.candidate_communication_preferences
  for each row execute function public.enforce_comm_prefs_tenant_integrity();

-- =============================================================================
-- Documentation the next reader sees first.
-- =============================================================================
comment on table public.message_templates is
  'What a candidate is told, and when. Owner/Admin write; every member reads, so a recruiter can see what a candidate will receive without being able to reword it org-wide.';

comment on table public.message_log is
  'Every message sent to a candidate, or deliberately skipped. APPEND-ONLY from a session''s point of view: there is no insert/update/delete policy, so only the send pipeline (service role) writes. Read by components/CommunicationLog.tsx on BOTH the application and candidate pages — there is no second history view.';

comment on column public.message_log.status is
  '''skipped'' is not a failure — it records the product declining to send, e.g. an opt-out or a disconnected channel. Logging that as ''failed'' would make an honoured opt-out look like a bug.';

comment on column public.message_log.body_sent is
  'The rendered message AS SENT, after placeholder substitution. Stored rather than re-rendered, because the template may have changed since and the log must say what this person actually received.';

comment on table public.candidate_communication_preferences is
  'Per-candidate opt-out, one row per (organization, candidate). Recruiters may write it: honouring "don''t text me again" should not need an Admin.';
