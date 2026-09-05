# Production Readiness Checklist

`IMPLEMENTED / PARTIAL / MISSING / RISK / UNKNOWN`

Assessed 2026-08-30 against the code in this repository. Every row was verified;
nothing is inferred from the specification.

---

## 1. Application security

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1.1 | Authentication implemented | `IMPLEMENTED` | Supabase Auth; edge session refresh in `proxy.ts` |
| 1.2 | Deny-by-default route protection | `IMPLEMENTED` | `lib/supabase/session.ts` allowlist, tested in `publicPaths.test.ts` |
| 1.3 | Authorization enforced server-side | `IMPLEMENTED` | `requireRole()` in 100/105 routes; 5 public routes are intentional and documented |
| 1.4 | Authorization enforced in the database | `IMPLEMENTED` | RLS on all 51 tables + `has_org_role()` + role triggers |
| 1.5 | Frontend authorization never trusted | `IMPLEMENTED` | Field allowlists run before anything else; hiding a control is treated as cosmetic |
| 1.6 | IDOR / cross-tenant protection | `IMPLEMENTED` | Session-resolved tenant; `.eq("organization_id", …)` on every id lookup; ~20 integrity triggers |
| 1.7 | **Invite tokens bound to identity** | **`RISK`** | `accept_invite` never checks the email; `on conflict do update set role` permits self-escalation — **S-01** |
| 1.8 | Service-role usage constrained | `PARTIAL` | Correct where checked, but 16 modules and no test asserting the tenant filter — **S-02** |
| 1.9 | Input validation | `PARTIAL` | Careful per-route + strong DB `CHECK` constraints; no aggregate assertion — **S-03** |
| 1.10 | SQL injection | `IMPLEMENTED` | PostgREST binding only; no raw SQL in application code |
| 1.11 | XSS | `IMPLEMENTED` | Zero `dangerouslySetInnerHTML`, zero `eval`/`new Function` |
| 1.12 | **Security headers / CSP** | **`MISSING`** | `next.config.ts` is empty — no CSP, HSTS, nosniff, Referrer-Policy, or frame-ancestors |
| 1.13 | CSRF | `PARTIAL` | No token; mitigated by `SameSite=Lax` + JSON-only bodies forcing preflight |
| 1.14 | **Rate limiting** | **`PARTIAL`** | Excellent on the public form; **absent everywhere else**, including 3 public coding routes and ~30 AI endpoints — **S-07** |
| 1.15 | File upload security | `IMPLEMENTED` | Private buckets, size + MIME + extension caps, signed reads |
| 1.16 | Malware / content sniffing on upload | `MISSING` | Bytes are never inspected |
| 1.17 | Secrets kept out of git | `IMPLEMENTED` | Verified via `git ls-files`; `.gitignore` names credential file types explicitly |
| 1.18 | No private credentials in frontend | `IMPLEMENTED` | Only the RLS-constrained publishable key is `NEXT_PUBLIC_` |
| 1.19 | Credentials encrypted at rest | `IMPLEMENTED` | AES-GCM + column-level `REVOKE` |
| 1.20 | Key rotation possible | `RISK` | One key serves five purposes; rotation breaks every live candidate link — **S-06** |
| 1.21 | Webhook signature verification | `IMPLEMENTED` | HMAC over raw bytes, constant time, fails closed |
| 1.22 | Webhook replay protection | `MISSING` | No timestamp or nonce — **S-05** |
| 1.23 | MFA | `MISSING` | |
| 1.24 | Session revocation UI | `MISSING` | |
| 1.25 | Dependency vulnerability scanning | `MISSING` | No `npm audit` in any pipeline; no Dependabot |

## 2. AI safety

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 2.1 | Single provider boundary | `IMPLEMENTED` | `lib/ai/provider.ts`; no generic `askAI()` |
| 2.2 | Output validated before use | `IMPLEMENTED` | Every call passes a `validate()` narrowing function |
| 2.3 | AI never writes to trusted tables | `IMPLEMENTED` | Human review in the path for parsing and screening reports |
| 2.4 | Hard constraints enforced in code | `IMPLEMENTED` | `numericGuard.ts`, tested |
| 2.5 | Graceful degradation when unconfigured | `IMPLEMENTED` | `not_configured` is a normal state; manual workflow always usable |
| 2.6 | Timeout on provider calls | `IMPLEMENTED` | 30 s abort budget |
| 2.7 | **Prompt-injection boundary** | **`RISK`** | Attacker-controlled resume text enters prompts undelimited; shortlisting acts automatically — **S-04** |
| 2.8 | **Cost metering / budget** | **`MISSING`** | No usage table, no token counting, no cap, no per-tenant attribution |

## 3. Privacy & compliance

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 3.1 | Consent before recording | `IMPLEMENTED` | Cannot be disabled; trigger-stamped; decline policy configurable |
| 3.2 | Processor disclosure | `IMPLEMENTED` | `lib/privacy/providers.ts`, shows only connected processors |
| 3.3 | Data minimisation | `IMPLEMENTED` | No raw IPs; masked recipients at write time; minimal candidate URLs |
| 3.4 | **Retention enforced** | **`PARTIAL`** | Complete tested planner, **zero callers**. Nothing is ever deleted |
| 3.5 | Retention honestly disclosed in the UI | `PARTIAL` | Security page says so; the Privacy page — where it is configured — does not |
| 3.6 | Right to erasure | `PARTIAL` | Admin action exists; storage-object completeness unverified |
| 3.7 | Right to object (marketing) | `IMPLEMENTED` | Per-channel opt-out + signed unsubscribe usable without a login |
| 3.8 | Right of access / portability | `MISSING` | No candidate-facing export |
| 3.9 | Automated-decision notice (Art. 22) | `PARTIAL` | Structurally reversible, but no notice and no stated human-review route |
| 3.10 | Audit trail immutable | `IMPLEMENTED` | Trigger rejects `UPDATE`/`DELETE`; actor snapshot survives user deletion |
| 3.11 | DPA / sub-processors / data region | `UNKNOWN` | Not recorded anywhere in the repository |

## 4. Reliability & operations

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 4.1 | Typecheck clean | `IMPLEMENTED` | `tsc --noEmit` passes, `strict: true` |
| 4.2 | Lint clean | `IMPLEMENTED` | ESLint 9 passes |
| 4.3 | Unit tests | `IMPLEMENTED` | 1643 passing; every `lib/` domain covered |
| 4.4 | **RLS / tenant-isolation tests** | **`MISSING`** | The core security property has no automated coverage — **T-01** |
| 4.5 | **API route tests** | **`MISSING`** | 105 handlers, zero tests — **T-02** |
| 4.6 | E2E tests | `MISSING` | No Playwright/Cypress |
| 4.7 | Component tests | `MISSING` | 66 client components, none rendered in a test |
| 4.8 | Coverage reporting | `MISSING` | |
| 4.9 | **CI/CD** | **`MISSING`** | No workflow of any kind; nothing gates a push |
| 4.10 | **Migrations applied** | **`RISK`** | `0032`, `0037`, `0038` written but not applied |
| 4.11 | Migration ledger per environment | `MISSING` | `docs/Memory.md` prose is the only record |
| 4.12 | Rollback plan | `MISSING` | No down-migrations; no documented procedure until now |
| 4.13 | **Backups verified** | **`UNKNOWN`** | Plan, PITR, and storage-bucket backup all unrecorded; no restore ever tested |
| 4.14 | **Error tracking** | **`MISSING`** | `console.error` into ephemeral logs; nobody is notified of anything |
| 4.15 | Structured logging | `MISSING` | No levels, no request-id correlation |
| 4.16 | Health check endpoint | `MISSING` | |
| 4.17 | Alerting — especially cron failure | `MISSING` | A dead sweep is invisible by construction |
| 4.18 | Graceful degradation | `IMPLEMENTED` | Unbuilt tables, missing keys and AI failure all degrade honestly and are labelled |
| 4.19 | Route-level error boundary | `IMPLEMENTED` | `app/error.tsx`, no stack shown |
| 4.20 | `global-error` / `not-found` pages | `MISSING` | |
| 4.21 | Uncommitted work | `RISK` | 20 modified + 16 untracked files at audit time |

## 5. Performance & scalability

| # | Item | Status | Evidence / gap |
| --- | --- | --- | --- |
| 5.1 | Indexing | `IMPLEMENTED` | ~198 indexes; FKs used in filters are covered |
| 5.2 | Query plans measured | `UNKNOWN` | No `EXPLAIN ANALYZE` evidence for any query |
| 5.3 | Pagination | `PARTIAL` | `parsePagination()` on 8 routes; most lists use a fixed `.limit()` — pipeline caps at 500, applications at 200, **and silently truncate with no "showing N of M"** |
| 5.4 | Caching | `MISSING` | 54 of 65 pages are `force-dynamic`. Correct for tenant data, but no `revalidate` anywhere and no caching of stable reads |
| 5.5 | **Cron scalability** | **`RISK`** | One sequential sweep over **every** organization, `maxDuration = 300`. At 5-minute cadence, a slow org delays every org behind it, and the whole sweep dies at 300 s with partial work done. No per-org isolation, no queue, no backpressure |
| 5.6 | Long-running route budgets | `PARTIAL` | `maxDuration = 60` on action routes. A stage change can trigger a match, a call and messages inside one request |
| 5.7 | N+1 queries | `UNKNOWN` | Not measured |
| 5.8 | Resume extraction bounds | `MISSING` | No timeout or memory bound around `unpdf` / `mammoth` |
| 5.9 | Connection pooling | `UNKNOWN` | Supabase pooler configuration not recorded |
| 5.10 | Bundle size | `UNKNOWN` | Not measured. CodeMirror + 5 language packs is substantial |

## 6. Documentation & maintainability

| # | Item | Status |
| --- | --- | --- |
| 6.1 | Architecture documented | `IMPLEMENTED` — `docs/ARCHITECTURE.md`, `README.md`, and unusually good in-code rationale comments |
| 6.2 | Per-module specifications | `IMPLEMENTED` — `docs/modules/` (35 files) |
| 6.3 | Manual QA guide | `IMPLEMENTED` — 6,411 lines, though with no recorded run |
| 6.4 | Session log protocol | `IMPLEMENTED` — `docs/Memory.md` |
| 6.5 | Agent rules | `IMPLEMENTED` — `AGENTS.md` |
| 6.6 | Runbook / incident response | `MISSING` |
| 6.7 | `README` build status accurate | `PARTIAL` — lists 17 modules and shows the privacy retrofit unchecked, but Modules 18–26 are built and privacy is partially built |

---

## Go / no-go

**Not production-ready.** Four blockers, all of them tractable:

1. Three migrations unapplied — the deployed schema does not match the code.
2. No CI, and uncommitted work in the tree.
3. Backups and rollback are `UNKNOWN` — there is no verified way back from a bad
   release or a bad day.
4. No error tracking — a production failure would be invisible.

Plus one **P0 security** finding (**S-01**, invite privilege escalation) and one
**P0 privacy** finding (retention promised but never executed).

What is genuinely strong — the tenant boundary, RLS depth, the AI safety model,
credential handling, candidate-link design, and honest degradation — is strong
enough that the gaps are operational rather than architectural. That is the
easier kind of gap to close.
