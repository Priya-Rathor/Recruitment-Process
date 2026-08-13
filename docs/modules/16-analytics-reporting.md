MODULE 16
Analytics & Reporting
Purpose
This module turns all recruitment activity into business intelligence for recruiters, owners, and clients. A manager should be able to answer in seconds: where candidates come from, where they get stuck, how recruiters are performing, how long hiring takes, how many calls/interviews convert, and which clients/jobs need attention.
Key Features / What This Module Manages
	•	Recruitment funnel metrics
	•	Time-to-hire and time-in-stage
	•	Source performance and recruiter performance
	•	Job performance and client performance
	•	AI screening and Bolna call performance
	•	Interview conversion and offer conversion
	•	Placement counts and pipeline aging
	•	Follow-up SLA performance and automation success/failure
	•	Trend comparisons and exportable reports
Main Routes
	•	/analytics (single page with tabs for MVP)
	•	/analytics/recruitment, /analytics/recruiters, /analytics/jobs, /analytics/clients, /analytics/screening, /analytics/automations (optional sub-pages)
Core Data Model
	•	Analytics reads from operational tables (applications, application_stage_history, screening_calls, interviews, automation_runs, clients) via SQL views: analytics_application_funnel, analytics_recruiter_performance, analytics_job_performance, analytics_client_performance, analytics_screening_metrics
	•	Materialized views/aggregate tables introduced later for expensive calculations (12-month trends, aging across millions of rows)
UI / Operational Flow
	•	Owner opens Analytics -> selects Last 30 Days -> sees KPI cards, funnel, time-to-hire, time-in-stage, bottleneck stage
	•	Filters (date range, client, job, recruiter) apply consistently across every tab, with a 'compare with previous period' toggle
	•	Owner filters by recruiter/job/client, reviews Bolna screening performance and automation reliability, then exports a filtered CSV report
Design / Color Specification
	•	KPI card: background #FFFFFF, border #E2E8F0, radius 12px; main value 28-32px, label 13-14px
	•	Positive trend #16A34A, negative trend #DC2626 (note: for time-to-hire, lower is better - do not assume all increases are positive)
	•	Funnel: primary #4F46E5 with lighter tints for each step; avoid 3D funnels
	•	Charts: primary series #4F46E5, secondary/reference neutral gray, success #16A34A, warning #F59E0B, error #DC2626; avoid rainbow charts; 3-5 major visuals per tab
How This Module Connects To The Others
Depends on:
	•	Module 3: jobs
	•	Module 4: candidates
	•	Module 5: applications + application_stage_history
	•	Module 7: application_matches
	•	Module 8: screening_calls
	•	Module 9: screening_reports
	•	Module 10: pipeline_sla_config
	•	Module 11: interviews + interview_feedback
	•	Module 12: clients + client_feedback_events
	•	Module 13: automation_runs
	•	— nearly every operational table built so far, via read-only SQL views
Provides for later modules:
	•	analytics_application_funnel, analytics_recruiter_performance, analytics_job_performance, analytics_client_performance, analytics_screening_metrics — read-only views; no other module depends on these
Retrofit required:
If any of Modules 3-13 change their schema after this module is built, re-run and validate every analytics_* view against the current schema before trusting its output again.
How AI Is Used In This Module
AI turns raw numbers into explanation: "Your largest bottleneck this month is Client Review. Average time increased from 2.9 to 4.8 days. ABC Tech and FinCorp account for 61% of delayed client feedback. Screening conversion improved by 12%, while interview-to-offer conversion fell from 31% to 27%." An 'Ask Analytics AI' entry point lets management ask questions like "Why did placements drop this month?", "Which client is causing delays?", "Which candidate source produces the highest interview conversion?", or "How many recruiter hours did AI screening potentially save?" AI reads and explains the analytics data conversationally; it does not replace the deterministic metric calculations, and build order should always be deterministic metrics first, AI narration second.
Recruitment Funnel & Conversion
Applications 842 -> AI Screened 514 -> Shortlisted 218 -> Interviews 126 -> Offers 34 -> Hired 21, with stage-to-stage conversion rates (e.g. Application to Screening 61%, Screening to Shortlist 42%, Shortlist to Interview 58%, Interview to Offer 27%, Offer to Hire 62%).
Time-to-Hire & Time-in-Stage
Average and median time-to-hire (median avoids distortion from outliers). Time-in-stage computed from stage entry/exit timestamps in application_stage_history, with bottleneck stages highlighted using amber/red indicators (not banners) when they exceed the configured SLA.
Source, Recruiter, Job & Client Performance
Source performance (candidates, interviews, hires, hire rate) rendered as two focused bar charts. Recruiter performance shown with workload and outcomes as separate views, never a single ranked leaderboard. Job performance with a rule-based Healthy / Needs Attention indicator. Client performance centered on Average Client Feedback Time.
AI Screening, Bolna & Automation Analytics
AI calls attempted/answered/completed/no-answer/failed with answer and completion rates. Bolna metrics including duration, callback requests, calls by language/job/recruiter. Estimated screening time saved (labeled explicitly as an estimate). Automation run success/failure rates with a per-automation failure table.
Interviews, Offers, Placements & SLA
Interview completion/no-show rates and interview-to-offer conversion. Offer acceptance rate. Placement counts with month-over-month growth, broken down by client/recruiter/source/job type. Follow-up SLA compliance percentage.
Role Permissions
Permission
Owner
Admin
Recruiter
Viewer
Full analytics (all tabs)
Yes
Yes
Configurable
Read-only
Company-wide recruiter comparisons
Yes
Yes
Restricted (MVP default)
Restricted
CSV export
Yes
Yes
Yes (own scope)
No
Build Now (MVP)
	•	Analytics overview, date filters, funnel, conversion rates
	•	Time-to-hire, time-in-stage, source performance
	•	Recruiter/job/client metrics
	•	AI screening/Bolna metrics, interview metrics, automation metrics, SLA metrics
	•	CSV exports, responsive charts, permissions, tenant isolation
Build Later (Not MVP)
	•	Predictive hiring forecasts, AI performance scoring of recruiters, automated workforce forecasting
	•	Financial accounting/revenue recognition, custom report builder, arbitrary SQL reporting
	•	Scheduled PDF reports, BI warehouse, cross-tenant/benchmark analytics
Testing Checklist
	•	Date filters, recruiter/client/job filters, and previous-period comparisons
	•	No data / one record / large dataset behavior and insufficient-data messaging
	•	Funnel counts, conversion percentages, stage duration, time-to-hire (zero-denominator safety)
	•	Timezone boundaries (e.g. 'today' by organization local time)
	•	CSV export matches on-screen filtered results exactly; permissions and tenant isolation on export
Claude Implementation Prompt — Module 16: Analytics & Reporting
Save this specification as /docs/modules/16-analytics-reporting.md, then give Claude the prompt below:
Build Module 16: Analytics & Reporting for my multi-tenant recruitment SaaS.
 
Before writing any code, read: the global design system, /docs/modules/16-analytics-reporting.md, and every previously built module's code/spec (earlier modules define tables, RLS conventions, and the AI Service Layer this module must reuse).
 
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
- Module 3: jobs
- Module 4: candidates
- Module 5: applications + application_stage_history
- Module 7: application_matches
- Module 8: screening_calls
- Module 9: screening_reports
- Module 10: pipeline_sla_config
- Module 11: interviews + interview_feedback
- Module 12: clients + client_feedback_events
- Module 13: automation_runs
- — nearly every operational table built so far, via read-only SQL views
 
Provides for later modules (do not rename/remove once other modules depend on it):
- analytics_application_funnel, analytics_recruiter_performance, analytics_job_performance, analytics_client_performance, analytics_screening_metrics — read-only views; no other module depends on these
 
Retrofit required — go back and connect earlier/later modules, do not just build this module forward:
If any of Modules 3-13 change their schema after this module is built, re-run and validate every analytics_* view against the current schema before trusting its output again.
 
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
 
Module-specific color/layout rules for Analytics & Reporting:
- KPI card: background #FFFFFF, border #E2E8F0, radius 12px; main value 28-32px, label 13-14px
- Positive trend #16A34A, negative trend #DC2626 (note: for time-to-hire, lower is better - do not assume all increases are positive)
- Funnel: primary #4F46E5 with lighter tints for each step; avoid 3D funnels
- Charts: primary series #4F46E5, secondary/reference neutral gray, success #16A34A, warning #F59E0B, error #DC2626; avoid rainbow charts; 3-5 major visuals per tab
 
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
 
- Analytics reads from operational tables (applications, application_stage_history, screening_calls, interviews, automation_runs, clients) via SQL views: analytics_application_funnel, analytics_recruiter_performance, analytics_job_performance, analytics_client_performance, analytics_screening_metrics
- Materialized views/aggregate tables introduced later for expensive calculations (12-month trends, aging across millions of rows)
 
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
- GET /api/analytics-reporting — list, organization-scoped, supports pagination + the module's standard filters
- POST /api/analytics-reporting — create a new record (validates payload server-side, ignores any client-supplied organization_id)
- GET /api/analytics-reporting/:id — fetch one record the caller's organization owns
- PATCH /api/analytics-reporting/:id — partial update, role-checked
- DELETE /api/analytics-reporting/:id — soft-delete/archive where applicable, role-checked
- POST /api/analytics-reporting/:id/ai-action — invokes the module's AI Service Layer function (see AI Integration section) and returns structured, unsaved suggestions for review
- Every endpoint validates the caller's role against the permissions table in section 9 before executing
- Every list endpoint supports the module's standard filters (see UI section) as query parameters, validated server-side
- Never return another organization's data even if a valid-looking id is guessed/passed in
 
=================================================================
7. FUNCTIONALITY — WHAT THIS MODULE MUST DO
=================================================================
Purpose: This module turns all recruitment activity into business intelligence for recruiters, owners, and clients. A manager should be able to answer in seconds: where candidates come from, where they get stuck, how recruiters are performing, how long hiring takes, how many calls/interviews convert, and which clients/jobs need attention.
 
Features to implement, exactly as scoped:
- Recruitment funnel metrics
- Time-to-hire and time-in-stage
- Source performance and recruiter performance
- Job performance and client performance
- AI screening and Bolna call performance
- Interview conversion and offer conversion
- Placement counts and pipeline aging
- Follow-up SLA performance and automation success/failure
- Trend comparisons and exportable reports
 
Pages/routes for this module:
- /analytics (single page with tabs for MVP)
- /analytics/recruitment, /analytics/recruiters, /analytics/jobs, /analytics/clients, /analytics/screening, /analytics/automations (optional sub-pages)
 
Step-by-step operational flow to implement:
1. Owner opens Analytics -> selects Last 30 Days -> sees KPI cards, funnel, time-to-hire, time-in-stage, bottleneck stage
2. Filters (date range, client, job, recruiter) apply consistently across every tab, with a 'compare with previous period' toggle
3. Owner filters by recruiter/job/client, reviews Bolna screening performance and automation reliability, then exports a filtered CSV report
 
Additional required behavior:
- Recruitment Funnel & Conversion: Applications 842 -> AI Screened 514 -> Shortlisted 218 -> Interviews 126 -> Offers 34 -> Hired 21, with stage-to-stage conversion rates (e.g. Application to Screening 61%, Screening to Shortlist 42%, Shortlist to Interview 58%, Interview to Offer 27%, Offer to Hire 62%).
- Time-to-Hire & Time-in-Stage: Average and median time-to-hire (median avoids distortion from outliers). Time-in-stage computed from stage entry/exit timestamps in application_stage_history, with bottleneck stages highlighted using amber/red indicators (not banners) when they exceed the configured SLA.
- Source, Recruiter, Job & Client Performance: Source performance (candidates, interviews, hires, hire rate) rendered as two focused bar charts. Recruiter performance shown with workload and outcomes as separate views, never a single ranked leaderboard. Job performance with a rule-based Healthy / Needs Attention indicator. Client performance centered on Average Client Feedback Time.
- AI Screening, Bolna & Automation Analytics: AI calls attempted/answered/completed/no-answer/failed with answer and completion rates. Bolna metrics including duration, callback requests, calls by language/job/recruiter. Estimated screening time saved (labeled explicitly as an estimate). Automation run success/failure rates with a per-automation failure table.
- Interviews, Offers, Placements & SLA: Interview completion/no-show rates and interview-to-offer conversion. Offer acceptance rate. Placement counts with month-over-month growth, broken down by client/recruiter/source/job type. Follow-up SLA compliance percentage.
 
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
Full analytics (all tabs) | Yes | Yes | Configurable | Read-only
Company-wide recruiter comparisons | Yes | Yes | Restricted (MVP default) | Restricted
CSV export | Yes | Yes | Yes (own scope) | No
Hide or disable (not just visually gray out without blocking) any action a role is not permitted to take — the API must reject it independently of the UI.
 
=================================================================
10. AI INTEGRATION — EXACT BEHAVIOR REQUIRED
=================================================================
AI turns raw numbers into explanation: "Your largest bottleneck this month is Client Review. Average time increased from 2.9 to 4.8 days. ABC Tech and FinCorp account for 61% of delayed client feedback. Screening conversion improved by 12%, while interview-to-offer conversion fell from 31% to 27%." An 'Ask Analytics AI' entry point lets management ask questions like "Why did placements drop this month?", "Which client is causing delays?", "Which candidate source produces the highest interview conversion?", or "How many recruiter hours did AI screening potentially save?" AI reads and explains the analytics data conversationally; it does not replace the deterministic metric calculations, and build order should always be deterministic metrics first, AI narration second.
 
Implementation requirements:
- Route this module's AI calls through a single, named function in the shared AI Service Layer (e.g. lib/ai/<moduleFunctionName>.ts) — never call the LLM provider directly from a React component or route handler.
- The AI function must accept only the structured data it needs (never raw, unscoped database access) and must return a typed, validated structure — reject and surface an error on malformed AI output rather than rendering it.
- Follow the platform-wide pattern strictly: Raw Data -> AI Processing -> Structured Output -> Validation -> Human Review (where the spec calls for it) -> Business Action. AI output must never write directly to a trusted table without the review step described in section 7/8 for this module.
- Log every AI call's inputs/outputs at a summary level to the Activity & Audit module for traceability, without storing secrets or full raw provider payloads unnecessarily.
 
=================================================================
11. OUT OF SCOPE — DO NOT BUILD THESE NOW
=================================================================
- Predictive hiring forecasts, AI performance scoring of recruiters, automated workforce forecasting
- Financial accounting/revenue recognition, custom report builder, arbitrary SQL reporting
- Scheduled PDF reports, BI warehouse, cross-tenant/benchmark analytics
- Anything from another module's spec that has not been built yet — stub/interface against it instead of re-implementing it here
 
=================================================================
12. MVP DEFINITION OF DONE
=================================================================
- Analytics overview, date filters, funnel, conversion rates
- Time-to-hire, time-in-stage, source performance
- Recruiter/job/client metrics
- AI screening/Bolna metrics, interview metrics, automation metrics, SLA metrics
- CSV exports, responsive charts, permissions, tenant isolation
 
=================================================================
13. TESTING — WRITE AND RUN ALL OF THESE BEFORE CALLING THE MODULE DONE
=================================================================
Functional tests (module-specific):
- Date filters, recruiter/client/job filters, and previous-period comparisons
- No data / one record / large dataset behavior and insufficient-data messaging
- Funnel counts, conversion percentages, stage duration, time-to-hire (zero-denominator safety)
- Timezone boundaries (e.g. 'today' by organization local time)
- CSV export matches on-screen filtered results exactly; permissions and tenant isolation on export
 
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

Simple UI Template — Module 16: Analytics & Reporting
Wireframe only — a minimal reference for structure and color usage, not a pixel-perfect design. Build the real UI with the project's existing component library.


