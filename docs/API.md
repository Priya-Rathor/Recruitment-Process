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
| Scheduler (GitHub Actions; Vercel Cron on a Pro plan) | `Authorization: Bearer $CRON_SECRET`. |
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
| `/api/messages/conversations` | GET | member |
| `/api/messages/conversations/[id]` | GET, PATCH | member / recruiter+ |
| `/api/messages/conversations/[id]/reply` | POST | recruiter+ |

The three conversation routes are the WhatsApp inbox (`/messages`). Two rules
worth stating because neither is visible in the table:

- **The Recruiter scope is a scope, not a boundary.** A Recruiter sees threads
  for candidates on applications assigned to them, applied in the query exactly
  as the pipeline board applies it. `whatsapp_conversations` and `message_log`
  both grant SELECT to every member of the organization, so the ORGANIZATION is
  the security boundary. `GET`/`PATCH` on a thread outside the scope return
  **404**, not 403, so a guessed id cannot confirm that a thread exists.
- **`/reply` sends nothing itself.** It resolves the recipient and calls
  `sendOnChannel()` — the single outbound path — so the opt-out gate, the log
  row, the masked recipient and Meta's 24-hour window behave identically to a
  templated send. An unlinked thread is refused with `409 unlinked_conversation`
  and an opted-out candidate with `409 opted_out`, which the UI turns into an
  explicit confirmation before re-submitting with `acknowledge_opt_out`.

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
| `/api/settings/auto-reply` | GET, PUT, PATCH, DELETE | owner, admin |

`/api/settings/auto-reply` configures the WhatsApp auto-reply agent (0042).
`PUT` saves the organization default (`job_id: null`) or one job's override;
`PATCH` flips the organization-wide **master switch**, which the inbox also
reaches; `DELETE?id=` removes a job override so that job falls back to the
default — the only way back, because a *disabled* override stops the agent for
that job rather than falling through. Every method is Owner/Admin in the route
**and** in RLS, and switching the master on or off is written to the audit log in
both directions: on, because it begins sending unattended AI messages to real
people; off, because it is the fact that explains a gap in the replies.

### Webhooks & auth callback
| Route | Methods | Auth |
| --- | --- | --- |
| `/api/webhooks/bolna` | POST | **HMAC signature, fails closed** |
| `/api/webhooks/whatsapp` | GET, POST | **public. GET = Meta's verify-token handshake; POST = `X-Hub-Signature-256`, fails closed** |
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
| **WhatsApp (Meta Cloud API)** | Candidate messaging, inbound replies, **and the auto-reply agent** | Per-org encrypted token + phone id; inbound needs `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` (or a per-org app secret) | Same as email. Refused loudly for internal staff (no phone column on `users`; falling back to the candidate's number would misdeliver). **Inbound fails closed and silently-shaped**: with no app secret every reply is rejected and the inbox stays empty while sending still works, so `/messages` and the integration card both say so on the page. |
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

### `/api/webhooks/whatsapp` (0041)

Same four properties, plus the differences Meta forces:

1. **Signature** — HMAC-SHA256 over the raw bytes against the Meta app secret,
   constant-time compare, `401` on any mismatch. No secret ⇒ nothing is ever
   accepted. Forging here is not spam: it is putting words in a candidate's
   mouth, and a forged `STOP` would switch off a real candidate's messages.
2. **Tenancy from our record** — `value.metadata.phone_number_id` is a lookup
   key into `organization_integrations`, a table only we write;
   `organization_id` comes off that row. The integration must be `connected`.
3. **Bounded effect** — writes `message_log`, `whatsapp_conversations` and the
   WhatsApp opt-out flag. It cannot create a candidate, move a stage or start an
   automation. A number matching no candidate stays unmatched for a human to
   link; nothing is invented from a bare phone number.
4. **Idempotent** — a partial unique index on
   `(organization_id, provider_message_id) where direction = 'inbound'` makes a
   redelivery a no-op at the database rather than at the handler, and status
   callbacks only ever move a message forward (`sent → delivered → opened`), so
   they are order-independent too. This is what lets the route return `500` and
   invite a retry when a write genuinely fails.

**The body is parsed before the signature is checked**, because the secret may
be per organization and the only thing naming the organization is inside the
body. Nothing is written, and no candidate data is read, until verification
passes; an unsigned request costs one indexed SELECT against our own
integrations table.

Unlike Bolna, replay is **not** a gap here — see point 4.

### The auto-reply agent (0042)

The webhook's one side effect beyond storing the message: it queues, and may
immediately run, `lib/autoReply/run.ts`. Six gates stand between an inbound
message and an AI reply, and every one of them can only ever **stop** a message:

1. `organization_settings.auto_reply_master_enabled` — read first, defaults
   **false**, and re-read again at send time so pressing it off stops replies
   that were already queued.
2. A linked candidate. An unmatched number is never answered.
3. A 30-minute human cooldown (`sent_by not null and auto_replied = false`).
4. Config precedence — the job's override, else the organization default.
5. A **deterministic** escalation guard that runs *before* the model, so pay,
   contested decisions, visas, distress and data requests never reach it.
6. The model, plus its own refusal, plus a numeric guard over every digit in the
   draft and a rejection of any URL or address.

Anything other than a validated, grounded answer sends a fixed holding message
and sets `whatsapp_conversations.needs_human`. `auto_reply_queue.inbound_message_id`
is unique, so a Meta redelivery cannot produce a second reply; an `immediate`
reply runs inline and the same row is the backstop if that attempt is cut short.
Delayed replies drain from the **existing** automation sweep (a pass in
`runCronSweep`, gated on its own master switch rather than on
`automations_enabled`), never a second clock.

The agent writes exactly two things: one WhatsApp message through
`sendOnChannel()` — the same path as every other outbound message — and the
`needs_human` flag. It cannot move a stage, schedule anything, or send on any
other channel, because it returns text and has no client, no tools and no
field any caller reads as an instruction.
