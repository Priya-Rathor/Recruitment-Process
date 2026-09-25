# Database

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

PostgreSQL via Supabase. **51 tables**, all with `organization_id` and RLS
enabled. **38 migrations**, ~9,500 lines of SQL, ~198 indexes, ~64 functions and
triggers. Migrations are plain SQL applied through the Supabase SQL Editor or
CLI, written to be re-runnable (`if not exists`, `drop policy if exists`).

> `RISK` — **migrations `0032`, `0037` and `0038` are written but NOT APPLIED**
> to the working database (recorded in `docs/Memory.md`). The code that reads
> `organization_settings.privacy_settings`, the stage-workflow columns and the
> delay queue will fail with a schema-out-of-date error until they are run.
> This is production blocker **B-01**.

---

## 1. Table inventory by domain

### Identity & tenancy
| Table | Purpose |
| --- | --- |
| `organizations` | The tenant. Owns `timezone` — the source of truth for every date calculation. |
| `users` | App profile, 1:1 with `auth.users` via `auth_id`. |
| `organization_members` | Membership + role + `active|removed` status. Unique per (org, user). |
| `invites` | Emailed token, role, 7-day expiry, `pending|accepted|revoked|expired`. |

### Jobs & candidates
`jobs` · `job_screening_questions` · `job_interview_questions` ·
`job_hiring_stages` · `candidates` · `candidate_duplicates`

### Applications & pipeline
`applications` · `application_stage_history` · `application_notes` ·
`application_matches` · `application_evaluations` · `pipeline_sla_config`

### Resumes
`resumes` · `resume_parse_results` · `resume_intake_items`

### Screening & voice
`screening_calls` · `screening_reports` · `voice_agents` ·
`voice_agent_test_calls`

### Agent Center (`0043`)
`agents` — identity for every agent type (`agent_type` × optional `provider`,
`agent_status`). Voice screening agents extend into `voice_agents` **with the
same id** (`voice_agents.id` → `agents.id`). WhatsApp reply agents are refused
here and stay in `auto_reply_config` (`0042`) until the WhatsApp module merges
them.

### Interviews & coding
`interviews` · `interview_feedback` · `coding_sessions` · `coding_submissions`

### Clients (agency mode)
`clients` · `client_feedback_events`

### Automations
`automations` · `automation_runs` · `automation_approvals` ·
`automation_sweeps` · `automation_delayed_actions`

### Communication
`notifications` · `notification_deliveries` · `notification_preferences` ·
`message_templates` · `message_log` · `candidate_communication_preferences`

### Public forms
`forms` · `form_fields` · `form_responses` · `form_submission_attempts`

### Onboarding
`organization_document_templates` · `onboarding_records` · `onboarding_documents`

### Settings & audit
`organization_settings` · `user_preferences` · `organization_integrations` ·
`activity_events`

---

## 2. Core relationships

```
organizations 1─┬─* organization_members *─1 users
                ├─* invites
                ├─* jobs 1─┬─* job_hiring_stages
                │          ├─* job_screening_questions
                │          ├─* job_interview_questions
                │          └─* forms (purpose = job_application)
                ├─* candidates 1─* resumes 1─1 resume_parse_results
                ├─* clients 1─* client_feedback_events
                └─* applications ─┬─ candidate_id → candidates
                                  ├─ job_id       → jobs
                                  ├─1 application_matches
                                  ├─* application_stage_history
                                  ├─* application_notes
                                  ├─* application_evaluations
                                  ├─* screening_calls 1─1 screening_reports
                                  ├─* interviews 1─┬─* interview_feedback
                                  │                └─* coding_sessions 1─1 coding_submissions
                                  ├─1 onboarding_records 1─* onboarding_documents
                                  ├─* message_log
                                  └─* automation_runs 1─0..1 automation_approvals
```

`applications` is unique on `(candidate_id, job_id)` — one application per
candidate per job; a re-application is a new row, not a reopened one.

---

## 3. Enumerated types

`org_role` · `job_status` · `work_mode` · `candidate_source` ·
`duplicate_status` · `application_stage` (8 stages) · `resume_parse_status` ·
`resume_intake_status` · `integration_status` · `screening_call_status` ·
`interest_level` · `location_acceptance` · `interview_mode` ·
`interview_status` · `interview_recommendation` · `calendar_sync_status` ·
`automation_status` · `automation_run_status` · `automation_approval_status` ·
`delayed_action_status` · `activity_entity_type` · `notification_channel` ·
`notification_delivery_status` · `evaluation_outcome` · `document_owner` ·
`onboarding_status` · `onboarding_document_status` · `coding_session_status` ·
`form_purpose` · `form_status` · `form_field_type` · `form_response_status` ·
`communication_event` · `message_template_channel` ·
`message_delivery_channel` · `message_status`

---

## 4. Row-Level Security — `IMPLEMENTED`

RLS is enabled on **all 51 tables**. Helper predicates:

- `public.is_org_member(org_id)` — `security definer`, avoids policy recursion.
- `public.has_org_role(org_id, roles[])` — role gate inside policies.
- `public.current_app_user_id()` — maps `auth.uid()` to `public.users.id`.

**Two traps already hit and worth remembering:**

1. `organization_members`' SELECT policy **intentionally** exposes every member
   row of an org you belong to, because the team list needs it. Any query asking
   *"what is my membership?"* must filter `user_id` explicitly, or it picks up
   teammates' rows — and their roles.
2. Check-then-write across two statements is a **TOCTOU race**. For invariants
   like "always at least one Owner", lock the parent row inside a trigger
   (`enforce_owner_remains`) rather than reading and then writing.

**Column-level protection:** `organization_integrations.encrypted_credentials`
carries a `REVOKE` (migration `0007`), so even an Owner's authenticated session
cannot read the ciphertext. Reading it requires the service-role identity.

---

## 5. Triggers and functions — the invariants that are not in application code

| Category | Functions |
| --- | --- |
| **Tenant integrity** (~20) | `enforce_application_tenant_integrity`, `enforce_resume_tenant_integrity`, `enforce_interview_tenant_integrity`, `enforce_match_tenant_integrity`, `enforce_message_log_tenant_integrity`, `enforce_form_field_integrity`, `enforce_form_response_integrity`, `enforce_coding_session_integrity`, … — each asserts a child row's `organization_id` matches its parent's. |
| **Role safety** | `enforce_owner_remains` (locks the parent row — no TOCTOU), `prevent_self_role_change` (migration `0036`, blocks self-edits even via PostgREST). |
| **Audit immutability** | `reject_activity_event_mutation` — `activity_events` is append-only at the database, not by convention. |
| **Pipeline** | `record_application_stage_change` (history is written by the DB, so a direct PostgREST write is still captured), `stamp_rejected_at_stage`, `clear_not_shortlisted_on_terminal`, `protect_required_application_fields`. |
| **Automation** | `enforce_automation_activation`, `enforce_automation_run_completion_only`, `enforce_automation_approval_decision`, `cancel_delayed_actions_on_stage_change` (atomic — a poll would race the move), `bump_automation_version`. |
| **Data hygiene** | `normalize_candidate_contact`, `mark_matches_stale_for_candidate` / `_for_job`, `sync_application_match_score`, `sync_job_resume_passing_score`, `touch_updated_at`. |
| **Consent & recording** | `enforce_recording_permission`, `stamp_screening_consent`, `protect_ai_screening_original` (the AI's original draft can never be overwritten by the human correction). |
| **Lifecycle** | `handle_new_auth_user`, `ensure_current_user_profile`, `create_organization_and_owner`, `accept_invite`, `create_onboarding_on_hire`, `seed_default_document_templates`, `complete_interview_on_feedback`, `guard_candidate_delete_with_resumes`, `freeze_submitted_coding_code`, `enforce_single_default_voice_agent`, `promote_next_default_voice_agent`. |
| **Agent Center** (`0043`) | `guard_agent_in_use` (an agent named by any automation action cannot be deleted, from either table), `enforce_agent_immutable_columns`, `ensure_agent_for_voice_agent` (security definer — gives a console-created voice agent its identity row and refuses another tenant's id), `sync_voice_agent_name_to_agent` / `sync_agent_name_to_voice_agent`, `delete_agent_for_voice_agent`. |

---

## 6. Storage buckets — `IMPLEMENTED`

| Bucket | Public | Limit | MIME types |
| --- | --- | --- | --- |
| `resumes` (mig. `0005`) | **No** | 10 MB | PDF, DOCX, DOC |
| `onboarding-documents` (mig. `0026`) | **No** | 10 MB | PDF, JPEG, PNG, HEIC, DOCX, DOC |

Both carry tenant-scoped storage policies. Reads are issued as **short-lived
signed URLs** (60 s for onboarding documents); there is no public URL path to
either bucket.

---

## 7. Indexing — `IMPLEMENTED`

~198 indexes. Every foreign key used in a filter is indexed; partial unique
indexes carry real invariants (one default voice agent per org, one pending
delayed action per rule/application/occasion, the stage-workflow slot index).

`UNKNOWN` — no `EXPLAIN ANALYZE` evidence exists for any query. Index coverage
has been reasoned about but not measured against production-shaped data.

---

## 8. Migration practice

- Plain SQL in `supabase/migrations/`, numbered, applied **in filename order**.
- Re-runnable: `create ... if not exists`, `drop policy if exists`,
  `create or replace function`.
- `MISSING` — no down-migrations and no rollback scripts. See
  `docs/DEPLOYMENT.md` §Rollback.
- `RISK` — application is **manual** (paste into the SQL Editor). Nothing
  records which migrations have run against which environment; `docs/Memory.md`
  is the only ledger, and it is prose.
