// =============================================================================
// Neutral AgentSettings  ->  the provider's agent-configuration shape.
//
// SERVER ONLY. This file names the provider, so it must never be imported by a
// client component — that is the whole reason the mapping lives here rather than
// in lib/voice/, and why lib/voice/catalog.ts holds types with no provider words
// in them at all.
//
// Every function here is PURE: settings in, payload out, no fetch and no
// database. The console's own testing instruction is to verify "the adapter
// correctly maps the neutral AgentSettings shape to the real API shape", and a
// pure function is the only version of that which a test can actually assert.
//
// WHAT A TEST CAN AND CANNOT PROVE
// --------------------------------
// The tests beside this file pin the mapping: every neutral field lands in the
// documented provider field, the bounds survive, and no neutral value leaks a
// provider term back out. What they cannot prove is that the provider's live
// schema still matches its documentation — that needs one real staging call with
// the payload logged, which is why the field names are gathered in ONE object
// literal below instead of being scattered across the adapter.
// =============================================================================
import { createHash } from "node:crypto";
import type { AgentSettings, ResponseLength } from "@/lib/voice/settings";
import type { CatalogKind, CatalogOption } from "@/lib/voice/catalog";

/**
 * Words that must never reach the browser inside a label.
 *
 * A provider's own catalogue happily returns names like "Bolna Default" or a
 * voice whose display name is its TTS vendor. The console's rule is that the page
 * content stays provider-neutral, so labels are scrubbed on the way out rather
 * than trusted.
 *
 * Kept in this file BECAUSE it contains the provider's name: a denylist imported
 * by a client component would ship the very word it exists to remove into the
 * page source.
 */
const PROVIDER_TERMS = [
  "bolna",
  "elevenlabs",
  "eleven labs",
  "deepgram",
  "openai",
  "azure",
  "polly",
  "cartesia",
  "smallest",
  "twilio",
  "plivo",
  "whisper",
  "gpt",
  "claude",
  "anthropic",
  "gemini",
  "nova",
];

/**
 * Removes provider words from a display label.
 *
 * A label that is ONLY a provider term becomes null and the caller drops the
 * option — better to offer nine voices than ten where one is called "".
 */
export function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let label = raw;
  for (const term of PROVIDER_TERMS) {
    label = label.replace(new RegExp(term, "gi"), " ");
  }

  // Collapse the gaps the removals left, and tidy the punctuation they orphaned.
  //
  // The bracket pass matters: "Aditi (ElevenLabs)" would otherwise become
  // "Aditi ( )", which looks like a rendering bug in a dropdown rather than a
  // deliberate omission.
  label = label
    .replace(/[_-]+/g, " ")
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.\-–—:]+|[\s,.\-–—:]+$/g, "")
    .trim();

  if (label.length === 0) return null;
  return label.slice(0, 60);
}

/**
 * Mints the opaque key the frontend sees for a catalogue entry.
 *
 * Deterministic, so the key for a given provider identifier is stable across
 * requests and deploys — a stored `voiceKey` must still resolve tomorrow. Not
 * reversible by the browser: it is a truncated SHA-256 of a namespaced string,
 * and the only way back is to re-fetch the catalogue and re-mint, which is
 * exactly what resolveCatalogKey() below does.
 *
 * Truncated to 12 hex characters. Collision risk across a few hundred catalogue
 * entries is negligible, and a collision would mean picking the wrong voice —
 * not a security failure.
 */
export function mintCatalogKey(kind: CatalogKind, sourceId: string): string {
  const digest = createHash("sha256").update(`${kind}:${sourceId}`).digest("hex");
  return `${kind}_${digest.slice(0, 12)}`;
}

/**
 * Turns a key back into the provider identifier it was minted from.
 *
 * Works by re-minting every candidate rather than by storing a mapping table:
 * one source of truth (the provider's live catalogue), and no stale row that
 * points at a voice the provider retired.
 */
export function resolveCatalogKey(
  kind: CatalogKind,
  key: string | null,
  sourceIds: string[]
): string | null {
  if (!key) return null;
  return sourceIds.find((sourceId) => mintCatalogKey(kind, sourceId) === key) ?? null;
}

/**
 * The ambience tracks the provider supports.
 *
 * A FIXED SET rather than a catalogue endpoint, because it is an enum in the
 * provider's schema, not a list it serves. Labels are written here so they read
 * as places rather than as file names.
 */
export const AMBIENCE_TRACKS: { id: string; label: string }[] = [
  { id: "office-ambience", label: "Quiet office" },
  { id: "call-center", label: "Contact centre" },
  { id: "coffee-shop", label: "Coffee shop" },
  { id: "convention_hall", label: "Conference hall" },
];

export function ambienceOptions(): CatalogOption[] {
  return AMBIENCE_TRACKS.map((track) => ({
    key: mintCatalogKey("amb", track.id),
    label: track.label,
    language: null,
  }));
}

// -----------------------------------------------------------------------------
// The mapping itself.
// -----------------------------------------------------------------------------

/**
 * Response length -> a token ceiling.
 *
 * A ceiling rather than an instruction in the prompt, because "keep it short" in
 * a system prompt is a suggestion the model may ignore on turn forty, whereas a
 * max-token limit is arithmetic. The prompt says it too, for fluency.
 */
const RESPONSE_TOKENS: Record<ResponseLength, number> = {
  short: 90,
  medium: 160,
  long: 300,
};

const RESPONSE_GUIDANCE: Record<ResponseLength, string> = {
  short: "Keep every reply to one or two sentences.",
  medium: "Keep replies to two or three sentences.",
  long: "Replies may run to a short paragraph when the answer needs it.",
};

/**
 * Interruption sensitivity (0-1) -> how many words the candidate must say before
 * the agent stops talking.
 *
 * INVERTED, on purpose: high sensitivity means "cut off easily", which means a
 * LOW word threshold. Getting this backwards produces an agent that talks over
 * everybody at the setting labelled "most responsive", so it is one line with a
 * test rather than an inline expression.
 */
export function interruptionWords(sensitivity: number): number {
  const clamped = Math.min(Math.max(sensitivity, 0), 1);
  // 1 word at full sensitivity, 6 at none.
  return Math.max(1, Math.round(6 - clamped * 5));
}

/**
 * Assembles the agent's system prompt from the neutral fields.
 *
 * Order matters and is deliberate: identity, then tone, then the operator's own
 * instructions, then the guardrails LAST — a model that has read a long prompt
 * weights the end of it more heavily, and the guardrails are the part that must
 * survive.
 *
 * The consent disclosure is NOT here. It belongs to lib/screening/script.ts,
 * which emits it as the first spoken segment of every call and cannot be
 * configured off. Putting it in a prompt would make a legal obligation something
 * an LLM might paraphrase.
 */
export function buildSystemPrompt(settings: AgentSettings): string {
  const { brain, general, greeting } = settings;
  const company = general.companyName?.trim();

  const parts: string[] = [];

  parts.push(
    company
      ? `You are a voice agent calling on behalf of ${company}.`
      : "You are a voice agent calling on behalf of the hiring team."
  );

  if (brain.persona.trim()) parts.push(`Who you are: ${brain.persona.trim()}`);
  parts.push(`Tone: ${brain.tone}. ${RESPONSE_GUIDANCE[brain.responseLength]}`);
  if (brain.systemPrompt.trim()) parts.push(brain.systemPrompt.trim());

  if (greeting.closingMessage.trim()) {
    parts.push(`When the conversation is finished, close with: "${greeting.closingMessage.trim()}"`);
  }

  if (settings.handoff.transferEnabled) {
    parts.push(
      "If the candidate asks to speak to a person, say you will transfer them and stop talking."
    );
  }

  if (brain.guardrails.length > 0) {
    parts.push(
      ["Rules you must not break:", ...brain.guardrails.map((rule) => `- ${rule}`)].join("\n")
    );
  }

  return parts.join("\n\n");
}

/** Provider identifiers already resolved from the catalogue by the caller. */
export type ResolvedProviderIds = {
  /** Null means "let the provider use its account default". */
  model: string | null;
  voice: string | null;
  stt: string | null;
  ambienceTrack: string | null;
};

/**
 * The provider's agent-configuration payload.
 *
 * ONE object literal, so the field names that have to match the provider's
 * documented v2 agent schema are all in one place and a schema correction is a
 * single diff rather than an archaeology exercise.
 */
export function toProviderAgentPayload({
  settings,
  ids,
  webhookUrl,
}: {
  settings: AgentSettings;
  ids: ResolvedProviderIds;
  webhookUrl: string;
}): Record<string, unknown> {
  const { behavior, brain, general, greeting } = settings;

  return {
    agent_config: {
      agent_name: general.name,
      agent_type: general.purpose === "screening" ? "other" : general.purpose,
      agent_welcome_message: greeting.welcomeMessage,
      webhook_url: webhookUrl,
      tasks: [
        {
          task_type: "conversation",
          toolchain: {
            execution: "parallel",
            pipelines: [["transcriber", "llm", "synthesizer"]],
          },
          tools_config: {
            llm_agent: {
              agent_type: "simple_llm_agent",
              agent_flow_type: "streaming",
              llm_config: {
                // Omitted rather than sent as null when the operator has not
                // chosen one: an explicit null overrides the account default on
                // some providers, which is not what "platform default" means.
                ...(ids.model ? { model: ids.model } : {}),
                max_tokens: RESPONSE_TOKENS[brain.responseLength],
                temperature: brain.temperature,
              },
            },
            synthesizer: {
              stream: true,
              audio_format: "wav",
              buffer_size: 150,
              ...(ids.voice ? { provider_config: { voice_id: ids.voice } } : {}),
            },
            transcriber: {
              stream: true,
              encoding: "linear16",
              // 400ms of silence before the recogniser calls a phrase finished.
              // Not the same thing as maxSilenceSeconds, which is when to give up
              // on the call entirely.
              endpointing: 400,
              ...(ids.stt ? { model: ids.stt } : {}),
            },
          },
          task_config: {
            // --- Conversation Behavior, section 6 of the console -------------
            hangup_after_silence: behavior.maxSilenceSeconds,
            call_terminate: behavior.maxCallMinutes * 60,
            hangup_after_LLMCall: behavior.aiDecidedHangup,
            voicemail: behavior.voicemailDetection,
            backchanneling: behavior.backchanneling,
            backchanneling_message_gap: 5,
            backchanneling_start_delay: 5,
            ambient_noise: behavior.ambienceEnabled && ids.ambienceTrack !== null,
            ...(behavior.ambienceEnabled && ids.ambienceTrack
              ? { ambient_noise_track: ids.ambienceTrack }
              : {}),

            /*
              Interruption. `allow_interruptions: false` is expressed as a word
              threshold far above anything a person says in one breath, because a
              provider that ignores an unknown boolean would otherwise silently
              leave interruption ON — and "the agent talks over the candidate" is
              the complaint that follows.
            */
            number_of_words_for_interruption: behavior.allowInterruption
              ? interruptionWords(behavior.interruptionSensitivity)
              : 999,
            interruption_backoff_period: 100,
            incremental_delay: 100,

            // --- Human Handoff, section 8 ------------------------------------
            ...(settings.handoff.transferEnabled && settings.handoff.transferNumber
              ? {
                  call_transfer: {
                    enabled: true,
                    transfer_number: settings.handoff.transferNumber,
                  },
                }
              : {}),
          },
        },
      ],
    },
    agent_prompts: {
      task_1: { system_prompt: buildSystemPrompt(settings) },
    },
  };
}

/**
 * Parses one entry of a provider catalogue response into a neutral option.
 *
 * DEFENSIVE ON PURPOSE. Catalogue endpoints differ in whether they return
 * `{ id, name }`, `{ voice_id, voice_name }` or a bare string, and a shape change
 * must degrade to "this option is unavailable" rather than throw inside a page
 * render. Returns null for anything it cannot read.
 */
export function parseCatalogEntry(
  kind: CatalogKind,
  entry: unknown
): { option: CatalogOption; sourceId: string } | null {
  if (typeof entry === "string") {
    const label = sanitizeLabel(entry);
    if (!label) return null;
    return { option: { key: mintCatalogKey(kind, entry), label, language: null }, sourceId: entry };
  }

  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;

  const idCandidate = [raw.id, raw.voice_id, raw.model, raw.model_id, raw.name, raw.voice].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (!idCandidate) return null;

  const label =
    sanitizeLabel(raw.display_name) ??
    sanitizeLabel(raw.name) ??
    sanitizeLabel(raw.voice_name) ??
    sanitizeLabel(raw.label) ??
    sanitizeLabel(idCandidate);
  if (!label) return null;

  const language =
    typeof raw.language === "string"
      ? sanitizeLabel(raw.language)
      : typeof raw.languages === "string"
        ? sanitizeLabel(raw.languages)
        : Array.isArray(raw.languages)
          ? sanitizeLabel(raw.languages.filter((l) => typeof l === "string").join(", "))
          : null;

  return {
    option: { key: mintCatalogKey(kind, idCandidate), label, language: language ?? null },
    sourceId: idCandidate,
  };
}

/**
 * Pulls the list out of whatever wrapper a catalogue endpoint used.
 *
 * `[]`, `{ data: [] }`, `{ voices: [] }`, `{ models: [] }` are all in use across
 * provider APIs, including between endpoints of the same provider.
 */
export function extractCatalogArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return [];

  const raw = payload as Record<string, unknown>;
  for (const key of ["data", "items", "results", "voices", "models", "languages"]) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[];
  }
  return [];
}
