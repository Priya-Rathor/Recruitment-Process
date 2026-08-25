# Module 17 (Settings & Integrations) — implementation notes

The last core module, and mostly a **completion** rather than a new build. Its
own spec says so: *"this is the module every earlier stub was written against —
completing it requires going back and finishing the wiring, not just building
new UI."*

## The four required retrofits

### 1. Bolna's credentials stub — extended, not replaced

The spec: *"without changing `placeCall()`'s external interface."* Held.
`organization_integrations` gained `error_code`, `credential_mode` and
`connected_by` by `add column if not exists`; the adapter gained an optional
`connectedBy` argument. No signature any caller depends on changed, and Module
8's screening flow was not touched.

Test outcomes now record a machine-readable `error_code`, so the settings card
offers **"reconnect"** for a rejected key and **"try again"** for an unreachable
provider. Parsing English to decide which was never going to survive.

### 2. Google Calendar OAuth — real, and **unverified**

The stub is gone. `createEvent()` makes genuine Calendar API calls, `deleteEvent()`
genuinely deletes, `test()` reads calendar metadata (never a test event — a
"test" that puts a phantom interview in a customer's calendar and emails their
team is not a test).

**This code has never run against Google.** There is no Google Cloud project, no
client ID, no registered redirect URI, no consent screen. Everything in this repo
is unproven for want of a Supabase project, but OAuth deserves separate mention
because it is the flow where "looks right" and "works" diverge most: redirect
URI mismatches, scopes needing re-consent, refresh tokens issued only on the
first authorization, and clock skew all fail at runtime and never at compile
time.

Three things were got right on paper and need confirming in practice:

- `access_type=offline` **plus** `prompt=consent`. Without the second, a user who
  has authorized before receives an access token and **no refresh token**, and
  the integration dies after one hour with no visible cause. A missing refresh
  token is treated as a hard failure at connect time rather than stored.
- A refresh response never includes a new refresh token, so the existing one is
  **carried forward**. Writing `null` would break every subsequent refresh.
- `invalid_grant` (revoked) is distinguished from a transient failure. The
  remedies differ, and treating a network blip as a revocation would nag an
  admin to reconnect a working integration.

**Module 11's calling code was not modified**, which was the point. A revoked
grant degrades to `not_connected`, not `failed`, so the spec's requirement that
scheduling "still degrades gracefully if the connection is later revoked" holds
through the same branch that always handled it.

The OAuth callback runs **four checks** before storing a token — session role,
HMAC on the state, cookie nonce, and organization match. The state must be
signed because an unsigned state is a value an attacker chooses: without it,
somebody could complete a flow with their own Google account while naming a
different organization, and their credentials would land in that organization's
row.

### 3. Module 13's "assume connected" — deleted

`checkIntegrations()` carried the forward stub *"for integrations without a real
getStatus() yet, default to 'unknown — assume connected'"*. All five adapters
now have one, so the fallback is gone and **an unrecognised provider blocks**.

That is the safe direction: assume-connected means a rule activates, looks
healthy, and fails at run time against a candidate. Blocking means an admin is
told at activation, while they are looking at the screen. Each provider gets a
real health read and the message names it, so "Bolna isn't connected, so this
rule can't place screening calls" replaces "an integration is missing".

The temporary banner on `/automations` that told admins the check wasn't real was
removed in the same change — a stale reassurance is worse than none.

### 4. `/settings/pipeline` — points at Module 10's table

No duplicate. The page reuses `getSlaConfig()`, `editableSlaRows()` **and**
Module 10's `SlaSettings` component, which already posts to
`/api/pipeline/sla`. One table, one API, one form. A second place to set the
same number would disagree the first time somebody used the other one.

## What this migration deliberately did **not** create

The spec's schema lists JSONB columns that would duplicate tables earlier
modules own:

- **`pipeline_settings`** — Module 10 owns `pipeline_sla_config` as rows, and
  the spec's own retrofit instruction says to point at it.
- **`notification_settings`** / **`user_preferences.notification_preferences`** —
  Module 15 built `notification_preferences` as rows precisely so "I never chose
  this" and "I chose the same as the default" stay different facts. Collapsing
  that into a blob would destroy the inheritance it depends on.
- **`organization_settings.timezone`** — lives on `organizations`, where
  `lib/time.ts` already reads it. Two timezones would let the dashboard and the
  analytics disagree about what "today" is.

`user_preferences.display_timezone` exists but is **display-only**, and says so:
every stored calculation still uses the organization's timezone, because a
report whose numbers change depending on who opened it is not a report.

## Credential handling

The pattern the spec asks for, end to end: submitted once → validated →
encrypted → **only masked metadata ever returned**.

Four layers, deliberately overlapping:

1. `saveCredentials()` **fails closed** — a secret that cannot be encrypted is
   not stored. Writing it in plaintext "temporarily" is how a credential ends up
   in a backup forever.
2. `toPublic()` rebuilds the row **field by field** rather than
   destructuring-and-spreading, so a secret-bearing column added later is
   invisible until somebody names it deliberately. There is a test for exactly
   that regression.
3. RLS restricts `organization_integrations` to Owner/Admin.
4. A **column-level REVOKE** on `encrypted_credentials`, re-asserted in this
   migration because it is the single control between an Owner's browser session
   and every provider secret the organization holds.

`maskCredential()` reveals nothing at all for a secret of four characters or
fewer — a naive "last four" rule would print a short key in full.

## Dependency warnings

Read from Module 13's `required_integrations` rather than a hardcoded list, so a
rule created tomorrow appears without anyone remembering to update this file. A
dependency warning that goes stale is worse than none, because it is trusted.

Live automations sort first; drafts are listed as "can't be activated" rather
than "will stop working". If the lookup **fails**, the UI says so — "nothing
depends on this" when we could not check is the false reassurance that gets a
live integration turned off mid-interview-week. Disconnect requires
`?confirm=true`; a warning nobody has to acknowledge is decoration.

## AI: no new function

Section 10 describes an assistant that "proposes the corresponding automation
configuration for the admin to review and explicitly click 'Review & Activate'".

**That is Module 13's `draftAutomationRule()`, already built**, already bound to
a closed catalogue, already unable to activate anything. Writing a second one
would mean two prompts, two validators and two things to keep in step. The
settings pages link to it rather than duplicating it.

## Follow-ups

- ☐ **Google OAuth end-to-end.** The most important item here. Needs a Google
  Cloud project, a registered redirect URI, and a real connect → schedule →
  revoke → reschedule pass.
- ☐ **`lib/ai/provider.ts` does not read the stored LLM key.** It uses
  `OPENAI_API_KEY` from the environment. The adapter stores and health-checks a
  per-organization key, and the settings card **says which one is actually in
  force** rather than implying the stored one is used. Wiring it means a
  database round trip and a decrypt before every AI call, and changing a
  signature eleven modules depend on.
- ☐ **`platform_managed` is stored but not honoured.** The column and check
  constraint exist; nothing yet hides Disconnect for a shared account or refuses
  to fall back to platform credentials.
- ☐ **n8n is monitored, not used.** Module 13 executes in-process by design. The
  card says so instead of showing a green "Connected" beside an engine that
  never calls it.
- ☐ **Retention is stored, not enforced.** Nothing deletes anything yet; the
  form says so in the same panel rather than implying a cleanup is running. The
  Privacy & Compliance retrofit owns the job.
- ☐ **No concurrent-edit protection.** Two admins editing settings is
  last-write-wins with no acknowledgment.
- ☐ **Branding is stored but not applied** — `logo_url` and `brand_color` are
  saved and validated; the app shell still renders the default tokens.

---

# What changed after Module 17 shipped

Four passes over this module, in order. Each was a visual/consistency change
except the last, which removed a provider.

## 1. The sidebar became a landing grid

Settings was a permanent left nav beside a detail panel — twelve rows of
similar-length text, always on screen, competing with whatever page you opened.

`/settings` is now a **categorised grid** and the navigation *is* the landing
page. Each individual settings page keeps its content exactly as built and gains
an explicit `← Settings` back link; a page nested one level deeper (the Voice
Agent Console) points one level up instead, so it does not skip the integration
that owns it.

`SettingsShell` lost both `role` and `current`. With no sidebar neither had any
output — every page already does its own role check and renders
`RestrictedPanel` itself. The old `.settings-nav__*` CSS was deleted with them.

### One catalogue, not two

`app/settings/catalog.ts` is the single source: `visibleCategories()` feeds the
grid, `visibleLinks()` (re-exported from `SettingsShell` as `visibleSections` for
compatibility) feeds everything else. A grid built *beside* the old section list
would have been a second list to keep in step, and the drift is not cosmetic — a
link whose route was renamed becomes a 404.

`catalog.test.ts` walks the real `app/` route tree and asserts every `href`
resolves to a page file, including the `#integration-…` anchors, which are checked
against `PROVIDER_DESCRIPTORS` rather than against a hardcoded list. It also
proves the checker works by asserting a route that does not exist is rejected —
without that, a `routeExists()` returning `true` for everything would pass
silently forever.

### Search

Subsequence matching, not substring: `msgtmp` finds Message templates and a
typo still lands. A category whose *name* matches keeps all its links, because
searching by category is half of what people type.

## 2. The grid was rebalanced

Cards hold 2–3 items each and heights are content-driven — `align-items: start`,
no masonry, no forced height matching. That only reads as deliberate while the
content is balanced, so the **Integrations card was split in two** (Calling &
scheduling / Communication & AI) when it reached six items against neighbours of
two.

Column counts are explicit (1 / 2 / 3 / 4 at 560, 860, 1120px). `auto-fill`
re-flowed the same seven cards through 4+3, 3+3+1 and 2+2+2+1 at breakpoints
nobody chose. Tracks are `minmax(0, 1fr)` — a track's implicit minimum is `auto`,
so one long unbroken word could push a column wider than its share.

`catalog.test.ts` asserts every card stays within 2–3 items. The layout depends
on that property, so it is a test rather than a hope.

## 3. The integrations detail page

**Three button states, one rule, no exceptions:** connectable → solid primary
`Connect`; connected → outline `Replace credentials` plus quiet `Test connection`
and soft-danger `Disconnect`, with *no* solid button anywhere; blocked →
`is-unavailable`, grey and inert.

That third state is the fix for a real bug. Google Calendar's button was already
`disabled` (no OAuth app on the deployment), but the only disabled treatment in
the stylesheet was a global opacity knock-down — so a disabled *primary* rendered
as the same blue at 55% and read as a second kind of button rather than as a dead
one. `is-unavailable` is opt-in rather than a change to
`.button.is-primary:disabled`, which would repaint every disabled primary in the
product.

The AI provider's chip reads **"Using platform default"** when
`activeSource === "server_environment"`. Its status genuinely is `disconnected` —
no organization key is stored — but resume parsing and matching *are* working on
the server's key, and a grey "Disconnected" on a working feature is false. Only
the chip changes; `status` is untouched, so the connect flow and every dependency
check behave as before.

The **trust disclosure** is one component in two placements: a flat bordered
footer note, and inside every credential-entry panel. The inline copy used to be
a shorter paraphrase — it said less than the footer did, in the one place where
somebody has a secret in the field above it.

## 4. n8n removed from every customer surface

It stays in the `Provider` union — the table has a CHECK constraint listing it and
Module 13's engine can still hand off to a workflow — but it has no descriptor, so
no card, no connect form, no dependency warning and no API route (the handler
404s it). Ten surfaces were closed, including the automations builder, the
template library, the rule-drafting AI prompt, and a **public marketing page**
that claimed the automation engine was "orchestrated through n8n" — which was
also factually wrong, since Module 13 runs in-process.

The exclusion is a TYPE, `CustomerFacingProvider = Exclude<Provider, "n8n">`, not
a filter applied at the end. Applying it made the compiler find every remaining
surface; a filter can be forgotten by the next person adding one.

`call_n8n_webhook` is **retired, not deleted**. `isActionType()` gates
`parseActions()`, so removing it from `ACTIONS` would make every stored rule
containing it fail to save with "Unknown action" — silently breaking live
automations to tidy a picker. It is gone from `OFFERED_ACTIONS`, the templates and
the AI prompt; it still parses and still runs.

## Retrofit checklist — additions

- ☐ **Module 15's migration is a 4-byte truncated file.**
  `0030_module15_candidate_messaging.sql` contains the text `writ`.
  `message_templates`, `message_log` and `candidate_communication_preferences`
  are queried from eleven files and created by nothing, and
  `lib/communications/` has no `isMissingRelation` guard — so
  `/settings/templates` errors rather than degrading. **Blocking.**
- ☐ **`organization_settings.communication_settings` has no column.**
  `RecruitmentForm` sends it in the same payload as currency, default recruiter,
  default stage and interview duration, so `/settings/recruitment` cannot save
  *anything*. **Blocking.**
- ☐ **`SettingsPayload` is stale** — omits `onboarding_settings` and
  `communication_settings`, both of which `parseSettingsPayload()` accepts.
  Cosmetic; the parser is the real contract.
- ☐ **`var(--color-secondary-text)` does not exist.** The real token is
  `--color-text-secondary`. Fixed in the settings nav; still wrong in
  `TemplateEditor`, `SendMessagePanel`, `ReminderButton`, `NotificationList`,
  `charts.tsx` and `CommunicationLog`, where the text silently inherits
  near-black instead of grey.
- ☐ **Automation rules have no Settings entry.** The org-wide kill switch
  (`organizations.automations_enabled`) and the rules themselves live only on
  `/automations`. The audit recommends linking them from the grid (marked ↗)
  rather than moving the page.
