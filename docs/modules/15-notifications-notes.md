# Module 15 (Notifications & Communication) — implementation notes

## A dependency the spec claimed exists, and doesn't

Section 2 lists *"Module 1: users/roles + user_preferences (per-user
overrides)"* as a dependency. **Module 1 never built a `user_preferences`
table.** `notification_preferences` is created here instead.

It is modelled as **rows**, not a JSON blob on the user, and that choice carries
the spec's third functional test. With a blob, "I never chose this" and "I chose
the same thing the team did" are indistinguishable — so changing a team default
would either silently overwrite deliberate personal choices or never reach
anyone who had opened the settings page. As rows, an absent row means *inherit*,
and `resolvePreference()` walks template → organization → user.

Two partial unique indexes rather than one plain unique, because `NULL != NULL`
in Postgres: a single `unique(organization_id, user_id, notification_type)`
would happily allow twenty conflicting organization defaults for the same type.

## The strictest read policy in the product

Everywhere else, org membership is the read boundary. Not here: **a notification
is readable only by its recipient.**

A notification body quotes candidate names, interview times and screening
outcomes, and it is addressed to one person. "Rahul Sharma declined the
automated call" delivered to a Viewer with no business on that application is a
leak dressed up as a feature.

The UPDATE policy repeats `user_id = caller` in **WITH CHECK** as well as
`USING`. A `USING`-only policy would let someone reassign their notification to
a colleague, at which point the row is that colleague's to read — the rule
constrains what the row may *become*, so it belongs in `WITH CHECK`.

The preference policy has the same shape for a different reason: without the
`WITH CHECK` half, a Recruiter could take their own override row and null its
`user_id`, turning a personal setting into an organization-wide default.

## "External channel failure never blocks in-app" is an ordering guarantee

The spec's first functional test. In `notify()` the in-app row is inserted and
its id captured **before** any external attempt begins, and the email step lives
in its own block that can only ever write a `notification_deliveries` row. There
is no code path where a provider outage costs someone their notification.

`notify()` also never throws, like `logActivity()`. A caller wiring up a
reminder should not have to defend against the reminder system.

Deliveries are a **separate table** on purpose. Collapsing them into
`notifications` would mean a failed email either destroys the notification or
silently reports success. `skipped` is distinguished from `failed` throughout,
because the two mean different things to whoever reads them: *connect the
integration* versus *something broke, look at it*.

## The fixed-fact guard

The spec's second functional test: *"AI tone adjustments never alter the fixed
facts in a template (time, names, figures)."*

Every template **declares** which substituted values are facts. That declaration
is what makes the constraint checkable at all — without it, "don't change the
facts" has no referent and can only be a sentence in a prompt.

`findAlteredFacts()` then runs three passes:

1. **Every declared fact must survive verbatim.** Not fuzzy-matched. A name
   shortened from "Rahul Sharma" to "Rahul" is a judgement call the model does
   not get to make on an external message.
2. **No new figures**, via the shared `numericGuard`.
3. **No new clock times** — a separate pass, because "2:00pm" already permits
   the digits 2 and 0, so "arrive by 1:45pm" could slip past pass 2 if 45
   appeared elsewhere. Times are the single most damaging thing to get wrong.

A rewrite that fails is **rejected**, not shown with a warning, and the approved
wording is always returned alongside so a rejection degrades to "send the
original" rather than to a dead end. The failure being prevented is specific: a
candidate is told 3:00pm instead of 2:00pm and misses the interview. Nobody
reviewing a fluent, friendly message catches the digit.

The AI route **re-renders the message server-side** from the template and the
supplied facts. The client's own version of the text is never the baseline —
otherwise a caller could post arbitrary text with a matching `facts` object and
use the endpoint as a general-purpose rewriter in the product's voice.

## In-app cannot be muted for high-priority types

A deliberate deviation from "preferences always win", covering three types:
a cancelled interview, a candidate asking not to be called again, and a failed
automation.

Muting the callback request is the sharp case: Module 8's retry policy will
never dial that person again, so if nobody sees the notice the candidate is
simply dropped. **Email stays fully optional** — muting a channel is a
preference; muting the record is not.

Enforced in `applyMandatoryChannels()` at send time *and* refused by the
preferences API, so the settings screen never shows a switch that silently does
nothing.

## THE RETROFIT — every stub call-site

The spec requires these named explicitly.

### Module 13 (Automation Engine)

| File | Was | Now |
| --- | --- | --- |
| `lib/automations/engine.ts` — `notify_recruiter` action | Returned `skipped` with "delivered from Module 15 onward" | Notifies the application's **assigned recruiter**, falling back to the triggering user only when nobody is assigned |
| `lib/automations/engine.ts` — `finish()` | Nothing | Notifies **Owners/Admins** on `failed` **and `blocked`** runs |
| `lib/automations/catalog.ts` — `ACTION_INTEGRATIONS` | Comment saying `notify_recruiter` would need `"email"` | Deliberately still requires **nothing** |
| `app/automations/AutomationForm.tsx` | "recorded in the run log only until Module 15" | "notifies the assigned recruiter" |

Three judgement calls there:

- The recipient is the **assigned** recruiter, not the person whose action fired
  the rule. Telling someone their own action happened is not a notification.
- `notify_recruiter` still declares **no required integration**. It always
  creates an in-app notification, which needs nothing; email is an optional
  extra. Listing `"email"` would block a rule from activating over a channel it
  does not depend on.
- **Only failures**, never successes. Notifying on every run makes the centre
  useless within a day. `blocked` is included because a rule that cannot run
  looks identical to a working one in the automations list.

### Module 11 (Interviews)

| File | Was | Now |
| --- | --- | --- |
| `lib/interviews/feedback.ts` | Header explaining nothing was sent | Header records the retrofit; `overdueFeedback()` unchanged |
| `lib/notifications/reminders.ts` | — | `sendFeedbackReminders()` reads the same computation and sends |
| `app/interviews/page.tsx` | "sending them arrives with Notifications (Module 15)" | Links to the dispatcher |

The queue computation was **not rewritten** — it was already right and already
tested. Only delivery was missing. Reminders go to the assigned **interviewer**,
the only person who can clear one; an interview with no interviewer is skipped
rather than broadcast, since "somebody owes feedback" sent to everyone is how a
team learns to ignore notifications.

### Module 12 (Clients)

| File | Was | Now |
| --- | --- | --- |
| `app/api/applications/[id]/submission/route.ts` | `TODO(Module 15): actually deliver the message` | Confirms to the sender that the clock started |
| `lib/notifications/reminders.ts` | — | `sendClientFeedbackReminders()` chases the **account manager** |
| `app/applications/[id]/submission/SubmissionPanel.tsx` | "arrives with Module 15" | Points at Module 17 |

**Emailing the submission to the client is deliberately still not done.** Module
12 built two explicit steps precisely so a human approves wording that describes
a real person to a third party in our customer's name; auto-sending here would
undo that. It needs its own approved external template, a confirmation naming
the recipient, and a verified per-organization From address — a Module 17 job.

Client chases are **internal** for the same reason: an automated nag sent in an
account manager's name without their knowledge is the kind of thing that loses
an account.

### Modules 8/9 (Screening)

`app/api/webhooks/bolna/route.ts` now notifies the assigned recruiter on call
completion, using `useAdminClient` because a webhook has no session. A
**cancelled** call maps to `screening_callback_requested` — the spec's own
worked example, and the urgent one, since Module 8 will never dial that person
again.

### Module 5 / Module 1

- `app/api/applications/[id]/route.ts` — notifies a recruiter when work is
  assigned to them, and never when they assign it to themselves.
- `app/api/invites/route.ts` — comment untouched. Invite emails need an
  unauthenticated send path and a token in the body, which is a different and
  more sensitive flow than anything here. Left for Module 17.

## THERE IS NO SCHEDULER — the module's main limitation

`sendFeedbackReminders()` and `sendClientFeedbackReminders()` are correct and
deduped, but **nothing calls them on a timer**. This product has no cron, queue,
or background worker, and building one would be a larger piece of infrastructure
than the module it serves.

So dispatch is an explicit request: `POST /api/notifications/reminders`, behind
a button on `/notifications`. Reminders go out when somebody opens the app
rather than at 9am. That is a real limitation, recorded here rather than papered
over with a settings screen claiming a schedule that does not exist.

The dedupe makes it safe: every reminder is checked against the last 24 hours
before sending, and the dedupe read **fails towards silence** — if we cannot
tell whether someone was already nagged, nagging them again is the worse
mistake. A missed reminder is recoverable; a reputation for spam is not.

## Two spec endpoints deliberately not implemented

- **`POST /api/notifications`** — would let any signed-in user send arbitrary
  alerts to a colleague in the product's own voice. A phishing surface with no
  legitimate use; every real sender is server-side and calls `notify()`.
- **`POST /api/notifications/:id/ai-action`** — the tone assistant operates on a
  *draft*, before any notification exists, so it is `/api/notifications/ai-action`.

## Follow-ups

- ☐ **A scheduler.** The single biggest gap. Until then reminders are manual.
- ☐ **Candidate-facing sends have no UI.** `interview_reminder` and
  `interview_cancelled` are approved external templates, the tone assistant
  works on them, and `sendEmail()` will deliver them — but no page composes one
  yet. The plumbing is complete; the compose screen is not.
- ☐ **Email connection UI** is Module 17. `lib/integrations/email/` exposes
  `connect/test/getStatus/disconnect` and nothing calls `connect()` yet, so
  email is permanently `disconnected` today. Every surface says so.
- ☐ **Invite emails** (Module 1) still hand the Owner a link to share.
- ☐ **Bounce handling.** `provider_message_id` is stored and indexed for it;
  there is no webhook consuming provider events.
- ☐ **No digest or batching.** Ten stage changes produce ten notifications.
- ☐ **SMS/WhatsApp** is explicitly Build Later.
