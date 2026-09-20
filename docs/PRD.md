# Product Requirements — Scoreboad (as-built)

**Status legend used throughout `docs/`:**
`IMPLEMENTED` · `PARTIAL` · `MISSING` · `RISK` · `UNKNOWN`

This document describes **what the code actually does today**, reverse-engineered
from the repository. It is not a wish list. Where a feature exists in the
specification (`docs/modules/`) but not in the code, it is marked `MISSING` and
named as such.

---

## 1. What this product is

A **multi-tenant, AI-assisted recruitment operating system**. An organization
signs up, invites a team, posts jobs, collects candidates (manually, in bulk, or
through a public application link), and moves each application through an
eight-stage pipeline. AI assists at every stage — parsing resumes, scoring
match, placing voice screening calls, drafting reports and messages — but the
product's governing rule is that **AI proposes and a human confirms**; the
manual workflow always remains usable when AI is unavailable.

**Primary users:** recruitment agencies and in-house talent teams.
**Secondary actors with no login:** candidates (public application form, live
coding round, unsubscribe link) and integration providers (Bolna webhook).

---

## 2. Roles

`IMPLEMENTED` — enum `public.org_role` = `owner | admin | recruiter | viewer`.

| Role | Can do |
| --- | --- |
| **owner** | Everything. Sole role that may grant or revoke Owner. Cannot be reduced below one active Owner per org. |
| **admin** | Team, settings, integrations, automations, privacy, templates, voice agents. Cannot grant/revoke Owner. |
| **recruiter** | Jobs, candidates, applications, interviews, resumes, evaluations, messages, screening. Cannot change settings or activate automations. |
| **viewer** | Read-only across the product. |

Enforced in **three** places: the settings catalogue (`app/settings/catalog.ts`)
hides what a role cannot use, `requireRole()` rejects it in the API, and RLS
policies reject it at the database. A role change always requires a second
person — the `prevent_self_role_change` trigger (migration `0036`) blocks
self-edits even via direct PostgREST.

---

## 3. Feature inventory

### 3.1 Authentication & organization — `IMPLEMENTED`
Email/password and Google OAuth via Supabase Auth. Signup → onboarding →
create-or-join an organization. Multi-org membership with a validated
active-organization cookie and a switcher. Team invites by emailed token,
7-day expiry, accepted through a `security definer` RPC.
Pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`,
`/onboarding`, `/invite/[token]`, `/team/invite`, `/organizations/switch`.

> `RISK` — invite tokens are **bearer credentials, not identity-bound**. See
> `docs/SECURITY.md` §Authentication, finding **S-01**.

### 3.2 Dashboard — `IMPLEMENTED` (thin by design)
KPI tiles, an attention queue, quick links, and an AI-generated Daily Brief
guarded by `lib/ai/numericGuard.ts` so the prose can never state a number that
contradicts the tiles. Metrics that depend on unbuilt modules degrade to an
explicit *pending* state rather than reporting a false `0`
(`lib/dashboard/metrics.ts`).

### 3.3 Jobs — `IMPLEMENTED`
CRUD, draft/open/on-hold/closed status, required vs preferred skills, salary and
experience ranges (DB-enforced), owner recruiter, per-job hiring stages, health
rules, AI extraction of a job from a pasted description, per-job screening and
interview question lists, per-job resume passing score.

### 3.4 Candidates — `IMPLEMENTED`
CRUD, normalized email/phone (trigger-maintained), duplicate detection and
review queue, structured profile (education/experience/projects), natural-
language search parsed by AI into filters, archive, and an admin-only data
erasure action.

### 3.5 Applications & pipeline — `IMPLEMENTED`
Eight stages, transition rules enforced in code *and* by a stage-history
trigger. Kanban board with SLA colouring, per-stage SLA config, stage timings,
notes, structured evaluations, "Not Shortlisted" flag (reversible, never a
stage), and an AI pipeline-prioritisation assistant.

### 3.6 Resume AI — `IMPLEMENTED`
Upload to a **private** Supabase Storage bucket (10 MB, PDF/DOC/DOCX only),
text extraction (`unpdf`, `mammoth`, `word-extractor`), AI parse into a
structured proposal, and a **side-by-side human review diff** before any field
is written to the candidate record. Bulk intake processes a batch against one
job with deterministic candidate matching and a conflict queue.

### 3.7 AI matching — `IMPLEMENTED`
A deterministic scorer runs first and always; the LLM adds a semantic score when
available. Results are stored with `ai_used` / `ai_error` and a staleness flag
that triggers re-scoring when the job or candidate changes.

### 3.8 Voice screening (Bolna) — `IMPLEMENTED`
Per-organization encrypted credentials, a voice-agent console with a test-call
path, per-job call data with an explicit precedence rule, a consent disclosure
that cannot be disabled, a hard attempt cap, and a signed webhook that records
outcome, transcript and recording. Disconnected by default.

### 3.9 Screening reports — `IMPLEMENTED`
AI drafts a summary from the transcript into `ai_*` columns; a human reviews and
the corrected values land in the primary columns, with `corrected_fields` and
`uncertain_fields` retained as evidence.

### 3.10 Interviews — `IMPLEMENTED`
Scheduling with optional Google Calendar sync (degrades honestly when
unconfigured), feedback with rating + recommendation, and a **live coding
round**: a signed candidate link, CodeMirror editor, autosave, interviewer
monitor, and a frozen submission written into `application_evaluations`.

### 3.11 Clients (agency mode) — `IMPLEMENTED`
Client records, contacts, feedback SLA, AI-generated candidate submissions
stored verbatim, and feedback turnaround tracking.

### 3.12 Automations & stage workflows — `IMPLEMENTED`
A rule catalogue with conditions and up to 10 actions, draft→active lifecycle,
approval queue for sensitive actions, run log with a dedupe key that prevents
runaway re-fires, an org-level kill switch, and a per-job **Stage Workflow
Builder** with pass/fail branching, AI resume shortlisting, `wait_then` delayed
actions, and internal-staff notification. One clock: a single Vercel cron every
5 minutes drains stale-stage rules, approval expiry and the delay queue.

### 3.13 Activity & audit — `IMPLEMENTED`
Append-only `activity_events` (an `UPDATE`/`DELETE` trigger rejects mutation),
actor snapshot preserved after user deletion, an `is_sensitive` flag gating
security events to Owner/Admin, and an AI narrative grounded in the logged facts.

### 3.14 Notifications & candidate communication — `IMPLEMENTED`
Internal in-app + email notifications with per-user preferences, and a separate
candidate-facing layer: message templates (email / WhatsApp / both), pipeline
event triggers, a send pipeline with a masked recipient hint on every log row,
per-candidate opt-out, and a signed unsubscribe link.

### 3.15 Analytics — `IMPLEMENTED`
Funnel, time-to-hire, source effectiveness, recruiter load, trend direction,
filters, CSV export, and an AI explainer under the same numeric guard as the
Daily Brief.

### 3.16 Settings & integrations — `IMPLEMENTED`
One settings catalogue drives both the landing grid and each page's own role
check. Adapters for `bolna | calendar | email | llm | n8n | whatsapp`, each with
`connect/test/getStatus/disconnect`, AES-GCM credentials, and honest status
reporting.

### 3.17 Public application forms — `IMPLEMENTED`
Form builder, signed public link with a `token_version` kill switch, QR code,
rate-limited public submission, resume upload, and reuse of the existing
candidate/application/resume pipeline rather than a parallel one.

### 3.18 Onboarding & documents — `IMPLEMENTED`
A hire triggers an onboarding record; a document checklist from org templates,
a private bucket, 60-second signed read URLs, verification workflow, and an
overdue sweep.

### 3.19 Public marketing site — `IMPLEMENTED`
`/`, `/product/[slug]`, `/how-it-works`, publicly readable by design.

### 3.20 Privacy & consent — `PARTIAL`
Consent settings, recording gate, processor disclosure, privacy notice, and a
**pure** retention planner with tests — but **no executor**. Nothing is
actually deleted on expiry. The Security & data settings page says so in words;
the Privacy page does not. See `docs/PRIVACY.md`.

### 3.21 AI & calling cost tracking — `MISSING`
No usage table, no token metering, no per-organization budget, no cap. Named as
a required retrofit in `README.md` and `docs/modules/00-cost-tracking.md`.

---

## 4. Core user flows

1. **Sign up → onboarding → org created → dashboard.**
2. **Invite a teammate:** Owner/Admin issues an invite → email link →
   `/invite/[token]` → sign in → `accept_invite` RPC → membership created.
3. **Post a job → configure hiring stages → build a stage workflow → publish an
   application form → share the link/QR.**
4. **Candidate applies publicly:** rate limit → validate → resume stored →
   candidate matched or created → application created → form response linked →
   automations dispatched.
5. **Resume parse → human review diff → accept fields → candidate updated.**
6. **AI match → shortlist branch → pass advances / fail flags (reversible) /
   needs-review does nothing.**
7. **Screening call:** consent disclosure → Bolna places call → webhook records
   transcript → AI drafts report → human reviews and corrects.
8. **Interview scheduled → optional calendar invite → optional coding round via
   signed candidate link → feedback → evaluation.**
9. **Hire → onboarding record → document checklist → verification → complete.**
10. **Every step writes an activity event; automations may notify, message, wait,
    or request a form.**

---

## 5. Explicit non-goals in the current build

- No candidate portal — candidates never authenticate.
- No billing or subscription management.
- No mobile app.
- No self-serve organization deletion beyond the admin erasure action.
- No multi-region or data-residency selection.
