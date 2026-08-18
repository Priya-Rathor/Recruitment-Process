-- =============================================================================
-- Agency mode — one product, two kinds of buyer.
--
-- The product was built for a recruitment AGENCY: an organization that recruits
-- on behalf of other companies, and therefore has `clients` (Module 12),
-- candidate submissions, and feedback-turnaround SLAs.
--
-- It is also sold to IN-HOUSE teams, who hire for themselves. For them there is
-- no third party to submit a candidate to, so every client-facing surface is
-- dead weight: a nav item leading to a page that will always be empty, a "no
-- client" dropdown on every job, an analytics tab with nothing in it.
--
-- This flag says which one an organization is. It is a VISIBILITY switch, not a
-- permission:
--
--   * It hides client-facing UI. It does not restrict access to anything, so it
--     is deliberately NOT enforced in RLS — there would be nothing to enforce.
--     Role checks continue to be the security boundary (see 0011).
--   * It destroys nothing. An organization that switches to in-house keeps its
--     clients, submissions and feedback history; switching back shows them
--     again, unchanged. Turning a toggle off must never be a delete.
--
-- Defaults to TRUE so every organization that exists today keeps exactly the
-- behaviour it has now. Only new organizations answer the question, in
-- onboarding step 2.
--
-- No new policy: `organizations_update_owner_admin` (migration 0001) already
-- gates every column of this table to Owner/Admin, this one included.
-- =============================================================================

alter table public.organizations
  add column if not exists agency_mode boolean not null default true;

comment on column public.organizations.agency_mode is
  'True = recruits for client companies (Module 12 clients, submissions and '
  'feedback SLAs are shown). False = hires for itself; those surfaces are '
  'hidden. Visibility only — no data is deleted when this is turned off.';
