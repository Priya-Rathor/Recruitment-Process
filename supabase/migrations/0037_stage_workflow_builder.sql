-- =============================================================================
-- Module 25 — Stage Workflow Builder
--
-- This migration adds NO new engine, NO new pipeline, and NO new stage.
--
-- It does three things:
--
--   1. Gives `automations` enough provenance to say "this rule belongs to
--      job X, stage Y, branch Z". A stage workflow IS an automations row. The
--      Automations settings page keeps listing it, the run history keeps
--      recording it, and the engine keeps executing it — the builder is a
--      second, stage-centric editor for rows that already had a home.
--
--   2. Adds the Not Shortlisted flag to `applications`. NOT a stage, NOT a
--      status enum value: three nullable columns. The 8-stage structure
--      (lib/applications/stages.ts) is untouched, so Analytics funnels, SLA
--      config and job_hiring_stages toggles all keep working unchanged.
--
--   3. Records which branch a run took, so "why did this email go out?" has an
--      answer in the run history rather than only in the rule.
--
-- WHY PROVENANCE COLUMNS RATHER THAN A SEPARATE TABLE.
--
-- A `stage_workflows` table would have needed its own actions column, its own
-- validation, its own executor and its own run log — four copies of Module 13
-- that would drift from the original within one release. The brief is explicit
-- that this "connects [the modules], it does not replace any of them", so the
-- rows stay where the engine already looks for them and the new columns only
-- answer "who is editing this, and from where".
-- =============================================================================

-- =============================================================================
-- automations — provenance
-- =============================================================================

alter table public.automations
  -- NULL means org-wide, which is what every rule written before this migration
  -- is. A stage workflow always names its job: the same stage on two jobs is two
  -- independent workflows, because the whole point is that a Senior Engineer
  -- pipeline can email different words than a Support pipeline.
  add column if not exists job_id uuid references public.jobs (id) on delete cascade,

  -- Which pipeline stage this fires on. Deliberately plain text validated
  -- against lib/applications/stages.ts, matching how `trigger` is stored: a new
  -- stage would then be a catalogue change, not a migration. NULL for org-wide
  -- rules that are not attached to a stage at all.
  add column if not exists stage_key text,

  -- 'always' for a stage with no pass/fail concept, 'pass'/'fail' for the two
  -- branches of a scored stage. An 'always' rule fires on every entry into the
  -- stage; a branch rule fires only when the engine dispatched that outcome.
  add column if not exists branch text not null default 'always'
    check (branch in ('always', 'pass', 'fail')),

  -- How this rule is edited. 'stage_workflow' rows are owned by the builder and
  -- round-tripped by it; 'manual' rows are the Module 13 builder's. Kept so the
  -- Automations page can label where a rule came from instead of showing a list
  -- where half the rows cannot be edited where they appear.
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'stage_workflow'));

comment on column public.automations.job_id is
  'Job this rule is scoped to. NULL = organization-wide (every rule before Module 25).';
comment on column public.automations.stage_key is
  'Pipeline stage this rule is attached to. Validated in lib/applications/stages.ts.';
comment on column public.automations.branch is
  'always | pass | fail. Branch rules fire only when the engine dispatched that outcome.';
comment on column public.automations.source is
  'manual = Module 13 builder. stage_workflow = the per-stage builder on the job page.';

-- One workflow row per job + stage + branch. A second row for the same slot
-- would make "the actions on this stage" depend on row order, which is the
-- ambiguity the builder's ordered action list exists to remove.
--
-- Partial, so it constrains ONLY builder-owned rows: an admin may still write as
-- many org-wide Module 13 rules against the same stage as they like.
create unique index if not exists uq_automations_stage_workflow_slot
  on public.automations (job_id, stage_key, branch)
  where source = 'stage_workflow';

-- The dispatch query gains a job filter: "active rules for this trigger, that
-- are either org-wide or scoped to this application's job".
create index if not exists idx_automations_job_stage
  on public.automations (organization_id, job_id, stage_key)
  where status = 'active';

/**
 * THE UNIQUE (organization_id, name) CONSTRAINT IS THE REASON FOR THIS BLOCK.
 *
 * Module 13 named rules uniquely per organization, which is right for
 * hand-written rules a person has to find in a list. A stage workflow's name is
 * generated ("Shortlisted — On Pass"), and the same stage on two different jobs
 * would generate the same name and collide on save — the builder would refuse to
 * create a workflow on the second job for a reason that has nothing to do with
 * anything the user did.
 *
 * The constraint is replaced with one that treats a builder-owned row's name as
 * unique within its JOB. Hand-written rules keep exactly the old guarantee,
 * because their job_id is NULL and the two partial indexes below are disjoint.
 */
alter table public.automations
  drop constraint if exists automations_organization_id_name_key;

create unique index if not exists uq_automations_org_name_global
  on public.automations (organization_id, name)
  where job_id is null;

create unique index if not exists uq_automations_org_job_name
  on public.automations (organization_id, job_id, name)
  where job_id is not null;

/**
 * A stage workflow must name its stage; an org-wide rule must not name a job it
 * is not scoped to. Enforced in the database rather than only in the API for the
 * standing reason in AGENTS.md: the browser holds an authenticated PostgREST
 * client, so a rule inserted directly would otherwise skip every check the route
 * makes.
 */
alter table public.automations
  drop constraint if exists automations_stage_workflow_shape;

alter table public.automations
  add constraint automations_stage_workflow_shape check (
    source <> 'stage_workflow'
    or (job_id is not null and stage_key is not null)
  );

-- =============================================================================
-- automation_runs — which branch ran
-- =============================================================================

alter table public.automation_runs
  add column if not exists branch text not null default 'always'
    check (branch in ('always', 'pass', 'fail'));

comment on column public.automation_runs.branch is
  'The outcome branch this run was dispatched for. Answers "why did this fire?".';

-- =============================================================================
-- message_log — who a message actually went to
--
-- Module 25 lets a stage workflow send a templated message to a COLLEAGUE about
-- a candidate ("Rahul just passed the assessment with 82%"). The row keeps its
-- candidate_id, because the message is part of that application's story and the
-- communication history is where somebody goes to find out what happened.
--
-- Without this column that row would be indistinguishable from a message the
-- CANDIDATE received. "We told them on the 4th" would then be a false statement
-- generated from a true row — the worst kind, because nothing looks wrong.
-- =============================================================================

alter table public.message_log
  add column if not exists internal_recipient_user_id uuid
    references public.users (id) on delete set null;

comment on column public.message_log.internal_recipient_user_id is
  'Set when this message went to a colleague ABOUT the candidate, not to the '
  'candidate. NULL = a candidate-facing message, which is every row before '
  'Module 25.';

create index if not exists idx_message_log_internal_recipient
  on public.message_log (organization_id, internal_recipient_user_id)
  where internal_recipient_user_id is not null;

-- =============================================================================
-- applications — the Not Shortlisted flag
--
-- THIS IS NOT A STAGE AND NOT A REJECTION.
--
-- The brief is explicit: an automatic screen-out is "distinct from Rejected,
-- since this was an automatic screen-out rather than a human decision after
-- review", and it "must remain visible and reversible by a human, never a hard
-- rejection with no way back".
--
-- So the application STAYS in whatever stage it was in (Applied), keeps its row
-- on the pipeline board, and carries a flag. Three consequences fall out of that
-- choice, all of them wanted:
--
--   - public.application_stage is untouched, so the funnel in Module 16, the SLA
--     config in Module 10 and the stage toggles in job_hiring_stages all keep
--     working with no retrofit at all.
--   - Clearing the flag is a single UPDATE to NULL. There is no stage to move
--     back to and no history entry to unpick, which is what makes "reversible"
--     true rather than aspirational.
--   - The board can show the card with a marker instead of hiding it, so an
--     over-aggressive threshold is visible as a column full of flags rather than
--     as candidates who quietly stopped appearing.
-- =============================================================================

alter table public.applications
  add column if not exists not_shortlisted_at timestamptz,

  -- The score that failed, frozen at the moment of the decision. Read from
  -- match_score at flag time rather than joined at read time, because match_score
  -- is recalculated and a later recalculation would rewrite the history of a
  -- decision that was made on the old number.
  add column if not exists not_shortlisted_score numeric(5, 2)
    check (not_shortlisted_score is null
           or (not_shortlisted_score >= 0 and not_shortlisted_score <= 100)),

  -- The threshold it was measured against, for the same reason. "62% did not
  -- reach 70%" is a complete explanation; "62%" on its own is not.
  add column if not exists not_shortlisted_threshold numeric(5, 2)
    check (not_shortlisted_threshold is null
           or (not_shortlisted_threshold >= 0 and not_shortlisted_threshold <= 100)),

  add column if not exists not_shortlisted_reason text
    check (not_shortlisted_reason is null or length(not_shortlisted_reason) <= 500);

comment on column public.applications.not_shortlisted_at is
  'Set by the AI Resume Shortlisting action on a fail. NOT a rejection: the '
  'application keeps its stage and stays on the board. NULL = not flagged, and '
  'setting it back to NULL is how a human reverses the automatic screen-out.';

-- The board and the "show me what the screen rejected" filter both ask for
-- flagged rows within an organization.
create index if not exists idx_applications_not_shortlisted
  on public.applications (organization_id, not_shortlisted_at)
  where not_shortlisted_at is not null;

/**
 * The flag may never coexist with a terminal stage.
 *
 * "Not Shortlisted" means "the automatic screen said no, and a human has not
 * looked yet". Once somebody rejects the application, the human decision is the
 * one that stands and the flag becomes a second, contradictory answer to the
 * same question. Clearing it on the way into a terminal stage is done by the
 * trigger below rather than refused, because refusing would block a legitimate
 * rejection behind an unrelated tidy-up.
 */
create or replace function public.clear_not_shortlisted_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage in ('rejected', 'withdrawn', 'hired')
     and new.not_shortlisted_at is not null then
    new.not_shortlisted_at := null;
    new.not_shortlisted_score := null;
    new.not_shortlisted_threshold := null;
    new.not_shortlisted_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_applications_clear_not_shortlisted on public.applications;
create trigger trg_applications_clear_not_shortlisted
  before insert or update of stage, not_shortlisted_at on public.applications
  for each row execute function public.clear_not_shortlisted_on_terminal();
