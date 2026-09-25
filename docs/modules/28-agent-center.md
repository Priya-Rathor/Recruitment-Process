# Agent Center — Module 1 (foundation)

Settings → **AI & Agents** (Agents, Automations) → Agents (`/settings/agents`). The ONLY place an AI
agent is created or configured — the single Agents entry in Settings (a test
fails if any other Settings link names an agent). **Agent type** (what it does) and **provider** (who runs it) are separate
axes: `lib/agents/types.ts` and `lib/agents/providers.ts` never import each other.

## What is built

| Piece | Where |
| --- | --- |
| Type registry — exactly **8** types (CV Screening added in `0044`; Universal + Custom LLM merged into Custom in `0045`), names, Lucide icons, dependency, `runnable` | `lib/agents/types.ts` (client-safe) |
| Provider capability matrix, with the docs evidence per claim | `lib/agents/providers.ts` (client-safe) |
| Per-type config fields + the one validator | `lib/agents/config.ts` (client-safe) |
| Connection state per provider/channel (no credentials) | `lib/agents/registry.ts` (server) |
| Reads/writes (session client, RLS) | `lib/agents/queries.ts` |
| API | `app/api/settings/agents` (GET, POST) · `[id]` (GET, PATCH, DELETE) |
| UI | list + empty state, create flow steps 1–3, edit page |
| Schema | `supabase/migrations/0043_agent_center.sql`, proved by `supabase/VERIFY_0043.sql` |

## Settings architecture — agents vs integrations

An **integration** is a connection (Integrations: Bolna AI, Google Calendar —
also the video provider, via Meet links — and AI provider; Communications:
Email, WhatsApp Business). Sarvam and other video providers have no adapter, so
they have no card and are not offered in the create flow. An
**agent** is the AI worker that uses one, and lives only under `/settings/agents`:

| Route | What |
| --- | --- |
| `/settings/agents` | List — search, status and type filters, provider, where used |
| `/settings/agents/new` | Create flow |
| `/settings/agents/[id]` | Edit an agent |
| `/settings/agents/voice` | Voice agent console (moved from `/settings/integrations/bolna`, which redirects) |
| `/settings/agents/whatsapp` | WhatsApp Auto Reply Agent (moved from `/settings/auto-reply`, which redirects) |

The voice screening **call rules** (attempts, retry delay, language, recording)
are on the voice agent page (`/settings/agents/voice#call-rules`); the old
`/settings/screening` "Screening defaults" page redirects there. One set per
organization — the scheduler reads them for every screening call.
The Bolna connect form's agent ID is now an optional fallback.

Assignment is the existing one: an automation / stage-workflow action names an
agent (`actions[].config.agent_id`). One agent, many jobs and stages; "Used in"
and the delete guard read it. No separate assignments table yet — nothing but
voice screening executes an agent to assign.

## Rules the database enforces

- A provider is present exactly for `voice_screening` / `voice_interview`.
- Only `voice_screening` may be ACTIVE — the only type something runs today.
- `whatsapp_reply` rows are refused: that agent stays in `auto_reply_config`
  (0042) so it keeps exactly one kill switch. The Agent Center lists it from there.
- Type, provider and organization are immutable.
- An agent any automation action names cannot be deleted — from the Agent
  Center or from the voice console.

## Voice screening

Existing `voice_agents` rows were copied into `agents` **with the same ids**, so
stage workflows (`start_screening_call.config.agent_id`) are untouched. The
console still creates agents; a trigger gives each its identity row. Call
settings stay in the console; the Agent Center links there (`?agent=<id>`).

**Status now controls dialling** (`lib/voice/dialing.ts`): a paused or archived
agent never dials, a workflow naming a draft is refused, a draft *default* is
skipped (0034 makes the first agent the default automatically).

## Next modules

Test step and review step · voice interview flow · Sarvam adapter (+ privacy
entry) · inbound email for email reply · assessment engine · per-agent LLM
settings (needs `provider.ts` to read per-org keys) · merging `auto_reply_config`
into `agents`.
