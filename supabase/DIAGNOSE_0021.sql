-- =============================================================================
-- Read-only. Changes nothing. Run this and paste the output.
--
-- Postgres reports blockers for `ALTER COLUMN ... TYPE` ONE AT A TIME, which is
-- why this migration failed twice — a view the first time, a trigger the
-- second. This query lists them ALL at once, whatever kind they are, by walking
-- pg_depend rather than guessing at categories.
-- =============================================================================

-- 1. Which enum is live right now?
select 1 as ord, 'enum values' as check,
       string_agg(e.enumlabel, ', ' order by e.enumsortorder) as result
from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname = 'application_stage'

union all

-- 2. Has the new column landed?
select 2, 'rejected_at_stage exists',
       coalesce((select 'yes' from information_schema.columns
                 where table_schema = 'public' and table_name = 'applications'
                   and column_name = 'rejected_at_stage'), 'no')

union all

-- 3. A leftover type from a half-run attempt?
select 3, 'application_stage_next left behind',
       coalesce((select 'yes' from pg_type where typname = 'application_stage_next'), 'no')

union all

-- 4. THE IMPORTANT ONE.
--
--    Every object that depends on applications.stage or
--    application_stage_history.stage, of ANY kind — views and rules
--    (pg_rewrite), triggers (pg_trigger), policies (pg_policy), constraints
--    (pg_constraint), defaults (pg_attrdef). Each one must be dropped before
--    the type can change, and recreated after.
--
--    `none` here means nothing is blocking and the migration should run clean.
select 4, 'blocking dependencies',
       coalesce(
         string_agg(distinct kind || ': ' || name, ', ' order by kind || ': ' || name),
         'none'
       )
from (
  select 'view/rule' as kind, c.relname::text as name
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
  join pg_class c on c.oid = r.ev_class
  join pg_class src on src.oid = d.refobjid
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where src.relname in ('applications', 'application_stage_history')
    and a.attname = 'stage' and c.relname <> src.relname

  union all

  select 'trigger', t.tgname::text
  from pg_depend d
  join pg_trigger t on t.oid = d.objid and d.classid = 'pg_trigger'::regclass
  join pg_class src on src.oid = d.refobjid
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where src.relname in ('applications', 'application_stage_history')
    and a.attname = 'stage'

  union all

  select 'policy', p.polname::text
  from pg_depend d
  join pg_policy p on p.oid = d.objid and d.classid = 'pg_policy'::regclass
  join pg_class src on src.oid = d.refobjid
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where src.relname in ('applications', 'application_stage_history')
    and a.attname = 'stage'

  union all

  select 'constraint', con.conname::text
  from pg_depend d
  join pg_constraint con on con.oid = d.objid and d.classid = 'pg_constraint'::regclass
  join pg_class src on src.oid = d.refobjid
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where src.relname in ('applications', 'application_stage_history')
    and a.attname = 'stage'
) as blockers

order by ord;
