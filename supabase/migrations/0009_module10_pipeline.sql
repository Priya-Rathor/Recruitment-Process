-- =============================================================================
-- Module 10: Advanced Pipeline
--
-- The board itself needs no new tables — it reads and writes applications.stage
-- and application_stage_history, both from Module 5, and stage transitions are
-- already recorded by that module's trigger.
--
-- The one thing this module owns is the SLA configuration.
--
-- FORWARD STUB (spec): "Module 17's dedicated Pipeline Settings page doesn't
-- exist yet, so this module both creates and provides a basic edit UI for
-- pipeline_sla_config directly."
--
-- RETROFIT (spec): "When Module 17 ships /settings/pipeline, point its UI at
-- this same pipeline_sla_config table — do not create a second, duplicate SLA
-- settings table."
-- =============================================================================

create table if not exists public.pipeline_sla_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  stage public.application_stage not null,

  -- Days an application may sit in this stage before it needs attention.
  target_days integer not null check (target_days >= 0 and target_days <= 365),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One target per stage per organization. Absent rows fall back to the
  -- defaults in lib/pipeline/sla.ts rather than meaning "no SLA".
  unique (organization_id, stage)
);

create index if not exists idx_pipeline_sla_config_organization_id
  on public.pipeline_sla_config (organization_id);
create index if not exists idx_pipeline_sla_config_org_stage
  on public.pipeline_sla_config (organization_id, stage);

drop trigger if exists trg_pipeline_sla_config_touch on public.pipeline_sla_config;
create trigger trg_pipeline_sla_config_touch
  before update on public.pipeline_sla_config
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================

alter table public.pipeline_sla_config enable row level security;

-- Every member reads it: the board shows aging to everyone who can see the
-- board, including Viewer.
drop policy if exists pipeline_sla_config_select_member on public.pipeline_sla_config;
create policy pipeline_sla_config_select_member on public.pipeline_sla_config
  for select using (public.is_org_member(organization_id));

-- Editing SLA targets is a configuration change, so Owner/Admin only. Note this
-- is narrower than "move applications between stages", which Recruiters may do:
-- changing the yardstick everyone is measured against is a different act from
-- doing the work.
drop policy if exists pipeline_sla_config_write_owner_admin on public.pipeline_sla_config;
create policy pipeline_sla_config_write_owner_admin on public.pipeline_sla_config
  for all
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- =============================================================================
-- Board performance
--
-- The board groups every live application by stage and sorts by how long it has
-- been sitting. Module 5 already indexes (organization_id, stage, updated_at);
-- this adds the partial index for the "open board" case, which excludes
-- archived rows and terminal stages.
-- =============================================================================
create index if not exists idx_applications_open_board
  on public.applications (organization_id, stage, updated_at)
  where archived_at is null
    and stage not in ('hired', 'rejected', 'withdrawn');
