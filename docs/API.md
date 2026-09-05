# API & Integrations

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

**105 route handlers** under `app/api/`. All are App Router route handlers; there
is no separate API service, no GraphQL, and no OpenAPI/typed client.

---

## 1. Conventions — `IMPLEMENTED`

- **Success:** `{ data: ... }`, sometimes with `caller_role`.
- **Error:** `{ error: "<human-readable message>" }` produced by
  `jsonError()` / `handleRouteError()` in `lib/api.ts`. A `TenantError` carries
  its own 401/403; anything else becomes a generic 500 so internals and raw
  provider/database errors never reach the browser.
- **Tenancy:** resolved from the session by `requireMembership()` /
  `requireRole()` / `getCurrentOrganizationId()`. **No route accepts an
  `organization_id` from the body, query string, or header.** Verified across
  all 105 routes.
- **Body parsing:** every handler wraps `request.json()` in try/catch and
  returns `400 Invalid JSON body.` rather than throwing.
- **Pagination:** `parsePagination()` clamps `page ≥ 1` and `per_page ≤ 100`.
  Used by 8 routes; most list endpoints instead apply a fixed `.limit()`.
- **`maxDuration`** is raised to 60 s on action-bearing routes and 300 s on the
  cron sweep.

`MISSING` — no API versioning, no request-id correlation header, no
machine-readable error codes (the `error` string is the only signal), and no
generated client or schema.

---

## 2. Authentication model

| Caller | Mechanism |
| --- | --- |
| Signed-in user | Supabase session cookie, refreshed at the edge by `proxy.ts`. |
| Vercel Cron | `Authorization: Bearer $CRON_SECRET`, constant-time compare. |
| Bolna | HMAC-SHA256 over the **raw** request bytes, `x-bolna-signature` or `x-webhook-signature`, constant-time compare. |
| Candidate (no login) | A purpose-scoped **signed token in the URL** — HMAC over the row id, nothing stored. |

**The five intentionally unauthenticated routes** — verified to be the only ones
with no tenant helper:

```
POST /api/apply/[token]/submit      public job application
GET  /api/coding/[token]            candidate opens the coding round
PUT  /api/coding/[token]/draft      autosave
POST /api/coding/[token]/submit     final submission
POST /api/webhooks/bolna            provider callback
```

Each resolves its tenant from **our own row**, never from the payload, and each
re-checks access on every call rather than caching it from page load.

---

## 3. Route inventory

Roles shown are the minimum required. `member` = any active member including
Viewer.

### Organizations, members, invites
| Route | Methods | Role |
| --- | --- | --- |
| `/api/organizations` | GET, POST | authenticated |
| `/api/organizations/[id]` | GET, PATCH, DELETE | member / owner+admin |
| `/api/organizations/[id]/onboarding` | POST | owner, admin |
| `/api/organizations/[id]/ai-action` | POST | owner, admin |
| `/api/organizations/switch` | POST | authenticated (validated against real memberships) |
| `/api/members` | GET | member |
| `/api/members/[id]` | PATCH, DELETE | owner, admin |
| `/api/invites` | GET, POST | owner, admin |
| `/api/invites/[id]` | DELETE | owner, admin |
| `/api/invites/accept` | POST | authenticated |

### Jobs
| Route | Methods | Role |
| --- | --- | --- |
| `/api/jobs` | GET, POST | member / owner+admin+recruiter |
| `/api/jobs/[id]` | GET, PATCH, DELETE | member / recruiter+ / owner+admin |
| `/api/jobs/[id]/hiring-stages` | GET, PUT | member / recruiter+ |
| `/api/jobs/[id]/application-form` | POST | recruiter+ |
| `/api/jobs/[id]/workflow` | GET, PUT | member / owner+admin |
| `/api/jobs/[id]/workflow/apply-template` | POST | owner, admin |
| `/api/jobs/[id]/intake`, `/intake/[itemId]` | GET, POST, PATCH | recruiter+ |
| `/api/jobs/ai-action` | POST | recruiter+ |

### Candidates & resumes
| Route | Methods | Role |
| --- | --- | --- |
| `/api/candidates` | GET, POST | member / recruiter+ |
| `/api/candidates/[id]` | GET, PATCH, DELETE | member / recruiter+ / owner+admin |
| `/api/candidates/[id]/resumes` | GET, POST | member / recruiter+ |
| `/api/candidates/[id]/communication-preferences` | PUT | recruiter+ |
| `/api/candidates/lookup`, `/search` | GET, POST | member |
| `/api/candidates/ai-action` | POST | recruiter+ |
| `/api/resumes/[id]/download` | GET | member |
| `/api/resumes/[id]/parse`, `/review` | POST | recruiter+ |

### Applications
| Route | Methods | Role |
| --- | --- | --- |
| `/api/applications` | GET, POST | member / recruiter+ |
| `/api/applications/[id]` | GET, PATCH, DELETE | member / recruiter+ / owner+admin |
| `/api/applications/[id]/notes` | POST | recruiter+ |
| `/api/applications/[id]/evaluations`, `/[entryId]` | POST, PATCH | recruiter+ |
| `/api/applications/[id]/match` | GET, POST | member / recruiter+ |
| `/api/applications/[id]/shortlist` | DELETE | recruiter+ |
| `/api/applications/[id]/screening-call` | GET, POST | member / recruiter+ |
| `/api/applications/[id]/screening-report` | GET, POST | member / recruiter+ |
| `/api/applications/[id]/interview-brief` | POST | member |
| `/api/applications/[id]/submission` | GET, POST, PUT | member / recruiter+ |
| `/api/applications/[id]/ai-action` | POST | member |
| `/api/screening-calls` | GET | member |
| `/api/screening-reports/[id]/review` | POST | recruiter+ |

### Interviews & coding
| Route | Methods | Role |
| --- | --- | --- |
| `/api/interviews`, `/[id]` | GET, POST, PATCH | member / recruiter+ |
| `/api/interviews/[id]/feedback` | POST | recruiter+ |
| `/api/interviews/[id]/coding-session` | GET, POST | member / recruiter+ |
| `/api/coding-sessions/[id]`, `/qr` | GET, PATCH | member / recruiter+ |
| `/api/coding/[token]`, `/draft`, `/submit` | GET, PUT, POST | **public, signed token** |

### Clients, pipeline, analytics, dashboard
| Route | Methods | Role |
| --- | --- | --- |
| `/api/clients`, `/[id]`, `/[id]/ai-action` | GET, POST, PATCH, DELETE | member / recruiter+ / owner+admin |
| `/api/pipeline/sla` | GET, PUT | member / owner+admin |
| `/api/pipeline/ai-action` | POST | recruiter+ |
| `/api/analytics`, `/export`, `/ai-action` | GET, POST | member |
| `/api/dashboard`, `/ai-action` | GET, POST | member |
| `/api/activity-events`, `/ai-action` | GET, POST | member |

### Automations
| Route | Methods | Role |
| --- | --- | --- |
| `/api/automations`, `/[id]` | GET, POST, PATCH, DELETE | member / owner+admin |
| `/api/automations/[id]/test` | POST | owner, admin |
| `/api/automations/approvals`, `/[id]` | GET, PATCH | member / owner+admin |
| `/api/automations/runs` | GET | member |
| `/api/automations/switch` | PATCH | owner, admin |
| `/api/automations/sweep` | **GET** = cron (`CRON_SECRET`), **POST** = owner+admin | |
| `/api/automations/ai-action` | POST | owner, admin |

### Notifications & messaging
| Route | Methods | Role |
| --- | --- | --- |
| `/api/notifications`, `/[id]` | GET, PATCH, DELETE | member |
| `/api/notifications/preferences` | GET, PUT, DELETE | member |
| `/api/notifications/reminders` | POST | recruiter+ |
| `/api/notifications/ai-action` | POST | recruiter+ |
| `/api/messages` | POST | recruiter+ |

### Forms & onboarding
| Route | Methods | Role |
| --- | --- | --- |
| `/api/forms`, `/[id]` | GET, POST, PATCH, DELETE | member / recruiter+ / owner+admin |
| `/api/forms/[id]/fields` | PUT | recruiter+ |
| `/api/forms/[id]/qr` | GET | member |
| `/api/apply/[token]/submit` | POST | **public, signed token, rate-limited** |
| `/api/onboarding/[id]`, `/documents` | GET, PATCH, POST | member / recruiter+ |
| `/api/onboarding/documents/[id]`, `/file` | GET, POST, PATCH, DELETE | member / recruiter+ / owner+admin |

### Settings & integrations
| Route | Methods | Role |
| --- | --- | --- |
| `/api/settings` | GET, PATCH | member / owner+admin |
| `/api/settings/integrations`, `/[provider]` | GET, POST, DELETE | owner, admin |
| `/api/settings/integrations/calendar/authorize`, `/callback` | GET | owner, admin |
| `/api/settings/message-templates`, `/[id]` | GET, POST, PATCH, DELETE | member / owner+admin |
| `/api/settings/document-templates`, `/[id]`, `/reorder` | GET, POST, PATCH, PUT, DELETE | member / owner+admin |
| `/api/settings/voice-agents` and all sub-routes | GET, POST, PUT, DELETE | owner, admin |

### Webhooks & auth callback
| Route | Methods | Auth |
| --- | --- | --- |
| `/api/webhooks/bolna` | POST | **HMAC signature, fails closed** |
| `/auth/callback` | GET | Supabase OAuth exchange |

---

## 4. External integrations

| Provider | Purpose | Credentials | Failure mode |
| --- | --- | --- | --- |
| **Supabase** | DB, Auth, Storage | Env: URL + publishable key (browser), secret key (server only) | `requireSupabaseConfig()` throws an actionable message; a placeholder value is detected and named. |
| **LLM (OpenAI-compatible)** | AI service layer | Env `OPENAI_API_KEY`, optional `AI_BASE_URL` / `AI_MODEL` | `not_configured` → AI features simply unavailable; manual workflow unaffected. `PARTIAL` — a per-org key can be stored via the `llm` adapter but `provider.ts` does not yet read it. |
| **Bolna AI** | Voice screening calls | **Per organization**, AES-GCM encrypted | Disconnected by default; hard attempt cap; consent disclosure not disableable. |
| **Google Calendar** | Interview invites | Env OAuth client + per-org encrypted refresh token | Unconfigured → interviews still schedule, no invites sent, settings page says so. |
| **Email (Resend-compatible)** | Internal + candidate email | Per-org encrypted key, `EMAIL_API_URL` override | Send recorded as "not sent" with a reason; nothing else fails. |
| **WhatsApp (Meta Cloud API)** | Candidate messaging | Per-org encrypted token + phone id | Same as email. Refused loudly for internal staff (no phone column on `users`; falling back to the candidate's number would misdeliver). |
| **n8n** | Orchestration | `N8N_WEBHOOK_URL` | Monitored only. Automations execute in-process, not through n8n. |

---

## 5. Webhook security — `IMPLEMENTED` with one gap

`POST /api/webhooks/bolna`:

1. **Signature** — HMAC-SHA256 over the raw bytes, constant-time compare. No
   secret configured ⇒ `503`, never open.
2. **Tenancy from our record** — the `screening_calls` row is found by the id we
   generated; `organization_id` is read from that row. A forged
   `organization_id` in the payload is ignored.
3. **Bounded effect** — it can only advance one known call. It cannot create
   rows and cannot touch anything outside `screening_calls` /
   `voice_agent_test_calls`.
4. Test calls carry a **different metadata key**, so a configuration test can
   never be written into a candidate's screening history.

`RISK` — **no replay protection**. There is no timestamp, nonce, or
delivery-id check, so a captured valid request can be replayed indefinitely.
Impact is bounded (it only re-writes the same outcome onto the same call), but
it is a gap. See `docs/SECURITY.md` finding **S-05**.
