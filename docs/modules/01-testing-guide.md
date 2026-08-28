# Module 1 (authentication & organization) — manual test guide

Every check below is something you can do by hand against a real Supabase
project. Each one names **what to do**, **what you should see**, and — where the
UI alone could mislead you — **the SQL that proves it**.

Run it top to bottom. Each part reuses the accounts the previous part created.

## The one idea that makes this testable without an inbox

**You do not need working email to test any of this.**

- Supabase email auto-confirm is on, so sign-up logs you straight in — no
  confirmation link to chase.
- Invites are never mailed. `POST /api/invites` returns an `invite_url` and
  `app/team/invite/TeamManager.tsx` renders it on screen for you to copy.

Only `/forgot-password` (Part 5) touches real mail delivery, and it is the one
check that can legitimately fail for reasons outside this module.

---

## Phase 0 — Setup

### 0.1 Apply the migration

Paste `supabase/migrations/0001_module1_authentication_organization.sql` into
the Supabase SQL Editor and run it. It is re-runnable (`if not exists`, `drop
policy if exists`), so running it twice is safe. If sign-up fails with a
database error, this is why.

**Verify:**

```sql
-- Expect exactly these four tables.
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('organizations', 'users', 'organization_members', 'invites')
order by table_name;

-- Expect rls enabled on all four.
select relname, relrowsecurity from pg_class
where relname in ('organizations', 'users', 'organization_members', 'invites');

-- Expect the tenant helpers and the last-owner trigger to exist.
select proname from pg_proc
where proname in ('current_app_user_id', 'is_org_member', 'has_org_role',
                  'handle_new_auth_user', 'create_organization_and_owner',
                  'accept_invite', 'enforce_owner_remains',
                  'prevent_self_role_change')
order by proname;
```

Also apply `supabase/migrations/0036_prevent_self_role_change.sql`, which adds
the last of those.

```sql
-- Expect both triggers on organization_members.
select tgname from pg_trigger
where tgrelid = 'public.organization_members'::regclass
  and not tgisinternal
order by tgname;
```

### 0.2 Start the server

```bash
npm run dev
```

### 0.3 Open three browser contexts and keep them open

| Window | What it is | Who |
| --- | --- | --- |
| **A** | Normal window | Org A **Owner** |
| **B** | Incognito | The **invited teammate** |
| **C** | A second Chrome profile (or a different browser) | **Org B** — the rival tenant |

Three separate contexts matter: two tabs in the same window share a session and
will silently invalidate every isolation check in Part 4.

---

## Phase 1 — Sign-up and workspace creation (Window A)

### 1.1 A new account reaches onboarding

Go to `/signup`. Enter a full name, a fresh email, and a password →
**Create account**.

**Expect:** you land on `/onboarding` showing "Step 1 of 3 — Name your
workspace". No confirmation email.

### 1.2 The same email cannot sign up twice

Log out. Return to `/signup` and sign up again with the email from 1.1.

**Expect:** an error. Not a second workspace.

**Verify:**

```sql
select count(*) from auth.users where email = 'YOUR_EMAIL';  -- expect 1
```

### 1.3 Invalid credentials are refused

On `/signup`, submit an email with no `@`. Then a valid email with a
3-character password.

**Expect:** an inline error each time, you stay on `/signup`, and no account is
created. Confirm in Supabase → Authentication → Users.

### 1.4 The workspace is created at step 1, not at sign-up

Log back in, then on onboarding step 1 enter a workspace name, country and
timezone → Continue.

**Expect:** step 2 appears.

**Verify:** the `organizations` row exists *now* and did not exist between 1.1
and this step — `POST /api/organizations` is what creates it, via
`create_organization_and_owner()`.

```sql
select id, name, country, timezone, onboarding_completed_at
from public.organizations order by created_at desc limit 1;
```

### 1.5 Finish onboarding

On step 2 fill industry, team size, "Who do you hire for?" and the hiring-focus
box → **Skip AI suggestions** → **Finish setup**.

**Expect:** you land on `/dashboard`.

### 1.6 Onboarding cannot be re-entered

Type `/onboarding` into the address bar.

**Expect:** immediate redirect to `/dashboard`. `app/onboarding/page.tsx`
redirects once `onboarding_completed_at` is set; editing these answers
afterwards belongs in Settings → Organization.

### 1.7 Exactly one organization, exactly one Owner

Open `/team/invite`.

**Expect:** you are listed exactly once with role **Owner**. Pending invites is
empty. This is the module's headline invariant.

**Verify:**

```sql
select om.role, om.status, u.email
from public.organization_members om
join public.users u on u.id = om.user_id
where om.organization_id = 'ORG_A_ID';
-- expect exactly one row: owner / active / your email
```

---

## Phase 2 — Invites (Window A → Window B)

### 2.1 Invite input is validated

On `/team/invite`, submit an email with no `@`.

**Expect:** "Enter a valid email address." No invite row is created — the
pending count does not move.

### 2.2 An Owner can create an invite

Enter a real second email, choose role **Recruiter**, click **Create invite**.

**Expect:** a "Share this invite link" panel with a copyable URL. The invite
appears under Pending invites with an expiry **7 days** out (the column default
in the migration). **Copy the link — 2.3 needs it.**

### 2.3 Accepting an invite joins the same workspace

In **Window B (incognito)**, paste the link and create the account.

**Expect:** the invitee lands in the *same* workspace, not a new one.

Back in **Window A**, refresh `/team/invite`.

**Expect:** they are listed as an active **Recruiter**, and the invite leaves
the pending list.

**Verify:**

```sql
select status from public.invites where email = 'INVITEE_EMAIL';  -- accepted
select count(*) from public.organizations;  -- unchanged — no second org
```

### 2.4 A revoked invite stops working

Create a second invite, copy its link, then click **Revoke** on it. Open the
copied link in a private window.

**Expect:** rejected. A link that leaked before revocation must be dead the
moment it is revoked.

### 2.5 A tampered token is rejected

Take a valid invite URL and change four or five characters in the token. Open
it.

**Expect:** "Invalid or expired invite" — raised by `accept_invite()` in the
database, not merely by the UI. No membership row is created.

---

## Phase 3 — Roles, self-edits, and the last-Owner rule (Windows A and B)

### 3.1 A Recruiter has no team management

In **Window B**, open `/team/invite` as the Recruiter.

**Expect:** no invite form. The page reads "Only an Owner or Admin can invite
teammates or change roles."

### 3.2 A promotion takes effect on the next request

In **Window A**, change that user to **Admin**. In **Window B**, press
**refresh** — do not log out.

**Expect:** the invite form is now available. No re-login required.

### 3.3 An Admin cannot mint an Owner

Still in **Window B** as Admin, try to create an invite with role **Owner**.

**Expect:** refused. `app/api/invites/route.ts` allows only an Owner to invite
an Owner, and the `invites_insert_owner_admin` policy enforces the same thing.
An Admin who could mint Owners is a privilege escalation.

### 3.4 A demotion revokes access just as fast

In **Window A**, change them to **Viewer**. Refresh **Window B**.

**Expect:** access is gone again immediately. A stale session must not keep
elevated rights.

### 3.5 Nobody can change their own role

In **Window B** as Admin, look at your own row on `/team/invite`.

**Expect:** your role shows as plain text, not a dropdown, and there is no
Remove button. The page reads "You can't change or remove your own membership."

Do the same as Owner in **Window A** — same result.

Now bypass the UI. In **Window B**, open DevTools → Console and PATCH your own
membership directly (take the id from the Network tab, or from the SQL below):

```js
await fetch('/api/members/YOUR_OWN_MEMBER_ID', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'viewer' })
}).then(r => r.json()).then(console.log);
```

**Expect:** `403` — "You cannot change your own role. Ask another Owner or Admin
to do it."

This one matters because it is the check that was missing. Before
`0036_prevent_self_role_change.sql`, an Admin could demote themselves in one
click and then lacked the permission needed to undo it — only an Owner could
restore them.

**Verify the database refuses it too,** since the route is not the only way to
write the row. Run the PostgREST snippet from 4.3 as an Admin, but as an update:

```js
const r = await fetch(
  `https://${ref}.supabase.co/rest/v1/organization_members?id=eq.YOUR_OWN_MEMBER_ID`,
  { method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${s.access_token}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'viewer' }) }
);
console.log(r.status, await r.text());
```

**Expect:** rejected with "You cannot change your own role…" from the
`prevent_self_role_change` trigger. A rule that lived only in the route handler
would let this through.

### 3.6 Stepping down as Owner takes two people

**Expect:** an Owner cannot demote themselves either — 3.5 applies to every
role. To hand over: promote a second member to **Owner**, then have *them*
change your role. `enforce_owner_remains()` still guarantees the workspace
never reaches zero Owners.

### 3.7 You cannot remove your own membership either

In **Window B** as Admin, the Remove button is absent on your own row. Bypass
the UI from the Console:

```js
await fetch('/api/members/YOUR_OWN_MEMBER_ID', { method: 'DELETE' })
  .then(r => r.json()).then(console.log);
```

**Expect:** `403` — "You cannot remove your own membership." Before this guard
existed an Admin could delete themselves out of the workspace entirely, which
is strictly worse than the self-demotion in 3.5.

There is no "leave organization" feature. If one is wanted it should be its own
endpoint with its own rules, not a side effect of the admin removal route.

### 3.8 The last Owner is still protected

3.5 and 3.7 now shadow the self-service routes into the last-Owner rule, so
exercise `enforce_owner_remains()` where it is still reachable — a direct
database write, as the sole Owner in **Window A**:

```js
const r = await fetch(
  `https://${ref}.supabase.co/rest/v1/organization_members?id=eq.YOUR_OWN_MEMBER_ID`,
  { method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${s.access_token}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'removed' }) }
);
console.log(r.status, await r.text());
```

**Expect:** *"An organization must always have at least one active Owner.
Promote another member to Owner first."*

Note this writes `status`, not `role`, so `prevent_self_role_change` does not
fire — the refusal comes from `enforce_owner_remains()`, which is the point of
the test. It is a constraint trigger that takes a row lock on the organization,
so it holds against the API bypass and is not vulnerable to the check-then-write
race a two-statement API check would have.

### 3.9 Ownership can be handed over

Promote the second user to **Owner**, then have *them* change your role to
Admin.

**Expect:** it succeeds. Stepping down needs two people now, and the workspace
is never left ownerless and never permanently locked.

**Verify:**

```sql
select count(*) from public.organization_members
where organization_id = 'ORG_A_ID' and role = 'owner' and status = 'active';
-- must never be 0, at any point during this phase
```

---

## Phase 4 — Tenant isolation (Window C)

This is what the module exists for. Everything above is a convenience; this is
the correctness boundary.

### 4.1 A second workspace is fully separate

In **Window C**, sign up a brand-new account and complete onboarding. This is
**Org B**.

**Expect:** Org B's `/team/invite` lists only the Org B owner. The dashboard
shows empty states, not Org A's numbers.

### 4.2 Org A's URLs are dead ends for Org B

In **Window A**, create a job and copy its URL (`/jobs/<id>`). Paste that exact
URL into **Window C**. Repeat with a candidate URL and with
`/settings/organization`.

**Expect:** not found or no access every time — never Org A's data, and never a
partial render that leaks a title or a name.

### 4.3 Isolation holds with the API taken out of the picture

The browser holds an authenticated PostgREST client, so any signed-in user can
skip the route handlers entirely. This is the only check that proves the
boundary is real rather than merely enforced in application code.

Logged in as Org B in **Window C**, open DevTools → Console and run:

```js
const ref = 'jjcwwotdkoojqdifwdwx';
const key = 'PASTE_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';
const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`));
const r = await fetch(
  `https://${ref}.supabase.co/rest/v1/organizations?select=id,name`,
  { headers: { apikey: key, Authorization: `Bearer ${s.access_token}` } }
);
console.table(await r.json());
```

**Expect:** exactly one row — Org B.

If Org A appears, RLS is not doing the work and the route handler is the only
thing standing between tenants. Repeat the query against
`organization_members`, `invites` and `users`.

> Note on `organization_members`: its SELECT policy intentionally exposes every
> member row of an org you belong to, because the team list needs it. Seeing
> your *own* org's teammates here is correct. Seeing another org's is not.

### 4.4 The switcher lists only your own workspaces

Open `/organizations/switch` in **A** and in **C**.

**Expect:** each user sees only workspaces they are an active member of.

Then invite the Org B owner into Org A and accept. Check again.

**Expect:** that user now sees both, and switching changes which tenant's data
loads.

---

## Phase 5 — Sessions and password reset (Window A)

### 5.1 Protected routes demand a session

Log out. Type each of these directly: `/dashboard`, `/team/invite`,
`/settings/organization`, `/jobs`.

**Expect:** all four bounce to `/login`. Auth is enforced at the edge in
`proxy.ts` with a public-path allowlist, so protection is the default for any
route added later.

### 5.2 Logging out really ends the session

Log in, open `/dashboard`, log out, press the browser **Back** button, then
**refresh**.

**Expect:** redirected to `/login`. A cached frame may flash for an instant; the
refresh is what matters.

### 5.3 Password reset requests are discreet

Open `/forgot-password`. Submit a real account email, then an email that has
never signed up.

**Expect:** the same neutral confirmation both times — the page must not reveal
which emails have accounts.

**On delivery:** Supabase's built-in SMTP only mails your own Supabase account
address and is heavily rate-limited. A missing email here is an SMTP setting,
not a Module 1 defect. Configure a real SMTP provider in Supabase → Project
Settings → Authentication → SMTP before treating it as a failure.

---

## The AI onboarding step

Optional, and worth understanding before you file a bug against it.

On onboarding step 2, typing at least 3 characters into the hiring-focus box
enables **Suggest defaults with AI**. It calls
`POST /api/organizations/[id]/ai-action` →
`lib/ai/generateOnboardingRecommendations.ts` and renders five lists on the
review screen: pipeline stages, screening questions, interview rounds, candidate
fields, automation ideas.

**None of it is persisted.** `finish()` in `app/onboarding/OnboardingFlow.tsx`
posts only `industry`, `size`, `hiringFocus` and `agency_mode` — exactly what
the skip path posts. An org onboarded with AI and one onboarded without end up
byte-for-byte equivalent.

### 5.4 An AI failure never blocks onboarding

Stop the server, set `OPENAI_API_KEY=sk-invalid` in `.env.local`, restart, sign
up a throwaway account and click **Suggest defaults with AI**.

**Expect:** a red "We couldn't generate suggestions…" message with a **Retry AI
suggestions** button — and **Finish setup** still completes. The manual path
must always survive an AI outage.

Restore the real key afterwards.

### Open retrofit item

The spec (`docs/modules/01-authentication-organization.md`, section "How AI Is
Used In This Module") says the Owner can "accept, edit, or skip" these
suggestions. There is no accept path today. The review screen's own copy —
"These become editable defaults once Jobs, Pipeline, and Settings are
available" — was written when Modules 3, 10 and 17 did not exist. They exist
now.

**Outstanding work:** wire accept → real pipeline stages
(`0021_pipeline_stage_redefinition.sql`), screening templates, interview rounds
and candidate fields, gated to Owner/Admin, with an explicit Save. Until then
this is a known gap, not a test failure.

---

## What to re-run after any change

| You changed | Re-run |
| --- | --- |
| `supabase/migrations/0001_*.sql` or any RLS policy | 3.5–3.7, all of Phase 4 |
| `lib/tenant.ts` | 3.1–3.4, 4.2, 5.1 |
| `app/api/invites/*` or `app/api/members/*` | Phase 2, Phase 3 |
| `app/team/invite/TeamManager.tsx` | 3.1, 3.5, 3.6, 3.7 |
| `supabase/migrations/0036_*.sql` | 3.5–3.9 |
| `proxy.ts` | 5.1, 5.2 |
| `app/onboarding/*` | 1.4–1.6, 5.4 |

4.3, 3.5 and 3.7 are the three that catch real regressions. Everything else
catches typos.
