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

alter table public.agents disable trigger trg_agents_immutable;

update public.agents set type = 'custom_llm' where type = 'universal'
  and exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'agent_type' and e.enumlabel = 'custom_llm'
  );

alter table public.agents enable trigger trg_agents_immutable;

do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'agent_type' and e.enumlabel = 'custom_llm'
  ) then
    alter type public.agent_type rename value 'custom_llm' to 'custom';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'agents_universal_retired') then
    alter table public.agents
      add constraint agents_universal_retired check (type <> 'universal');
  end if;
end;
$$;
