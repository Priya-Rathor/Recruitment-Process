# Production Audit

**Repository:** Scoreboad · **Audited:** 2026-08-30 · **Branch:** `master`
**Scope:** full repository — 692 files, ~117,900 lines of TS/TSX, ~9,500 lines
of SQL, 105 API routes, 51 tables, 38 migrations, 1,643 tests.

Every finding was verified against the source. Nothing here is inferred from the
specification, and where something could not be established from the repository
it is marked `UNKNOWN` rather than guessed.

---

## 1. What is already good

This is a **well-engineered codebase**, and unusually so for AI-assisted work.
The following are not "acceptable" — they are done properly, and several are
better than what most production SaaS ships.

**The tenant boundary is real, and defended in depth.**
The tenant is resolved from the session only; the active-org cookie is a hint
re-validated against real membership rows on every request. RLS is enabled on
**all 51 tables**, and ~20 `enforce_*_tenant_integrity` triggers close the gap
where a correctly-tenanted row could still point at another tenant's parent.
Verified: **all 105 route handlers** call a tenant helper except the five
intentionally public ones.

**The team understood that RLS — not the route handler — is the boundary.**
Because the browser holds an authenticated PostgREST client, a rule that lives
only in a route handler is not enforced. This codebase acts on that
consistently: stage history is written by a trigger so a direct PostgREST write
is still captured; `activity_events` is append-only at the database, not by
convention; self-role-change is blocked by a trigger because the rule compares
`OLD` to `NEW`, which no policy can express; and "at least one Owner" locks the
parent row inside the trigger instead of check-then-write, so there is no TOCTOU
race. That last one is a subtle bug most teams ship.

**The AI safety model is coherent and enforced, not aspirational.**
One provider boundary (`lib/ai/provider.ts`), no generic `askAI()`, 18 named
purpose-specific functions taking structured input only, `AiResult<T>` with
mandatory output validation, a 30-second abort budget, and — the part that
matters — where the spec states a hard constraint, it is enforced in code and
the *enforcement* is tested (`numericGuard.ts`), rather than left to prompt
wording. AI failure is a normal state; the manual workflow always remains usable.

**Candidate-facing links are designed, not improvised.**
Three signed-token implementations built to the same shape on purpose: an HMAC
over the row's own id with **nothing stored**, so a database dump contains no
working links and there is no token column to leak. Constant-time comparison.
Identical failure response for a bad signature, a missing key and a malformed
token, so nobody can probe which rows exist. The URL carries one row id — never
an organization, job, candidate or application id.

**Credential handling is correct end to end.**
AES-GCM at rest, a **column-level `REVOKE`** so even an Owner's session cannot
read the ciphertext, a mask (`••••••4F8A`) returned to the UI, and adapters that
**fail closed** when the encryption key is absent rather than storing secrets in
the clear. No secret is committed; `.gitignore` names credential *file types*,
correctly noting that a secret does not have to be called `.env` to be one.

**Privacy is treated as a build constraint.**
Raw IP addresses are never stored — only a **keyed HMAC**, with an explicit note
that a bare SHA-256 of an IPv4 address is reversible on a laptop. Recipient
addresses are masked **at write time**, not at render time. The consent
disclosure cannot be disabled. This is the difference between a team that read
the GDPR and a team that intends to.

**Degradation is honest.**
Unbuilt tables produce a labelled *pending* state, never a fake `0` — because a
zero reads as "nothing happened", which is a false statement to a manager. A
missing migration is distinguished from an RLS denial by **error code, not
message text**, so a real bug is never mislabelled as pending work. Every
integration reports what is actually true rather than a convenient fiction — the
`llm` adapter explicitly refuses to report "connected" while `provider.ts` uses
a different key.

**Anything that contacts a real person fails closed.**
Disconnected by default, explicit confirmation, a hard attempt cap, and a
consent disclosure that cannot be turned off.

**The one rate limiter that exists is textbook.**
Table-backed because the app is serverless and an in-process counter is a
suggestion, not a limit. Two caps because `x-forwarded-for` is a header. Keyed
HMAC rather than a raw IP. Fails **open**, deliberately, because the cost of a
broken limiter is spam a recruiter deletes and the cost of failing closed is a
real person unable to apply for a job. Rows pruned rather than hoarded.

**Test discipline where it counts.** 1,643 tests in 2.2 seconds, every `lib/`
domain covered, and the pattern is right: the irreversible decision is a pure
function with tests, and the executor only does what it is told.

**The in-code documentation is exceptional.** Comments explain *why* — including
the near-misses (`/apply` must not free `/applications`), the failures already
suffered, and the alternatives rejected. That is the artefact that makes this
codebase maintainable by someone who did not write it.

---

## 2. What needs improvement

| Area | Current | Should be |
| --- | --- | --- |
| **Operations** | No CI, no error tracking, no alerting, no health check, unverified backups | The single largest gap. Everything else is a code change; this is missing infrastructure |
| **Test kinds** | Excellent unit coverage of pure logic | Nothing tests RLS, routes, or flows — the three things most likely to break |
| **Rate limiting** | One excellent implementation, one caller | Generalise the *existing* table-backed limiter to public coding routes and AI endpoints. Do not write a second one |
| **Validation** | Careful per-route, strong DB `CHECK` backstop | Extract the ~10 primitives already duplicated across routes into `lib/validation.ts`. Keep it hand-written — no schema library needed |
| **AI cost** | Unmetered, unattributed, uncapped | Per-organization usage rows and a budget check in `provider.ts` |
| **Headers** | `next.config.ts` is empty | ~20 lines using the framework's own `headers()` |
| **Key management** | One key, five purposes | HKDF-derived subkeys from one root — ~15 lines, no dependency |
| **Pagination** | Silent truncation at 200/500 | Either paginate or say "showing 200 of 1,340" |
| **Cron** | Sequential over all orgs, 300 s ceiling | Per-org isolation and resumable partial progress |
| **Docs drift** | `README.md` stops at Module 17 | Reflect Modules 18–26 and partial privacy |

---

## 3. Critical security issues

| ID | Sev | Issue |
| --- | --- | --- |
| **S-01** | **P0** | **Invite privilege escalation.** `accept_invite` never compares the invite's email to the accepting user's, and ends with `on conflict … do update set role = excluded.role`. Anyone holding a forwarded invite token joins with the invited role; an existing lower-privileged member presenting an admin token **escalates themselves**. |
| **S-07** | **P1** | **Rate limiting on one endpoint only.** Three public unauthenticated coding routes (one autosaving on a timer) and ~30 paid AI endpoints are uncapped. |
| **S-04** | **P1** | **Prompt injection into an automated decision.** Attacker-controlled resume text enters LLM prompts undelimited, and `lib/workflow/shortlist.ts` branches an application on the resulting score with no human in the loop. |
| — | **P1** | **No AI cost control.** No metering, no attribution, no budget, no cap. |
| — | **P1** | **No security headers.** No CSP, HSTS, `nosniff`, `Referrer-Policy`, or `frame-ancestors`. |
| **S-02** | **P1** | **Service-role client unverified.** 16 modules bypass RLS with no test asserting the `organization_id` filter. |
| **S-05** | **P2** | Bolna webhook has no replay protection. |
| **S-06** | **P2** | One encryption key serves five purposes; rotation breaks every live candidate link, so it will never happen. |
| **S-08** | **P2** | Provider error bodies logged verbatim — candidate PII into logs. |

---

## 4. Production blockers

Four, and none of them are code-quality problems:

1. **B-01 — Three migrations unapplied.** `0032`, `0037`, `0038` are written but
   have never run. The deployed schema does not match the code.
2. **B-02 — No CI, and 36 uncommitted files.** Nothing gates a push, and what
   is deployed corresponds to no commit.
3. **B-03 — Backups and rollback are `UNKNOWN`.** No recorded plan, no PITR
   setting, no storage-bucket backup, no down-migrations, and no restore has
   ever been tested. There is no verified way back.
4. **B-04 — No error tracking.** A production failure is invisible.

Plus **S-01** (P0 security) and **P-01** (P0 privacy: retention promised in the
UI, never executed).

---

## 5. Technical debt

- `lib/automations/engine.ts` is ~1,800 lines with ~25 service-role queries. It
  is the highest-risk single file in the repository — not because it is wrong,
  but because its correctness rests entirely on reviewer attention.
- `UUID_PATTERN` and other validation primitives are re-declared across several
  route files.
- 105 route handlers with no shared request-parsing helper beyond
  `parsePagination()`.
- `README.md` documents 17 modules; 26 exist.
- `provider.ts` still ignores the per-organization LLM key the `llm` adapter
  stores — honestly reported, but a real divergence.
- `schedule_interview` renders a manual-trigger button that nothing wires up
  (carried across two modules).
- `docs/QA-MANUAL-TESTING-GUIDE.md` at 6,411 lines has no CI hook and no
  recorded run, so it documents intent rather than verified state.
- `.claude/settings.local.json` contains a Supabase project URL and a
  publishable key in an allowlisted `curl`. The key is public by design, but the
  project ref is now in git history.

---

## 6. Missing tests

| Priority | Missing |
| --- | --- |
| **P0** | Any test of RLS or cross-tenant isolation — 51 tables, ~110 policies, zero coverage |
| **P0** | Any test of the 105 API route handlers — no 401/403/404 assertions, nothing catching a new route with no guard |
| **P1** | Any test that a service-role query filters `organization_id` |
| **P1** | Any end-to-end test — including the public application flow a stranger can reach |
| **P1** | Migration replay from empty + idempotency |
| **P2** | Component tests (66 client components, none rendered) |
| **P2** | Coverage reporting |
| **P2** | Load test of the sweep; query plans; bundle size |

---

## 7. Recommended priorities

### P0 — before any production traffic
1. Apply migrations `0032`, `0037`, `0038`. *(B-01)*
2. Fix `accept_invite`: bind to the invited email; stop the `on conflict` branch
   from granting a role. *(S-01)*
3. Commit the working tree and add a CI workflow running
   lint + typecheck + test + build. *(B-02)*
4. Establish and **test** a backup/restore path, including storage buckets and
   key escrow; write the rollback procedure. *(B-03)*
5. Add error tracking and a cron-failure alert. *(B-04)*
6. Document `CRON_SECRET` in `.env.local.example` and surface "scheduler not
   configured" in the Automations UI.
7. Repeat the "nothing is deleted yet" warning on the Privacy settings page.
   *(P-01, 10 lines — removes a misleading promise today)*

### P1 — before scaling beyond a pilot
8. Static test: every route handler calls a tenant helper. *(T-02, ~40 lines)*
9. RLS cross-tenant test suite against local Supabase. *(T-01)*
10. Extend the existing rate limiter to the public coding routes and to AI
    actions per organization. *(S-07)*
11. AI usage metering + per-organization budget in `provider.ts`.
12. Security headers in `next.config.ts`. *(~20 lines)*
13. Static test: admin-client queries filter `organization_id`. *(T-03)*
14. Require the deterministic score to also clear the threshold before
    `ai_resume_shortlist` takes the pass branch. *(S-04 — cheaper and stronger
    than prompt hardening)*
15. Make the sweep per-organization isolated and resumable. *(PERF-01)*
16. Playwright smoke test of the core flow.

### P2 — hardening and maintainability
17. HKDF-derived subkeys from one root secret. *(S-06)*
18. Webhook replay protection. *(S-05)*
19. Truncate provider error bodies in logs. *(S-08)*
20. `lib/validation.ts` for the duplicated primitives. *(S-03)*
21. Real pagination, or an explicit "showing N of M". *(PERF-02)*
22. Content sniffing on upload; a bound around resume extraction.
23. Retention executor as a pass inside the existing sweep, defaulting to
    flag-for-review. *(P-01)*
24. Coverage reporting, component tests, `global-error.tsx`, `not-found.tsx`.
25. Update `README.md` to reflect Modules 18–26.

---

## 8. The first five things to fix

Chosen for **blast radius per hour of work**, not by severity alone.

### 1. Apply migrations `0032`, `0037`, `0038`
*Minutes.* Nothing else can be trusted while the deployed schema disagrees with
the code, and two whole modules are currently inert. Everything below assumes
this is done.

### 2. Fix `accept_invite` — bind the invite to its email
*~15 lines of SQL, one migration.* The only finding in this audit that lets an
attacker **become an admin of someone else's organization**. Everything else is
a availability, cost or compliance problem; this is a control-plane compromise.

```sql
-- inside accept_invite, after loading v_invite:
if lower(v_invite.email) is distinct from
   lower((select email from auth.users where id = auth.uid()))
then
  raise exception 'This invite was sent to a different email address.';
end if;
```
And change the `on conflict` branch so it reactivates a removed member without
silently granting a new role.

### 3. Add CI and commit the tree
*~30 lines of YAML, one afternoon.* Four verification commands already exist and
already pass. Right now nothing runs them, and the deployed artefact corresponds
to no commit — which means **no finding in this document can be re-verified
against what is actually running.** CI is what makes every other fix stick.

### 4. Establish a tested backup and rollback path
*One day.* This is the only item that is `UNKNOWN` rather than `MISSING`, and
that is worse. Confirm the Supabase plan and PITR, back up both storage buckets,
escrow `INTEGRATION_ENCRYPTION_KEY` (a restored database without it yields
unreadable credentials and dead candidate links), and **perform one restore**.
An untested backup is a belief.

### 5. Rate-limit the public coding routes, then meter AI spend
*Half a day.* `PUT /api/coding/[token]/draft` is unauthenticated and autosaves on
a timer — a held token is an unbounded write loop. The limiter to use already
exists and is good; generalise `form_submission_attempts` into a
`(bucket, subject_hash)` table rather than writing a second one. Then add token
counting to `provider.ts`, because an uncapped LLM bill is the failure mode most
likely to arrive without warning.

---

## 9. Overall assessment

**Architecture: strong. Operations: absent.**

The security *model* here is better than most production SaaS — the tenant
boundary is defended at three layers, the database carries the invariants that
belong in it, the AI safety pattern is enforced rather than described, and the
privacy decisions show real understanding rather than checkbox compliance. The
code reads like it was written by someone who had been burned before and wrote
down why.

What is missing is almost entirely the operational layer that turns good code
into a running service: continuous integration, error visibility, verified
backups, a rollback path, cost control, and tests of the kinds that catch
regressions in the properties this codebase most cares about.

Two exceptions to that pattern deserve naming, because they are code-level and
they are serious: **the invite escalation path (S-01)** and **retention that is
configured, displayed, and never executed (P-01)**.

The gap is closable. Items 1–5 above are days of work, not months.
