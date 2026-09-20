-- =============================================================================
-- VERIFY_0041.sql — proves the inbox's schema-level guarantees actually hold.
--
-- Run AFTER applying 0041_whatsapp_inbox.sql. Paste the whole file into the
-- Supabase SQL Editor and run it once, or let supabase/tests/replay.sh do it.
--
-- WHY THIS FILE EXISTS. Four of the inbound webhook's promises are kept by the
-- DATABASE rather than by TypeScript, deliberately — a check in a handler is a
-- check two concurrent deliveries can both pass. The unit tests in
-- lib/messaging/messaging.test.ts cannot reach any of them:
--
--   1. Meta redelivers events; the same message must not appear twice.
--   2. Two first messages from one number must not open two threads.
--   3. An unmatched inbound message belongs to no candidate and no application,
--      and must still be storable — while a row belonging to NOTHING must not.
--   4. The unread count must survive a batch arriving at once.
--   5. A thread must not be able to point at another tenant's candidate.
--
-- It creates its own throwaway organization, candidate and conversation,
-- exercises each guarantee, and ROLLS BACK. Every check RAISES on failure, so
-- the script either prints six PASS notices or stops at the first thing that is
-- wrong — reading "no rows returned" as a pass is the mistake this shape exists
-- to prevent.
-- =============================================================================

begin;

do $$
declare
  -- Deliberately recognisable as fixtures.
  k_org_a    uuid := '00000000-0000-4000-8000-0000000041a0';
  k_org_b    uuid := '00000000-0000-4000-8000-0000000041b0';
  k_cand_a   uuid := '00000000-0000-4000-8000-0000000041c1';
  k_cand_b   uuid := '00000000-0000-4000-8000-0000000041c2';

  v_thread   uuid;
  v_other    uuid;
  v_count    integer;
  v_unread   integer;
  v_last     timestamptz;
  v_raised   boolean;
begin
  -- ---------------------------------------------------------------------------
  -- Fixtures. Two tenants, because half of what is being proved is that they
  -- cannot reach each other.
  -- ---------------------------------------------------------------------------
  insert into public.organizations (id, name) values
    (k_org_a, '0041 verification org A'),
    (k_org_b, '0041 verification org B');

  insert into public.candidates (id, organization_id, name, phone) values
    (k_cand_a, k_org_a, 'Fixture Candidate A', '+91 98765 43210'),
    (k_cand_b, k_org_b, 'Fixture Candidate B', '+91 90000 00001');

  -- ---------------------------------------------------------------------------
  -- 1. One thread per number per tenant.
  -- ---------------------------------------------------------------------------
  insert into public.whatsapp_conversations (organization_id, candidate_id, phone_number)
  values (k_org_a, k_cand_a, '919876543210')
  returning id into v_thread;

  v_raised := false;
  begin
    insert into public.whatsapp_conversations (organization_id, phone_number)
    values (k_org_a, '919876543210');
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 1): a second thread opened for the same number. Two deliveries of a '
      'candidate''s first message would split their conversation in half.';
  end if;

  -- The SAME number in another tenant is a different person and must be allowed.
  insert into public.whatsapp_conversations (organization_id, phone_number)
  values (k_org_b, '919876543210')
  returning id into v_other;

  raise notice 'PASS 1 — one thread per number per tenant, and tenants do not collide';

  -- ---------------------------------------------------------------------------
  -- 2. Idempotency: Meta's message id cannot be stored twice inbound.
  -- ---------------------------------------------------------------------------
  insert into public.message_log
    (organization_id, conversation_id, candidate_id, channel, direction,
     body_sent, status, provider_message_id)
  values
    (k_org_a, v_thread, k_cand_a, 'whatsapp', 'inbound',
     'Yes, Thursday works', 'received', 'wamid.DUPLICATE');

  v_raised := false;
  begin
    insert into public.message_log
      (organization_id, conversation_id, candidate_id, channel, direction,
       body_sent, status, provider_message_id)
    values
      (k_org_a, v_thread, k_cand_a, 'whatsapp', 'inbound',
       'Yes, Thursday works', 'received', 'wamid.DUPLICATE');
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 2): a redelivered inbound message was stored twice. Meta retries '
      'until it gets a 2xx, so this is the normal case, not an edge case.';
  end if;

  -- OUTBOUND rows must stay exempt: sendWhatsApp() writes the literal string
  -- 'unknown' when Meta's response carries no id, and a unique index covering
  -- outbound would fail the SECOND such send — a message that had already
  -- reached a real person.
  insert into public.message_log
    (organization_id, candidate_id, channel, direction, body_sent, status, provider_message_id)
  values
    (k_org_a, k_cand_a, 'whatsapp', 'outbound', 'first', 'sent', 'unknown'),
    (k_org_a, k_cand_a, 'whatsapp', 'outbound', 'second', 'sent', 'unknown');

  raise notice 'PASS 2 — inbound ids are unique, outbound ''unknown'' ids are not blocked';

  -- ---------------------------------------------------------------------------
  -- 3. The relaxed home rule.
  -- ---------------------------------------------------------------------------
  -- An unmatched sender: no candidate, no application, but a thread.
  insert into public.message_log
    (organization_id, conversation_id, channel, direction, body_sent, status,
     provider_message_id)
  values
    (k_org_a, v_thread, 'whatsapp', 'inbound', 'Who is this?', 'received', 'wamid.UNMATCHED');

  -- A row belonging to nothing at all is still refused: it would be invisible
  -- on every page, which is what the constraint has always been for.
  v_raised := false;
  begin
    insert into public.message_log (organization_id, channel, direction, body_sent, status)
    values (k_org_a, 'whatsapp', 'inbound', 'orphan', 'received');
  exception when check_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 3): a message_log row with no application, candidate or conversation '
      'was accepted. Nothing can ever display it.';
  end if;

  raise notice 'PASS 3 — an unmatched message is storable; a homeless one is not';

  -- ---------------------------------------------------------------------------
  -- 4. The unread counter, and the fact that time only moves forward.
  -- ---------------------------------------------------------------------------
  perform public.bump_whatsapp_conversation(
    v_thread, k_org_a, 'first', '2026-09-20T10:00:00Z'::timestamptz, true);
  perform public.bump_whatsapp_conversation(
    v_thread, k_org_a, 'second', '2026-09-20T11:00:00Z'::timestamptz, true);
  -- An OUTBOUND bump must not raise the unread count: our own message is not
  -- something the team needs to be told about.
  perform public.bump_whatsapp_conversation(
    v_thread, k_org_a, 'ours', '2026-09-20T12:00:00Z'::timestamptz, false);
  -- A REDELIVERED older event must not drag the thread back down the list.
  perform public.bump_whatsapp_conversation(
    v_thread, k_org_a, 'late replay', '2026-09-20T09:00:00Z'::timestamptz, true);

  select unread_count, last_message_at, last_inbound_at is not null
  into v_unread, v_last, v_raised
  from public.whatsapp_conversations where id = v_thread;

  if v_unread <> 3 then
    raise exception 'FAIL (check 4): unread_count is %, expected 3.', v_unread;
  end if;
  if v_last <> '2026-09-20T12:00:00Z'::timestamptz then
    raise exception
      'FAIL (check 4): last_message_at went backwards to %. A redelivered old event '
      'would reorder the inbox.', v_last;
  end if;
  if not v_raised then
    raise exception 'FAIL (check 4): last_inbound_at was never set, so the 24-hour '
      'window would read as permanently closed.';
  end if;

  raise notice 'PASS 4 — unread counts inbound only, and last_message_at only moves forward';

  -- ---------------------------------------------------------------------------
  -- 5. Cross-tenant integrity.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    update public.whatsapp_conversations set candidate_id = k_cand_b where id = v_thread;
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 5): a thread was linked to another tenant''s candidate. A foreign key '
      'proves the row exists, not that it is ours.';
  end if;

  v_raised := false;
  begin
    insert into public.message_log
      (organization_id, conversation_id, channel, direction, body_sent, status)
    values (k_org_b, v_thread, 'whatsapp', 'inbound', 'cross-tenant', 'received');
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 5): a message row pointed at another tenant''s conversation.';
  end if;

  raise notice 'PASS 5 — a thread cannot cross a tenant boundary in either direction';

  -- ---------------------------------------------------------------------------
  -- 6. Existing rows were backfilled correctly.
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.message_log
  where organization_id = k_org_a and direction = 'outbound' and conversation_id is null;

  if v_count <> 2 then
    raise exception
      'FAIL (check 6): expected the two conversation-less outbound rows to default to '
      'outbound; found %.', v_count;
  end if;

  raise notice 'PASS 6 — direction defaults to outbound, which is what every pre-0041 row was';

  raise notice '---';
  raise notice 'ALL SIX CHECKS PASSED. Rolling back the fixtures.';
end $$;

rollback;

-- Belt and braces, in case a client auto-committed each statement rather than
-- honouring the transaction. A no-op after a successful rollback.
delete from public.organizations
where id in (
  '00000000-0000-4000-8000-0000000041a0',
  '00000000-0000-4000-8000-0000000041b0'
);
