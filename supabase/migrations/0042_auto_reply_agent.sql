-- =============================================================================
-- 0042 — the WhatsApp auto-reply agent.
--
-- 0041 gave candidates a way to write to us. This lets an AI answer them, which
-- is a materially different kind of feature from every other AI function in this
-- product and the schema is shaped by that difference.
--
-- WHY THIS IS THE HIGHEST-STAKES AI SURFACE HERE, AND WHAT THE SCHEMA DOES
-- ABOUT IT.
--
-- Every other AI function in lib/ai/ produces something a human reads and then
-- accepts or discards: a summary on a page, a draft in a composer, a suggested
-- rule. The Raw Data → AI → Validation → HUMAN REVIEW → Business Action sequence
-- has a person in the middle. This one does not. Its output leaves the building
-- and arrives on a real person's phone, and **a WhatsApp message cannot be
-- unsent**. There is no undo to build, so the schema's job is to make the
-- feature (a) off unless somebody deliberately turned it on, (b) stoppable
-- instantly, and (c) impossible to mistake for a human afterwards:
--
--   - `organization_settings.auto_reply_master_enabled` DEFAULTS FALSE. An
--     existing organization that applies this migration does not start
--     messaging its candidates. Nothing about a schema change should be able to
--     cause an outbound message.
--   - It is a separate boolean from `auto_reply_config.enabled`, not a
--     convenience duplicate: one is the kill switch a recruiter reaches for
--     in the inbox when the agent says something wrong, the other is
--     configuration an admin tunes. Collapsing them would mean the fastest way
--     to stop the agent was to edit its settings.
--   - `message_log.auto_replied` is on the LOG ROW, so what the agent said is
--     permanently distinguishable from what a person said. The UI labels it from
--     this column; there is no path that writes an auto-reply as an ordinary
--     outbound message.
--   - `whatsapp_conversations.needs_human` is how a refusal becomes visible. An
--     agent that declines to answer and tells nobody is an agent that silently
--     drops candidates.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'auto_reply_timing') then
    create type public.auto_reply_timing as enum ('immediate', 'delayed');
  end if;

  /*
    The life of one queued reply.

    'skipped' is the interesting one and the reason this is an enum rather than a
    boolean: an auto-reply that did not go because a human had just replied, or
    because the candidate had opted out, is the agent behaving correctly. Filing
    that as 'failed' would make correct restraint look like a bug, and filing it
    as nothing at all would make it invisible — and "why didn't the agent answer
    this one?" is a question an admin will ask in the first week.
  */
  if not exists (select 1 from pg_type where typname = 'auto_reply_queue_status') then
    create type public.auto_reply_queue_status as enum (
      'pending',   -- due now or later; the sweep will take it
      'sent',      -- a reply reached the provider
      'skipped',   -- deliberately not answered. See above.
      'failed'     -- we could not complete it
    );
  end if;
end $$;

-- =============================================================================
-- auto_reply_config
--
-- One row per scope: `job_id IS NULL` is the organization-wide default, a set
-- `job_id` overrides it for that job. Exactly the precedence shape Module 24's
-- Default Call Data established (lib/voice/callData.ts), and resolved by one
-- pure function in lib/autoReply/config.ts that both the settings preview and
-- the webhook call — a preview that computes precedence differently from the
-- code that sends is worse than no preview, because it is believed.
-- =============================================================================
create table if not exists public.auto_reply_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    NULL = the organization-wide default. Set = this job's override.

    ON DELETE CASCADE: an override for a deleted job is configuration for
    something that no longer exists, and leaving it would make the settings page
    list an override nobody can see the job for.
  */
  job_id uuid references public.jobs (id) on delete cascade,

  enabled boolean not null default false,

  response_timing public.auto_reply_timing not null default 'immediate',

  /*
    Only meaningful for 'delayed', and the CHECK makes that structural rather
    than conventional.

    Capped at 24 hours (1440) for a reason that is Meta's, not ours: free-form
    text is only permitted within 24 hours of the candidate's last inbound
    message, so a delay longer than the window guarantees the reply is refused
    by WhatsApp at the moment it finally fires. A setting that cannot work is
    not a setting.
  */
  delay_minutes integer check (delay_minutes is null or (delay_minutes between 1 and 1440)),
  constraint auto_reply_config_delay_matches_timing check (
    (response_timing = 'delayed' and delay_minutes is not null)
    or (response_timing = 'immediate' and delay_minutes is null)
  ),

  -- Free-form guidance, not a template. Capped so a pasted essay cannot push
  -- the real facts out of the model's context window.
  tone_instructions text check (tone_instructions is null or length(tone_instructions) <= 2000),
  context_instructions text
    check (context_instructions is null or length(context_instructions) <= 4000),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One override per job per tenant.
  unique (organization_id, job_id)
);

/*
  ONE organization-wide row per tenant.

  A separate partial unique index because `unique (organization_id, job_id)`
  does NOT constrain the default: in SQL two NULLs are not equal, so that
  constraint happily admits five organization-wide rows. Whichever one a query
  happened to read would then decide how the agent behaves — the same class of
  bug migration 0035 avoided by giving candidate_communication_preferences a
  composite primary key instead of a surrogate id.
*/
create unique index if not exists idx_auto_reply_config_org_default
  on public.auto_reply_config (organization_id)
  where job_id is null;

create index if not exists idx_auto_reply_config_job
  on public.auto_reply_config (organization_id, job_id)
  where job_id is not null;

drop trigger if exists trg_auto_reply_config_touch on public.auto_reply_config;
create trigger trg_auto_reply_config_touch
  before update on public.auto_reply_config
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- auto_reply_queue
--
-- One row per inbound message the agent intends to answer.
--
-- WHY A QUEUE EXISTS AT ALL — and why it is not a second clock. AGENTS.md: "Do
-- not add a second cron, a worker, or a timer — add a pass to the existing
-- sweep." A delayed reply is therefore a row with a `due_at`, drained by the
-- one sweep that already drains the `wait_then` delay queue and approval expiry.
--
-- IT IS ALSO THE IDEMPOTENCY KEY, AND THAT MATTERS MORE THAN THE DELAY.
-- `inbound_message_id` is unique, so Meta redelivering a webhook cannot produce
-- a second reply to the same message. Without it, a function frozen mid-send
-- (the normal serverless failure) plus Meta's retry would message a candidate
-- twice about one question.
--
-- An 'immediate' reply is queued too, with `due_at = now()`, and then attempted
-- inline. If the inline attempt never finishes — Meta's timeout, a frozen
-- function — the row is still pending and the sweep picks it up. The queue is
-- the backstop, not just the delay mechanism.
-- =============================================================================
create table if not exists public.auto_reply_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  conversation_id uuid not null
    references public.whatsapp_conversations (id) on delete cascade,

  /*
    The inbound message this is an answer to.

    UNIQUE, which is the whole idempotency guarantee. ON DELETE CASCADE because a
    queued answer to a message that no longer exists has nothing to answer.
  */
  inbound_message_id uuid not null unique
    references public.message_log (id) on delete cascade,

  due_at timestamptz not null default now(),
  status public.auto_reply_queue_status not null default 'pending',

  /*
    Attempts, so a reply that keeps failing stops rather than being retried by
    every sweep forever. The drain gives up at 3 — an LLM or provider failure
    that has persisted across three sweeps is a configuration problem a person
    needs to see, not something to keep spending tokens on.
  */
  attempts integer not null default 0 check (attempts >= 0),

  /** Human-readable, and safe to show an admin. Why it was skipped or failed. */
  detail text,

  /** The reply row, once one exists. Ties the queue to what was actually said. */
  reply_message_id uuid references public.message_log (id) on delete set null,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);

/*
  The drain's own index: pending work, oldest first.

  Partial, because a processed row is never read by the drain again and the
  overwhelming majority of rows are processed.
*/
create index if not exists idx_auto_reply_queue_due
  on public.auto_reply_queue (organization_id, due_at)
  where status = 'pending';

create index if not exists idx_auto_reply_queue_conversation
  on public.auto_reply_queue (conversation_id, created_at desc);

-- =============================================================================
-- Columns on the tables 0041 created
-- =============================================================================

/*
  Was this said by the agent?

  DEFAULTS FALSE, so every row written before this migration — and every row
  written by the manual composer, the templated sends and the automation
  engine — is correctly "a person or a configured template said this". Only
  lib/autoReply/ ever sets it true.

  The UI reads this column to label the bubble. Section 8 of the spec: never
  disguise an auto-reply as a human-sent message. A boolean on the row is how
  that becomes impossible rather than remembered.
*/
alter table public.message_log
  add column if not exists auto_replied boolean not null default false;

create index if not exists idx_message_log_auto_replied
  on public.message_log (organization_id, created_at desc)
  where auto_replied;

/*
  The agent declined and a person is needed.

  On the CONVERSATION rather than the message, because it is a state of the
  thread — "somebody has to answer these people" — and the inbox sorts and
  filters on it. Cleared when a human replies, which is the only thing that can
  honestly clear it.
*/
alter table public.whatsapp_conversations
  add column if not exists needs_human boolean not null default false;

/** Why, in words an admin can act on. Never shown to the candidate. */
alter table public.whatsapp_conversations
  add column if not exists needs_human_reason text;

alter table public.whatsapp_conversations
  add column if not exists needs_human_at timestamptz;

create index if not exists idx_whatsapp_conversations_needs_human
  on public.whatsapp_conversations (organization_id, last_message_at desc)
  where needs_human;

/*
  THE MASTER KILL SWITCH.

  DEFAULT FALSE, and that is the single most important default in this
  migration: applying a schema change must never be able to start messaging real
  candidates. An organization that wants the agent turns it on deliberately, in
  the inbox, as an Owner or Admin.

  Checked FIRST, before any per-job or organization-wide config is read — see
  resolveAutoReply() in lib/autoReply/config.ts. A recruiter watching the agent
  say something wrong needs one switch that stops all of it, not a settings page
  to audit.

  On organization_settings rather than in a jsonb blob because it is a boolean
  the product branches on, not a preference it carries around; the existing
  owner/admin write policy on that table is already exactly the permission the
  spec asks for.
*/
alter table public.organization_settings
  add column if not exists auto_reply_master_enabled boolean not null default false;

-- =============================================================================
-- Cross-tenant integrity.
--
-- A foreign key proves the parent exists, not that it is OURS. Same reasoning
-- and same shape as 0035 and 0041.
-- =============================================================================
create or replace function public.enforce_auto_reply_config_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_id is not null then
    if not exists (
      select 1 from public.jobs j
      where j.id = new.job_id and j.organization_id = new.organization_id
    ) then
      raise exception 'Job does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_auto_reply_config_tenant_integrity() from public, anon;

drop trigger if exists trg_auto_reply_config_tenant_integrity on public.auto_reply_config;
create trigger trg_auto_reply_config_tenant_integrity
  before insert or update of job_id, organization_id
  on public.auto_reply_config
  for each row execute function public.enforce_auto_reply_config_tenant_integrity();

create or replace function public.enforce_auto_reply_queue_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.whatsapp_conversations w
    where w.id = new.conversation_id and w.organization_id = new.organization_id
  ) then
    raise exception 'Conversation does not belong to this organization';
  end if;

  if not exists (
    select 1 from public.message_log m
    where m.id = new.inbound_message_id and m.organization_id = new.organization_id
  ) then
    raise exception 'Message does not belong to this organization';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_auto_reply_queue_tenant_integrity() from public, anon;

drop trigger if exists trg_auto_reply_queue_tenant_integrity on public.auto_reply_queue;
create trigger trg_auto_reply_queue_tenant_integrity
  before insert or update of conversation_id, inbound_message_id, organization_id
  on public.auto_reply_queue
  for each row execute function public.enforce_auto_reply_queue_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.auto_reply_config enable row level security;
alter table public.auto_reply_queue enable row level security;

/**
 * Config: every member reads, Owner/Admin writes.
 *
 * The read is open to Recruiter and Viewer on purpose, and it is the same
 * judgement migration 0035 made about message templates: a recruiter looking at
 * a thread the agent answered should be able to see what the agent was told to
 * do, without being able to change it for the whole organization. Hiding the
 * configuration would make the agent's behaviour unexplainable to the people
 * living with it.
 *
 * WITH CHECK repeats the role test against the NEW row, so organization_id
 * cannot be edited into a tenant the caller does not belong to, and — the part
 * that matters here — `enabled` cannot be flipped true by a Recruiter through
 * the browser's PostgREST client just because a route handler said no. AGENTS.md:
 * a rule that constrains what a row may BECOME belongs in the policy.
 */
drop policy if exists auto_reply_config_select_member on public.auto_reply_config;
create policy auto_reply_config_select_member on public.auto_reply_config
  for select using (public.is_org_member(organization_id));

drop policy if exists auto_reply_config_write_owner_admin on public.auto_reply_config;
create policy auto_reply_config_write_owner_admin on public.auto_reply_config
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

/**
 * Queue: every member reads. NOBODY writes through a session.
 *
 * No INSERT, UPDATE or DELETE policy, deliberately — the same treatment
 * message_log gets, for the same reason. Rows are written by the inbound webhook
 * and the sweep through the service-role client, both of which have no session
 * by definition. A queue a browser could edit is a queue a browser could use to
 * make the agent message somebody, which is the one thing this table must not
 * allow.
 *
 * The read is open because "what did the agent do, and why did it skip that
 * one?" is the question the inbox's oversight view exists to answer.
 */
drop policy if exists auto_reply_queue_select_member on public.auto_reply_queue;
create policy auto_reply_queue_select_member on public.auto_reply_queue
  for select using (public.is_org_member(organization_id));

-- =============================================================================
-- The inbox needs to show "the agent already handled this" at a glance.
--
-- DENORMALISED ONTO THE CONVERSATION, like last_message_preview beside it, and
-- for the same reason: the list reads up to 200 threads and cannot run a
-- latest-message-per-conversation lookup to render one icon each. The value is
-- written by the same statement that already moves the thread up the list, so
-- there is no second write to forget and nothing to drift.
-- =============================================================================
alter table public.whatsapp_conversations
  add column if not exists last_message_auto_replied boolean not null default false;

/*
  The bump function gains a parameter.

  DROPPED FIRST, deliberately. Adding an argument to a Postgres function creates
  an OVERLOAD rather than replacing it, and PostgREST resolving an rpc() call
  against two candidate signatures is a failure that shows up as "could not
  choose the best candidate function" at run time — i.e. on the webhook, in
  production, for one tenant. Dropping by exact signature keeps this migration
  re-runnable and leaves exactly one function.
*/
drop function if exists public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean);

create or replace function public.bump_whatsapp_conversation(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_preview text,
  p_message_at timestamptz,
  p_inbound boolean,
  p_auto_replied boolean default false
)
returns void
language sql
as $$
  update public.whatsapp_conversations
     set last_message_at    = greatest(last_message_at, p_message_at),
         last_inbound_at    = case
                                when p_inbound
                                then greatest(coalesce(last_inbound_at, p_message_at), p_message_at)
                                else last_inbound_at
                              end,
         last_message_preview = p_preview,
         unread_count       = case when p_inbound then unread_count + 1 else unread_count end,
         -- An inbound message is never an auto-reply, so arriving clears the
         -- flag: the newest thing in the thread is the candidate waiting again.
         last_message_auto_replied = case when p_inbound then false else p_auto_replied end
   where id = p_conversation_id
     and organization_id = p_organization_id;
$$;

revoke all on function
  public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean, boolean)
  from public, anon;
grant execute on function
  public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean, boolean)
  to authenticated, service_role;
