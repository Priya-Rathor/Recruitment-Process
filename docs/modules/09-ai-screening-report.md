MODULE 9
AI Screening Report (Summarization)
Purpose
A raw call transcript is not useful to a busy recruiter. This module turns an 8-minute Bolna conversation into a 60-second, structured screening report.
Key Features / What This Module Manages
	•	One-paragraph natural-language summary of the call
	•	Structured extraction: interest level, expected CTC, notice period, location acceptance, availability
	•	Confidence/uncertainty flags on ambiguous answers
	•	Recruiter review step before the summary is treated as authoritative
Main Routes
	•	/applications/[id]/screening-report
Core Data Model
	•	screening_reports (id, screening_call_id, application_id, summary_text, interest_level, expected_ctc, notice_period_days, location_accepted, availability_notes, reviewed_by, reviewed_at)
UI / Operational Flow
	•	Screening call marked completed (Module 8) -> AI generates summary + structured fields
	•	Report appears on the application with a 'Pending Review' flag
	•	Recruiter reviews, corrects if needed, marks as reviewed
	•	Reviewed report feeds Application summary (Module 5), Pipeline prioritization (Module 10), and Analytics (Module 16)
How This Module Connects To The Others
Depends on:
	•	Module 8: screening_calls (must exist and be in a completed state; a failed/no-answer call has no transcript to summarize)
	•	Module 6: reuse the same AI Service Layer folder/pattern
Provides for later modules:
	•	screening_reports — read by Module 5 (application summary), Module 10 (pipeline prioritization), Module 11 (interview brief), Module 12 (client submission draft), Module 16 (analytics)
How AI Is Used In This Module
AI extracts answers from the call transcript and writes a short narrative such as: "Rahul has approximately five years of Java/Spring Boot experience and production AWS exposure. He is actively looking for opportunities, expects 19 LPA, has a 30-day notice period and is comfortable with the Gurgaon hybrid model. Kubernetes experience requires verification." It also produces structured fields (Interest: High, Expected CTC: 19 LPA, Notice: 30 days, Location: Accepted, Availability: Weekdays after 5 PM). As with resume parsing, the pattern is AI extracts, human verifies - the recruiter reviews before the report is treated as authoritative business data.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
View screening report
Yes
Yes
Yes
Yes
Review/correct report
Yes
Yes
Yes (own applications)
No
Build Now (MVP)
	•	AI summary + structured extraction from transcript
	•	Recruiter review/correction flow
	•	Feed into Application summary and Pipeline
Build Later (Not MVP)
	•	Sentiment/tone analysis of the call
	•	Automatic red-flag detection beyond the configured questions
Testing Checklist
	•	Structured fields are derivable from the transcript (spot-check against source text)
	•	Uncertain/ambiguous answers are flagged rather than guessed confidently
	•	Recruiter corrections persist and are distinguishable from the original AI output
	•	Report generation fails gracefully if the transcript is empty or a call failed
Claude Implementation Prompt — Module 9: AI Screening Report (Summarization)
Save this specification as /docs/modules/09-ai-screening-report-summarization.md, then give Claude the prompt below:
Build Module 9: AI Screening Report (Summarization) for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/09-ai-screening-report-summarization.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- Module 8: screening_calls (must exist and be in a completed state; a failed/no-answer call has no transcript to summarize)
- Module 6: reuse the same AI Service Layer folder/pattern
 
Provides for later modules (do not rename/remove once other modules depend on it):
- screening_reports — read by Module 5 (application summary), Module 10 (pipeline prioritization), Module 11 (interview brief), Module 12 (client submission draft), Module 16 (analytics)
 
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
 
- screening_reports (id, screening_call_id, application_id, summary_text, interest_level, expected_ctc, notice_period_days, location_accepted, availability_notes, reviewed_by, reviewed_at)
 
Required indexes (at minimum):
- index on organization_id
- index on screening_call_id
- index on application_id
- composite index on (organization_id, created_at) for any table queried by recent activity or date range
 
RLS rules:
- SELECT/INSERT/UPDATE/DELETE policies all filter on organization_id = auth resolved tenant
- No database function in this module may accept an arbitrary organization_id/tenant parameter from the browser
- Role checks (Owner/Admin/Recruiter/Viewer) are enforced both in RLS where feasible and again in the API layer
 
=================================================================
6. BACKEND — API ENDPOINTS
=================================================================
- GET /api/screening-reports — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/screening-reports — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/screening-reports/:id — fetch one record the caller's organization owns
- PATCH /api/screening-reports/:id — partial update, role-checked
- DELETE /api/screening-reports/:id — soft-delete/archive where applicable, role-checked
- POST /api/screening-reports/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: A raw call transcript is not useful to a busy recruiter. This module turns an 8-minute Bolna conversation into a 60-second, structured screening report.
 
Features to implement, exactly as scoped:
- One-paragraph natural-language summary of the call
- Structured extraction: interest level, expected CTC, notice period, location acceptance, availability
- Confidence/uncertainty flags on ambiguous answers
- Recruiter review step before the summary is treated as authoritative
 
Pages/routes for this module:
- /applications/[id]/screening-report
 
Step-by-step operational flow to implement:
1. Screening call marked completed (Module 8) -> AI generates summary + structured fields
2. Report appears on the application with a 'Pending Review' flag
3. Recruiter reviews, corrects if needed, marks as reviewed
4. Reviewed report feeds Application summary (Module 5), Pipeline prioritization (Module 10), and Analytics (Module 16)
 
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
View screening report | Yes | Yes | Yes | Yes
Review/correct report | Yes | Yes | Yes (own applications) | No
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI extracts answers from the call transcript and writes a short narrative such as: "Rahul has approximately five years of Java/Spring Boot experience and production AWS exposure. He is actively looking for opportunities, expects 19 LPA, has a 30-day notice period and is comfortable with the Gurgaon hybrid model. Kubernetes experience requires verification." It also produces structured fields (Interest: High, Expected CTC: 19 LPA, Notice: 30 days, Location: Accepted, Availability: Weekdays after 5 PM). As with resume parsing, the pattern is AI extracts, human verifies - the recruiter reviews before the report is treated as authoritative business data.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Sentiment/tone analysis of the call
- Automatic red-flag detection beyond the configured questions
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- AI summary + structured extraction from transcript
- Recruiter review/correction flow
- Feed into Application summary and Pipeline
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Structured fields are derivable from the transcript (spot-check against source text)
- Uncertain/ambiguous answers are flagged rather than guessed confidently
- Recruiter corrections persist and are distinguishable from the original AI output
- Report generation fails gracefully if the transcript is empty or a call failed
 
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

Simple UI Template — Module 9: AI Screening Report (Summarization)
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


