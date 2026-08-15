-- =============================================================================
-- Read-only. Changes nothing. Run this and paste the output.
--
-- Answers the one question I cannot answer from outside: what still depends on
-- applications.stage / application_stage_history.stage, and therefore what is
-- blocking `ALTER TABLE ... ALTER COLUMN stage TYPE ...`.
-- =============================================================================

-- 1. Which enum is live right now?
select 'enum values' as check, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as result
from pg_enum e join pg_type t on t.oid = e.enumtypid
where t.typname = 'application_stage'

union all

-- 2. Does the new column exist yet?
select 'rejected_at_stage exists',
       coalesce((select 'yes' from information_schema.columns
                 where table_schema = 'public' and table_name = 'applications'
                   and column_name = 'rejected_at_stage'), 'no')

union all

-- 3. A leftover type from a half-run attempt?
select 'application_stage_next left behind',
       coalesce((select 'yes' from pg_type where typname = 'application_stage_next'), 'no')

union all

-- 4. THE IMPORTANT ONE: everything that still depends on a stage column.
--    Anything listed here must be dropped before the type can change.
select 'blocking dependency',
       coalesce(string_agg(distinct dependent.relname || ' (' || dependent.relkind || ')', ', '), 'none')
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class dependent on dependent.oid = r.ev_class
join pg_class source on source.oid = d.refobjid
join pg_attribute att
  on att.attrelid = d.refobjid and att.attnum = d.refobjsubid
where source.relname in ('applications', 'application_stage_history')
  and att.attname = 'stage'
  and dependent.relname <> source.relname;
