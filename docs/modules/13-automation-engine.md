MODULE 13
Automation Engine
Purpose
This module is the brain connecting every other module. It expresses simple When/If/Then business rules to the user while n8n executes the underlying workflow complexity.
Key Features / What This Module Manages
	•	When / If / Then rule builder
	•	Trigger catalogue (application enters stage, screening completes, interview ends, etc.)
	•	Condition support (match score thresholds, field presence, time delays)
	•	Action catalogue (start Bolna screening, generate summary, notify recruiter, send reminder)
	•	Run history with success/failure/skip status
	•	Dependency awareness (e.g. an automation using Bolna is blocked if Bolna is disconnected)
Main Routes
	•	/automations
	•	/automations/new
	•	/automations/[id]
Core Data Model
	•	automations (id, organization_id, name, trigger, conditions JSONB, actions JSONB, status, created_by)
	•	automation_runs (id, automation_id, application_id, status, started_at, finished_at, error_message)
UI / Operational Flow
	•	Admin builds a rule: When Application enters Screening, If Match > 75% AND candidate has phone, Then Start Bolna AI screening
	•	n8n executes the workflow behind the scenes when the trigger fires
	•	Every run is logged with success/failure/skip and surfaced in Module 16 Analytics
	•	If a required integration (e.g. Bolna) is disconnected, the automation is blocked from activating with a clear message
How This Module Connects To The Others
Depends on:
	•	Module 5: applications (triggers such as stage changes)
	•	Module 8: the placeCall() adapter function (screening action) — must call it directly, not re-implement it
	•	Module 9: screening-report generation (action)
	•	Module 11: interview reminder logic (action)
Provides for later modules:
	•	automations, automation_runs — read by Module 16 (analytics), and by Module 17 (dependency-warning checks before disconnecting an integration)
Forward-dependency stub:
Module 15 (Notifications) and Module 17 (integration health) don't exist yet. Stub the 'notify' action as a call into Module 14's Activity & Audit log instead of sending anything externally, and revisit once Module 15 ships. For integration-dependency blocking (e.g. 'don't activate a Bolna automation if Bolna is disconnected'), call lib/integrations/*/getStatus() where it exists (Module 8's Bolna adapter); for integrations without a real getStatus() yet, default to 'unknown — assume connected' and clearly label this as temporary in the UI rather than silently blocking everything.
Retrofit required:
When Module 15 ships, replace the Activity-Audit-only notify stub with a real call into its notification-creation function. When Module 17 ships, replace every temporary 'assume connected' status check with real getStatus() calls and re-test every dependency-blocking rule end-to-end.
How AI Is Used In This Module
This module is primarily deterministic - When/If/Then rules must be explainable and predictable, so AI is not the execution engine. The one place AI adds value is setup assistance: an admin can type "I want AI screening for all Java candidates above 75% match" and AI proposes a ready-made rule (trigger: application enters Screening; condition: match > 75%; action: Bolna AI screening; language: English/Hinglish; max attempts: 2) which the admin reviews and explicitly activates via 'Review & Activate'. AI drafts the rule; it never activates a live automation on its own.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
Create/edit automations
Yes
Yes
No
No
View automation run history
Yes
Yes
Yes (own scope)
Yes
Use AI rule-drafting assistant
Yes
Yes
No
No
Build Now (MVP)
	•	When/If/Then rule builder
	•	Trigger/condition/action catalogue
	•	Run history + status
	•	Integration-dependency blocking
	•	AI rule-drafting assistant
Build Later (Not MVP)
	•	Arbitrary/custom scripting inside rules
	•	Cross-organization automation templates marketplace
Testing Checklist
	•	A rule cannot be activated if a required integration is disconnected
	•	Run history accurately reflects success/failure/skip for every trigger event
	•	AI-drafted rules require explicit human activation before going live
	•	Tenant isolation of rules and run history
Claude Implementation Prompt — Module 13: Automation Engine
Save this specification as /docs/modules/13-automation-engine.md, then give Claude the prompt below:
Build Module 13: Automation Engine for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/13-automation-engine.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- Module 5: applications (triggers such as stage changes)
- Module 8: the placeCall() adapter function (screening action) — must call it directly, not re-implement it
- Module 9: screening-report generation (action)
- Module 11: interview reminder logic (action)
 
Provides for later modules (do not rename/remove once other modules depend on it):
- automations, automation_runs — read by Module 16 (analytics), and by Module 17 (dependency-warning checks before disconnecting an integration)
 
Forward dependency — something this module needs doesn't exist yet, so stub it correctly:
Module 15 (Notifications) and Module 17 (integration health) don't exist yet. Stub the 'notify' action as a call into Module 14's Activity & Audit log instead of sending anything externally, and revisit once Module 15 ships. For integration-dependency blocking (e.g. 'don't activate a Bolna automation if Bolna is disconnected'), call lib/integrations/*/getStatus() where it exists (Module 8's Bolna adapter); for integrations without a real getStatus() yet, default to 'unknown — assume connected' and clearly label this as temporary in the UI rather than silently blocking everything.
 
Retrofit required — go back and connect earlier/later modules, do not just build this module forward:
When Module 15 ships, replace the Activity-Audit-only notify stub with a real call into its notification-creation function. When Module 17 ships, replace every temporary 'assume connected' status check with real getStatus() calls and re-test every dependency-blocking rule end-to-end.
 
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
 
- automations (id, organization_id, name, trigger, conditions JSONB, actions JSONB, status, created_by)
- automation_runs (id, automation_id, application_id, status, started_at, finished_at, error_message)
 
Required indexes (at minimum):
- index on organization_id
- index on status
- index on automation_id
- index on application_id
- composite index on (organization_id, created_at) for any table queried by recent activity or date range
 
RLS rules:
- SELECT/INSERT/UPDATE/DELETE policies all filter on organization_id = auth resolved tenant
- No database function in this module may accept an arbitrary organization_id/tenant parameter from the browser
- Role checks (Owner/Admin/Recruiter/Viewer) are enforced both in RLS where feasible and again in the API layer
 
=================================================================
6. BACKEND — API ENDPOINTS
=================================================================
- GET /api/automations — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/automations — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/automations/:id — fetch one record the caller's organization owns
- PATCH /api/automations/:id — partial update, role-checked
- DELETE /api/automations/:id — soft-delete/archive where applicable, role-checked
- POST /api/automations/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: This module is the brain connecting every other module. It expresses simple When/If/Then business rules to the user while n8n executes the underlying workflow complexity.
 
Features to implement, exactly as scoped:
- When / If / Then rule builder
- Trigger catalogue (application enters stage, screening completes, interview ends, etc.)
- Condition support (match score thresholds, field presence, time delays)
- Action catalogue (start Bolna screening, generate summary, notify recruiter, send reminder)
- Run history with success/failure/skip status
- Dependency awareness (e.g. an automation using Bolna is blocked if Bolna is disconnected)
 
Pages/routes for this module:
- /automations
- /automations/new
- /automations/[id]
 
Step-by-step operational flow to implement:
1. Admin builds a rule: When Application enters Screening, If Match > 75% AND candidate has phone, Then Start Bolna AI screening
2. n8n executes the workflow behind the scenes when the trigger fires
3. Every run is logged with success/failure/skip and surfaced in Module 16 Analytics
4. If a required integration (e.g. Bolna) is disconnected, the automation is blocked from activating with a clear message
 
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
Create/edit automations | Yes | Yes | No | No
View automation run history | Yes | Yes | Yes (own scope) | Yes
Use AI rule-drafting assistant | Yes | Yes | No | No
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
This module is primarily deterministic - When/If/Then rules must be explainable and predictable, so AI is not the execution engine. The one place AI adds value is setup assistance: an admin can type "I want AI screening for all Java candidates above 75% match" and AI proposes a ready-made rule (trigger: application enters Screening; condition: match > 75%; action: Bolna AI screening; language: English/Hinglish; max attempts: 2) which the admin reviews and explicitly activates via 'Review & Activate'. AI drafts the rule; it never activates a live automation on its own.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Arbitrary/custom scripting inside rules
- Cross-organization automation templates marketplace
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- When/If/Then rule builder
- Trigger/condition/action catalogue
- Run history + status
- Integration-dependency blocking
- AI rule-drafting assistant
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- A rule cannot be activated if a required integration is disconnected
- Run history accurately reflects success/failure/skip for every trigger event
- AI-drafted rules require explicit human activation before going live
- Tenant isolation of rules and run history
 
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

Simple UI Template — Module 13: Automation Engine
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


