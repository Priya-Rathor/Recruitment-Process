MODULE 17
Settings & Integrations
Purpose
This is the final core module. It centralizes organization settings, user preferences, integration credentials, defaults, and connection health, so Owners/Admins can configure the recruitment system without touching code, n8n, Supabase, or provider dashboards.
Key Features / What This Module Manages
	•	Organization profile and branding
	•	Recruitment, screening, and pipeline defaults
	•	Notification defaults and user preferences
	•	Roles/permissions entry points
	•	Bolna AI, n8n, LLM provider, Email, and Google Calendar connections
	•	Security settings and data-retention settings
	•	Integration health and Test Connection actions
Main Routes
	•	/settings, /settings/organization, /settings/users, /settings/recruitment, /settings/screening, /settings/pipeline, /settings/notifications, /settings/integrations, /settings/security
Core Data Model
	•	organization_settings (organization_id PK, timezone, currency, default_recruiter_id, default_application_stage, default_interview_duration, screening_settings JSONB, pipeline_settings JSONB, notification_settings JSONB, retention_settings JSONB)
	•	user_preferences (user_id, organization_id, timezone, date_format, notification_preferences JSONB, ui_preferences JSONB)
	•	organization_integrations (id, organization_id, provider, status, encrypted_credentials, settings JSONB, last_tested_at, last_success_at, error_code, error_message)
UI / Operational Flow
	•	Owner opens Settings -> left navigation (Organization, Team & Permissions, Recruitment, Screening, Pipeline, Notifications, Integrations, Security) -> right panel shows selected section
	•	Owner updates organization defaults, screening configuration, and pipeline SLA, using explicit 'Save Changes' (never silent auto-save)
	•	Owner connects Bolna, tests the connection, connects Google Calendar, configures Email and the AI provider; n8n health is visible
	•	Dependent modules (Automation, Notifications, Interviews) detect disconnected integrations and degrade gracefully or block activation with a clear message
Design / Color Specification
	•	Settings card: background #FFFFFF, border 1px #E2E8F0, radius 12px, padding 24px
	•	Integration status - Connected: bg #DCFCE7 / text #15803D; Needs Attention: bg #FEF3C7 / text #B45309; Disconnected: bg #F1F5F9 / text #475569; Error: bg #FEE2E2 / text #B91C1C
	•	Dangerous actions live in a separate Danger Zone at the bottom of a settings page, never beside normal Save buttons
How This Module Connects To The Others
Depends on:
	•	Module 1: roles (who can manage settings/integrations)
	•	Every temporary integration stub created earlier: Module 8's lib/integrations/bolna/ (credentials stub), Module 11's lib/integrations/calendar/ (createEvent stub), Module 13's 'assume connected' integration-health placeholder, Module 10's inline pipeline_sla_config editor
Provides for later modules:
	•	organization_settings, user_preferences, organization_integrations — the real backing store for every stub used by earlier modules
	•	The completed lib/integrations/{bolna,calendar,email,llm,n8n}/ adapters with real connect/test/getStatus/disconnect implementations
Retrofit required:
This is the module every earlier stub was written against — completing it requires going back and finishing the wiring, not just building new UI. Specifically: (1) Replace Module 8's minimal Bolna credentials stub with this module's full organization_integrations row + masked display + Test Connection flow, without changing placeCall()'s external interface. (2) Replace Module 11's calendar createEvent() stub with real Google OAuth, and confirm interview scheduling still degrades gracefully if the connection is later revoked. (3) Replace Module 13's 'assume connected' status checks with real getStatus() calls and re-test every automation dependency-blocking rule end-to-end. (4) Point this module's /settings/pipeline page at the pipeline_sla_config table Module 10 already created rather than creating a duplicate. Test each of the four items above end-to-end (e.g. disconnect Bolna and confirm Module 13 now actually blocks the dependent automation) before calling Module 17 done.
How AI Is Used In This Module
AI acts as a setup assistant here rather than a runtime feature. An admin can describe an intent in plain language - e.g. "I want AI screening for all Java candidates above 75% match" - and AI proposes the corresponding automation configuration (trigger, condition, action, language, max attempts) for the admin to review and explicitly click 'Review & Activate'. This makes configuration approachable without letting AI silently change security- or credential-sensitive settings; those remain explicit, code-controlled, human-confirmed actions at all times.
Credential Security Pattern
Frontend submits credentials once -> Backend validates -> Backend encrypts/stores -> Backend returns only masked metadata (e.g. API Key: ********4F8A). The backend must never return a complete API key, OAuth refresh token, or service-role key to the browser. Support both platform_managed (e.g. a shared managed Bolna account) and organization_managed (e.g. per-tenant Google Calendar OAuth) credential modes.
Integration Adapter Layer
lib/integrations/{bolna, calendar, email, llm, n8n}/ each expose a consistent connect(), test(), getStatus(), disconnect() pattern, so provider-specific logic never spreads across UI components. Other modules (Automation, Notifications, Interviews) read integration health/settings from this shared layer rather than calling providers directly.
Dependency Warnings
Before disconnecting an integration, show which live automations/features depend on it (e.g. 'Before disconnecting: High Match AI Screening, Screening Retry, and Candidate Callback will be affected'). Automations that require a disconnected integration cannot be activated, with a clear inline message rather than silently failing later.
Test Connection
Admin clicks Test -> backend loads credentials -> makes a safe provider health/config check (not a real candidate call for Bolna, unless explicitly required) -> returns status -> updates last_tested_at/last_success_at. Errors are shown as plain, non-technical messages; raw provider stack traces are never shown to users.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
Manage organization settings
Yes
Yes
No
No
Manage integrations/credentials
Yes
Yes
No
No
View permission summary
Yes
Yes
Yes (view)
Yes (view)
Manage own notification preferences
Yes
Yes
Yes
Limited/None
Build Now (MVP)
	•	Settings navigation, organization settings, recruitment/screening/pipeline defaults, notification defaults
	•	Integration cards for Bolna, n8n, LLM, Email, Google Calendar with Test Connection and masked credentials
	•	Integration health, security/settings permissions, audit logging
Build Later (Not MVP)
	•	Full custom RBAC builder, white-label domains, complex theme builder
	•	SSO/SAML, SCIM, multi-region data residency, enterprise secrets vault UI
	•	Dozens of AI providers, custom SMTP per customer, billing/usage plans, organization cloning, advanced retention workflows
Testing Checklist
	•	Recruiter cannot read integration secrets; Viewer cannot update organization settings
	•	Encrypted credentials never appear un-masked in any API response
	•	Tenant isolation on all settings/integration tables
	•	Connect / test / disconnect flows for Bolna, Calendar, Email, LLM, n8n including invalid credentials and expired OAuth
	•	Dependency warnings correctly list affected automations before disconnect; audit events recorded for every settings/integration change
Claude Implementation Prompt — Module 17: Settings & Integrations
Save this specification as /docs/modules/17-settings-integrations.md, then give Claude the prompt below:
Build Module 17: Settings & Integrations for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/17-settings-integrations.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
=================================================================
1. TECH STACK
=================================================================
- Next.js (App Router) + TypeScript
- Bulma for base styling, project design tokens for color/spacing
- Supabase (PostgreSQL + Auth + Storage) with Row-Level Security
- n8n for workflow/automation orchestration
- Bolna AI for outbound/inbound voice screening calls
- An LLM provider (OpenAI, swappable later) behind an internal AI Service Layer
 
=================================================================
2. CONNECTIONS TO OTHER MODULES — READ THIS BEFORE WRITING CODE
=================================================================
This module does not exist in isolation. Get the following connections right or later modules will break.
 
Depends on (must already exist / must be read from):
- Module 1: roles (who can manage settings/integrations)
- Every temporary integration stub created earlier: Module 8's lib/integrations/bolna/ (credentials stub), Module 11's lib/integrations/calendar/ (createEvent stub), Module 13's 'assume connected' integration-health placeholder, Module 10's inline pipeline_sla_config editor
 
Provides for later modules (do not rename/remove once other modules depend on it):
- organization_settings, user_preferences, organization_integrations — the real backing store for every stub used by earlier modules
- The completed lib/integrations/{bolna,calendar,email,llm,n8n}/ adapters with real connect/test/getStatus/disconnect implementations
 
Retrofit required — go back and connect earlier/later modules, do not just build this module forward:
This is the module every earlier stub was written against — completing it requires going back and finishing the wiring, not just building new UI. Specifically: (1) Replace Module 8's minimal Bolna credentials stub with this module's full organization_integrations row + masked display + Test Connection flow, without changing placeCall()'s external interface. (2) Replace Module 11's calendar createEvent() stub with real Google OAuth, and confirm interview scheduling still degrades gracefully if the connection is later revoked. (3) Replace Module 13's 'assume connected' status checks with real getStatus() calls and re-test every automation dependency-blocking rule end-to-end. (4) Point this module's /settings/pipeline page at the pipeline_sla_config table Module 10 already created rather than creating a duplicate. Test each of the four items above end-to-end (e.g. disconnect Bolna and confirm Module 13 now actually blocks the dependent automation) before calling Module 17 done.
 
=================================================================
4. DESIGN SYSTEM — USE THESE EXACT VALUES, DO NOT INVENT NEW ONES
=================================================================
Color tokens (hex, and where each is used):
- Primary: #4F46E5 — Buttons, links, active nav, primary chart series, funnel main color
- Primary Hover: #4338CA — Hover/active state of primary buttons and links
- Background (page): #F8FAFC — App shell / page background, never used on cards
- Card: #FFFFFF — Every card/panel background
- Border: #E2E8F0 — 1px card borders, table borders, dividers
- Main Text: #0F172A — Headings and primary body text
- Secondary Text: #64748B — Labels, captions, helper text, timestamps
- Success: #16A34A — Positive trends, Connected status, success toasts
- Warning: #F59E0B — SLA breach indicators, Needs Attention status
- Error: #DC2626 — Negative trends, failed states, destructive actions
- Info: #2563EB — Informational badges/callouts
 
Module-specific color/layout rules for Settings & Integrations:
- Settings card: background #FFFFFF, border 1px #E2E8F0, radius 12px, padding 24px
- Integration status - Connected: bg #DCFCE7 / text #15803D; Needs Attention: bg #FEF3C7 / text #B45309; Disconnected: bg #F1F5F9 / text #475569; Error: bg #FEE2E2 / text #B91C1C
- Dangerous actions live in a separate Danger Zone at the bottom of a settings page, never beside normal Save buttons
 
Card style (apply to every panel/card in this module):
- Card background: #FFFFFF
- Card border: 1px solid #E2E8F0
- Card border radius: 12px
- Card padding: 24px (16px on mobile)
- Card shadow: none/flat (rely on border, not drop shadow) unless the frontend-design tokens already in use say otherwise
 
Typography:
- KPI/metric main value: 28-32px, bold, #0F172A
- KPI/metric label: 13-14px, #64748B
- Section headings: 18-20px, semibold, #0F172A
- Body text: 14-15px, #0F172A
- Helper/caption text: 12-13px, #64748B
 
Do not use rainbow/decorative color palettes, 3D charts, drop-shadow-heavy cards, or any color not in the token list above.
 
=================================================================
5. BACKEND — DATABASE SCHEMA
=================================================================
Create/extend the following tables. Every table must include organization_id and be governed by Row-Level Security scoped to the authenticated user's organization — no query may accept an organization_id from client input.
 
- organization_settings (organization_id PK, timezone, currency, default_recruiter_id, default_application_stage, default_interview_duration, screening_settings JSONB, pipeline_settings JSONB, notification_settings JSONB, retention_settings JSONB)
- user_preferences (user_id, organization_id, timezone, date_format, notification_preferences JSONB, ui_preferences JSONB)
- organization_integrations (id, organization_id, provider, status, encrypted_credentials, settings JSONB, last_tested_at, last_success_at, error_code, error_message)
 
Required indexes (at minimum):
- index on organization_id
- index on default_recruiter_id
- index on user_id
- index on status
- composite index on (organization_id, created_at) for any table queried by recent activity or date range
 
RLS rules:
- SELECT/INSERT/UPDATE/DELETE policies all filter on organization_id = auth resolved tenant
- No database function in this module may accept an arbitrary organization_id/tenant parameter from the browser
- Role checks (Owner/Admin/Recruiter/Viewer) are enforced both in RLS where feasible and again in the API layer
 
=================================================================
6. BACKEND — API ENDPOINTS
=================================================================
- GET /api/organization-settings — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/organization-settings — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/organization-settings/:id — fetch one record the caller's organization owns
- PATCH /api/organization-settings/:id — partial update, role-checked
- DELETE /api/organization-settings/:id — soft-delete/archive where applicable, role-checked
- POST /api/organization-settings/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: This is the final core module. It centralizes organization settings, user preferences, integration credentials, defaults, and connection health, so Owners/Admins can configure the recruitment system without touching code, n8n, Supabase, or provider dashboards.
 
Features to implement, exactly as scoped:
- Organization profile and branding
- Recruitment, screening, and pipeline defaults
- Notification defaults and user preferences
- Roles/permissions entry points
- Bolna AI, n8n, LLM provider, Email, and Google Calendar connections
- Security settings and data-retention settings
- Integration health and Test Connection actions
 
Pages/routes for this module:
- /settings, /settings/organization, /settings/users, /settings/recruitment, /settings/screening, /settings/pipeline, /settings/notifications, /settings/integrations, /settings/security
 
Step-by-step operational flow to implement:
1. Owner opens Settings -> left navigation (Organization, Team & Permissions, Recruitment, Screening, Pipeline, Notifications, Integrations, Security) -> right panel shows selected section
2. Owner updates organization defaults, screening configuration, and pipeline SLA, using explicit 'Save Changes' (never silent auto-save)
3. Owner connects Bolna, tests the connection, connects Google Calendar, configures Email and the AI provider; n8n health is visible
4. Dependent modules (Automation, Notifications, Interviews) detect disconnected integrations and degrade gracefully or block activation with a clear message
 
Additional required behavior:
- Credential Security Pattern: Frontend submits credentials once -> Backend validates -> Backend encrypts/stores -> Backend returns only masked metadata (e.g. API Key: ********4F8A). The backend must never return a complete API key, OAuth refresh token, or service-role key to the browser. Support both platform_managed (e.g. a shared managed Bolna account) and organization_managed (e.g. per-tenant Google Calendar OAuth) credential modes.
- Integration Adapter Layer: lib/integrations/{bolna, calendar, email, llm, n8n}/ each expose a consistent connect(), test(), getStatus(), disconnect() pattern, so provider-specific logic never spreads across UI components. Other modules (Automation, Notifications, Interviews) read integration health/settings from this shared layer rather than calling providers directly.
- Dependency Warnings: Before disconnecting an integration, show which live automations/features depend on it (e.g. 'Before disconnecting: High Match AI Screening, Screening Retry, and Candidate Callback will be affected'). Automations that require a disconnected integration cannot be activated, with a clear inline message rather than silently failing later.
- Test Connection: Admin clicks Test -> backend loads credentials -> makes a safe provider health/config check (not a real candidate call for Bolna, unless explicitly required) -> returns status -> updates last_tested_at/last_success_at. Errors are shown as plain, non-technical messages; raw provider stack traces are never shown to users.
 
=================================================================
8. FRONTEND — UI REQUIREMENTS
=================================================================
Layout: reuse the project's existing shell (nav + content area). Content area background #F8FAFC, all content lives in #FFFFFF cards per section 4.
Responsive behavior: single-column stacking on mobile widths; tables convert to stacked cards or scroll horizontally only where a table cannot reasonably collapse; filters move into a bottom-sheet/drawer on mobile.
 
Required UI states for every data-bearing view in this module:
- Loading: skeleton blocks matching the shape of the eventual content (KPI skeletons, table-row skeletons, chart-block skeletons) — never one full-page spinner
- Empty state: a short plain-language message plus, where relevant, a single primary action button (e.g. 'Connect Bolna', 'Create your first job') — never a broken/blank chart or table
- Error state: a short human-readable message in #DC2626 tones with a Retry action; one failing section must never crash the rest of the page
- Insufficient-data state (analytics-style views only): 'Not enough data for a meaningful trend' instead of a misleading percentage
 
Do not silently auto-save destructive or bulk changes — use an explicit Save action with an unsaved-changes indicator wherever this module allows editing configuration.
 
=================================================================
9. ROLE PERMISSIONS (ENFORCE IN UI AND API, NOT JUST UI)
=================================================================
Permission | Owner | Admin | Recruiter | Viewer
Manage organization settings | Yes | Yes | No | No
Manage integrations/credentials | Yes | Yes | No | No
View permission summary | Yes | Yes | Yes (view) | Yes (view)
Manage own notification preferences | Yes | Yes | Yes | Limited/None
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI acts as a setup assistant here rather than a runtime feature. An admin can describe an intent in plain language - e.g. "I want AI screening for all Java candidates above 75% match" - and AI proposes the corresponding automation configuration (trigger, condition, action, language, max attempts) for the admin to review and explicitly click 'Review & Activate'. This makes configuration approachable without letting AI silently change security- or credential-sensitive settings; those remain explicit, code-controlled, human-confirmed actions at all times.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Full custom RBAC builder, white-label domains, complex theme builder
- SSO/SAML, SCIM, multi-region data residency, enterprise secrets vault UI
- Dozens of AI providers, custom SMTP per customer, billing/usage plans, organization cloning, advanced retention workflows
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- Settings navigation, organization settings, recruitment/screening/pipeline defaults, notification defaults
- Integration cards for Bolna, n8n, LLM, Email, Google Calendar with Test Connection and masked credentials
- Integration health, security/settings permissions, audit logging
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Recruiter cannot read integration secrets; Viewer cannot update organization settings
- Encrypted credentials never appear un-masked in any API response
- Tenant isolation on all settings/integration tables
- Connect / test / disconnect flows for Bolna, Calendar, Email, LLM, n8n including invalid credentials and expired OAuth
- Dependency warnings correctly list affected automations before disconnect; audit events recorded for every settings/integration change
 
Edge cases (apply to this module even if not listed above):
- Empty state: organization has zero records for this module's core entity
- Single-record state: exactly one record — rates/averages must not be misleading (e.g. show 'Not enough data' rather than 100%/0% on a sample size of one where relevant)
- Large dataset: pagination/virtualization does not degrade badly at 10,000+ rows
- Concurrent edits: two users editing the same record do not silently overwrite each other without at least a last-write-wins acknowledgment
- Malformed/partial AI output: UI shows a clear error and lets the user retry or proceed manually, and never crashes the page
- Timezone boundaries: any 'today'/'this week' calculation uses the organization's configured timezone, not the server's or browser's
 
Security & tenant isolation tests:
- A user from Organization A can never read, list, update, or delete Organization B's records via this module's UI or API, including by guessing IDs
- Every role listed in section 9 is tested against every restricted action in this module, both allowed and denied cases
- No API response in this module ever includes another organization's data, another user's private notes (if applicable), or unmasked credentials/secrets
 
Performance checks:
- List/detail queries use the indexes defined in section 5 (verify with EXPLAIN or equivalent) rather than full table scans
- Pages render a first meaningful paint using skeleton states in under ~1s on typical data volumes, with real data streamed in as it resolves
 
Regression checks against dependent modules:
- Confirm this module's changes do not break the modules that read from or write to the same tables (list them explicitly in your completion report)
 
=================================================================
14. COMPLETION REPORT — RETURN ALL OF THE FOLLOWING
=================================================================
- Files created
- Files modified
- Database migrations (schema + RLS policies + indexes)
- API endpoints implemented, with request/response shapes
- AI Service Layer function(s) added, with their exact input/output types
- UI components created, and which design tokens/states from section 4 and 8 they use
- Permissions matrix implemented (confirm it matches section 9 exactly)
- Full list of tests written and their pass/fail result
- Any remaining issues, known limitations, or follow-ups for the next module

Simple UI Template — Module 17: Settings & Integrations
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


