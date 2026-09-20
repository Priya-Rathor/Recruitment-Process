# Module 15 (candidate communication) — manual test guide

Every check below is something you can do by hand against a real Supabase
project. Each one names **what to do**, **what you should see**, and — where the
UI alone could mislead you — **the SQL that proves it**.

## The one idea that makes this testable without a provider

**You do not need a working email or WhatsApp account to test almost any of
this.**

With no channel connected, every send still runs the whole pipeline —
placeholder resolution, the opt-out gate, the duplicate guard, the log write —
and records a row in `message_log` with `status = 'skipped'` and
`error_message = "Email isn't connected, so nothing was sent."`

That row is the proof the trigger fired. So:

- **Phase 1–6** need no provider at all. Read `message_log` instead of an inbox.
- **Phase 7** is the only part that needs real credentials, and it only adds
  "did the bytes actually leave".

Doing it this way is faster and it does not send anything to a real person while
you are learning what the buttons do.

---

## Phase 0 — Setup

### 0.1 Apply the migration

Paste `supabase/migrations/0030_module15_candidate_messaging.sql` into the
Supabase SQL Editor and run it. (Or `supabase/ALL_MIGRATIONS.sql` on a fresh
project — it now includes 0027–0030, which it was missing before.)

**Verify:**

```sql
-- Expect exactly these three, and 12 seeded templates per organization.
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('message_templates', 'message_log',
                     'candidate_communication_preferences');

select count(*) as templates, count(*) filter (where active) as active_ones
from message_templates;
```

**Expect:** `templates = 12`, **`active_ones = 0`**. The default set ships
switched off on purpose — nothing auto-sends until you review the wording. If
`active_ones` is anything but 0, stop and say so; that would be a bug.

```sql
-- The new column and enum value.
select communication_settings from organization_settings limit 1;
select unnest(enum_range(null::message_status));
```

**Expect:** seven statuses including `skipped`. (`skipped` is not in the original
spec — it means "opted out / no address / channel not connected", which is not a
failure. See the notes doc.)

### 0.2 Environment

In `.env.local`:

| Variable | Needed for | If missing |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | **Any** integration at all | Email and WhatsApp can never connect — every send logs `skipped`. Phases 1–6 still work. |
| `INTEGRATION_ENCRYPTION_KEY` (32+ chars) | Credentials **and** signing unsubscribe links | No credentials can be stored, and no unsubscribe link is issued — the footer degrades to "reply and we'll remove you" |
| `APP_URL` | Unsubscribe links on sends with no HTTP request behind them | Sends caused by a click use that request's origin, so normally unnecessary |

Restart `npm run dev` after editing.

### 0.3 Test data

You need: one **job**, one **candidate with a real email address you control**,
and one **application** joining them. Put your own address on the candidate —
Phase 7 will email it.

---

## Phase 1 — The template library

**Route:** `/settings/templates` (Owner/Admin only)

### 1.1 It opens and is honest about its state

**Expect:** a banner reading **"Nothing is sending automatically."** Two channel
chips — "Email not connected" / "WhatsApp not connected". Then twelve groups, one
per event, each with a template inside.

### 1.2 The two events with no automatic trigger say so

Scroll to **Offer extended** and **Requirements not met**.

**Expect** under each: *"No automatic trigger — this product has no point in the
pipeline that means this event. Send it by hand, or from an automation."*

This is deliberate and not a gap in the wiring: there is no offer stage in
`lib/applications/stages.ts`, and nothing distinguishes "unqualified" from
"rejected". Every other event states where it fires from, e.g. *"Sends the moment
an application enters Shortlisted."*

### 1.3 The editor reuses the Job Hiring Stages placeholder editor

Open **Video interview scheduled** → **Edit**.

- [ ] Click **Insert field** → the searchable picker opens, grouped **Job fields
      / Candidate / Interview / Your organization**
- [ ] Put your cursor mid-sentence, insert `Candidate Name` → the token lands **at
      the cursor**, and the cursor stays **after** it (this is the caret handling
      that makes inserting a second field bearable)
- [ ] The chip list under the box updates: **"Fields used: …"**
- [ ] Click **Preview with sample data** → placeholders render as sample values
- [ ] Change **Channel** to `Email + WhatsApp` → a **second body field** appears
      with its own character countdown; `Email` alone hides it; `WhatsApp` alone
      hides the subject field entirely

The `Interview` and `Your organization` groups exist **only** here. Open a job's
hiring-stage prompt editor (`/jobs/<id>` → configure a stage) and confirm those
two groups are **absent** — a screening script cannot resolve `{{interview.time}}`,
so offering it there would produce a sentence read aloud to a candidate with a
hole in it.

### 1.4 A typo warns but does not throw your work away

Type `{{candidate.nmae}}` into the body → **Save**.

**Expect:** it **saves**, and shows *"This field isn't recognised and will be sent
exactly as written: {{candidate.nmae}}"*. Refusing somebody's work over a typo is
worse than showing them the typo; the token is left visible rather than silently
deleted.

### 1.5 Only one template can be active per event

- [ ] Switch **Video interview scheduled** on → chip becomes **"Sending
      automatically"**
- [ ] **New template** in the *same* group → name it `Second video`, subject and
      body anything, Save
- [ ] Switch the new one on

**Expect** a 409 naming the other one: *"'Video interview scheduled' is already
the active template for this event. Switch it off first — only one template sends
automatically per event, or a candidate would receive two messages."*

Enforced by a partial unique index, not by the form — try it with `curl` and it
still fails.

### 1.6 An active template cannot be deleted

Try **Delete** on the active one.

**Expect:** *"…is active and sending automatically. Switch it off before deleting
it."* Deleting the thing currently messaging candidates should be two decisions.

Now switch it off, delete it, and confirm the confirmation says: *"Messages
already sent from it stay in the communication log with their exact wording."*
That is Phase 4.3.

### 1.7 Permissions

| Role | `/settings/templates` |
| --- | --- |
| Owner / Admin | Full access |
| Recruiter / Viewer | Section **hidden** from the settings nav; visiting the URL shows "You can't manage message templates" |

Prove the API agrees, signed in as a Recruiter:

```bash
# Expect 403 — the RLS policy refuses it too, so a direct PostgREST write fails.
curl -i -X POST http://localhost:3000/api/settings/message-templates \
  -H 'Content-Type: application/json' \
  -d '{"name":"x","event_key":"hired","channel":"email","subject":"s","body":"b"}'

# Expect 200 — Recruiters READ the library, because the send screen needs it.
curl -i http://localhost:3000/api/settings/message-templates
```

---

## Phase 2 — Automatic sends on pipeline events

Leave email disconnected. You are reading `message_log`, not an inbox.

### 2.1 The spec's headline test — a video interview booking

1. Activate **Video interview scheduled** (`/settings/templates`)
2. Open your application → **Schedule interview** → mode **Video**, pick a time
3. Save

```sql
select event_key, channel, status, subject, sent_by, error_message,
       left(body_sent, 200) as body
from message_log
order by created_at desc limit 2;
```

**Expect:**

- `event_key = 'video_interview_scheduled'`
- **`sent_by IS NULL`** — this is how the schema records "an automation did it"
- `body_sent` has **no `{{` left in it**, and contains the **real** candidate
  name, job title, and the interview time
- The time is in the **organization's** timezone, not UTC
- `status = 'skipped'`, `error_message = "Email isn't connected, so nothing was
  sent."`

**Why this fires from the scheduling action and not a stage move:** the message
states a *time*, and a stage change has none. Confirm the other half of that
decision — move the application to the **Video Interview** stage manually and
check no second row appears for `video_interview_scheduled`.

**A video interview should carry its joining link.** If Google Calendar is
connected, `body_sent` contains a Meet URL. That works because the interview is
**re-read** after scheduling rather than built from the form — the calendar step
writes `meeting_url` afterwards.

### 2.2 A stage move fires its own event

Activate **Shortlisted**, then move the application to Shortlisted.

**Expect:** a `shortlisted` row appears the moment you save the stage — no button
to press, no sweep.

Repeat for the other stage-triggered events: `ai_screening_call_scheduled`,
`assessment_assigned`, `director_round_scheduled`, `hired`, `rejected`.

### 2.3 Withdrawn sends nothing, deliberately

Move an application to **Withdrawn**.

**Expect:** **no row.** The candidate ended it; telling them so reads as a
rejection for their own decision.

### 2.4 The message describes the move a person made

Build an automation that moves Shortlisted → AI Screening Call, with both
templates active. Move an application to Shortlisted.

**Expect:** a `shortlisted` row, not only an `ai_screening_call_scheduled` one.
The message fires **before** the automation dispatch precisely so the candidate
hears about the stage a person moved them to.

### 2.5 The same event never sends twice

Move the application to Rejected, back to Shortlisted, then to Rejected again.

```sql
select event_key, count(*) from message_log
where application_id = '<your-application-id>' group by 1;
```

**Expect:** `rejected = 1`. "You were rejected" is said once, ever.

Then check the guard is not too strong: a **skipped** attempt does **not** consume
the one chance. With email still disconnected you have a skipped `rejected` row —
connect email later (Phase 7) and the same event can still send.

### 2.6 Application created

Activate **Application received**, then create a new application
(`/applications/new`).

**Expect:** an `application_received` row. Do the same through **bulk resume
intake** — a candidate from a thirty-file upload is still a person who applied,
so whether they hear back must not depend on which screen you used.

---

## Phase 3 — Switching a template off

**The spec's second test:** disabling stops future sends *without touching the
past.*

1. Note how many rows exist: `select count(*) from message_log;`
2. Switch **Shortlisted** **off**
3. Move a *different* application to Shortlisted

**Expect:** the count is **unchanged** — no new row.

4. Look at the old rows.

**Expect:** every previous `shortlisted` row is **exactly as it was**, with its
full wording intact.

5. Now the real test of the design — **delete** the template entirely, then look
   again:

```sql
select template_id, event_key, left(body_sent, 80) from message_log
where event_key = 'shortlisted';
```

**Expect:** `template_id` is now **NULL**, and `body_sent` is **still the complete
message**. That is why the log stores resolved text rather than a pointer: a log
that referenced a template would start lying the moment somebody edited it.

---

## Phase 4 — The communication log

### 4.1 On the Application page

Open the application → the **Communications** card, below the AI summary.

- [ ] Newest first
- [ ] Channel icon (envelope / speech bubble)
- [ ] Subject, or the **first line of the body** where there is no subject
      (WhatsApp has no subject — this is what a phone shows in its notification)
- [ ] Status chip: `Sent` info · `Delivered` success · `Opened` success **with an
      eye icon** · `Not sent` neutral · `Failed` / `Bounced` error
- [ ] **"Automatic"** where `sent_by IS NULL`, your name where you sent it
- [ ] Timestamp in the organization's timezone
- [ ] Click a row → expands to **"Exactly as sent"** with the full text

`Not sent` is **neutral, not red**. It means opted out / no address / channel not
connected — a correct decision, not a malfunction. Rendering those in error red
teaches a team to ignore the colour, and then they ignore the real ones. The
reason shows **inline**, not on hover — a hover tooltip is invisible on a phone
and to a keyboard user.

### 4.2 On the Candidate page — the aggregation test

Give one candidate **two applications on two different jobs**. Trigger a send on
each.

Open `/candidates/<id>` → **Communications**.

**Expect:** both messages in one list, each row naming **which job** it was about.
The Application page shows only its own.

This works because `message_log.candidate_id` is stored separately rather than
joined through the application — so archiving or deleting an application cannot
take the record of what you told that person with it. Prove it: archive one
application and confirm its message is **still** on the candidate page.

### 4.3 It is read-only for everyone

There is no edit control, for any role including Owner. That is not just a hidden
button — there is **no UPDATE and no DELETE policy** on `message_log`. Since the
browser holds an authenticated PostgREST client, prove it directly from the
browser console while signed in as an Owner:

```js
const { error } = await window.supabase
  .from('message_log')
  .update({ body_sent: 'tampered' })
  .eq('id', '<a row id>');
console.log(error);   // expect the update to affect nothing
```

**Expect:** zero rows changed. A rule that lives only in a route handler is not
enforced.

### 4.4 A failed read never reads as "nothing was sent"

Hard to stage deliberately, but worth knowing what you would see: if the query
fails you get *"Couldn't load the communication log. This is not the same as
nothing having been sent — reload before assuming this candidate hasn't been
contacted."*

A recruiter about to tell somebody they were rejected needs that distinction.

---

## Phase 5 — Manual send

**Route:** Application detail → **Send message** (beside "Edit application")

### 5.1 From a template, with a real preview

- [ ] **Send message** → the composer opens
- [ ] Channel `Email`
- [ ] Template dropdown lists templates that can go on **this** channel, and
      marks inactive ones *"(off — still fine to send by hand)"* — you may use the
      wording of a template that does not auto-send
- [ ] Pick one → subject and body pre-fill **with the tokens still in them**, so
      you edit the template's own language
- [ ] The **Preview** below shows the message with **this candidate's real
      details** substituted

The preview uses the same `renderMessage()` the send uses, against values loaded
by the same query. A preview built from a second renderer can lie, and it would
be believed.

### 5.2 A one-off message

Choose **"Write a one-off message"**, type your own subject and body, include
`{{candidate.name}}`.

**Expect:** the preview resolves it. After sending:

```sql
select template_id, event_key, sent_by from message_log order by created_at desc limit 1;
```

**Expect:** `template_id IS NULL`, `event_key IS NULL`, and `sent_by = your user
id`. Compare with Phase 2.1 where `sent_by` was NULL — that is the difference
between "Automatic" and your name in the log.

### 5.3 Missing address is refused before anything is written

Blank the candidate's email, then try to send an email.

**Expect:** *"This candidate has no email address on file."* and **no log row** —
this one is refused up front rather than recorded as an attempt.

### 5.4 Permissions — the "(assigned)" clause

| Role | Manual send |
| --- | --- |
| Owner / Admin | Any application |
| Recruiter | **Only applications assigned to them** |
| Viewer | Button not rendered; API refuses |

The assignment rule cannot live in RLS — the INSERT policy allows any Recruiter in
the org, which is the right floor for a policy but not the right rule for a route.
So test the route directly. As a Recruiter, on an application assigned to
**somebody else**:

```bash
curl -i -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"application_id":"<not-yours>","channel":"email","subject":"s","body":"b"}'
# Expect 403: "You can only message candidates on applications assigned to you."
```

As a **Viewer**, expect 403 from `requireRole` before any of that.

---

## Phase 6 — Opt-out

**The spec's third test:** an opted-out candidate stops receiving automatic email
but can still be messaged by hand, **with a warning first**.

### 6.1 Record an opt-out

`/candidates/<id>` → **Communications** → **Record email opt-out**.

**Expect:**

- [ ] Chip **"Email opted out"** on the card
- [ ] The **same chip beside the candidate's name** at the top of the page —
      somebody who opened this page for a phone number never scrolls to the card
- [ ] A line stating when it was recorded

```sql
select email_opted_out, whatsapp_opted_out, opted_out_at, opted_out_reason
from candidate_communication_preferences where candidate_id = '<id>';
```

**Expect:** `email_opted_out = true`, `whatsapp_opted_out = false` — it is **per
channel**; opting out of email is not opting out of WhatsApp. `opted_out_at` is
stamped **by the database**, not by the browser: it is the evidence a candidate
asked you to stop.

### 6.2 Automatic sends stop

Move that application to a stage with an active template.

```sql
select status, error_message from message_log order by created_at desc limit 1;
```

**Expect:** `status = 'skipped'`, `error_message = "Not sent — this candidate has
opted out of email."`

The attempt is **recorded, not silent**. "We never told them" is a fact the
pipeline needs; a missing row would read as "nobody thought to".

### 6.3 A human is warned, never blocked

**Send message** → Email → write something → **Send**.

**Expect:**

- [ ] A warning panel: **"<Name> has opted out of this channel"**, with the reason
      and the advice to send only if they contacted you and are expecting a reply
- [ ] Two buttons: **Send anyway** and **Don't send**
- [ ] **Don't send** → dismisses, sends nothing
- [ ] **Send anyway** → it goes

This is two round trips on purpose. The first `POST /api/messages` returns **409
`code: "opted_out"`**; only the second carries `acknowledge_opt_out: true`. That
flag is what makes the warning unskippable rather than decorative — a one-click
send with a warning printed somewhere on the page is not a warning.

Confirm the override is recorded, because "a human deliberately messaged somebody
who had opted out" is exactly what a reviewer would come looking for:

```sql
select event_type, metadata from activity_events
where event_type = 'message.sent' order by created_at desc limit 1;
-- expect metadata->>'overrode_opt_out' = 'true'
```

### 6.4 An automation can never override it

There is no path for this — `overrideOptOut` is only honoured when `sentBy` is a
real user. Confirm by reading the condition in `lib/communications/send.ts` (the
`!automatic &&` in the opt-out gate), and by re-running 6.2 with an automation
instead of a stage move: still `skipped`.

### 6.5 Lifting an opt-out is the guarded direction

Click **Allow email again**.

**Expect** a confirmation: *"Only do this if they have told you they want to hear
from us again. They asked us to stop, and resuming without being asked is the
thing an opt-out exists to prevent."*

Recording an opt-out is writing down what you were told; lifting one is resuming
contact with somebody who asked you to stop.

### 6.6 The unsubscribe link

**Requires `INTEGRATION_ENCRYPTION_KEY` set.**

Trigger an automatic email send and read the footer:

```sql
select right(body_sent, 200) from message_log
where sent_by is null order by created_at desc limit 1;
```

**Expect:** the body ends with a separator and *"If you'd rather not receive these
updates, you can unsubscribe here: http://localhost:3000/unsubscribe?token=…"*

The footer is appended **after** the template renders, so no template can edit it
away — the same structural approach Module 8 uses for the call-recording
disclosure.

Now the link itself:

- [ ] Open it **signed out** (or in a private window) → the page loads. A candidate
      has no login, so this is in the proxy's public allowlist.
- [ ] **Nothing has happened yet.** The page says so, and shows a button. This
      matters: mail clients and corporate link scanners fetch every URL in an
      email, so a GET that did the work would silently unsubscribe people who never
      clicked.
- [ ] Press **"Yes, unsubscribe me"** → confirmation page, and
      `email_opted_out = true` in the table
- [ ] Press it **again** (reload and resubmit) → *"You were already
      unsubscribed"*, not an error
- [ ] **Tamper with the token** — change one character of the candidate id portion
      → *"This link isn't valid"*. The signature is an HMAC over
      *(candidate id, channel)*, so one link cannot be pointed at anybody else.
- [ ] Confirm it can **only ever opt out**: there is no parameter that
      re-subscribes. A URL somebody could be tricked into opening must not be able
      to restore contact.

Then check the failure mode: **unset `INTEGRATION_ENCRYPTION_KEY`**, restart, and
trigger a send.

**Expect** the footer to read *"reply to this email and we'll remove you"* with
**no link at all**. A dead unsubscribe link is worse than an instruction to a
human — the candidate believes they opted out and nothing happened.

### 6.7 Recruiters see the state before composing

With an opt-out recorded, open **Send message**.

**Expect:** the chip **"Opted out of email"** right under the channel selector,
*before* you type anything.

---

## Phase 7 — Channels

### 7.1 Email — real delivery

`/settings/integrations` → **Email** → **Connect**. A
[Resend](https://resend.com) API key and a verified From address.

- [ ] Status chip becomes **Connected**
- [ ] **Test connection** → "Connection is working." (It checks the account
      endpoint — it does **not** send a test email. A "test" that emails a real
      person is not a test.)
- [ ] Now repeat **any** send from Phase 2 or 5

**Expect:** `status = 'sent'`, a non-null `provider_message_id`, `sent_at` set —
**and the email in your inbox**, with the placeholders resolved and the
unsubscribe footer at the bottom.

```sql
select status, provider_message_id, recipient_hint, sent_at
from message_log order by created_at desc limit 1;
```

**`recipient_hint` is masked** (`ra••••••••••@example.com`) — the log keeps enough
to recognise an address, not enough to be a mailing list.

### 7.2 WhatsApp — the card and the honest caveats

`/settings/integrations` → **WhatsApp Business**.

- [ ] The card is there, with the same Connected / Needs Attention /
      Disconnected / Error treatment as the other five
- [ ] **Connect** shows five fields: access token, phone number ID, display
      number, approved template name, template language
- [ ] The copy explains the **24-hour window** *before* you connect: Meta only
      delivers free-form text to somebody who messaged your business in the last
      24 hours, so for a recruitment pipeline you need an approved Meta template
      name. Without one you will get Meta's refusal, and the adapter surfaces the
      actual remedy rather than "could not send".
- [ ] It also says opt-out is **"reply STOP"** and that **there is no inbound
      webhook yet** — a reply is read by a person, who records it on the candidate
      page.

Without real Meta credentials you can still verify:

- [ ] **Test connection** on a disconnected integration → "WhatsApp isn't
      connected yet."
- [ ] A WhatsApp send with WhatsApp disconnected → `status = 'skipped'`,
      *"WhatsApp isn't connected, so nothing was sent on that channel."*
- [ ] A candidate whose phone number has **no country code** → *"That phone
      number has no country code, so WhatsApp couldn't be sure who it belongs to."*
      This refuses rather than guesses: an Indian ten-digit number sent without a
      code is either rejected by Meta or delivered to whoever holds that number in
      the United States.
- [ ] Set the organization's **country** to India and retry → the number is
      normalised to `91…` and the send proceeds to the provider call

### 7.3 The spec's fourth test — WhatsApp never blocks email

**Leave WhatsApp disconnected for all of this.** Email connected.

1. Set a template's channel to **Email + WhatsApp**, activate it
2. Trigger its event

```sql
select channel, status, error_message from message_log
where event_key = '<that event>' order by created_at;
```

**Expect two rows, independent:**

| channel | status | meaning |
| --- | --- | --- |
| `email` | `sent` | delivered normally |
| `whatsapp` | `skipped` | "WhatsApp isn't connected…" |

**And the email arrives.** A WhatsApp failure cannot cost the email.

Also confirm the activation gate agrees — a rule using **Send templated message**
with a `both` template **activates** with WhatsApp disconnected. Requiring both
channels would stop an org that has never configured WhatsApp from using a rule
whose email half works perfectly.

---

## Phase 8 — Module 13: "Send templated message"

**The spec's last test:** the action is usable inside a *custom* automation, not
only through the fixed event list.

### 8.1 Build one

`/automations/new` → name it → **When** *An application enters a stage* → **If**
*Pipeline stage is Rejected* → **Then**:

- [ ] **Add action** → the dropdown contains **"Send templated message"**
- [ ] Choosing it shows a **template picker** listing your library with each
      template's channel, and marking inactive ones "(off)"
- [ ] Under it: *"Sends your own … wording. Opt-outs are respected, the
      unsubscribe line is added automatically, and every send is recorded in the
      candidate's communication log."*
- [ ] Pick a **switched-off** template → warning: *"…is switched off, so this
      action will skip until somebody activates it."* A rule pointing at an
      inactive template skips every time; better to know now than from the run
      history.
- [ ] Pick an **active** one whose event also fires by itself → *"Note that … is
      also active for …, so it already sends … A candidate is only ever sent it
      once per application."*

### 8.2 Combined with other actions

Add **Add a note** and **Move to a stage** to the same rule.

**Expect:** it saves. This is the point of the action — an org combining
message-sending with other work, rather than being limited to the fixed event
list.

### 8.3 Approval defaults on, and can be switched off

**Expect:** *"A person must approve the actions before they run"* is **checked**
automatically, and — unlike a rule with the built-in **Email the candidate a stage
update** — you **can** uncheck it.

The difference is where the human review happened. The built-in email sends
wording from this codebase that nobody in your organization ever read, so a person
approves each run. A templated message sends wording an Owner or Admin **wrote and
deliberately activated**. Forcing per-run approval would also make an automation
strictly *worse* than the built-in trigger, which sends the very same template
with no approval step.

### 8.4 The approval names the template

Leave approval on, activate the rule, trigger it. Go to `/automations/approvals`.

**Expect** the proposed action to read **"Send templated message — 'Your template
name' (read the wording)"**, linking to the library.

"Send templated message" alone asks somebody to approve wording they cannot see,
which is a rubber stamp with extra steps.

Approve it → check `message_log` for the row, with `sent_by IS NULL`.

### 8.5 Cross-tenant template ids are refused

The one that matters. Get a template id from **another** organization (or invent a
UUID) and try to save a rule with it:

```bash
curl -i -X POST http://localhost:3000/api/automations \
  -H 'Content-Type: application/json' \
  -d '{"name":"leak","trigger":"application_created",
       "actions":[{"type":"send_templated_message",
                   "config":{"template_id":"00000000-0000-0000-0000-000000000000"}}]}'
# Expect 422: "That message template doesn't exist."
```

A rule's config is client-authored data, and `validateRule()` can only check its
*shape*. The API verifies ownership and **overwrites** `event_key` and `channels`
from the row it verified — a rule carrying another tenant's id would otherwise
make the engine read and send that organization's wording.

Confirm the overwrite, by posting deliberately wrong derived values:

```sql
select actions from automations order by created_at desc limit 1;
-- event_key and channels match the TEMPLATE, not whatever you sent
```

### 8.6 The AI drafter declines this one on purpose

`/automations/new` → the AI draft box → *"email the candidate our rejection
template when they're rejected"*.

**Expect:** it does **not** invent a template id. It either drafts the rest of the
rule or reports the request as unsupported, explaining that you should add the
action and pick the template yourself.

The model cannot know which templates exist, so anything it produced would be a
fabricated UUID — and `validateRule()` would reject the **whole draft** over it,
losing every other part of a rule that was fine.

---

## Phase 9 — The interview reminder

**Route:** `/settings/recruitment`

### 9.1 The config

**Expect:** **Interview reminder** (hours, 0 = off) and **Reminder channels**
(email / WhatsApp checkboxes). Default **24 hours, email only**.

Email-only by default because WhatsApp is the least likely to be configured — a
default that assumed it would make every reminder record a "not sent" row.

- [ ] With no active `interview_reminder` template: *"No interview reminder
      template is switched on, so no reminder will be sent whatever you set here."*
- [ ] Always visible: *"Reminders go out when somebody dispatches them from the
      notifications page — this product has no background scheduler yet."*

That last line is a real limitation, stated rather than papered over. **There is
still no scheduler.** This module extends the one existing dispatcher rather than
building a second reminder system — Module 11 never actually built a timing config
to reuse (its feedback queue hard-codes `FEEDBACK_DUE_HOURS`).

- [ ] **Explicit Save** with an "Unsaved changes" indicator — no auto-save
- [ ] Set hours to `9999` via `curl` → clamped to **168** (a week). The form is
      not the boundary; `normalizeCommunicationSettings` is.

### 9.2 Dispatch

1. Activate the **Interview reminder** template
2. Schedule an interview **~2 hours from now**
3. Set the reminder window to **24** hours
4. `/notifications` → **Send overdue reminders**

**Expect:** a row with `event_key = 'interview_reminder'`, containing the
interview time and location/joining details.

### 9.3 It does not nag

Press the button **again**.

**Expect:** no second row. **"Nothing new — N already reminded…"**

### 9.4 …but a rescheduled interview earns a new one

This is the one event that is **not** once-per-application-forever. Reschedule the
interview and dispatch again.

**Expect:** a second reminder. A rejection is said once; a reminder is about a
specific time, and the time changed.

### 9.5 Switched off says so

Set reminder hours to **0**, save, dispatch.

**Expect:** *"Candidate interview reminders: Interview reminders are switched off
in Settings → Recruitment."* — not "Nothing is overdue", which would send you
looking for a bug that is not there.

Then uncheck **both** channels and dispatch: *"No reminder channel is selected…"*

Then set the channel to **WhatsApp** while the template is **email-only**:
*"'…' doesn't cover the channel you chose for reminders."* The template says which
channels it has wording for; the setting says which you want. Only the
intersection can send.

### 9.6 Interview reminders are candidate-facing

Unlike the other three reminders in that dispatcher (feedback, client feedback,
onboarding documents — all internal), this one goes to a **candidate**. Confirm it
lands in `message_log` and **not** in `notifications`, and that it carries the
unsubscribe footer and respects the opt-out. Routing it through `notify()` would
have bypassed all three.

---

## Phase 10 — Tenant isolation

Two organizations, A and B. Signed in to A throughout.

```sql
-- Run as org A's user via PostgREST / the browser console.
select count(*) from message_templates;                  -- only A's 12
select count(*) from message_log;                         -- only A's
select count(*) from candidate_communication_preferences; -- only A's
```

Then guess ids:

```bash
# Every one should 404 — indistinguishable from a genuinely missing row.
curl -i -X PATCH http://localhost:3000/api/settings/message-templates/<B's-template-id> \
  -H 'Content-Type: application/json' -d '{"active":true}'

curl -i -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"application_id":"<B-application>","channel":"email","subject":"s","body":"b"}'

curl -i -X PUT http://localhost:3000/api/candidates/<B-candidate>/communication-preferences \
  -H 'Content-Type: application/json' \
  -d '{"email_opted_out":true,"whatsapp_opted_out":false}'
```

The database backs each of these up independently: triggers on `message_log` and
`candidate_communication_preferences` refuse a candidate, application, or template
belonging to another organization, and refuse an application whose candidate does
not match — so a message can never appear on one candidate's page having been
addressed to somebody else.

---

## Phase 11 — The audit trail

```sql
select event_type, actor_label, metadata, created_at from activity_events
where event_type in ('message.sent', 'message_template.created',
                     'message_template.updated', 'message_template.deleted',
                     'candidate.communication_preference_changed')
order by created_at desc limit 20;
```

**Expect:**

- Every send, with `channel` and `status` — and **never the message body**. The
  full text lives in `message_log`, which has its own append-only policy; copying
  candidate-facing prose into a table whose purpose is broad readability would be
  the wrong trade.
- Activation logged **distinctly** from an edit: *"Activated 'X' — it now sends
  automatically"* vs *"Edited 'X' (name, body)"*. Switching a template on is the
  moment it starts messaging candidates unattended; that is a different kind of
  change from fixing a typo.
- A **failed** send described as such — *"'X' was not sent by email: …"* — because
  that is how a team finds out the candidate never heard.
- Opt-outs distinguishing **who chose it**: *"The candidate opted out of email"*
  (unsubscribe link, `actor_id` NULL) vs *"Recorded an opt-out from email"* (a
  recruiter). The same fact, different provenance.

---

## What this guide cannot test, and why

| Not covered | Why |
| --- | --- |
| `delivered` / `opened` / `bounced` | No provider webhooks yet. The columns and the `provider_message_id` index exist for it; nothing consumes provider events, so a real send rests at `sent`. |
| A candidate replying, or sending STOP | No inbound channel. The WhatsApp opt-out instruction is honoured by a person reading the reply. |
| Reminders firing at a fixed hour | No scheduler. They go out when somebody presses the button. |
| Per-job template overrides | `event_key` is organization-wide. One active template per event is the honest starting point. |
| AI tone assistance on these templates | The fixed-fact guard works on the internal template set; extending it needs each template to declare which placeholders are facts. |

All five are recorded as follow-ups in `docs/modules/15-notifications-notes.md`.

---

## Phase 8 — The inbound webhook and the inbox (0041)

Everything above tests a one-way pipe. This phase tests the half that receives.
Unlike phases 1–6, **most of this needs a real Meta app** — the whole point is
that a message arrives from outside.

### 8.1 Apply the migration and prove its guarantees

```bash
./supabase/tests/replay.sh    # replays all 41 and runs supabase/VERIFY_*.sql
```

`VERIFY_0041.sql` proves the five things no unit test can reach: one thread per
number per tenant, inbound message ids deduped (while outbound `'unknown'` ids
stay allowed), an unmatched message storable but a homeless one not, the unread
counter and `last_message_at` behaving under out-of-order redelivery, and a
thread unable to cross a tenant boundary in either direction. Run it against
your real project too — paste the file into the SQL Editor; it rolls back.

### 8.2 The endpoint refuses what it should, with no Meta account

```bash
# Wrong verify token → 403. A 503 means WHATSAPP_VERIFY_TOKEN never reached the
# deployment, which is a different bug with the same symptom (no inbox).
curl -i "https://<domain>/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x"

# Unsigned POST → 401. THE important one: anything else means forged candidate
# messages are being accepted.
curl -i -X POST https://<domain>/api/webhooks/whatsapp \
  -H 'content-type: application/json' \
  -d '{"entry":[{"changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"<your id>"},"messages":[{"from":"919876543210","id":"wamid.TEST","type":"text","timestamp":"1758369600","text":{"body":"hi"}}]}}]}]}'
```

**Verify nothing was written:**

```sql
select count(*) from public.message_log where provider_message_id = 'wamid.TEST';
-- Expect 0. A row here means the signature check is not doing its job.
```

### 8.3 A real inbound message

Register the callback first — `docs/DEPLOYMENT.md` §6.2, including the
**subscribe to the `messages` field** step, which is the usual thing people
miss (the URL verifies, and nothing is ever delivered).

Text the business number from a phone whose number is on a candidate record.

| Expect | Where |
| --- | --- |
| The thread appears in **/messages** within ~15s | The inbox polls; it does not hold a socket open |
| The candidate's name on the row, not "Unknown number" | Matched via `candidates.phone_normalized` — the last 10 digits |
| A red badge on the **Messages** nav item | Counts threads, not messages |
| `direction = 'inbound'`, `status = 'received'` | `select direction, status, body_sent from public.message_log order by created_at desc limit 1;` |

Now text from a number **not** on any candidate record: the row appears as
*Unknown number* with a grey tint and a candidate picker. Confirm **no candidate
was created** — `select count(*) from public.candidates;` is unchanged.

Link it, and the thread moves onto that candidate's record.

### 8.4 Redelivery does not duplicate

Meta redelivers until it gets a 2xx, so this happens by itself under load. To
force it, replay the exact same signed body twice (or temporarily make the
handler return 500 after the insert). The second delivery must leave
`select count(*) from public.message_log where provider_message_id = '<wamid>'`
at **1**.

### 8.5 STOP sets the opt-out by itself

Reply **STOP** from the candidate's phone.

```sql
select whatsapp_opted_out, opted_out_reason
from public.candidate_communication_preferences where candidate_id = '<id>';
-- Expect true, 'Replied STOP on WhatsApp.'
```

The thread's composer is now disabled with a banner, and an automatic send on
that channel records `skipped`. Then check the near-miss: send **"Please stop by
the office at 3"** from another candidate and confirm they are **not** opted out
— matching a substring here would silently switch off a real conversation.

For an UNMATCHED number, the STOP cannot be recorded (there is no candidate to
record it against). Link the thread afterwards and confirm the opt-out is
applied at that moment — that deferred application is in the PATCH route.

### 8.6 Delivery and read receipts, finally

Send a templated message to the candidate. Watch the outbound bubble's tick in
the thread: **Sent** → **Delivered** → **Read** (blue) as Meta reports each.

```sql
select status from public.message_log where provider_message_id = '<wamid>';
-- 'sent' → 'delivered' → 'opened'
```

This is the behaviour migration 0035 recorded as impossible ("`opened` — email
only; WhatsApp gives us no read signal we trust"). It was only impossible
because nothing was listening.

### 8.7 The reply uses the same pipeline as everything else

Reply from the inbox and confirm the row it writes is indistinguishable from a
manual send made anywhere else:

```sql
select direction, status, sent_by, conversation_id, recipient_hint, error_message
from public.message_log order by created_at desc limit 1;
```

`sent_by` is your user id (not null — so no unsubscribe footer is appended),
`recipient_hint` is masked to the last four digits, and `conversation_id` points
at the thread. Then check the window: reply to a thread whose last inbound
message is **more than 24 hours** old with no Meta template configured. The
composer is disabled with the re-engagement remedy — the same wording
`sendWhatsApp()` produces on Meta's 131047, so hitting the wall in two places
does not look like two different problems.

### 8.8 Roles

| Role | Expect |
| --- | --- |
| **Viewer** | Reads threads. No composer, and opening a thread does **not** clear its unread count (it is shared across the org — a Viewer browsing must not tell three recruiters a candidate was handled) |
| **Recruiter** | Sees only threads for candidates on applications assigned to them, plus every unmatched thread. A direct link to another recruiter's thread renders "Conversation not available", and `curl` on it returns **404** |
| **Owner/Admin** | Everything |

Check the Recruiter case with `curl` as well as in the UI — a hidden row is
cosmetic, and `/api/messages/conversations/<id>` is the boundary that matters.

---

## Phase 9 — The auto-reply agent (0042)

The agent is **off by default** and stays off until somebody switches it on, so
none of this fires by accident. Everything here needs WhatsApp connected, a Meta
app secret (phase 8), and `OPENAI_API_KEY` set — without the last one the agent
skips every message and leaves it in the inbox, which is a real state worth
seeing once.

### 9.1 Prove the schema first

```bash
./supabase/tests/replay.sh    # 42 migrations + every supabase/VERIFY_*.sql
```

`VERIFY_0042.sql` proves the seven things no unit test can reach: the master
switch defaults **off**, only one organization-wide config can exist (two NULL
`job_id`s do not collide in SQL), timing and delay cannot disagree and cannot
exceed Meta's 24-hour window, one inbound message can be queued only once,
neither a config nor a queue row can cross a tenant, `auto_replied` defaults
false on every row, and `bump_whatsapp_conversation` still has exactly one
signature.

### 9.2 The master switch really is a master switch

Settings → **Message auto-reply agent**: switch the agent on, set the
organization default to enabled + Immediate, and save. Then in **Messages**,
switch **Auto-reply** to **Off**.

Text the business number. **Nothing is answered.** The message just arrives.

```sql
-- No queue row at all: the switch is checked before anything is written.
select count(*) from public.auto_reply_queue where status = 'pending';
```

Switch it back on, text again, and the reply arrives within a few seconds.

Then the harder half — switch it **off while a delayed reply is waiting**:
set the default to Delayed / 5 minutes, text in, confirm a `pending` row exists,
switch the master off, and wait for the sweep. The row resolves to `skipped`
with "Auto-reply was switched off before this reply went out", and **the
candidate gets nothing**. A queue that trusted its own past would have sent it.

### 9.3 A context-accurate reply, not a template

Pick a candidate with a real application — a stage, a match score, and ideally a
scheduled interview. From their phone, ask **"what's the status of my
application?"**

The reply should name their actual stage and, if asked, their actual interview
time. Then check it was grounded rather than lucky:

```sql
select body_sent, auto_replied, status
from public.message_log
where auto_replied order by created_at desc limit 1;
```

**Every number in that reply must exist in the candidate's data.** If the model
invents one — a rounded match score, a date nobody booked — `findUnsupportedNumbers()`
rejects the whole draft and the candidate gets the holding message instead. To
see that path deliberately, temporarily point `AI_MODEL` at a weaker model and
ask something numeric.

### 9.4 The fallback, which is the feature

Ask, from the candidate's phone: **"what's the salary for this role?"**

| Expect | Where |
| --- | --- |
| A holding reply: "Thanks for your message — a member of our team will get back to you shortly." | The candidate's phone |
| The thread flagged **Needs human reply**, amber, sorted to the top of the inbox | /messages |
| The reason, in the thread banner: "Mentions pay or negotiation…" | The thread header |
| **No model call was made at all** | The escalation guard runs *before* the model |

```sql
select needs_human, needs_human_reason from public.whatsapp_conversations
where id = '<id>';
```

Repeat with "why was I rejected?", "will you sponsor my visa?", "please delete
my data" and "I'm struggling, please help me" — all five must escalate.

Then the near-miss that matters just as much: ask **"when is my interview?"**,
**"did I get shortlisted?"** and **"what should I prepare?"**. All three must be
*answered*, not escalated. A guard that escalates ordinary status questions
leaves a permanently flagged inbox, and the feature gets switched off.

### 9.5 The 30-minute human cooldown

Reply to the candidate **by hand** from the inbox. Then have them send another
message.

**The agent must stay silent.** Check why:

```sql
select status, detail from public.auto_reply_queue order by created_at desc limit 1;
-- 'skipped' — "A colleague replied within the last 30 minutes…"
```

The cooldown reads the same row the reply wrote (`sent_by not null and
auto_replied = false`), so there is no separate bookkeeping to drift. Replying by
hand also clears the **Needs human reply** flag — and only a successful send
clears it, because a refused reply means the candidate still has not heard from
a person.

To confirm the window really expires rather than latching, backdate the human
reply and let the next sweep run:

```sql
update public.message_log set created_at = now() - interval '31 minutes'
where id = '<the human reply>';
```

### 9.6 Per-job override beats the org default

Settings → Message auto-reply agent → **Add job override** for one job. Set it
to **Off** and save, leaving the organization default **On**.

Text in as a candidate on *that* job: **no reply**. Text in as a candidate on
any other job: answered.

```sql
select detail from public.auto_reply_queue order by created_at desc limit 1;
-- nothing queued at all — resolveAutoReply() refused before the insert
```

This is the rule most likely to be built the other way round: a disabled
override **stops** the agent rather than falling through to an enabled default.
Removing the override is the only way back to the default — check the
precedence table under "What actually applies" agrees before and after, since it
is computed by the same function the agent runs.

### 9.7 Every auto-reply is visibly labelled

In the thread, an agent message reads **"Auto-reply"** with a bot icon in
primary tint — never a person's name, never the bare "Automatic" a templated
send shows. In the list, its row carries a small bot icon. In **Recent
auto-replies** (the inbox's third tab), an Owner/Admin can scan everything the
agent has said.

The label comes from `message_log.auto_replied`, not from anything inferred at
render time, so there is no path that presents an agent message as a human one.

### 9.8 Roles

| Role | Expect |
| --- | --- |
| **Viewer** | Sees the auto-reply state in the inbox as text, no switch. `PATCH /api/settings/auto-reply` → **403**. `/settings/auto-reply` shows the restricted panel |
| **Recruiter** | Same — state visible, switch absent, API 403. Can still reply by hand, which is what suppresses the agent |
| **Owner/Admin** | Configures everything |

Check the API with `curl` as well as the UI: a hidden switch is cosmetic, and
`PATCH /api/settings/auto-reply` is the boundary that matters.

---

## Automated coverage

```bash
npm test        # 1114 tests, 50 files
npm run lint
npm run typecheck
npm run build
```

`lib/autoReply/autoReply.test.ts` (34 tests) covers phase 9's pure half:
precedence including the master switch and the disabled-override rule, the
escalation guard in BOTH directions (what must escalate and what must not), the
numeric grounding set that stops the agent inventing a score or a date, and the
inbox ordering that lifts flagged threads above newer self-answered ones.

`lib/messaging/messaging.test.ts` (41 tests) covers phase 8's pure half: STOP
detection including the "please stop by the office" near-miss, the 24-hour
window and the reply-capability rules, Meta payload parsing against real
payload shapes (plus every shape of junk, without throwing), and signature
verification — accepted, tampered, wrong-secret, missing, and the fails-closed
no-secret case.

`lib/communications/communications.test.ts` (51 tests) and
`optout.test.ts` (9) cover the decision logic behind phases 1-7:
timezone-correct rendering, the catalogue↔database agreement, channel resolution,
the `both`-requires-neither rule, number normalisation refusing to guess, the
approval distinction, settings clamping, and the unsubscribe token refusing
tampered ids and channels.

They deliberately do **not** mock a database. The bottom of that file lists what
needs a real Supabase project — which is what this guide is for.
