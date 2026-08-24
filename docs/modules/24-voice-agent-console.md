# Module 24 — Voice Agent Console

One page — `/settings/integrations/bolna` — that configures what the automated
screening call says, how it sounds, how it behaves, and what it falls back to
when a job has not configured its own screening.

It replaces the *agent configuration* half of Module 17's Bolna card. Credentials
stay on that card, because the console must never display or accept an API key.

## What it is not

- **Not a second integration path.** Saving pushes through
  `lib/integrations/bolna/updateAgentConfig()`, beside the existing
  `connect / test / getStatus / disconnect / placeCall`.
- **Not a second question list.** A job's questions stay in
  `job_screening_questions`. The console holds *fallback* questions, used only by
  a job that has AI screening on and no list of its own.
- **Not a second language / attempt-count setting.** Those are Module 17's
  `organization_settings.screening_settings`, read from there.
- **Not a dashboard, wizard, or accordion.** One scrollable page, nine sections,
  independently expandable, one sticky Save.

## The shape of it

```
/settings/integrations            → Bolna card: credentials, Test connection
     └─ "Voice agent console"     → /settings/integrations/bolna
          ├─ 0 switcher           voice_agents rows; one is_default per org
          ├─ 1 General            name, purpose, company name, caller number   (columns)
          ├─ 2 Greeting           welcome + closing, {{field}} picker          (config jsonb)
          ├─ 3 AI Brain           persona, tone, prompt, guardrails, model,
          │                       response length, temperature
          ├─ 4 Voice              TTS voice          ─┐
          ├─ 5 Speech             STT model/language  ├ opaque catalogue keys,
          ├─ 6 Behavior           interruption, backchannel, ambience,        │ backend-populated
          │                       silence, duration, hangup, voicemail        ─┘
          ├─ 7 Default Call Data  org fallbacks + precedence preview  (default_call_data jsonb)
          ├─ 8 Handoff            transfer toggle + number
          └─ 9 Test Agent         "Call me" → voice_agent_test_calls
                                       └─ /api/webhooks/bolna advances it
```

## Files

| Path | What it holds |
| --- | --- |
| `supabase/migrations/0034_module24_voice_agent_console.sql` | Two tables, RLS, triggers, the column-level REVOKE |
| `lib/voice/settings.ts` | The neutral `AgentSettings` shape, defaults, normaliser, row split |
| `lib/voice/callData.ts` | Default Call Data, and **the precedence rule** |
| `lib/voice/catalog.ts` | Catalogue types. Client-safe: no provider words, no crypto |
| `lib/voice/queries.ts` | Reads/writes, precedence inputs, test-call rows |
| `lib/integrations/bolna/agentMapping.ts` | Neutral → provider payload. Server only; names the provider |
| `lib/integrations/bolna/index.ts` | `listAgentCatalog`, `updateAgentConfig`, `placeTestCall` |
| `app/api/settings/voice-agents/` | List/create, save/delete, test-call, precedence preview |
| `app/settings/integrations/bolna/` | The page and its five client components |

## The precedence rule

Stated in the UI, implemented once, tested:

> These are used when a job doesn't specify its own AI Screening Call
> configuration. A job's own settings (under Hiring Stages) always take priority
> over these defaults.

`resolveCallDataPrecedence()` in `lib/voice/callData.ts` is called by **both** the
read-only preview table and the real dialling path, so the two cannot disagree. A
preview computed by a second code path would be believed and would be wrong.

Jobs have no arbitrary key/value store, and inventing one would be the
duplication the spec forbids. So the job-level side of each row is the real field
that already exists in Module 3's screening stage:

| Field | Org default | Job override |
| --- | --- | --- |
| `screening_questions` | `default_call_data.fallbackQuestions` | `job_screening_questions` |
| `company_name` | call-data field, else the agent's company name | the job's client name (Module 12) |
| `language` | `screening_settings.language` | `job_hiring_stages.config.language` |
| `max_call_attempts` | `screening_settings.maxAttempts` | `job_hiring_stages.config.maxAttempts` |
| `call_briefing` | the agent's base instructions | `job_hiring_stages.prompt_template` |
| anything else an admin adds | the call-data field | *none* — the row says so |

Questions are **never merged**. A job with three questions asks three, not three
plus the org's five.

## What changed outside this module

- `placeCall()` now dials with the **default console agent's** provider id,
  falling back to the id captured at connect time. Signature unchanged; an
  organization that never opens the console resolves to exactly the id it used
  before.
- `startScreeningCall()` resolves questions through
  `resolveEffectiveQuestions()`. An empty job list used to mean "no call can
  run"; it now means "use the org fallback, if there is one". Both the job page's
  screening card and the stage-config modal say so, because a recruiter who
  leaves the list empty needs to know a call may still happen.
- `/api/webhooks/bolna` accepts a second metadata key,
  `voice_agent_test_call_id`. A test dial can never be written into a candidate's
  screening history.
- Four audit events registered under the `integration` entity:
  `voice_agent.created / saved / deleted / test_called`, all sensitive.

## Provider neutrality — how it is actually enforced

Four mechanisms, not one convention:

1. **Column-level REVOKE.** `voice_agents.provider`, `.provider_agent_id` and
   `voice_agent_test_calls.provider_call_id` have SELECT revoked from
   `authenticated` and `anon`. The browser holds a PostgREST client, so a column a
   policy exposes is a column a browser can read; a route that declines to
   serialise a column is not a boundary. Every query in `lib/voice/queries.ts`
   names its columns, because `select *` on a table with a revoked column fails.
2. **Opaque catalogue keys.** A voice reaches the browser as
   `{ key: "voice_9c1f0ab27d34", label: "Aditi", language: "Hindi" }`. The key is
   a truncated namespaced SHA-256 of the provider's identifier, minted in the
   adapter. Resolving one back means re-fetching the provider's catalogue — so a
   retired voice resolves to "account default" rather than to a stale id.
3. **Label scrubbing.** Provider names are stripped from catalogue labels
   server-side. The denylist lives in the adapter *because it contains the
   provider's name*: imported by a client component, it would ship the very word
   it exists to remove.
4. **A test.** `lib/voice/settings.test.ts` asserts the serialised defaults and
   the stored row contain none of the forbidden terms, so the rule survives new
   fields.

`normalizeCatalogKey()` also constrains the key's *shape*, so a hand-edited row
cannot smuggle `gpt-4o-mini` through the model field and have the adapter pass it
straight to the provider.

## Safety

`placeTestCall()` telephones a real person, so it follows the same rules as every
other outbound path:

- Owner/Admin only, checked in the route as well as in RLS.
- `confirmed: true` required in the body; the console asks first, naming the
  number.
- A hard cap of ten test calls per organization per rolling hour.
  `countRecentTestCalls()` **fails closed** — a count that errors is treated as
  "at the limit", because a cap that cannot be counted cannot be enforced.
- The consent disclosure comes from `lib/screening/script.ts` and cannot be
  switched off. Whoever answers may not be whoever pressed the button.
- `voice_agent_test_calls` has **no UPDATE policy**. Outcomes are written only by
  the webhook through the service-role client — nobody's browser session can
  rewrite the record of a call that was made.

Two more, on the configuration itself:

- `handoff.transferEnabled` cannot be saved on without a number. A transfer to
  nowhere drops the candidate mid-call, so the normaliser enforces it rather than
  the form.
- Default Call Data cannot overwrite `script`, `questions`, `language` or
  `is_test` on the call payload. Those keys are stripped in `placeCall()` —
  otherwise an admin could replace a compliance-checked script *after*
  `assertScriptIsCompliant()` had passed.

## Save behaviour

One request, `PUT /api/settings/voice-agents/:id`, carrying the whole form.

Order is local-write-first, then provider push:

1. Normalise — the browser is not trusted.
2. Write locally — a provider outage must not lose an afternoon of work.
3. Push, and **record whether it landed**.

A failed sync returns `200` with `synced: false` and a plain reason. The settings
*are* saved; the console says the provider does not have them yet and offers Save
again. Reporting success over a provider rejection would leave the console showing
settings no call will ever use. On any error the form keeps the user's edits — it
is never cleared.

## Degraded states, and what each one says

| Situation | What the page does |
| --- | --- |
| Migration 0034 not applied | Says so, names the migration. No Create button that cannot work |
| Integration not connected | Sections still editable and savable; banner says nothing dials yet |
| Catalogue unreachable | Dropdowns empty **and disabled**, with the reason. Never backfilled with invented voices |
| A saved voice no longer in the catalogue | Rendered as "Saved selection (no longer listed)", value intact. A plain `<select>` would silently show — and then save — the first option |
| No jobs yet | The precedence table says there is nothing to compare against |

## Known gaps

- **`rejectUnknownCallers` is stored, not applied.** This product places outbound
  calls only; there is no inbound path for it to gate. The toggle's help text says
  exactly that rather than pretending.
- **The provider payload's field names follow the documented v2 agent schema and
  are pinned by unit test, not by a live call.** They are gathered in one object
  literal in `agentMapping.ts` so a correction is a single diff. The spec asks for
  verification against a real staging payload; that still needs doing with live
  credentials.
- **Catalogue endpoint paths are best-effort**, tried in order and overridable
  with `BOLNA_CATALOG_PATHS` (`kind:path`, comma-separated) so a renamed endpoint
  does not need a deploy. Until one is confirmed, the console shows its degraded
  state honestly rather than an empty dropdown.
- **The product primary is `#004cf5`, not the `#4F46E5` the spec's token list
  names.** The brief's actual requirement — "the EXACT same design tokens as the
  rest of this product" — is met by using `var(--color-primary)`; the palette was
  rebranded to the logo blue after that list was written. Hardcoding the indigo
  would have made this the one page that did not match.
