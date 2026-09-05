# Privacy & Data Protection

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

This product processes candidate personal data — names, contact details, CVs,
salary expectations, **voice recordings and call transcripts**, and identity
documents such as PAN and Aadhaar scans. Several controls here exist as build
constraints rather than compliance tasks, because getting them wrong is
unlawful, not merely untidy.

---

## 1. Personal data inventory

| Category | Where | Sensitivity |
| --- | --- | --- |
| Recruiter identity | `users`, `organization_members` | Low |
| Candidate identity & contact | `candidates` (`email`, `phone`, normalised copies) | Medium |
| CV files | `resumes` bucket (private) + `resumes` rows | Medium–High |
| Parsed CV content | `resume_parse_results.raw_json` | Medium–High |
| Salary, notice period | `candidates`, `screening_reports` | Medium |
| **Voice recordings** | `screening_calls.recording_url` | **High** |
| **Call transcripts** | `screening_calls.transcript`, `voice_agent_test_calls.transcript` | **High** |
| AI evaluations | `application_matches`, `screening_reports`, `application_evaluations` | High (automated decision-making) |
| **Identity documents** | `onboarding-documents` bucket (private) | **High** |
| Public form answers | `form_responses.raw_answers` | Medium |
| Message content | `message_log.body_sent` | Medium |
| Candidate code | `coding_submissions.code` | Low |
| Audit trail | `activity_events` | Medium |

**Deliberately not collected:** raw IP addresses. Both
`form_responses.submitter_ip_hash` and `form_submission_attempts.ip_hash` store
a **keyed HMAC** only. An IP is personal data under GDPR, and a bare SHA-256 of
an IPv4 address is reversible by anyone with a laptop and an afternoon — hence
the HMAC rather than a plain digest. There is also no phone column on `users`,
which is why WhatsApp-to-internal-staff is refused loudly rather than falling
back to the candidate's number.

---

## 2. Consent — `IMPLEMENTED`

`lib/privacy/consent.ts`, `lib/privacy/settings.ts`, migration `0032`.

- A consent disclosure is spoken before any screening call and **cannot be
  disabled**. Recording someone without telling them is unlawful in many
  jurisdictions; it is treated as a build constraint.
- `resolveConsentOutcome()` and `mayCaptureAudio()` gate audio capture on an
  affirmative outcome. `isConsentRefusal()` detects a refusal in the transcript
  and the webhook acts on it.
- `screening_calls.consent_confirmed` / `consent_confirmed_at` are stamped by a
  trigger (`stamp_screening_consent`), not by application code.
- `enforce_recording_permission` refuses to store a recording where the
  organization's settings do not permit one.
- A configurable decline policy — `metadata_only | keep_transcript | keep_all` —
  decides what survives a refusal, and `artifactsKeptOnDecline()` states it in
  the UI in plain words.

`RISK` (P2) — the consent disclosure is delivered **by the voice agent**. If the
call drops before the disclosure completes, the product has no signal
distinguishing "disclosed and accepted" from "never disclosed". `UNKNOWN` — not
verified against a real dropped call.

---

## 3. Processor disclosure — `IMPLEMENTED`

`lib/privacy/providers.ts` enumerates every third party that touches personal
data, by category (`telephony | speech | ai_model | messaging`), and
`activeProcessors()` shows only those actually connected. This is the substance
of a GDPR Art. 30 record and an Art. 13 disclosure — but it lives in the product
UI, not in a published privacy notice. The privacy notice itself is
organization-authored (`PrivacyNoticeSettings`, max 4,000 chars) and **ships
empty**.

---

## 4. Data retention — `PARTIAL`, and this is the largest privacy gap

**What exists.** `lib/privacy/retention.ts` is a complete, well-tested, *pure*
decision layer:

- Per-artifact periods for `audioRecording`, `transcript`, `aiEvaluation`, plus
  a default.
- `0` means "keep until manually deleted" and is treated as a real answer, not
  as "unset" — the code checks key presence, not truthiness.
- `evaluateRetention()`, `planRetentionActions()`, `findOrphanedArtifacts()`,
  `artifactsRemovedByWithdrawal()`.
- Windows are half-open `[captured, captured + days)` and measured in the
  **organization's** timezone via `lib/time.ts`.
- `onExpiry` defaults to **manual review** rather than automatic deletion,
  because an automatic delete can destroy records an organization is legally
  required to keep and nobody finds out until they need them.

**What does not exist.** *Nothing calls any of it.* A repository-wide grep for
callers of `planRetentionActions`, `findOrphanedArtifacts` and
`getRetentionOverview` outside the module's own tests returns **zero results**.
There is no sweep, no cron pass, no route, and no UI action that executes a
retention plan. No recording, transcript or AI evaluation is ever deleted by
this system.

**Honesty check — partially passed.** `app/settings/security/page.tsx` says in
the UI: *"These periods are recorded but **nothing is deleted yet** — the job
that…"*. That is the right instinct and it is doing real work. But
`app/settings/privacy/PrivacyForm.tsx` — the page where an admin actually
configures retention periods — carries **no such warning**. An admin who
configures a 30-day transcript retention there will reasonably believe
transcripts are deleted after 30 days. They are not.

**Impact:** GDPR Art. 5(1)(e) storage limitation. Voice recordings and
transcripts of candidates who were never hired are retained indefinitely, in a
product whose own settings screen invites the operator to promise otherwise.

**Fix, in order of value:**
1. **Today (10 lines):** repeat the "nothing is deleted yet" banner on the
   Privacy page's retention section. This removes the misleading promise
   immediately and costs nothing.
2. **Then:** add a `drainRetention()` pass to the **existing** sweep in
   `lib/automations/sweep.ts` — the product has exactly one clock and this
   belongs in it. Default to the configured `manual_review` action, which means
   the first version only *flags* expired artifacts into a review queue and
   deletes nothing. That is both the safe default and the one the settings
   already describe.

---

## 5. Candidate rights

| Right | Status | Notes |
| --- | --- | --- |
| **Erasure** (Art. 17) | `PARTIAL` | An Owner/Admin "Delete Candidate Data" action exists (`DELETE /api/candidates/[id]`), guarded by `guard_candidate_delete_with_resumes`. `activity_events` deliberately survives — a log entry must outlive its subject, which is why `entity_id` carries no foreign key. `UNKNOWN`: whether storage objects and `resume_parse_results` are cleaned up alongside the row is not verified. |
| **Objection to marketing** (Art. 21) | `IMPLEMENTED` | Per-candidate, per-channel opt-out (`candidate_communication_preferences`), a signed unsubscribe link usable without a login, and a send pipeline that checks the flag. Internal messages correctly skip the candidate opt-out. |
| **Access / portability** (Art. 15, 20) | `MISSING` | No candidate-facing export. A recruiter can read the record; the candidate cannot request it. |
| **Rectification** (Art. 16) | `PARTIAL` | Recruiters can correct a record; candidates have no channel. |
| **Automated decision-making** (Art. 22) | `PARTIAL` | AI resume shortlisting **automatically** branches an application. It is mitigated structurally — "Not Shortlisted" is a reversible flag, not a stage change and never a rejection; the application keeps its board position; reversal is one `UPDATE` to `NULL`; and `needs_review` takes neither branch. But there is no notice to the candidate that automated processing occurred and no stated route to human review. |
| **Consent withdrawal** | `PARTIAL` | `artifactsRemovedByWithdrawal()` decides what should be removed; nothing executes it (same gap as §4). |

---

## 6. Data minimisation & purpose limitation — `IMPLEMENTED`

Several decisions in this codebase are minimisation done properly, and they are
worth naming because they are easy to undo by accident:

- No raw IP is ever written.
- Recipient addresses are **masked at write time** in `message_log` and
  `notification_deliveries` — the full address stays on the candidate record
  rather than being copied onto every row that anyone who can see an application
  can read.
- Rate-limit rows are pruned opportunistically; a ledger of hashed sources is
  not kept for a feature with no use for it.
- Candidate-facing URLs carry **only** one row id — never an organization, job,
  candidate or application id, and never a job title. A token is an HMAC over
  the id with nothing stored, so a database dump yields no working links.
- The AI service layer takes **structured input only**, never a database handle,
  so a prompt cannot accidentally carry more than the feature needs.
- `activity_events.is_sensitive` gates security events to Owner/Admin, and it is
  a stored column rather than a derived list so the boundary survives an event
  rename.

---

## 7. Sub-processors & data location

`UNKNOWN` — the deployment's regions are not recorded anywhere in the
repository. Candidate voice data leaves the EU/UK/India boundary the moment it
reaches Bolna and the LLM provider, and no Data Processing Agreement, no
Standard Contractual Clauses reference, and no region pinning appears in the
repo or in the environment template.

Sub-processors implied by the code: Supabase (data, auth, storage), Vercel
(hosting, logs), an OpenAI-compatible LLM provider, Bolna (telephony + speech),
a Resend-compatible email provider, Meta (WhatsApp Cloud API), Google (Calendar
OAuth).

---

## 8. Privacy findings

| Severity | Finding | Status |
| --- | --- | --- |
| **P0** | Retention is configurable but **never executed**; the Privacy page promises deletion that does not happen | `PARTIAL` |
| **P1** | Automated AI shortlisting with no Art. 22 notice or stated human-review route | `PARTIAL` |
| **P1** | No documented data-processing region, DPA, or sub-processor list | `UNKNOWN` |
| **P2** | No candidate access/portability channel | `MISSING` |
| **P2** | Privacy notice ships empty | `MISSING` |
| **P2** | Consent outcome on a dropped call is ambiguous | `RISK` |
| **P2** | Erasure completeness across storage objects unverified | `UNKNOWN` |
