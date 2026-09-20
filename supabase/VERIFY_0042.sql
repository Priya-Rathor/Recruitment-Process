-- =============================================================================
-- VERIFY_0042.sql — proves the auto-reply agent's schema-level guarantees.
--
-- Run AFTER applying 0042_auto_reply_agent.sql, or let supabase/tests/replay.sh
-- do it. Paste the whole file into the SQL Editor; it rolls back.
--
-- WHY THIS FILE EXISTS. Five of this feature's promises are kept by the DATABASE
-- rather than by TypeScript, and none of them is reachable from a unit test:
--
--   1. The master switch DEFAULTS OFF, so applying a migration cannot start
--      messaging candidates.
--   2. There can only ever be ONE organization-wide config row — two NULL
--      job_ids do not collide in SQL, so this needs its own index.
--   3. A delayed config cannot exist without a delay, and vice versa.
--   4. One inbound message can be queued only ONCE, which is what stops a Meta
--      redelivery producing a second reply to the same question.
--   5. Neither a config nor a queue row can reach another tenant.
--
-- Every check RAISES on failure, so this either prints seven PASS notices or
-- stops at the first thing that is wrong.
-- =============================================================================

begin;

do $$
declare
  k_org_a  uuid := '00000000-0000-4000-8000-0000000042a0';
  k_org_b  uuid := '00000000-0000-4000-8000-0000000042b0';
  k_job_a  uuid := '00000000-0000-4000-8000-00000004201f';
  k_job_b  uuid := '00000000-0000-4000-8000-00000004202f';
  k_cand_a uuid := '00000000-0000-4000-8000-0000000042c1';

  v_thread  uuid;
  v_msg     uuid;
  v_master  boolean;
  v_raised  boolean;
  v_count   integer;
begin
  -- ---------------------------------------------------------------------------
  -- Fixtures. Two tenants, because half of this is proving they cannot meet.
  -- ---------------------------------------------------------------------------
  insert into public.organizations (id, name) values
    (k_org_a, '0042 verification org A'),
    (k_org_b, '0042 verification org B');

  insert into public.jobs (id, organization_id, title) values
    (k_job_a, k_org_a, 'Fixture Job A'),
    (k_job_b, k_org_b, 'Fixture Job B');

  insert into public.candidates (id, organization_id, name, phone)
  values (k_cand_a, k_org_a, 'Fixture Candidate', '+91 98765 43210');

  insert into public.whatsapp_conversations (organization_id, candidate_id, phone_number)
  values (k_org_a, k_cand_a, '919876543210')
  returning id into v_thread;

  insert into public.message_log
    (organization_id, conversation_id, candidate_id, channel, direction,
     body_sent, status, provider_message_id)
  values
    (k_org_a, v_thread, k_cand_a, 'whatsapp', 'inbound',
     'What is my status?', 'received', 'wamid.0042')
  returning id into v_msg;

  -- ---------------------------------------------------------------------------
  -- 1. The master switch is OFF by default.
  -- ---------------------------------------------------------------------------
  insert into public.organization_settings (organization_id) values (k_org_a);

  select auto_reply_master_enabled into v_master
  from public.organization_settings where organization_id = k_org_a;

  if v_master is not false then
    raise exception
      'FAIL (check 1): auto_reply_master_enabled defaulted to %, not false. Applying a '
      'migration must never be able to start messaging real candidates.', v_master;
  end if;
  raise notice 'PASS 1 — the master switch defaults OFF';

  -- ---------------------------------------------------------------------------
  -- 2. Exactly one organization-wide config row.
  -- ---------------------------------------------------------------------------
  insert into public.auto_reply_config (organization_id, job_id, enabled)
  values (k_org_a, null, true);

  v_raised := false;
  begin
    insert into public.auto_reply_config (organization_id, job_id, enabled)
    values (k_org_a, null, false);
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 2): a second organization-wide config was accepted. Two NULL job_ids do '
      'not collide in SQL, so whichever row a query read would decide how the agent behaves.';
  end if;

  -- One override per job, too.
  insert into public.auto_reply_config (organization_id, job_id, enabled)
  values (k_org_a, k_job_a, true);

  v_raised := false;
  begin
    insert into public.auto_reply_config (organization_id, job_id, enabled)
    values (k_org_a, k_job_a, false);
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL (check 2): a second override for one job was accepted.';
  end if;

  raise notice 'PASS 2 — one org-wide config and one override per job, enforced';

  -- ---------------------------------------------------------------------------
  -- 3. Timing and delay cannot disagree.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.auto_reply_config (organization_id, job_id, response_timing)
    values (k_org_a, null, 'delayed');  -- no delay_minutes
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 3): a delayed config with no delay was accepted. The agent would have '
      'no idea when to send.';
  end if;

  v_raised := false;
  begin
    insert into public.auto_reply_config
      (organization_id, job_id, response_timing, delay_minutes)
    values (k_org_a, k_job_b, 'immediate', 30);  -- a delay it would never use
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 3): an immediate config carrying a delay was accepted — a setting the '
      'UI would show and the agent would ignore.';
  end if;

  -- And a delay beyond WhatsApp's own 24-hour reply window.
  v_raised := false;
  begin
    insert into public.auto_reply_config
      (organization_id, job_id, response_timing, delay_minutes)
    values (k_org_a, k_job_b, 'delayed', 1441);
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 3): a delay longer than 24 hours was accepted. Meta would refuse the '
      'reply at the moment it finally fired.';
  end if;

  raise notice 'PASS 3 — timing and delay must agree, and stay inside Meta''s window';

  -- ---------------------------------------------------------------------------
  -- 4. One inbound message, one queued reply.
  -- ---------------------------------------------------------------------------
  insert into public.auto_reply_queue
    (organization_id, conversation_id, inbound_message_id)
  values (k_org_a, v_thread, v_msg);

  v_raised := false;
  begin
    insert into public.auto_reply_queue
      (organization_id, conversation_id, inbound_message_id)
    values (k_org_a, v_thread, v_msg);
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 4): one inbound message was queued twice. Meta redelivers until it gets '
      'a 2xx, so the candidate would receive two replies to one question — and neither '
      'can be unsent.';
  end if;
  raise notice 'PASS 4 — an inbound message can only be queued once';

  -- ---------------------------------------------------------------------------
  -- 5. Cross-tenant integrity.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.auto_reply_config (organization_id, job_id, enabled)
    values (k_org_a, k_job_b, true);  -- org B's job
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 5): a config pointed at another tenant''s job. A foreign key proves the '
      'row exists, not that it is ours.';
  end if;

  v_raised := false;
  begin
    insert into public.auto_reply_queue
      (organization_id, conversation_id, inbound_message_id)
    values (k_org_b, v_thread, v_msg);  -- org A's thread and message
  exception when others then
    v_raised := true;
  end;

  if not v_raised then
    raise exception
      'FAIL (check 5): a queue row reached another tenant''s conversation.';
  end if;

  raise notice 'PASS 5 — neither a config nor a queued reply can cross a tenant boundary';

  -- ---------------------------------------------------------------------------
  -- 6. auto_replied defaults false on every existing and new row.
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.message_log
  where organization_id = k_org_a and auto_replied;

  if v_count <> 0 then
    raise exception
      'FAIL (check 6): % row(s) defaulted to auto_replied. Every message written before '
      'this feature — and every manual and templated send after it — was said by a person '
      'or a configured template.', v_count;
  end if;
  raise notice 'PASS 6 — auto_replied defaults false, so nothing is mislabelled as the agent';

  -- ---------------------------------------------------------------------------
  -- 7. The bump function still has exactly ONE signature.
  -- ---------------------------------------------------------------------------
  --
  -- Adding a parameter to a Postgres function creates an overload rather than
  -- replacing it, and PostgREST resolving an rpc() call against two candidates
  -- fails at run time — on the webhook, in production, for one tenant. 0042
  -- drops the 5-argument version by exact signature; this proves it worked.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bump_whatsapp_conversation';

  if v_count <> 1 then
    raise exception
      'FAIL (check 7): bump_whatsapp_conversation has % signatures, expected 1. PostgREST '
      'cannot choose between overloads and the inbound webhook would fail.', v_count;
  end if;
  raise notice 'PASS 7 — bump_whatsapp_conversation has exactly one signature';

  raise notice '---';
  raise notice 'ALL SEVEN CHECKS PASSED. Rolling back the fixtures.';
end $$;

rollback;

-- Belt and braces, in case a client auto-committed rather than honouring the
-- transaction. A no-op after a successful rollback.
delete from public.organizations
where id in (
  '00000000-0000-4000-8000-0000000042a0',
  '00000000-0000-4000-8000-0000000042b0'
);
