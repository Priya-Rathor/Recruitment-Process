MODULE 1
Authentication & Organization
Purpose
This module is the entry gate to the entire platform. It establishes multi-tenant workspaces (organizations), authenticates users, and enforces that every subsequent module operates within a single tenant's boundary. Nothing else in the product works correctly if this module is wrong.
Key Features / What This Module Manages
	•	Organization (tenant) sign-up and workspace creation
	•	Email/password and OAuth login via Supabase Auth
	•	Invite flow for adding recruiters, admins, and hiring managers
	•	Role assignment: Owner, Admin, Recruiter, Viewer
	•	Organization switching for users who belong to more than one tenant
	•	Session management and password reset
	•	Initial onboarding questionnaire (industry, hiring focus, team size)
Main Routes
	•	/login
	•	/signup
	•	/onboarding
	•	/organizations/switch
	•	/team/invite
Core Data Model
	•	organizations (id, name, industry, size, country, timezone, created_at)
	•	users (id, auth_id, name, email, avatar_url)
	•	organization_members (organization_id, user_id, role, status, invited_by, joined_at)
	•	invites (id, organization_id, email, role, token, expires_at, status)
UI / Operational Flow
	•	New user signs up -> creates organization -> becomes Owner
	•	Owner invites teammates by email with a pre-selected role
	•	Invited user accepts -> account created -> joins organization_members
	•	Every authenticated request resolves organization_id from the session, never from client input
How This Module Connects To The Others
Depends on:
	•	None — this is the foundation module. Build it first; every other module imports its tenant/role helpers.
Provides for later modules:
	•	organizations, users, organization_members, invites tables
	•	A tenant-resolution helper (e.g. getCurrentOrganizationId()) that every other module's API routes must call instead of trusting any client-supplied organization_id
	•	A role-check helper (Owner/Admin/Recruiter/Viewer) reused by every module's API and RLS layer
How AI Is Used In This Module
AI plays a light, optional role here as an onboarding assistant. After sign-up, the organization answers a short question such as "What type of hiring do you mostly do?" (e.g. "IT recruitment, mostly Java, React, DevOps"). AI uses that answer to recommend a starting set of screening templates, a default pipeline, default interview rounds, candidate fields, and automation templates - all of which the Owner can accept, edit, or skip. AI does not create users, assign roles, or touch permissions; those remain deterministic, code-controlled actions.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
Create organization
n/a (any new user)
-
-
-
Invite/remove members
Yes
Yes
No
No
Change roles
Yes
Yes
No
No
Accept onboarding AI suggestions
Yes
Yes
No
No
Build Now (MVP)
	•	Sign up / login / logout
	•	Organization creation
	•	Invite + accept flow
	•	Roles: Owner, Admin, Recruiter, Viewer
	•	Tenant resolution on every request
Build Later (Not MVP)
	•	SSO/SAML
	•	SCIM provisioning
	•	Multi-region data residency
	•	Fully custom RBAC builder
Testing Checklist
	•	Sign-up creates exactly one organization and one Owner
	•	Invited users cannot join without a valid, unexpired token
	•	A user in Org A can never read/write data belonging to Org B
	•	Role changes take effect immediately on next request
Claude Implementation Prompt — Module 1: Authentication & Organization
Save this specification as /docs/modules/01-authentication-organization.md, then give Claude the prompt below:
Build Module 1: Authentication & Organization for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/01-authentication-organization.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- None — this is the foundation module. Build it first; every other module imports its tenant/role helpers.
 
Provides for later modules (do not rename/remove once other modules depend on it):
- organizations, users, organization_members, invites tables
- A tenant-resolution helper (e.g. getCurrentOrganizationId()) that every other module's API routes must call instead of trusting any client-supplied organization_id
- A role-check helper (Owner/Admin/Recruiter/Viewer) reused by every module's API and RLS layer
 
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
 
- organizations (id, name, industry, size, country, timezone, created_at)
- users (id, auth_id, name, email, avatar_url)
- organization_members (organization_id, user_id, role, status, invited_by, joined_at)
- invites (id, organization_id, email, role, token, expires_at, status)
 
Required indexes (at minimum):
- index on organization_id
- index on created_at
- index on auth_id
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
- GET /api/organizations — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/organizations — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/organizations/:id — fetch one record the caller's organization owns
- PATCH /api/organizations/:id — partial update, role-checked
- DELETE /api/organizations/:id — soft-delete/archive where applicable, role-checked
- POST /api/organizations/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: This module is the entry gate to the entire platform. It establishes multi-tenant workspaces (organizations), authenticates users, and enforces that every subsequent module operates within a single tenant's boundary. Nothing else in the product works correctly if this module is wrong.
 
Features to implement, exactly as scoped:
- Organization (tenant) sign-up and workspace creation
- Email/password and OAuth login via Supabase Auth
- Invite flow for adding recruiters, admins, and hiring managers
- Role assignment: Owner, Admin, Recruiter, Viewer
- Organization switching for users who belong to more than one tenant
- Session management and password reset
- Initial onboarding questionnaire (industry, hiring focus, team size)
 
Pages/routes for this module:
- /login
- /signup
- /onboarding
- /organizations/switch
- /team/invite
 
Step-by-step operational flow to implement:
1. New user signs up -> creates organization -> becomes Owner
2. Owner invites teammates by email with a pre-selected role
3. Invited user accepts -> account created -> joins organization_members
4. Every authenticated request resolves organization_id from the session, never from client input
 
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
Create organization | n/a (any new user) | - | - | -
Invite/remove members | Yes | Yes | No | No
Change roles | Yes | Yes | No | No
Accept onboarding AI suggestions | Yes | Yes | No | No
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI plays a light, optional role here as an onboarding assistant. After sign-up, the organization answers a short question such as "What type of hiring do you mostly do?" (e.g. "IT recruitment, mostly Java, React, DevOps"). AI uses that answer to recommend a starting set of screening templates, a default pipeline, default interview rounds, candidate fields, and automation templates - all of which the Owner can accept, edit, or skip. AI does not create users, assign roles, or touch permissions; those remain deterministic, code-controlled actions.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- SSO/SAML
- SCIM provisioning
- Multi-region data residency
- Fully custom RBAC builder
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- Sign up / login / logout
- Organization creation
- Invite + accept flow
- Roles: Owner, Admin, Recruiter, Viewer
- Tenant resolution on every request
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Sign-up creates exactly one organization and one Owner
- Invited users cannot join without a valid, unexpired token
- A user in Org A can never read/write data belonging to Org B
- Role changes take effect immediately on next request
 
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

Simple UI Template — Module 1: Authentication & Organization
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


