MODULE 2
Dashboard
Purpose
The Dashboard is the command center of the platform. It must answer one question at a glance: "What is happening right now, and what needs my attention?" It is distinct from Analytics, which answers "how is the operation performing over time?"
Key Features / What This Module Manages
	•	Today's activity snapshot: new candidates, screenings, interviews, overdue items, failed calls
	•	Attention queue: items requiring a human decision right now
	•	Quick links into Jobs, Candidates, Pipeline, Interviews
	•	Role-scoped view: recruiters see their own workload first; owners/admins see the organization
	•	Optional AI-generated daily operations brief
Main Routes
	•	/dashboard
Core Data Model
	•	No new tables - reads from applications, candidates, interviews, automation_runs, screening_calls
	•	dashboard is a read/aggregation layer, not a source of truth
UI / Operational Flow
	•	User logs in -> lands on /dashboard
	•	KPI tiles at top (candidates today, screenings, interviews, overdue)
	•	Attention list below, sorted by urgency
	•	Optional AI brief rendered as a short paragraph above the tiles
How This Module Connects To The Others
Depends on:
	•	Module 1: tenant resolution + role checks
	•	Module 5: applications (KPI counts, attention queue)
	•	Module 4: candidates (new-candidate counts)
	•	Module 8: screening_calls (screening/failed-call counts)
	•	Module 11: interviews (interview counts)
	•	Module 13: automation_runs (failed-automation count) — this module doesn't exist yet when Dashboard is first built
Provides for later modules:
	•	No new tables — this is a read-only aggregation layer. No other module depends on Dashboard.
Forward-dependency stub:
Module 13 (Automation Engine) doesn't exist yet. Write the automation-failure KPI query defensively (return 0 / hide the tile) if automation_runs does not exist yet, rather than throwing an error.
Retrofit required:
Once Modules 5, 8, 11, and 13 all exist, revisit every Dashboard KPI query and confirm each one reads live data instead of a placeholder/zero value.
How AI Is Used In This Module
AI turns a wall of counters into a narrative. Instead of "42 new candidates, 18 AI screenings, 8 interviews, 5 overdue applications, 3 failed calls", AI produces a short Daily Operations Brief: "You received 42 candidates. 18 completed AI screening. Five strong-match candidates are waiting for recruiter review. Three screening calls failed because candidates did not answer. Client ABC Tech has had four candidates waiting for feedback for more than three days." This brief is generated from the same structured counts the UI already computes - AI explains the numbers, it does not invent them.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
View organization-wide dashboard
Yes
Yes
No (own workload only, configurable)
Yes (read-only)
View AI daily brief
Yes
Yes
Yes (own scope)
Yes
Build Now (MVP)
	•	Today's KPI tiles
	•	Attention queue
	•	Role-scoped filtering
	•	AI daily brief (read-only, generated from existing counts)
Build Later (Not MVP)
	•	Customizable widgets/layout
	•	Cross-organization benchmarking
Testing Checklist
	•	Counts match underlying tables exactly for the organization's timezone "today"
	•	Recruiter view excludes other recruiters' data unless permitted
	•	AI brief never states a number that contradicts the KPI tiles
Claude Implementation Prompt — Module 2: Dashboard
Save this specification as /docs/modules/02-dashboard.md, then give Claude the prompt below:
Build Module 2: Dashboard for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/02-dashboard.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- Module 1: tenant resolution + role checks
- Module 5: applications (KPI counts, attention queue)
- Module 4: candidates (new-candidate counts)
- Module 8: screening_calls (screening/failed-call counts)
- Module 11: interviews (interview counts)
- Module 13: automation_runs (failed-automation count) — this module doesn't exist yet when Dashboard is first built
 
Provides for later modules (do not rename/remove once other modules depend on it):
- No new tables — this is a read-only aggregation layer. No other module depends on Dashboard.
 
Forward dependency — something this module needs doesn't exist yet, so stub it correctly:
Module 13 (Automation Engine) doesn't exist yet. Write the automation-failure KPI query defensively (return 0 / hide the tile) if automation_runs does not exist yet, rather than throwing an error.
 
Retrofit required — go back and connect earlier/later modules, do not just build this module forward:
Once Modules 5, 8, 11, and 13 all exist, revisit every Dashboard KPI query and confirm each one reads live data instead of a placeholder/zero value.
 
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
 
- No new tables - reads from applications, candidates, interviews, automation_runs, screening_calls
- dashboard is a read/aggregation layer, not a source of truth
 
Required indexes (at minimum):
- index on organization_id
- composite index on (organization_id, created_at) for any table queried by recent activity or date range
 
RLS rules:
- SELECT/INSERT/UPDATE/DELETE policies all filter on organization_id = auth resolved tenant
- No database function in this module may accept an arbitrary organization_id/tenant parameter from the browser
- Role checks (Owner/Admin/Recruiter/Viewer) are enforced both in RLS where feasible and again in the API layer
 
=================================================================
6. BACKEND — API ENDPOINTS
=================================================================
- GET /api/dashboard — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/dashboard — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/dashboard/:id — fetch one record the caller's organization owns
- PATCH /api/dashboard/:id — partial update, role-checked
- DELETE /api/dashboard/:id — soft-delete/archive where applicable, role-checked
- POST /api/dashboard/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: The Dashboard is the command center of the platform. It must answer one question at a glance: "What is happening right now, and what needs my attention?" It is distinct from Analytics, which answers "how is the operation performing over time?"
 
Features to implement, exactly as scoped:
- Today's activity snapshot: new candidates, screenings, interviews, overdue items, failed calls
- Attention queue: items requiring a human decision right now
- Quick links into Jobs, Candidates, Pipeline, Interviews
- Role-scoped view: recruiters see their own workload first; owners/admins see the organization
- Optional AI-generated daily operations brief
 
Pages/routes for this module:
- /dashboard
 
Step-by-step operational flow to implement:
1. User logs in -> lands on /dashboard
2. KPI tiles at top (candidates today, screenings, interviews, overdue)
3. Attention list below, sorted by urgency
4. Optional AI brief rendered as a short paragraph above the tiles
 
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
View organization-wide dashboard | Yes | Yes | No (own workload only, configurable) | Yes (read-only)
View AI daily brief | Yes | Yes | Yes (own scope) | Yes
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI turns a wall of counters into a narrative. Instead of "42 new candidates, 18 AI screenings, 8 interviews, 5 overdue applications, 3 failed calls", AI produces a short Daily Operations Brief: "You received 42 candidates. 18 completed AI screening. Five strong-match candidates are waiting for recruiter review. Three screening calls failed because candidates did not answer. Client ABC Tech has had four candidates waiting for feedback for more than three days." This brief is generated from the same structured counts the UI already computes - AI explains the numbers, it does not invent them.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Customizable widgets/layout
- Cross-organization benchmarking
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- Today's KPI tiles
- Attention queue
- Role-scoped filtering
- AI daily brief (read-only, generated from existing counts)
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Counts match underlying tables exactly for the organization's timezone "today"
- Recruiter view excludes other recruiters' data unless permitted
- AI brief never states a number that contradicts the KPI tiles
 
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

Simple UI Template — Module 2: Dashboard
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


