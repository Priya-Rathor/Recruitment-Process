-- =============================================================================
-- 0045 — eight agent types: Universal and Custom LLM become one Custom Agent.
--
-- The product defines exactly eight agent types. "Universal" and "Custom LLM"
-- were two names for one thing — an agent defined by its own instructions,
-- run on the platform AI provider — so they are merged, not both kept:
--
--   1. every existing 'universal' agent becomes a custom agent. Its only
--      setting (instructions) is a subset of a custom agent's, so nothing is
--      lost. The immutable-type trigger is suspended for this one statement
--      and restored straight after — a migration is the one legitimate writer
--      of a type change;
--   2. 'custom_llm' is RENAMED 'custom' (a rename, so any row keeps its value);
--   3. 'universal' stays in the enum — Postgres cannot drop an enum value
--      without rebuilding every column that uses it — but a CHECK refuses it,
--      so no new row can ever use it.
--
-- Re-runnable: each step checks whether it has already happened.
-- =============================================================================

/*
  EVERY STEP IS INSIDE ONE DO BLOCK, AND THE UPDATE IS DYNAMIC SQL.

  The first version guarded a plain `update ... set type = 'custom_llm'` with an
  `exists (...)` clause. That is not a guard: Postgres casts the literal
  'custom_llm' to the enum while PARSING the statement, before any clause is
  evaluated — so once 'custom_llm' had been renamed, a re-run died with 22P02
  and the file was not re-runnable at all. Inside EXECUTE the literal is only
  parsed when the branch that needs it actually runs.

  The trigger is disabled and re-enabled inside the same block, so a failure
  anywhere can never leave it switched off.
*/
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'agent_type' and e.enumlabel = 'custom_llm'
  ) then
    alter table public.agents disable trigger trg_agents_immutable;
    execute $sql$update public.agents set type = 'custom_llm' where type = 'universal'$sql$;
    alter table public.agents enable trigger trg_agents_immutable;

    alter type public.agent_type rename value 'custom_llm' to 'custom';
  end if;

  -- Always re-enabled, even on a re-run where the branch above was skipped:
  -- this also repairs a database where the old version failed half-way.
  alter table public.agents enable trigger trg_agents_immutable;

  if not exists (select 1 from pg_constraint where conname = 'agents_universal_retired') then
    alter table public.agents
      add constraint agents_universal_retired check (type <> 'universal');
  end if;
end;
$$;
