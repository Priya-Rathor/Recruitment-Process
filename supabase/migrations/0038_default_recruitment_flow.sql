-- =============================================================================
-- Module 26 — Default Recruitment Flow, and the two primitives it needs.
--
-- Three things:
--
--   1. automation_delayed_actions — the "Wait, then…" queue. NOT a second
--      scheduler: the existing hourly cron at /api/automations/sweep drains it,
--      in the same pass, under the same service-role client, recording runs in
--      the same automation_runs table. See the block comment on the table.
--
--   2. organization_settings.office_address — the one new organisation-level
--      placeholder the Director Round invitation needs.
--
--   3. Nothing at all for the form-answer-to-field primitive, deliberately.
--      Surfacing an answer reads form_responses.raw_answers BY REFERENCE. A
--      column, a table or a copied value would be a second home for an answer
--      the candidate already gave once, and the day somebody edited a response
--      the two would disagree about what was submitted.
-- =============================================================================

-- =============================================================================
-- automation_delayed_actions
--
-- WHY A QUEUE AND NOT A WINDOW QUERY.
--
-- Interview reminders — the existing scheduled feature — ask a WINDOW question:
-- "which interviews start in the next N hours?" That works because an interview
-- has a row with a time on it, so the question can be asked fresh every sweep
-- and nothing needs remembering.
--
-- A delayed action has no such row. "Wait 30 minutes, then email" is a promise
-- made at a moment that has otherwise left no trace: by the time the sweep runs,
-- the screening call it followed looks exactly like one that finished 30 minutes
-- earlier and was never followed by a wait. So the promise itself is stored.
--
-- This is still the SAME scheduling mechanism, not a second one. The cron
-- endpoint is unchanged, the sweep function is unchanged in shape, and this adds
-- one more pass to it — the way the sweep already has a pass for stale-stage
-- rules and a pass for expiring approvals.
--
-- WHY IT CANCELS ON A STAGE CHANGE.
--
-- The brief is explicit: "If the application moves to a different stage before
-- the delay elapses, the pending delayed action is automatically cancelled —
-- never fire a stale action against an application that's moved on."
--
-- `stage_at_schedule` is the mechanism. The trigger below cancels on the stage
-- change itself rather than leaving it to the sweep to notice, so the pending row
-- is already cancelled the instant the recruiter clicks — not up to an hour
-- later, and not in a race with a sweep that started before the click.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'delayed_action_status') then
    create type public.delayed_action_status as enum (
      'pending',
      'fired',
      -- The application moved on. Not a failure — the correct outcome.
      'cancelled',
      'failed'
    );
  end if;
end $$;

create table if not exists public.automation_delayed_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  /**
   * The rule that scheduled this. Cascade-deleted with it: a pending action
   * belonging to a rule somebody deleted has nothing left to explain it, and
   * firing it would send a message no rule accounts for.
   */
  automation_id uuid not null references public.automations (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  /** For the run record and for the cancellation comparison. */
  stage_key text not null,
  branch text not null default 'always' check (branch in ('always', 'pass', 'fail')),

  /**
   * THE STAGE THE APPLICATION WAS IN WHEN THE WAIT STARTED.
   *
   * Compared against the live stage by the trigger below. Stored rather than
   * re-derived because `stage_key` is the stage the RULE is attached to, and for
   * a fail branch those differ — a failed resume screen schedules a Shortlisted
   * rule while the application sits in Applied.
   */
  stage_at_schedule text not null,

  /** When this becomes due. The sweep drains everything at or before now(). */
  run_at timestamptz not null,

  /**
   * The nested actions, frozen at schedule time.
   *
   * COPIED, not read from the rule when it fires. A wait is a promise about what
   * was configured when it started; if an admin edits the rule during the wait,
   * the candidate should get what the rule said when their application reached
   * that point, not a message from a rule they never went through. It also means
   * a rule edited mid-wait cannot turn a queued email into a phone call.
   */
  actions jsonb not null default '[]'::jsonb,

  status public.delayed_action_status not null default 'pending',

  /** Set when cancelled or failed. Always shown, never inferred. */
  detail text check (detail is null or length(detail) <= 500),

  scheduled_at timestamptz not null default now(),
  resolved_at timestamptz,

  /**
   * IDEMPOTENCY. One pending wait per (rule, application, occasion).
   *
   * Without it a re-delivered webhook or two overlapping sweeps would queue the
   * same wait twice, and the candidate would get the follow-up twice. Partial,
   * so a completed wait does not block a legitimate second one later — a
   * candidate who re-enters a stage genuinely earns a fresh wait.
   */
  dedupe_key text not null
);

create unique index if not exists uq_delayed_actions_pending
  on public.automation_delayed_actions (automation_id, application_id, dedupe_key)
  where status = 'pending';

-- The sweep's only query: everything due, oldest first.
create index if not exists idx_delayed_actions_due
  on public.automation_delayed_actions (run_at)
  where status = 'pending';

create index if not exists idx_delayed_actions_application
  on public.automation_delayed_actions (organization_id, application_id);

comment on table public.automation_delayed_actions is
  'The "Wait, then…" queue. Drained by the existing sweep at '
  '/api/automations/sweep — this is not a second scheduler.';

-- =============================================================================
-- RLS
--
-- READ for any member, WRITE for nobody through the browser.
--
-- Rows here are created by the engine and resolved by the sweep, both of which
-- hold either the acting user's session or the service-role client. A browser
-- that could insert one could schedule an arbitrary action list against any
-- application in its organization, which is a strictly larger power than the
-- automations table's own insert policy grants — so there is no insert policy at
-- all, matching how application_stage_history is handled.
--
-- Cancelling is the one thing a person legitimately does, and it happens through
-- the trigger below rather than through a direct write.
-- =============================================================================
alter table public.automation_delayed_actions enable row level security;

drop policy if exists delayed_actions_select_member on public.automation_delayed_actions;
create policy delayed_actions_select_member on public.automation_delayed_actions
  for select using (public.is_org_member(organization_id));

-- =============================================================================
-- Cancellation on a stage change
-- =============================================================================
create or replace function public.cancel_delayed_actions_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    update public.automation_delayed_actions
       set status = 'cancelled',
           resolved_at = now(),
           detail = 'Cancelled — the application moved to ' || new.stage::text
                    || ' before the wait finished.'
     where application_id = new.id
       and organization_id = new.organization_id
       and status = 'pending'
       /**
        * Only waits that started in the stage being LEFT.
        *
        * A wait scheduled by a rule on the stage being ENTERED — the same
        * dispatch that produced this stage change — must survive. Without this
        * clause a pass branch that both moves the application and starts a wait
        * would cancel its own wait microseconds after creating it, and the
        * failure would look like "delays just don't work".
        */
       and stage_at_schedule = old.stage::text;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_applications_cancel_delayed on public.applications;
create trigger trg_applications_cancel_delayed
  after update of stage on public.applications
  for each row execute function public.cancel_delayed_actions_on_stage_change();

-- =============================================================================
-- organization_settings.office_address
--
-- The Director Round invitation says "please visit our office at
-- {{organization.office_address}}". Nothing in this product held an address
-- before: organizations has a name, a timezone and a country, and a job has a
-- location, which is where the ROLE is, not where the office is.
--
-- A column rather than a key inside an existing jsonb blob, because it is a
-- single scalar an admin types into a settings field — the same shape as
-- logo_url and brand_color, which sit beside it.
-- =============================================================================
alter table public.organization_settings
  add column if not exists office_address text
    check (office_address is null or length(office_address) <= 500);

comment on column public.organization_settings.office_address is
  'Where candidates are asked to attend in person. Renders as '
  '{{organization.office_address}}. NULL renders as an em dash, never as a '
  'blank in the middle of a sentence.';
