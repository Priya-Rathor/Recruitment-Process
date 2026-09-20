-- =============================================================================
-- 0041 — WhatsApp inbox: inbound messages, conversations, real delivery status.
--
-- Module 15 shipped a one-way pipe. message_log recorded what this product SAID
-- to a candidate; nothing recorded what they said back, because there was no
-- inbound webhook. lib/integrations/whatsapp/index.ts states that limitation in
-- its own header ("OPT-OUT IS 'REPLY STOP', AND NOBODY IS LISTENING YET") and it
-- had two consequences worth naming:
--
--   1. A candidate who replied STOP was only honoured if a human happened to
--      read the reply on their phone and record it on the candidate page.
--   2. `opened` was documented as "email only; WhatsApp gives us no read signal
--      we trust" — true only because nothing was receiving Meta's status
--      callbacks. Those callbacks are exactly a delivery and read signal, and
--      they are now consumed.
--
-- EXTENDS message_log RATHER THAN ADDING A SECOND TABLE.
--
-- A conversation is one timeline. Storing what we sent in message_log and what
-- they replied in a separate table would mean every read of "what happened
-- between us and this person" is a UNION that two future authors will write
-- differently, and one of them will forget to filter organization_id. So an
-- inbound message is a message_log row with direction = 'inbound', and the
-- existing indexes, RLS, tenant-integrity trigger and masking all apply to it
-- unchanged.
--
-- THE CHECK CONSTRAINT HAD TO BE RELAXED, AND THAT IS THE INTERESTING PART.
--
-- message_log_has_a_subject required application_id or candidate_id, because a
-- row belonging to neither could not be displayed anywhere. An inbound message
-- from a number nobody recognises belongs to neither — and dropping it is not an
-- option (it may be a candidate texting from a second phone, or a wrong number
-- that a recruiter needs to see once to dismiss). A conversation is a third
-- valid home for such a row, so the constraint now admits it. The invariant is
-- unchanged in spirit: every row is reachable from some page.
-- =============================================================================

-- =============================================================================
-- Enums
-- =============================================================================

/*
  Direction.

  Defaulted to 'outbound' so the backfill of existing rows is the correct answer
  rather than a guess: before this migration, every row in message_log was
  something this product sent.
*/
do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_direction') then
    create type public.message_direction as enum ('outbound', 'inbound');
  end if;
end $$;

/*
  'received' — the status of an inbound message.

  NOT 'delivered'. The existing statuses all describe how far something WE sent
  got; reusing one of them for a message somebody sent US would put a green
  "Delivered" chip on a candidate's own reply, which reads as a claim about our
  delivery rather than a fact about theirs.

  Added with ALTER TYPE rather than by recreating the enum, so existing rows and
  the columns that reference it are untouched. Nothing in this file may USE the
  new value: Postgres forbids reading an enum value added in the same
  transaction, and the SQL Editor runs a script as one.
*/
alter type public.message_status add value if not exists 'received';

-- =============================================================================
-- whatsapp_conversations
--
-- One row per (organization, phone number). The inbox's left pane.
--
-- KEYED ON THE PHONE NUMBER, NOT THE CANDIDATE, and that is deliberate: the
-- number is what Meta gives us and the only thing known at the moment a stranger
-- texts in. candidate_id is an ANNOTATION on the conversation — filled when we
-- recognise the number, filled later by a human through "Link to candidate", and
-- null in between. Keying on the candidate would have left nowhere to put an
-- unmatched message, which is the case this table mostly exists to handle.
-- =============================================================================
create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /*
    NULL means "we do not know who this is" — an unmatched sender.

    ON DELETE SET NULL, not CASCADE. Deleting a candidate must not silently erase
    the record of a conversation that happened; it becomes an unmatched thread,
    which is the truth (we no longer know who that number belongs to) rather than
    a hole. The message rows themselves still cascade with the candidate, which is
    what the privacy module's erasure path requires.
  */
  candidate_id uuid references public.candidates (id) on delete set null,

  /*
    Digits only, country code included, no '+' — exactly the form
    normalizeWhatsAppNumber() produces and Meta expects. Stored normalised so the
    webhook's lookup is an index hit rather than a scan with a format guess, and
    so "+91 98765 43210" and "919876543210" can never open two threads.
  */
  phone_number text not null check (phone_number ~ '^[0-9]{7,15}$'),

  last_message_at timestamptz not null default now(),

  /*
    Separate from last_message_at because the two answer different questions and
    only this one can answer Meta's.

    Meta permits free-form text only within 24 hours of the candidate's last
    INBOUND message; an outbound message does not reopen that window. A single
    last_message_at would make a thread we just wrote to look repliable when it is
    not. Null means they have never written to us.
  */
  last_inbound_at timestamptz,

  -- Truncated at write time, not at render time: the list reads 200 rows and
  -- has no business pulling 200 message bodies to show one line of each.
  last_message_preview text,

  /*
    Inbound messages nobody on the team has opened yet.

    Per ORGANIZATION, not per user. This is a shared inbox — if a colleague has
    already answered the candidate, the thread is handled, and showing it as
    still-unread to everyone else would have three people answering it.
  */
  unread_count integer not null default 0 check (unread_count >= 0),

  created_at timestamptz not null default now(),

  /*
    One thread per number per tenant.

    A unique constraint rather than "check then insert" in the webhook: Meta
    retries, and two deliveries of the same first message arriving together would
    otherwise open two threads through a TOCTOU race that no amount of care in
    TypeScript can close. The webhook upserts onto this constraint.
  */
  unique (organization_id, phone_number)
);

create index if not exists idx_whatsapp_conversations_recent
  on public.whatsapp_conversations (organization_id, last_message_at desc);

create index if not exists idx_whatsapp_conversations_candidate
  on public.whatsapp_conversations (candidate_id)
  where candidate_id is not null;

-- =============================================================================
-- message_log — the inbound half
-- =============================================================================

alter table public.message_log
  add column if not exists direction public.message_direction not null default 'outbound';

alter table public.message_log
  add column if not exists conversation_id uuid
    references public.whatsapp_conversations (id) on delete cascade;

/*
  The relaxed home rule. See this file's header.

  Dropped and recreated rather than added alongside: two overlapping CHECKs with
  similar names is how a later reader concludes the stricter one is dead and
  removes the wrong one.
*/
alter table public.message_log
  drop constraint if exists message_log_has_a_subject;

alter table public.message_log
  add constraint message_log_has_a_subject check (
    application_id is not null
    or candidate_id is not null
    or conversation_id is not null
  );

create index if not exists idx_message_log_conversation
  on public.message_log (conversation_id, created_at)
  where conversation_id is not null;

/*
  IDEMPOTENCY, enforced by the database rather than by the handler.

  Meta redelivers a webhook event until it gets a 2xx, and a retry after a slow
  write is the normal case, not the rare one. The handler checks for an existing
  row first — but check-then-insert across two statements is the same TOCTOU race
  AGENTS.md names, and two concurrent redeliveries would both pass the check.

  INBOUND ONLY. Outbound rows cannot join this index: sendWhatsApp() stores the
  literal string 'unknown' when Meta's response carries no message id, so a
  second such send would collide and a UNIQUE violation would fail a message that
  had already reached a real person. Narrowing the index to inbound makes the
  guarantee exactly as wide as the fact that supports it.
*/
create unique index if not exists idx_message_log_inbound_provider_id
  on public.message_log (organization_id, provider_message_id)
  where direction = 'inbound' and provider_message_id is not null;

/*
  Outbound status callbacks arrive keyed by Meta's message id and nothing else,
  so the lookup that finds the row to update needs its own index. Partial, because
  the vast majority of rows are email and can never be the target.
*/
create index if not exists idx_message_log_provider_id
  on public.message_log (organization_id, provider_message_id)
  where provider_message_id is not null;

-- =============================================================================
-- Cross-tenant integrity.
--
-- Extends 0035's trigger rather than adding a second one. A foreign key proves
-- the conversation exists, not that it is OURS — without this, a log row could
-- point at another tenant's thread and surface in their inbox.
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

  -- 0041.
  if new.conversation_id is not null then
    if not exists (
      select 1 from public.whatsapp_conversations w
      where w.id = new.conversation_id and w.organization_id = new.organization_id
    ) then
      raise exception 'Conversation does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_message_log_tenant_integrity() from public, anon;

-- Recreated so conversation_id joins the UPDATE OF list; without it, moving a row
-- into another tenant's thread would not re-run the check.
drop trigger if exists trg_message_log_tenant_integrity on public.message_log;
create trigger trg_message_log_tenant_integrity
  before insert or update of
    application_id, candidate_id, template_id, conversation_id, organization_id
  on public.message_log
  for each row execute function public.enforce_message_log_tenant_integrity();

create or replace function public.enforce_whatsapp_conversation_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.candidate_id is not null then
    if not exists (
      select 1 from public.candidates c
      where c.id = new.candidate_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Candidate does not belong to this organization';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_whatsapp_conversation_tenant_integrity()
  from public, anon;

drop trigger if exists trg_whatsapp_conversations_tenant_integrity
  on public.whatsapp_conversations;
create trigger trg_whatsapp_conversations_tenant_integrity
  before insert or update of candidate_id, organization_id
  on public.whatsapp_conversations
  for each row execute function public.enforce_whatsapp_conversation_tenant_integrity();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.whatsapp_conversations enable row level security;

/**
 * Every member reads.
 *
 * DELIBERATELY ORG-WIDE, matching message_log's own SELECT policy and the
 * pipeline board. The "a Recruiter only sees conversations for candidates on
 * their assigned applications" rule is a SCOPING rule applied in the query
 * (lib/messaging/queries.ts), exactly as getBoard() applies it — it decides what
 * is useful to show, not what is safe to show. The tenant is the security
 * boundary here; a Recruiter can already read every message_log row in their own
 * organization through PostgREST, and pretending otherwise in one table while
 * leaving the other open would be a comforting lie.
 */
drop policy if exists whatsapp_conversations_select_member on public.whatsapp_conversations;
create policy whatsapp_conversations_select_member on public.whatsapp_conversations
  for select using (public.is_org_member(organization_id));

/**
 * Owner/Admin/Recruiter insert and update. NOBODY deletes.
 *
 * INSERT is needed because a thread is not only opened by an inbound message: a
 * recruiter sending the first WhatsApp to a candidate opens one too, through
 * their own session, from lib/messaging/thread.ts. Requiring the service role
 * for that would mean the send pipeline holding a privileged client to write a
 * row the caller is perfectly entitled to write.
 *
 * UPDATE covers the two edits a person makes — "link this number to a candidate"
 * and "mark this thread read" — plus the bump that follows an outbound message.
 *
 * NO DELETE POLICY, for the reason message_log has none: a thread with a real
 * person in it is a record of what was said, and an Owner being able to erase it
 * is the outcome most of this schema's constraints exist to prevent.
 *
 * Viewer is absent from both. A Viewer reads the inbox and cannot reply, so they
 * have nothing to write — and "mark as read" is a write, which is why the inbox
 * does not offer it to them rather than offering it and failing.
 *
 * WITH CHECK repeats the role test against the NEW row so organization_id cannot
 * be edited into a tenant the caller does not belong to — the same shape
 * migration 0035 uses on message_templates, and the reason it is there.
 */
drop policy if exists whatsapp_conversations_insert_staff on public.whatsapp_conversations;
create policy whatsapp_conversations_insert_staff on public.whatsapp_conversations
  for insert with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

drop policy if exists whatsapp_conversations_update_staff on public.whatsapp_conversations;
create policy whatsapp_conversations_update_staff on public.whatsapp_conversations
  for update using (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  ) with check (
    public.has_org_role(organization_id, array['owner', 'admin', 'recruiter']::public.org_role[])
  );

-- =============================================================================
-- bump_whatsapp_conversation
--
-- One statement, because "read the count, add one, write it back" across two
-- statements loses a message whenever two arrive together — and Meta delivers in
-- batches, so they do. AGENTS.md names this race for the "always at least one
-- Owner" invariant; a badge that reads 2 when three people wrote is the same bug
-- with a smaller blast radius, and the same fix.
--
-- last_message_at only ever moves FORWARD (greatest), because Meta redelivers
-- and its batches are not ordered. An older event arriving second must not drag
-- a thread back down the list.
--
-- SECURITY DEFINER with organization_id as an argument would be exactly the
-- "database function that accepts a tenant from the browser" that Module 15's
-- own migration forbids. It is NOT security definer: it runs with the caller's
-- rights, so the service-role webhook can call it and a browser cannot reach
-- past its own RLS policies. The organization_id argument is a filter for
-- safety-in-depth, not the authorisation.
-- =============================================================================
create or replace function public.bump_whatsapp_conversation(
  p_conversation_id uuid,
  p_organization_id uuid,
  p_preview text,
  p_message_at timestamptz,
  p_inbound boolean
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
         unread_count       = case when p_inbound then unread_count + 1 else unread_count end
   where id = p_conversation_id
     and organization_id = p_organization_id;
$$;

revoke all on function public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean)
  from public, anon;
grant execute on function public.bump_whatsapp_conversation(uuid, uuid, text, timestamptz, boolean)
  to authenticated, service_role;
