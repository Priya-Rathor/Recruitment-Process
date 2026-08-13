MODULE 5
Applications Management
Purpose
An Application is the join between a Candidate and a Job. All match scores, screening results, interview history, and client status belong to the application, not globally to the candidate - because the same candidate can be a 91% match for one role and a 43% match for another.
Key Features / What This Module Manages
	•	Application record linking candidate <-> job
	•	Current pipeline stage, match score, screening status, recruiter, notes
	•	AI-generated one-paragraph application summary
	•	Full timeline of everything that has happened on this application
Main Routes
	•	/applications
	•	/applications/[id]
Core Data Model
	•	applications (id, organization_id, candidate_id, job_id, stage, match_score, assigned_recruiter_id, source, created_at, updated_at)
	•	application_stage_history (id, application_id, stage, entered_at, exited_at)
	•	application_notes (id, application_id, author_id, note, created_at)
UI / Operational Flow
	•	Candidate is linked to a job (manually or via matching suggestion) -> application created at stage 'New'
	•	Application moves through the pipeline (see Module 10)
	•	Every stage transition writes to application_stage_history
	•	Application detail view renders an AI summary at the top, with full timeline below
How This Module Connects To The Others
Depends on:
	•	Module 3: jobs (application.job_id)
	•	Module 4: candidates (application.candidate_id)
	•	Module 1: organization_members (application.assigned_recruiter_id)
Provides for later modules:
	•	applications, application_stage_history, application_notes — this is the central table almost every later module (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16) reads or writes. Treat its schema as effectively frozen once later modules start depending on it; add columns rather than renaming/removing existing ones.
How AI Is Used In This Module
AI generates a one-paragraph summary of an application's current state instead of forcing the recruiter to open five tabs - for example: "Rahul is currently in Client Review. Resume match was 89%, AI screening completed successfully, and technical interview feedback was positive. Client feedback has been pending for two days." The summary is derived strictly from the application's own structured data (stage, match score, screening result, interview feedback, timestamps).
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
Create/edit application
Yes
Yes
Yes
No
View application summary/timeline
Yes
Yes
Yes (own/assigned)
Yes
Build Now (MVP)
	•	Application CRUD
	•	Stage history tracking
	•	AI one-paragraph summary
	•	Notes/timeline
Build Later (Not MVP)
	•	Cross-application AI comparison ('which of my applications need attention today' belongs to Pipeline/Module 10, not here)
Testing Checklist
	•	Match score and screening status always reflect the specific job, not the candidate globally
	•	Stage history correctly records entered_at/exited_at for every transition
	•	AI summary never contradicts the structured fields on the same application
	•	Tenant isolation
Claude Implementation Prompt — Module 5: Applications Management
Save this specification as /docs/modules/05-applications-management.md, then give Claude the prompt below:
Build Module 5: Applications Management for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/05-applications-management.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- Module 3: jobs (application.job_id)
- Module 4: candidates (application.candidate_id)
- Module 1: organization_members (application.assigned_recruiter_id)
 
Provides for later modules (do not rename/remove once other modules depend on it):
- applications, application_stage_history, application_notes — this is the central table almost every later module (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16) reads or writes. Treat its schema as effectively frozen once later modules start depending on it; add columns rather than renaming/removing existing ones.
 
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
 
- applications (id, organization_id, candidate_id, job_id, stage, match_score, assigned_recruiter_id, source, created_at, updated_at)
- application_stage_history (id, application_id, stage, entered_at, exited_at)
- application_notes (id, application_id, author_id, note, created_at)
 
Required indexes (at minimum):
- index on organization_id
- index on candidate_id
- index on job_id
- index on stage
- index on assigned_recruiter_id
- index on created_at
- index on application_id
- index on author_id
- composite index on (organization_id, created_at) for any table queried by recent activity or date range
 
RLS rules:
- SELECT/INSERT/UPDATE/DELETE policies all filter on organization_id = auth resolved tenant
- No database function in this module may accept an arbitrary organization_id/tenant parameter from the browser
- Role checks (Owner/Admin/Recruiter/Viewer) are enforced both in RLS where feasible and again in the API layer
 
=================================================================
6. BACKEND — API ENDPOINTS
=================================================================
- GET /api/applications — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/applications — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/applications/:id — fetch one record the caller's organization owns
- PATCH /api/applications/:id — partial update, role-checked
- DELETE /api/applications/:id — soft-delete/archive where applicable, role-checked
- POST /api/applications/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: An Application is the join between a Candidate and a Job. All match scores, screening results, interview history, and client status belong to the application, not globally to the candidate - because the same candidate can be a 91% match for one role and a 43% match for another.
 
Features to implement, exactly as scoped:
- Application record linking candidate <-> job
- Current pipeline stage, match score, screening status, recruiter, notes
- AI-generated one-paragraph application summary
- Full timeline of everything that has happened on this application
 
Pages/routes for this module:
- /applications
- /applications/[id]
 
Step-by-step operational flow to implement:
1. Candidate is linked to a job (manually or via matching suggestion) -> application created at stage 'New'
2. Application moves through the pipeline (see Module 10)
3. Every stage transition writes to application_stage_history
4. Application detail view renders an AI summary at the top, with full timeline below
 
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
Create/edit application | Yes | Yes | Yes | No
View application summary/timeline | Yes | Yes | Yes (own/assigned) | Yes
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI generates a one-paragraph summary of an application's current state instead of forcing the recruiter to open five tabs - for example: "Rahul is currently in Client Review. Resume match was 89%, AI screening completed successfully, and technical interview feedback was positive. Client feedback has been pending for two days." The summary is derived strictly from the application's own structured data (stage, match score, screening result, interview feedback, timestamps).
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Cross-application AI comparison ('which of my applications need attention today' belongs to Pipeline/Module 10, not here)
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- Application CRUD
- Stage history tracking
- AI one-paragraph summary
- Notes/timeline
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Match score and screening status always reflect the specific job, not the candidate globally
- Stage history correctly records entered_at/exited_at for every transition
- AI summary never contradicts the structured fields on the same application
- Tenant isolation
 
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

Simple UI Template — Module 5: Applications Management
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


