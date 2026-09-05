# Security

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

Every finding below was verified against the source in this repository on
2026-08-30. File and line references are given so each one can be re-checked.

---

## 1. Authentication — `IMPLEMENTED`

Supabase Auth (email/password + Google OAuth). Sessions are HTTP-only cookies,
refreshed at the edge on every request by `proxy.ts` → `updateSession()`.

`lib/supabase/session.ts` holds a **deny-by-default allowlist**: everything not
listed requires a session, so a new module's routes are protected the moment
they exist. The allowlist is `isPublicPath()` — exported specifically so
`publicPaths.test.ts` exercises the same code the edge runs, not a copy that
could drift. `matches()` frees an entry and its subtree only: `/apply` does not
free `/applications`, and `/` compiles to `startsWith("//")`, which no
normalised pathname satisfies, so it grants the landing page and nothing else.

A valid session with no `public.users` row is **repaired**, not rejected —
`getCurrentUser()` calls `ensure_current_user_profile()`, an argument-less RPC
reading only `auth.uid()`, so it can only ever create the caller's own profile.
This closes an `ERR_TOO_MANY_REDIRECTS` loop that pointed nowhere near its cause.

`PARTIAL` — no MFA, no session-revocation UI, no login-attempt lockout of our
own (Supabase Auth applies its own rate limits, which we neither configure nor
verify).

### S-01 · `RISK` (P0) — invite tokens are bearer credentials, not identity-bound

`supabase/migrations/0001_module1_authentication_organization.sql`,
`public.accept_invite(p_token uuid)`.

The RPC checks that the invite is `pending` and unexpired. **It never compares
`v_invite.email` to the accepting user's email.** Worse, it ends with:

```sql
on conflict (organization_id, user_id)
  do update set role = excluded.role, status = 'active';
```

Consequences:

- Anyone who obtains an invite token — a forwarded email, a shared screenshot, a
  proxy log, a browser-history sync — can join that organization **with the
  invited role**, including `admin` or `owner`.
- An **existing lower-privileged member** who obtains an admin invite intended
  for someone else **escalates their own role** through the `do update` branch.

The invite page tells the user *"Use the email address the invite was sent to"* —
but that is advice, not a control. Mitigating factors: the token is a
UUIDv4 (unguessable) and expires in 7 days. Neither changes the class of the
issue.

**Fix:** compare `lower(v_invite.email)` to the authenticated user's email inside
the RPC and raise on mismatch; make the `on conflict` branch reactivate a removed
member without changing `role` unless the invite's role is what the inviter
intended for *that* person.

---

## 2. Authorization & RBAC — `IMPLEMENTED`

Four roles. Enforced at **three** layers:

1. **UI** — `app/settings/catalog.ts` is the single settings catalogue and gates
   both the landing grid and each page's own check.
2. **API** — `requireRole()` in `lib/tenant.ts`. Verified: **all 105 route
   handlers** call a tenant helper except the five intentionally public ones.
3. **Database** — RLS policies plus `has_org_role()`.

Role-transition rules are in the database where they belong:

- `prevent_self_role_change` (migration `0036`) — a trigger, because the rule
  compares `OLD.role` to `NEW.role`, which no policy can express (`USING` sees
  only the old row, `WITH CHECK` only the new one).
- `enforce_owner_remains` — locks the parent row inside the trigger rather than
  check-then-write, so the "at least one Owner" invariant has no TOCTOU race.
- Only an Owner may grant or revoke Owner (`app/api/members/[id]/route.ts:88`).
- Role changes are logged with both the old and the new value.

**Never trust frontend authorization** is followed throughout: hiding a control
is treated as cosmetic. `app/api/applications/[id]/route.ts` states this
explicitly — `rejectCandidateFields()` runs *before* anything else because
"hiding the fields in the UI does not stop a curl."

---

## 3. Multi-tenancy & IDOR — `IMPLEMENTED`

- The tenant comes from the session only. The `active_organization_id` cookie is
  a hint, re-validated against real `organization_members` rows on every
  request; a forged value yields the default org, not access.
- `POST /api/organizations/switch` validates the requested id against real
  memberships before writing the cookie, and the cookie is `httpOnly`,
  `sameSite: lax`, `secure` in production.
- Every ID-addressed route scopes its lookup by `organization_id` — the pattern
  is `.eq("id", id).eq("organization_id", membership.organization.id)`, so a
  cross-tenant id returns `404`, not `403` (no existence oracle).
- ~20 `enforce_*_tenant_integrity` triggers stop a correctly-tenanted row from
  pointing at another tenant's parent.

### S-02 · `RISK` (P1) — the service-role client is the one place with no net

`lib/supabase/admin.ts` **bypasses RLS**. It is imported by 16 modules:

```
app/api/webhooks/bolna/route.ts   lib/activity/log.ts
lib/automations/engine.ts         lib/automations/sweep.ts
lib/coding/afterSubmit.ts         lib/coding/candidate.ts
lib/communications/send.ts        lib/communications/triggers.ts
lib/communications/unsubscribe.ts lib/forms/public.ts
lib/forms/submit.ts               lib/integrations/bolna/index.ts
lib/integrations/email/index.ts   lib/integrations/store.ts
lib/notifications/notify.ts       lib/voice/queries.ts
```

Spot checks found the `organization_id` filter present where it is required, and
each use is justified in a header comment. But there is **no automated test and
no lint rule** asserting it, and `lib/automations/engine.ts` alone makes ~25
admin queries across 1,800 lines. One omitted `.eq("organization_id", …)` in a
future edit is a silent cross-tenant read or write with nothing to catch it.

**Fix:** a repository test that parses these modules and fails on an admin-client
`.from(...)` chain with no `organization_id` predicate, plus an ESLint
`no-restricted-imports` rule limiting the admin client to an allowlist.

---

## 4. Input validation — `PARTIAL`

Validation is **hand-written**; there is no schema library. Where it exists it is
careful and well-tested:

- UUID regex checks before any id is used in a query.
- Type narrowing predicates (`isApplicationStage`, `isOrgRole`,
  `isCandidateSource`, `isApplicationPriority`, …), each unit-tested.
- Field allowlists on update: `rejectCandidateFields()` refuses a
  present-and-null field, not just a truthy one.
- Every `request.json()` is wrapped and returns `400` rather than throwing.
- Strong **database-side** validation: `CHECK` constraints on ranges, salary and
  experience ordering, currency `^[A-Z]{3}$`, brand colour `^#[0-9A-Fa-f]{6}$`,
  `link_path like '/%'` (an absolute URL in that column would be an open
  redirect waiting to be written), `field_key ~ '^[a-z][a-z0-9_]{0,58}[a-z0-9]$'`,
  code length `<= 200000`, and cross-column consistency constraints throughout.

### S-03 · `RISK` (P2) — validation is per-route and unverifiable in aggregate

With 105 handlers and no shared schema, coverage is a per-file property. There is
no test that asserts *every* route validates its body, and no way to review it
short of reading all 105. The database `CHECK` constraints are the real backstop
— which is the right architecture — but it means an unvalidated field surfaces as
a `500` from a constraint violation rather than a `422` with a usable message.

**Fix (small):** keep the hand-written approach — it is working and adds no
dependency — but add a `lib/validation.ts` with the ~10 primitives already
duplicated across routes (`uuid()`, `boundedString()`, `oneOf()`, `intInRange()`)
and a test that every `app/api/**/route.ts` importing `request.json()` also
imports a validator. The `UUID_PATTERN` constant alone is currently re-declared
in several files.

**Injection:** SQL injection is not reachable — every query goes through
PostgREST parameter binding; there is no raw SQL in application code. XSS: no
`dangerouslySetInnerHTML` and no `eval`/`new Function` anywhere in `app/`,
`lib/`, or `components/`. React escapes by default.

---

## 5. AI-specific security

### S-04 · `RISK` (P1) — no prompt-injection boundary on attacker-controlled text

Resume text and public form answers are **attacker-controlled**: anyone with a
public application link can submit arbitrary content. That text is placed into
LLM prompts by `parseResume()`, `matchCandidateToJob()` and
`structureCandidateText()` with no delimiting, no instruction-hierarchy marker,
and no "treat the following as data" framing (`grep` for `injection|untrusted|
delimit` across `lib/ai/` returns nothing).

What bounds the damage — and it is a lot:

- All AI output passes a `validate()` narrowing function before use.
- The AI has **no tool access** and no database handle.
- `AI never writes to trusted tables directly`; human review sits in the path
  for parsing and screening reports.
- `numericGuard.ts` prevents contradicting a displayed number.

What is **not** bounded: `lib/workflow/shortlist.ts` acts on the match score
**automatically** with no human in the loop. A crafted resume that inflates the
semantic score auto-advances an application onto the pass branch, which may fire
templated messages and schedule interviews. The reverse — a competitor's resume
scoring badly — is less interesting because "Not Shortlisted" is a reversible
flag that keeps the application on the board and never rejects.

**Fix:** wrap untrusted spans in an explicit delimiter with a system-prompt
instruction that content inside is data and never instructions; and (cheaper,
stronger) cap the LLM's influence on an *automated* branch — e.g. require the
deterministic score to also clear the threshold before `ai_resume_shortlist`
takes the pass branch.

### `MISSING` (P1) — no AI cost controls

No usage table, no token metering, no per-organization budget, no cap. `grep`
for `ai_usage|token_cost|ai_cost` across the migrations returns nothing;
`lib/ai/provider.ts` does not read the `usage` field of the provider response.
`OPENAI_API_KEY` is a single deployment-wide key, so spend cannot even be
attributed per tenant after the fact. Roughly 30 authenticated endpoints and one
public rate-limited endpoint reach an LLM. `docs/modules/00-cost-tracking.md`
names this retrofit as required.

---

## 6. Rate limiting — `PARTIAL`

One implementation exists and it is genuinely good: `lib/forms/rateLimit.ts`,
used by exactly one caller (`lib/forms/submit.ts:134`).

Why it is right:
- **Database-backed**, not an in-process `Map` — this app is serverless, so a
  per-instance counter is a suggestion, not a limit.
- **Two caps**: 3/hour per hashed source and 120/hour per form, because
  `x-forwarded-for` is a header and a forged value would just pick a different
  bucket. The per-form cap cannot be dodged by any header.
- The source is stored as an **HMAC** keyed on `INTEGRATION_ENCRYPTION_KEY`, not
  a raw IP (personal data) and not a bare SHA-256 (only ~4 billion IPv4
  addresses — an unkeyed digest is reversible on a laptop).
- Rolling half-open window; attempts recorded whether allowed or refused, and
  before the expensive work.
- Fails **open** on a database error, deliberately: the cost of a broken limiter
  is spam a recruiter deletes; the cost of failing closed is a real person unable
  to apply for a job.
- Rows are pruned opportunistically rather than kept.

### S-07 · `MISSING` (P1) — everything else is unlimited

No rate limiting on:

| Surface | Exposure |
| --- | --- |
| `PUT /api/coding/[token]/draft` | **Public, unauthenticated**, autosaves on a timer. A held token is an unbounded write loop against `coding_submissions`. |
| `GET /api/coding/[token]`, `POST /submit` | Public, unauthenticated. |
| `POST /api/webhooks/bolna` | Public. Signature-gated, so an attacker without the secret only burns an HMAC — but that is still uncapped work. |
| ~30 `*/ai-action` and AI routes | Authenticated, but any recruiter can loop them; each is a paid LLM call with no budget behind it. |
| `/login`, `/signup`, `/forgot-password` | Handled by Supabase Auth's own limits, which this project does not configure or assert. `UNKNOWN`. |

**Fix:** reuse the existing table-backed limiter (do not write a second one) —
generalise `form_submission_attempts` into a small `rate_limit_attempts` table
keyed by `(bucket, subject_hash)` and apply it to the coding token routes and to
AI actions per organization.

---

## 7. Secrets & environment — `PARTIAL`

- **No secret is committed.** `git ls-files` shows only `.env.local.example`;
  `.env.local` is untracked. `.gitignore` covers `.env*`, `*.pem`, `*.key`,
  `*.p12`, `*credentials*.json`, and `.supabase-db-url` explicitly — the comment
  correctly notes a secret does not have to be named `.env` to be a secret.
- **Nothing private is exposed to the frontend.** Only `NEXT_PUBLIC_SUPABASE_URL`
  and the publishable/anon key are `NEXT_PUBLIC_`, and both are safe by design
  (the publishable key is constrained by RLS). The secret key is read only via
  `lib/supabase/env.ts:supabaseSecretKey()`, imported only by `admin.ts`.
- Integration credentials are **AES-GCM encrypted at rest** and protected by a
  column-level `REVOKE`, so a browser with a valid Owner session still cannot
  read the ciphertext, and a database dump does not hand over live keys. The UI
  gets `••••••4F8A`.
- `lib/supabase/env.ts` accepts both the current (`sb_publishable_` /
  `sb_secret_`) and legacy (anon/service-role JWT) key generations, and detects
  the shipped placeholder rather than letting it fail later as an opaque network
  error.

### S-06 · `RISK` (P2) — one key, five purposes

`INTEGRATION_ENCRYPTION_KEY` is simultaneously: the credential-encryption key,
the form-token signing key, the unsubscribe-token key, the coding-token key, the
OAuth-state signing key, and the rate limiter's IP HMAC key.

Rotating it therefore: makes every stored integration credential unreadable
("Reconnect the integration"), invalidates every published application link and
QR code, breaks every unsubscribe link already in a candidate's inbox, kills
every live coding session, and re-buckets the rate limiter. In practice this
means **the key will never be rotated**, which is the actual risk.

**Fix:** derive purpose-scoped subkeys via HKDF from one root secret
(`hkdf(root, "form-token")`, `hkdf(root, "credentials")`, …). ~15 lines in
`lib/integrations/crypto.ts`, no new dependency, and it makes independent
rotation possible later.

### `MISSING` (P2) — undocumented environment variables

Read by the code but absent from `.env.local.example`:

```
CRON_SECRET          ← the important one; unset means the cron endpoint is a
                       permanent 503 and NO time-based automation ever fires
AI_MODEL
AI_BASE_URL
SUPABASE_SECRET_KEY                    (only the legacy name is documented)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (only the legacy name is documented)
BOLNA_CATALOG_PATHS
```

`CRON_SECRET`'s absence is the sharpest edge in this repo: a deployment looks
completely healthy while every delayed action, stale-stage rule and approval
expiry is silently dead. Nothing surfaces it except that one endpoint's 503.

---

## 8. File upload security — `IMPLEMENTED`

| Control | Resumes | Onboarding documents |
| --- | --- | --- |
| Bucket public? | **No** | **No** |
| Size cap | 10 MB (bucket + route agree) | 10 MB (`MAX_FILE_BYTES`, matched to the bucket) |
| MIME allowlist | Bucket `allowed_mime_types` | Bucket `allowed_mime_types` |
| Extension allowlist | `.pdf .doc .docx` | `.pdf .jpg .jpeg .png .heic .docx .doc` |
| Read path | Authenticated route | 60-second **signed URL**, then redirect |
| Tenant scope | Storage RLS policies | Storage RLS policies + route check |

Extension is checked first, deliberately: browsers disagree about the MIME type
of a `.doc` (Chrome says `application/msword`, some Windows setups say
`application/octet-stream`, some send nothing), and rejecting a real Word
document because the browser mislabelled it would be an unexplainable failure.
The **bucket's own `allowed_mime_types` is the real gate** — the application
check exists to give a good error at the file picker.

`RISK` (P2) — **no content sniffing and no malware scanning**. A `.pdf` whose
bytes are something else passes both checks. Impact is limited because files are
never executed, never served from our origin, and only ever handed to `unpdf` /
`mammoth` / `word-extractor` or to a signed download. The realistic threats are
a parser-crashing malformed file (contained — extraction failure is a handled
state) and a recruiter downloading a malicious document (unmitigated).

`UNKNOWN` — the resource behaviour of `unpdf`/`mammoth` on a decompression bomb
has not been tested. There is no timeout or memory bound around extraction.

---

## 9. Logging & sensitive data — `PARTIAL`

Good practice throughout:

- **348** `console.error` / `console.warn` calls; **zero** `console.log`.
- `formatDbError()` flattens a `PostgrestError` into a string because Next's dev
  overlay serialises a plain object to `{}` — a diagnosable fault otherwise
  reaches a human as an empty object.
- Recipients are **masked at write time** in the database, not at render time:
  `message_log.recipient_hint` and `notification_deliveries.recipient_hint` store
  `r••••@example.com` / `+91 •••• ••43 10`. The full address lives only on the
  candidate record.
- IP addresses are **never stored raw** — only a keyed HMAC, in both
  `form_responses.submitter_ip_hash` and `form_submission_attempts.ip_hash`.
- No password, token, or credential is logged anywhere.

### S-08 · `RISK` (P2) — provider response bodies are logged verbatim

Three call sites log an upstream error body in full:

```
lib/integrations/calendar/oauth.ts:135   console.error("[calendar] token exchange failed:", response.status, await response.text())
lib/integrations/email/index.ts:361      console.error("[email] send rejected:", response.status, await response.text())
lib/ai/provider.ts:110                   console.error(`[ai] provider returned ${response.status}`, await response.text())
```

Those bodies can contain personal data — a rejected email send commonly echoes
the recipient address, and an LLM 4xx can echo a slice of the prompt, which for
`parseResume()` is a candidate's CV. The provider's own credentials are not in
these bodies, so this is a PII-in-logs issue, not a credential leak.

**Fix:** truncate to ~200 characters and log the status plus a provider error
code rather than the whole body.

### `MISSING` (P1) — no structured logging, no aggregation, no alerting

Everything goes to `console.*`, which on Vercel means ephemeral function logs.
There is no request-id correlation, no log level, no retention policy, no error
tracker (no Sentry/Datadog/OpenTelemetry in `package.json`), and therefore **no
way to know an error happened in production**.

---

## 10. Transport, headers & browser hardening

`MISSING` (P1) — `next.config.ts` is **empty**. There are no security headers:
no `Content-Security-Policy`, no `Strict-Transport-Security`, no
`X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `X-Frame-Options` /
`frame-ancestors`, and no `Permissions-Policy`.

Vercel terminates TLS and sets HSTS at the edge for its own domains, so HTTPS
itself is fine — but the app is currently framable (clickjacking) and has no CSP
to blunt an XSS that gets past React's escaping.

**Fix:** add a `headers()` block to `next.config.ts`. This is ~20 lines using
the framework's built-in mechanism and requires no dependency. Start CSP in
report-only; Bulma and the CodeMirror bundle will need `style-src` attention.

**CSRF — `PARTIAL`.** There is no CSRF token and no `Origin` check. In practice
this is largely covered: the active-org cookie is `SameSite=Lax`, Supabase's
session cookie is `Lax` by default, and every mutating route requires a JSON
body — which forces a CORS preflight that a cross-site form cannot produce. It
is defence-by-default rather than defence-by-design, and it should be stated
rather than assumed. A single `Origin`/`Sec-Fetch-Site` check inside
`handleRouteError`'s sibling helper would make it explicit for ~10 lines.

---

## 11. Candidate-facing signed links — `IMPLEMENTED`

Three of them (`lib/forms/token.ts`, `lib/coding/token.ts`,
`lib/communications/optout.ts`), built to the same shape on purpose: an HMAC over
the row's own id, **nothing stored**. So a database dump contains no working
links and there is no token column for a mistaken `SELECT` to leak.

- The URL exposes only one row id — never an organization, job, candidate or
  application id, and never a job title.
- Every verifier compares in **constant time** and returns `null` for a bad
  signature, a missing key, a wrong scheme version and a malformed token alike —
  distinguishing them would let someone probe which rows exist.
- The form token additionally signs `token_version`, so
  `update forms set token_version = token_version + 1` is a **complete
  revocation** of every link and QR code ever issued, while still storing no
  secret.
- With no signing key, publishing is **refused** rather than issuing an
  unverifiable link — a dead unsubscribe link is worse than an instruction to a
  human, because the candidate believes they have opted out.

`RISK` (P3) — the coding-session link has a 24-hour expiry, but a published form
link is valid until someone bumps `token_version`. That is intended (a poster
outlives a day) and is called out here only so it is a decision on the record.

---

## 12. Summary of security findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| **S-01** | **P0** | `accept_invite` does not bind the invite to its email; `on conflict do update set role` allows self-escalation | `RISK` |
| **S-07** | **P1** | No rate limiting outside the public form — public coding routes and ~30 AI endpoints are uncapped | `MISSING` |
| **S-04** | **P1** | No prompt-injection boundary; AI shortlisting acts automatically on attacker-controlled resume text | `RISK` |
| — | **P1** | No AI cost metering, attribution, or budget | `MISSING` |
| — | **P1** | No security headers (`next.config.ts` empty) | `MISSING` |
| — | **P1** | No error tracking or structured logging | `MISSING` |
| **S-02** | **P1** | Service-role client used in 16 modules with no test asserting the `organization_id` filter | `RISK` |
| **S-05** | **P2** | Bolna webhook has no replay protection | `RISK` |
| **S-06** | **P2** | `INTEGRATION_ENCRYPTION_KEY` serves five purposes; rotation is effectively impossible | `RISK` |
| **S-08** | **P2** | Provider error bodies logged verbatim — PII in logs | `RISK` |
| **S-03** | **P2** | Per-route hand-written validation with no aggregate assertion | `PARTIAL` |
| — | **P2** | `CRON_SECRET` and 5 other env vars undocumented | `MISSING` |
| — | **P2** | No file content sniffing or malware scanning | `RISK` |
| — | **P3** | No CSRF token (mitigated by SameSite + JSON-only) | `PARTIAL` |
| — | **P3** | No MFA, no session revocation UI | `MISSING` |
