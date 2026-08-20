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

---

# Module 15, part two — candidate communication

The first half of this module built an **internal** notification pipeline:
`notifications`, `notification_deliveries`, `notification_preferences`, the
fixed-fact guard, and one approved external template (`candidate_stage_update`)
that an automation may send. Its own follow-up list said the plumbing for
candidate-facing sends was complete and *"no page composes one yet"*, and that
SMS/WhatsApp was Build Later.

This part builds the composing, the library, the second channel, and the record.

## Why `lib/communications/` rather than more of `lib/notifications/`

They are different products sharing a verb.

`notify()` addresses **one colleague**, is governed by that person's own
preferences, and its read policy is the strictest in the codebase — *a
notification is readable only by its recipient*. A candidate message addresses
**a member of the public**, is governed by their opt-out, must carry a working
unsubscribe, and is **team knowledge**: a Viewer reading the pipeline needs to
know the candidate has already been told they were rejected.

Every one of those four properties is opposite. Folding the second into the first
would have meant a `notify()` whose preference lookup, audience, read policy and
legal obligations all branched on a channel flag. So: two pipelines, one
integration layer underneath, and `sendEmail()` shared rather than duplicated —
which is what the spec asked for ("don't build a second email sending path").

## The log stores what was said, not where it came from

`message_log.body_sent` holds the fully-resolved text, footer included,
byte-for-byte what the provider was handed. `template_id` sits beside it,
nullable, `on delete set null`.

That ordering is the whole design. A log that pointed at a template would start
lying the first time somebody edited that template — and *"what did we tell this
candidate?"* is the only question a communication log exists to answer. It also
makes deleting a template safe, which is why the delete route can be a real
delete rather than an archive.

## Three decisions the schema enforces rather than the UI

**One active template per event, by partial unique index.** Two active
templates for `hired` would send a candidate two messages, and *which* two would
depend on row order. The `both` channel exists so one template can cover email
and WhatsApp, so nothing legitimate is lost. The API turns the resulting 23505
into *"'X' is already the active template for this event"* — a sentence naming
the row somebody has to go and switch off.

**The log is append-only to every browser.** The permission is *"read-only for
everyone (it's a record, not an editable thing)"*, and the browser holds an
authenticated PostgREST client, so that cannot live in a route handler. There is
a SELECT policy, an INSERT policy, and deliberately **no UPDATE and no DELETE
policy at all**. Delivery callbacks (`delivered`, `opened`, `bounced`) arrive
without a session and would be written with the service-role client, which
bypasses RLS — so the honest claim is that nobody holding a session can rewrite
history.

**`opted_out_at` is stamped by a trigger, not accepted from a caller.** It is
the evidence that a candidate asked not to be contacted. It is also cleared when
both flags go back to false, so *"opted out on 4 March"* never outlives the
opt-out itself.

## `skipped` is a status the spec did not ask for

The spec lists queued / sent / delivered / opened / failed / bounced. There is a
seventh, for the same reason migration 0014 added `skipped` to
`notification_delivery_status`: **the candidate opted out, or has no address, or
the channel isn't connected**. None of those is a malfunction.

`failed` means *something broke, look at it*. Rendering a correct policy decision
in error red teaches a team to ignore the colour, and then they ignore the real
ones. The chip is neutral, the reason is shown inline (not on hover — invisible
on a phone and to a keyboard), and `error_message` says which of the three it was.

A skipped attempt also **does not consume the once-per-application guard**: a
disconnected integration must not permanently spend the one chance to send a
message.

## Where each event fires, and the two that cannot

Ten of the twelve events fire at the exact moment the spec asked for. Two do not,
and `firesWhen: null` in the catalogue says so on the settings screen rather than
showing a switch that does nothing:

- **`offer_extended`** — there is no offer stage. `lib/applications/stages.ts`
  runs Director Round straight to Hired, and Module 19 files the signed offer as
  an onboarding document *after* the hire. Picking a stage move to mean "an offer
  went out" would email an offer to somebody who has not been offered anything.
- **`unqualified`** — nothing in the schema distinguishes *rejected because they
  did not meet the requirements* from *rejected because somebody else was
  better*. `rejected` covers the move. Splitting it would need the product to
  decide, per rejection, which it was, and it does not know.

Both remain fully usable by hand and from an automation. What they lack is an
automatic trigger.

**The two interview events fire from the scheduling action, not from a stage
move**, and `EVENT_FOR_STAGE` has no entry for those stages. Their messages state
a *time*; a stage change does not have one. A stage-triggered "your interview is
scheduled" with no time in it would send the candidate looking for a message
nobody sent. The interview is also **re-read** after scheduling rather than built
from the request body, because the calendar step writes `meeting_url`
afterwards — building from the payload would send a video interview with no
joining link.

**`withdrawn` is deliberately unmapped.** The candidate ended it; telling them so
reads as a rejection for their own decision.

## The message fires BEFORE the automation dispatch

In both the stage-change route and application creation. A rule can move the
application on again (Shortlisted → AI Screening Call), and if the automation ran
first the candidate would be told about the stage they ended up in and never
about the one a person actually moved them to.

## The placeholder editor was extracted, not rebuilt

`components/PlaceholderEditor.tsx` is the editor `app/jobs/StageConfigModal.tsx`
already had — same picker and search, same caret-preserving `insertToken()`, same
chip list, same unknown-token warning, same "Preview with sample data", same CSS.
The stage modal now imports it.

The one parameter that matters is `fields`. A message may say
`{{interview.time}}` and `{{organization.name}}`; a screening script cannot
resolve either, because there is no interview when a call runs. Widening
`PLACEHOLDER_FIELDS` itself would have offered those tokens in the stage picker,
where they render as nothing — and the failure surfaces as a sentence read aloud
to a candidate with a hole in it. So `splitTokens`, `renderTemplate` and
`renderPreview` take an optional catalogue, and each caller passes the vocabulary
that is true where it renders. There is a test asserting the two lists stay
separate.

## `send_templated_message` recommends approval; it does not force it

`send_candidate_email` forces approval on every run, and still does. The new
action does not, and the difference is **where the human review happened**:

- `send_candidate_email` sends wording that lives in this codebase. Nobody in the
  organization ever read it, so a person reads each proposal.
- `send_templated_message` sends wording an Owner or Admin **wrote and
  deliberately activated** — the default library ships inactive precisely so that
  switch is a decision. The review happened once, over the words.

Forcing per-run approval would also make an automation strictly *worse* than the
built-in event triggers, which send the very same template with no approval step.
So approval defaults on and can be switched off by somebody who has read the
words. The approvals queue **names the template** in the proposal — "Send
templated message" alone asks a person to approve wording they cannot see, which
is a rubber stamp with extra steps.

Its required integrations are computed **from its config**, not from a fixed
table entry, because they depend on the template: email-only needs `email`,
WhatsApp-only needs `whatsapp`, and a `both` template requires **neither** —
whichever channel is connected sends, and requiring both would stop an
organization that has never configured WhatsApp from activating a rule whose
email half works perfectly.

The AI rule-drafter is **not shown this action**. It names a template by UUID and
the model cannot know which templates exist, so anything it proposed would be a
fabricated id — and `validateRule()` would reject the whole draft over it, losing
every other part of a rule that was fine. The prompt asks it to say plainly that
this part needs a person.

## The interview reminder extends the one dispatcher

The spec said to *"reuse Module 11's existing reminder timing config, add channel
choice to it rather than creating a second reminder system"*. **Module 11 never
built one** — its feedback queue is computed on read and hard-codes
`FEEDBACK_DUE_HOURS`. So the nearest honest reading was: one reminder system, one
config, one trigger point. The timing and channels live in
`organization_settings.communication_settings`, edited under Settings →
Recruitment beside the other interview defaults, and `sendInterviewReminders()`
sits in `lib/notifications/reminders.ts` alongside the three that were already
there.

It is the **one** caller that bounds the dedupe rather than checking forever. Every
other event sends once per application, ever — "you were rejected" is said one
time. A reminder is not like that: a rescheduled interview earns a new one, so the
guard is bounded by the reminder window itself.

**It still has no scheduler.** That limitation is unchanged and is the module's
original one. `/notifications` dispatches it, and the settings screen says so
rather than implying a fixed hour.

## The unsubscribe link, and the two ways it fails safely

A candidate is not a user of this product. They have no login, so
`/unsubscribe` is in the proxy's public allowlist and **the link itself is the
authorisation**: an HMAC over `(candidate id, channel)`, signed with
`INTEGRATION_ENCRYPTION_KEY`.

- A tampered candidate id does not verify, so one link cannot be pointed at
  anybody else.
- A tampered channel does not verify, so an email link cannot silence WhatsApp.
- **The link can only ever opt out.** There is no code path that sets a flag to
  false. A URL somebody could be tricked into opening must not be able to restore
  contact with a person who asked us to stop.

**With no signing key, no link is issued at all** and the footer says "reply and
we'll remove you" instead. A dead unsubscribe link is worse than an instruction
to a human: the candidate believes they have opted out, and nothing happened.

**The opt-out happens on a POST, never on the GET.** Mail clients and corporate
link scanners fetch every URL in an email. If the GET did the work, a scanner
would silently unsubscribe candidates who never clicked anything, and the team
would have no idea why their messages stopped.

The footer is appended **after** the body renders, so no template can edit it
away — the same structural approach Module 8 takes with the call-recording
disclosure. Manual messages get no footer: a recruiter replying to a candidate's
own question is a conversation, and it would be contradictory on a message that
deliberately overrides an opt-out.

## Opt-out binds automatic sends absolutely; humans are warned, never blocked

The spec: *"never silently block a human-initiated message, but do warn them
first."* So `POST /api/messages` returns **409 with `code: "opted_out"`** and the
reason on the first attempt; the UI shows the warning and the button changes; only
then does the request carry `acknowledge_opt_out: true`. The flag is what makes
the warning unskippable rather than decorative, and the activity log records that
a human deliberately overrode it.

A **failed** opt-out read is `unknown`, not "not opted out", and the two
directions differ deliberately: an automatic send treats unknown as opted out and
stays silent, because emailing somebody who asked us not to is a complaint and
possibly a fine while a delayed pipeline update is recoverable. A manual send
surfaces it to the human, who can decide.

## WhatsApp: the two provider facts that shaped the adapter

**The 24-hour window.** Meta only delivers free-form text to somebody who has
messaged the business in the last 24 hours. A recruitment pipeline almost never
is, so an organization names a **Meta-approved template** on the integration and
the resolved body is sent as its single body parameter. Without one, free-form is
attempted and Meta's own refusal (error 131047) is surfaced with the actual
remedy, because nobody would guess it from "could not send". The connect form says
this *before* connecting rather than leaving it to be discovered as a failed send.

**Opt-out is "reply STOP", and nobody is listening yet.** There is no inbound
WhatsApp webhook, so a reply is read by a human who records it on the candidate
page. That is stated in the integration copy rather than implied away.

`normalizeWhatsAppNumber()` **refuses** a local number when the country is
unknown rather than guessing. An Indian ten-digit number sent without a country
code is either rejected by Meta or delivered to whoever holds that number in the
United States. The organization's own country supplies the code when it has one;
`dialCodeFor()` covers only the countries this product is sold into and returns
null for anything else.

## The default template set

Twelve templates, one per event, seeded **inactive**, and the wording lives in
migration 0030 and **only** there. Mirroring twelve message bodies in TypeScript
would be two copies of the words this product says to candidates, and the drift
would show up as a candidate receiving wording nobody approved. Module 19 has a
test whose entire job is catching exactly that drift for its document checklist;
here there is one copy, in the place that creates the rows.

Seeded for existing organizations as well as new ones, so "ships with a default
set" is not true only for organizations created after today.

What the wording deliberately avoids: promising a timeline (nobody in the loop
agreed to it, and an automatic message cannot know), stating a reason for
rejection (a templated reason applied to everybody is both untrue and, in several
jurisdictions, evidence), and asking a question (these send automatically; a
question implies somebody is watching the reply, and until an inbound channel
exists, nobody is).

## Email-only works completely without WhatsApp

Not an aspiration — a property of the code. `sendWhatsApp()` is reached from
exactly one place, inside the `channel === "whatsapp"` branch of
`sendOnChannel()`. An email-only template never reads the WhatsApp integration
row. `requiredIntegrationsFor()` never demands `whatsapp` for a `both` template.
The two channels of a `both` template get independent log rows, so a WhatsApp
failure cannot cost the email. Tests cover each of those.

## Follow-ups

- ☐ **No delivery webhooks.** `delivered`, `opened` and `bounced` are in the
  schema, indexed on `provider_message_id`, and nothing consumes provider events
  yet — so a real send today rests at `sent`. The same gap Module 15 part one
  recorded for `notification_deliveries`, now with a second provider behind it.
- ☐ **No inbound channel.** A candidate replying to an email or sending STOP on
  WhatsApp reaches a human, not this product. The WhatsApp opt-out instruction is
  therefore honoured by a person, and the settings copy says so.
- ☐ **Still no scheduler.** Interview reminders go out when somebody dispatches
  them.
- ☐ **`offer_extended` and `unqualified` have no automatic trigger**, for the
  schema reasons above. Giving them one means a real offer stage and a recorded
  rejection reason — both product decisions, not plumbing.
- ☐ **Per-job templates.** `event_key` is organization-wide; the spec's
  parenthetical "(matching the application's job/organization)" would allow a
  per-job override. Not built: it needs a resolution order and a UI to explain
  it, and one active template per event is the honest starting point.
- ☐ **No AI tone assistance on candidate templates.** Part one's fixed-fact guard
  works on the internal template set; wiring it to this library needs each
  template to declare which of its placeholders are facts, which is a schema
  change and a real design question.
