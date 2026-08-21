-- =============================================================================
-- Module 21 — Privacy, consent and data settings.
--
-- Four things, in dependency order:
--   1. organization_settings.privacy_settings — the configuration (§1-§9)
--   2. screening_call_status gains 'consent_declined' (§2)
--   3. screening_calls gains consent provenance columns (§2, rule 3)
--   4. A trigger that makes rule 5 structural rather than aspirational (§1)
--
-- Re-runnable, per the project convention: `if not exists`, `drop ... if exists`,
-- and enum additions guarded by a catalogue lookup.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The configuration column.
--
-- JSONB on the existing settings row rather than a new table, matching
-- screening_settings / retention_settings / communication_settings. It inherits
-- organization_settings' RLS unchanged, which is what makes these settings
-- organization-specific (rule 1) without a new policy to get wrong.
--
-- Default '{}' rather than a populated object: lib/privacy/settings.ts
-- normalizes on read, so an empty object and a missing row both resolve to the
-- documented defaults. Writing defaults into SQL as well would give two sources
-- of truth that drift the first time one is edited.
-- -----------------------------------------------------------------------------
alter table public.organization_settings
  add column if not exists privacy_settings jsonb not null default '{}'::jsonb;

comment on column public.organization_settings.privacy_settings is
  'Module 21 privacy, consent, retention and access configuration. Shape and '
  'defaults are owned by lib/privacy/settings.ts, which normalises on read and '
  'on write; treat values here as untrusted input, not as validated config.';

-- -----------------------------------------------------------------------------
-- 2. 'consent_declined' as a first-class call outcome.
--
-- The brief requires the interview be marked "Consent Declined". It is a real
-- status and not a failure: 'failed' means the provider or network broke, and
-- filing a refusal there would put a lawful, correctly handled refusal in the
-- same bucket as an outage — which then feeds the retry policy, the dashboard
-- counts and the analytics funnel as though it were a technical fault to be
-- retried. It must also never be retried, which lib/screening/retry.ts enforces.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'screening_call_status'
      and e.enumlabel = 'consent_declined'
  ) then
    alter type public.screening_call_status add value 'consent_declined';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Consent provenance on every call (rule 3: "Consent status must be stored
--    with every interview").
--
-- consent_confirmed and consent_confirmed_at already exist from Module 8. What
-- they cannot express is HOW consent was obtained, and rule 4 asks for exactly
-- that distinction — an explicit spoken "yes" and a candidate who simply carried
-- on are both consent, but they are not the same evidence. A privacy log that
-- reported them identically would overstate the weaker one.
--
-- consent_declined_at is separate from consent_confirmed = false, because false
-- is also the state of a call that has not reached the question yet. Silence and
-- refusal are different facts and a subject access request has to tell them
-- apart.
-- -----------------------------------------------------------------------------
alter table public.screening_calls
  add column if not exists consent_mode text
    check (consent_mode is null or consent_mode in ('explicit', 'continuation')),
  add column if not exists consent_declined_at timestamptz,
  -- What the configuration said at the moment of the call. Settings change; a
  -- call has to be auditable against the policy that was live when it happened,
  -- not whatever is configured on the day somebody asks.
  add column if not exists recording_permitted boolean not null default false,
  add column if not exists ai_disclosure_given boolean not null default false;

comment on column public.screening_calls.consent_mode is
  'How consent was obtained: explicit (the candidate said yes) or continuation '
  '(the candidate was told and carried on). Null until the disclosure is answered.';

comment on column public.screening_calls.recording_permitted is
  'Whether recording was permitted for THIS call, evaluated at dial time against '
  'the then-current privacy settings. Historical fact, not a live setting.';

-- -----------------------------------------------------------------------------
-- 4. The trigger that makes rule 5 structural.
--
--    "If recording is disabled, do not accidentally create or retain recordings."
--
-- WHY THIS IS A TRIGGER AND NOT A CHECK IN THE ROUTE HANDLER.
--
-- AGENTS.md states the rule this implements: the browser holds an authenticated
-- PostgREST client, so any signed-in user can write to this table directly and
-- skip the route entirely. A rule that only exists in a webhook handler is not
-- enforced — and the writer here IS a webhook, i.e. a path driven by an external
-- provider's payload rather than by our own UI.
--
-- So the invariant lives where it cannot be bypassed: a recording_url may only be
-- set on a call where recording was permitted. Anything else is refused, loudly,
-- rather than being silently nulled — a silent null would hide a bug in the
-- dial-time evaluation and leave everyone believing recordings were being stored
-- when they were not.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_recording_permission()
returns trigger
language plpgsql
as $$
begin
  if new.recording_url is not null and new.recording_permitted = false then
    raise exception
      'Cannot store a recording for call %: recording was not permitted for it. '
      'Check the organization''s privacy settings and the candidate''s consent.',
      new.id
      using errcode = 'check_violation';
  end if;

  -- A declined call is a call that stopped. It cannot also be carrying consent.
  if new.consent_declined_at is not null and new.consent_confirmed = true then
    raise exception
      'Call % cannot be both consented and declined.', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_recording_permission on public.screening_calls;

create trigger trg_enforce_recording_permission
  before insert or update on public.screening_calls
  for each row
  execute function public.enforce_recording_permission();

-- -----------------------------------------------------------------------------
-- 5. Index for the retention sweep.
--
-- The sweep asks "which completed calls have artifacts older than N days", per
-- organization. Without this it is a full scan of screening_calls on every run,
-- which grows with the table and runs on a schedule.
--
-- Partial: rows with no ended_at have no artifacts to expire, and
-- planRetentionActions() skips them anyway, so there is no reason to index them.
-- -----------------------------------------------------------------------------
create index if not exists screening_calls_retention_idx
  on public.screening_calls (organization_id, ended_at)
  where ended_at is not null;

-- -----------------------------------------------------------------------------
-- 6. Index for the §10 privacy log.
--
-- The privacy view filters activity_events to the privacy.* event types for one
-- organization, newest first. activity_events already has an organization index;
-- this makes the event_type filter selective rather than a scan of every event
-- the organization has ever recorded.
-- -----------------------------------------------------------------------------
create index if not exists activity_events_privacy_idx
  on public.activity_events (organization_id, created_at desc)
  where event_type like 'privacy.%';
