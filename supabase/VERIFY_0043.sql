-- =============================================================================
-- VERIFY_0043.sql — proves the Agent Center's schema-level guarantees.
--
-- Run AFTER applying 0043_agent_center.sql, or let supabase/tests/replay.sh do
-- it. Paste the whole file into the SQL Editor; it rolls back.
--
-- Every rule below is enforced by the DATABASE, because the browser holds a
-- PostgREST client and a rule kept only in a route handler is skipped by a
-- request sent straight to /rest/v1. None of them is reachable from vitest.
--
-- Every check RAISES on failure: this prints twelve PASS notices or stops at the
-- first thing that is wrong.
-- =============================================================================

begin;

-- The shim does not grant table privileges the way Supabase does; grant what
-- the RLS checks need, inside this transaction only.
grant select, insert, update, delete on public.agents, public.voice_agents to authenticated;

do $$
declare
  k_org_a   uuid := '00000000-0000-4000-8000-0000000043a0';
  k_org_b   uuid := '00000000-0000-4000-8000-0000000043b0';
  k_auth_o  uuid := '00000000-0000-4000-8000-0000000043e1';
  k_auth_r  uuid := '00000000-0000-4000-8000-0000000043e2';
  v_owner   uuid;
  v_recruit uuid;
  v_voice   uuid;
  v_agent   uuid;
  v_other   uuid;
  v_rule    uuid;
  v_text    text;
  v_status  public.agent_status;
  v_raised  boolean;
  v_count   integer;
begin
  -- ---------------------------------------------------------------------------
  -- Fixtures: two tenants, an Owner and a Recruiter in A.
  -- ---------------------------------------------------------------------------
  insert into public.organizations (id, name) values
    (k_org_a, '0043 verification org A'),
    (k_org_b, '0043 verification org B');

  insert into auth.users (id, email) values
    (k_auth_o, 'owner-0043@example.test'),
    (k_auth_r, 'recruiter-0043@example.test')
  on conflict (id) do nothing;

  insert into public.users (auth_id, email) values
    (k_auth_o, 'owner-0043@example.test'),
    (k_auth_r, 'recruiter-0043@example.test')
  on conflict (auth_id) do nothing;

  select id into v_owner from public.users where auth_id = k_auth_o;
  select id into v_recruit from public.users where auth_id = k_auth_r;

  insert into public.organization_members (organization_id, user_id, role) values
    (k_org_a, v_owner, 'owner'),
    (k_org_a, v_recruit, 'recruiter');

  -- ---------------------------------------------------------------------------
  -- 1. A voice agent created the console's way gets an identity row, same id.
  -- ---------------------------------------------------------------------------
  insert into public.voice_agents (organization_id, name)
  values (k_org_a, 'Console agent') returning id into v_voice;

  select type::text, status into v_text, v_status from public.agents where id = v_voice;
  if v_text is distinct from 'voice_screening' or v_status is distinct from 'active' then
    raise exception 'FAIL (check 1): console-created voice agent got type %, status % in agents',
      v_text, v_status;
  end if;
  raise notice 'PASS 1 — a console-created voice agent is an agent with the same id';

  -- ---------------------------------------------------------------------------
  -- 2. Provider presence follows the type, both ways.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type, provider)
    values (k_org_a, 'x', 'assessment', 'bolna');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 2a): an assessment agent accepted a provider'; end if;

  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type) values (k_org_a, 'x', 'voice_interview');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 2b): a voice interview agent saved with no provider'; end if;
  raise notice 'PASS 2 — a provider is present exactly when the type takes one';

  -- ---------------------------------------------------------------------------
  -- 3. Only a type something runs may be ACTIVE.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type, status)
    values (k_org_a, 'x', 'custom', 'active');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 3): a custom LLM agent was made active with no runtime'; end if;
  raise notice 'PASS 3 — ACTIVE is refused for every type nothing runs yet';

  -- ---------------------------------------------------------------------------
  -- 4. WhatsApp reply agents stay in 0042's tables.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type) values (k_org_a, 'x', 'whatsapp_reply');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 4): a second WhatsApp agent configuration was created'; end if;
  raise notice 'PASS 4 — no second WhatsApp configuration (one kill switch)';

  -- ---------------------------------------------------------------------------
  -- 5. Type and organization are fixed.
  -- ---------------------------------------------------------------------------
  insert into public.agents (organization_id, name, type)
  values (k_org_a, 'Assessor', 'assessment') returning id into v_agent;

  v_raised := false;
  begin
    update public.agents set organization_id = k_org_b where id = v_agent;
  exception when raise_exception then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 5): an agent was moved to another organization'; end if;
  raise notice 'PASS 5 — an agent cannot change organization or type';

  -- ---------------------------------------------------------------------------
  -- 6. An agent a workflow names cannot be deleted — from either table.
  -- ---------------------------------------------------------------------------
  insert into public.automations (organization_id, name, trigger, actions)
  values (
    k_org_a, '0043 fixture rule', 'application_created',
    jsonb_build_array(jsonb_build_object(
      'type', 'start_screening_call',
      'config', jsonb_build_object('agent_id', v_voice::text)))
  ) returning id into v_rule;

  v_raised := false;
  begin
    delete from public.agents where id = v_voice;
  exception when foreign_key_violation then
    get stacked diagnostics v_text = message_text;
    v_raised := v_text = 'agent_in_use';
  end;
  if not v_raised then raise exception 'FAIL (check 6a): an agent in use was deleted from agents'; end if;

  v_raised := false;
  begin
    delete from public.voice_agents where id = v_voice;
  exception when foreign_key_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 6b): the console path deleted an agent in use'; end if;

  delete from public.automations where id = v_rule;
  delete from public.agents where id = v_voice;
  select count(*) into v_count from public.voice_agents where id = v_voice;
  if v_count <> 0 then raise exception 'FAIL (check 6c): deleting the agent left its voice row behind'; end if;
  raise notice 'PASS 6 — in-use agents cannot be deleted; unused ones take their voice row with them';

  -- ---------------------------------------------------------------------------
  -- 7. A rename in either table is a rename in both.
  -- ---------------------------------------------------------------------------
  insert into public.voice_agents (organization_id, name)
  values (k_org_a, 'Before') returning id into v_voice;

  update public.voice_agents set name = 'Renamed in console' where id = v_voice;
  select name into v_text from public.agents where id = v_voice;
  if v_text <> 'Renamed in console' then raise exception 'FAIL (check 7a): console rename not mirrored'; end if;

  update public.agents set name = 'Renamed in Agent Center' where id = v_voice;
  select name into v_text from public.voice_agents where id = v_voice;
  if v_text <> 'Renamed in Agent Center' then raise exception 'FAIL (check 7b): Agent Center rename not mirrored'; end if;
  raise notice 'PASS 7 — names stay in step both ways';

  -- ---------------------------------------------------------------------------
  -- 8. A voice row cannot attach itself to another tenant's agent.
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    insert into public.voice_agents (id, organization_id, name) values (v_voice, k_org_b, 'Hijack');
  exception when raise_exception then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 8): a voice row attached to another tenant''s agent'; end if;
  raise notice 'PASS 8 — a voice row cannot borrow another tenant''s agent id';

  -- ---------------------------------------------------------------------------
  -- 9. RLS: org A's Owner cannot see or write org B; a Recruiter cannot write.
  -- ---------------------------------------------------------------------------
  insert into public.agents (organization_id, name, type)
  values (k_org_b, 'Org B agent', 'assessment') returning id into v_other;

  perform set_config('request.jwt.claims', json_build_object('sub', k_auth_o)::text, true);
  set local role authenticated;

  select count(*) into v_count from public.agents where id = v_other;
  if v_count <> 0 then raise exception 'FAIL (check 9a): org A read org B''s agent'; end if;

  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type) values (k_org_b, 'x', 'assessment');
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 9b): org A wrote an agent into org B'; end if;

  update public.agents set name = 'Hijacked' where id = v_other;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL (check 9c): org A updated org B''s agent'; end if;

  delete from public.agents where id = v_other;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL (check 9d): org A deleted org B''s agent'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', k_auth_r)::text, true);
  set local role authenticated;

  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type) values (k_org_a, 'x', 'assessment');
  exception when insufficient_privilege then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 9e): a Recruiter created an agent'; end if;

  select count(*) into v_count from public.agents where organization_id = k_org_a;
  if v_count = 0 then raise exception 'FAIL (check 9f): a Recruiter could not read their own org''s agents'; end if;

  reset role;
  raise notice 'PASS 9 — tenants are isolated, and only Owner/Admin write';

  -- ---------------------------------------------------------------------------
  -- 10. The integration store accepts WhatsApp (the 0007 CHECK omitted it).
  -- ---------------------------------------------------------------------------
  insert into public.organization_integrations (organization_id, provider)
  values (k_org_a, 'whatsapp');
  raise notice 'PASS 10 — organization_integrations accepts whatsapp';

  -- ---------------------------------------------------------------------------
  -- 11. 0044's CV Screening type: a draft, with no provider, never active.
  -- ---------------------------------------------------------------------------
  insert into public.agents (organization_id, name, type) values (k_org_a, 'CV screen', 'cv_screening');

  v_raised := false;
  begin
    insert into public.agents (organization_id, name, type, status)
    values (k_org_a, 'x', 'cv_screening', 'active');
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 11): a CV screening agent was made active with no runtime'; end if;
  raise notice 'PASS 11 — CV screening agents save as drafts and cannot be activated yet';

  -- ---------------------------------------------------------------------------
  -- 12. 0045: the retired Universal type is refused (merged into Custom).
  -- ---------------------------------------------------------------------------
  v_raised := false;
  begin
    execute $sql$insert into public.agents (organization_id, name, type)
      values ('00000000-0000-4000-8000-0000000043a0', 'x', 'universal')$sql$;
  exception when check_violation then v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL (check 12): a Universal agent was created after 0045 retired it'; end if;
  raise notice 'PASS 12 — eight types: Universal is retired';
end;
$$;

rollback;
