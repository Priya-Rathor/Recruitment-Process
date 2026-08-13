
AI-Powered Recruitment Operating System
Complete Product & Engineering Specification — 17 Core Modules
Multi-Tenant Recruitment SaaS · Next.js · Supabase · n8n · Bolna AI · LLM Layer

How to Read and Use This Document
This document specifies a single connected product — an AI-powered Recruitment Operating System — broken into 17 core modules. Each module has its own page (or pages) covering purpose, features, routes, data model, UI flow, design tokens, AI integration, permissions, MVP scope, testing checklist, and a ready-to-use Claude implementation prompt. The modules are meant to be built roughly in order, since later modules (Pipeline, Interviews, Analytics, Settings) depend on data structures introduced earlier (Authentication, Jobs, Candidates, Applications).
The Core Design Principle
AI should not sit in one "AI module." AI should sit across the whole recruitment workflow and assist at the right points. This is not a CRM with some AI features bolted on — it is a Recruitment Operating System where AI handles repetitive understanding, screening, summarization, and operational guidance, while recruiters remain responsible for consequential hiring decisions.
End-to-End Product Flow
	•	Client creates requirement → Job created
	•	Candidates enter the system (career page, upload, referral, email, agency database, manual)
	•	Resume parsed by AI → candidate profile structured
	•	Candidate matched to job (deterministic checks + AI semantic matching)
	•	AI screening call (Bolna) → call summarized into a structured report
	•	Recruiter reviews AI output → candidate moves through the pipeline
	•	Interview scheduled (AI-prepared brief) → client reviews → Offer → Hire
	•	Everything is measured in Analytics and improved via Automation
Technology Stack Used Throughout
	•	Next.js (App Router) + TypeScript
	•	Bulma for base styling, project design tokens for color/spacing
	•	Supabase (PostgreSQL + Auth + Storage) with Row-Level Security
	•	n8n for workflow/automation orchestration
	•	Bolna AI for outbound/inbound voice screening calls
	•	An LLM provider (OpenAI, swappable later) behind an internal AI Service Layer
Color Legend — What Each Color Means and Where To Use It
Every module uses the same color tokens for the same purpose, so a recruiter or manager learns the visual language once and reuses it everywhere. The swatch column below shows the actual color.
Token
Swatch / Hex
What it tells the user / where to use it
Primary
4F46E5
Buttons, links, active nav item, primary chart series, funnel color — the main call-to-action color across the whole app
Primary Hover
4338CA
Hover/pressed state of any primary button or link
Background
F8FAFC
Page background behind cards — never used on a card itself
Card
FFFFFF
Background of every card/panel/table
Border
E2E8F0
1px borders on cards, tables, dividers, and input fields
Main Text
0F172A
Headings and primary body text
Secondary Text
64748B
Labels, captions, timestamps, helper text
Success
16A34A
Positive trend, Connected status, completed/healthy states, on-time SLA
Warning
F59E0B
SLA at risk, Needs Attention status, pending/awaiting-review states
Error
DC2626
Negative trend, failed/disconnected states, destructive actions (delete/disconnect)
Info
2563EB
Informational badges, neutral status callouts, AI-generated summary boxes
The AI Architecture Pattern (applies to every module)
Don't let every module independently call an LLM. Route all AI calls through one centralized AI Service Layer with purpose-specific functions — parseResume(), matchCandidateToJob(), extractScreeningAnswers(), generateScreeningSummary(), generateInterviewBrief(), generateCandidateSubmission(), summarizeActivity(), explainAnalytics() — rather than one generic askAI(). This makes the system easy to test, easy to control, and easy to migrate between LLM providers (OpenAI → Claude → Gemini) without rewriting all 17 modules.
Across the entire platform, follow this sequence: Raw Business Data → AI Processing → Structured Output → Validation → Human Review when needed → Business Action. Never: Raw Data → AI → Immediately perform action. This distinction is what makes the system safe and professional rather than a black box.
What AI Should Control vs. What Code Should Control
Use normal code/database logic for:
	•	Authentication and permissions
	•	Salary comparisons and experience-range checks
	•	Stage changes, scheduling, and database writes
	•	SLA calculations and notification delivery
	•	Tenant security and audit logs
Use AI for:
	•	Resume understanding and semantic skill matching
	•	Summaries, extracting answers, explaining gaps
	•	Creating recruiter/interviewer briefs
	•	Natural-language search
	•	Analytics explanations and drafting communications
Module Map
	•	Module 1 — Authentication & Organization
	•	Module 2 — Dashboard
	•	Module 3 — Jobs Management
	•	Module 4 — Candidates Management
	•	Module 5 — Applications Management
	•	Module 6 — Resume AI (Parsing)
	•	Module 7 — AI Matching (Candidate-to-Job)
	•	Module 8 — Bolna AI Screening (Calling)
	•	Module 9 — AI Screening Report (Summarization)
	•	Module 10 — Advanced Pipeline
	•	Module 11 — Interviews
	•	Module 12 — Clients
	•	Module 13 — Automation Engine
	•	Module 14 — Activity & Audit
	•	Module 15 — Notifications & Communication
	•	Module 16 — Analytics & Reporting
	•	Module 17 — Settings & Integrations

