// =============================================================================
// AgentSettings — the NEUTRAL voice-agent configuration object.
//
// This is the shape the browser holds, sends and receives. It is the whole point
// of the module's architecture rule:
//
//   "The frontend works with a neutral AgentSettings object shape — it must
//    never contain or display the provider name or any API key/secret anywhere
//    in the UI copy, console logs, or network payloads sent from the browser."
//
// So there is no provider name in this file, no provider model string, and no
// provider voice id. Model / voice / STT / ambience selections are OPAQUE
// CATALOGUE KEYS (see lib/voice/catalog.ts) which only the adapter can resolve
// back to something a provider recognises. A test asserts the serialised
// defaults contain none of the forbidden words.
//
// PURE MODULE. No database, no fetch, no provider. Everything here is a value
// transformation, which is a fact a computer can check — so it is code with
// tests rather than a convention nobody enforces.
//
// normalizeAgentSettings() runs on EVERY read and EVERY write. The browser holds
// a PostgREST client and can write voice_agents.config directly, so this is not
// a "make the form tidy" helper: it is what stops a hand-edited row keeping an
// agent on the phone for an hour or setting a temperature of 40.
// =============================================================================

import {
  normalizeDefaultCallData,
  type DefaultCallData,
} from "@/lib/voice/callData";

/** What the agent is for. Drives grouping in the switcher, nothing else. */
export const AGENT_PURPOSES = ["screening", "confirmation", "follow_up", "other"] as const;
export type AgentPurpose = (typeof AGENT_PURPOSES)[number];

export const PURPOSE_LABELS: Record<AgentPurpose, string> = {
  screening: "Screening",
  confirmation: "Confirmation",
  follow_up: "Follow-up",
  other: "Other",
};

export function isAgentPurpose(value: unknown): value is AgentPurpose {
  return typeof value === "string" && (AGENT_PURPOSES as readonly string[]).includes(value);
}

/**
 * Tone. A CLOSED list rather than free text.
 *
 * Free text would end up in the provider's system prompt verbatim, which makes
 * "ignore your previous instructions" a tone. The persona and system-prompt
 * fields are the places for free text, and they are clearly labelled as prompt
 * content; this one is a switch.
 */
export const AGENT_TONES = ["professional", "friendly", "warm", "direct", "formal"] as const;
export type AgentTone = (typeof AGENT_TONES)[number];

export const RESPONSE_LENGTHS = ["short", "medium", "long"] as const;
export type ResponseLength = (typeof RESPONSE_LENGTHS)[number];

// -----------------------------------------------------------------------------
// Bounds.
//
// Each one is a real-world limit, not a round number: a call that can run for an
// hour is a bill nobody approved, and a hangup after 1 second of silence hangs up
// on anyone who pauses to think.
// -----------------------------------------------------------------------------
export const LIMITS = {
  nameMax: 120,
  companyNameMax: 160,
  phoneMax: 32,
  messageMax: 1200,
  personaMax: 2000,
  systemPromptMax: 8000,
  guardrailMax: 300,
  guardrailCount: 20,

  temperatureMin: 0,
  temperatureMax: 1,

  interruptionMin: 0,
  interruptionMax: 1,

  /** Two seconds is a breath; sixty is a dropped call nobody noticed. */
  silenceSecondsMin: 2,
  silenceSecondsMax: 60,

  /** A screening call is minutes. Thirty is the outer edge of plausible. */
  callMinutesMin: 1,
  callMinutesMax: 30,
} as const;

// -----------------------------------------------------------------------------
// The object.
//
// Grouped by the console's sections rather than flattened, so the page's state
// and this type read the same way round, and so a new field lands in an obvious
// place instead of at the bottom of a list of forty.
// -----------------------------------------------------------------------------

export type GeneralSettings = {
  name: string;
  purpose: AgentPurpose;
  /** Prefilled from the organization, but editable — see the console. */
  companyName: string | null;
  callerNumber: string | null;
};

export type GreetingSettings = {
  /** Both support {{field}} tokens; rendered per candidate at call time. */
  welcomeMessage: string;
  closingMessage: string;
};

export type BrainSettings = {
  persona: string;
  tone: AgentTone;
  systemPrompt: string;
  /** An editable list — things the agent must not do. */
  guardrails: string[];
  /**
   * An OPAQUE CATALOGUE KEY, or null for "the platform default".
   *
   * Never a provider model name. The frontend receives keys and labels from the
   * backend catalogue and sends a key back; only the adapter can turn one into
   * something a provider recognises.
   */
  modelKey: string | null;
  responseLength: ResponseLength;
  temperature: number;
};

export type VoiceSettings = {
  /** Opaque catalogue key. */
  voiceKey: string | null;
};

export type SpeechSettings = {
  /** Opaque catalogue key for the recogniser + its language. */
  sttKey: string | null;
};

export type BehaviorSettings = {
  allowInterruption: boolean;
  /** 0 = only a long pause counts, 1 = the smallest sound cuts the agent off. */
  interruptionSensitivity: number;
  backchanneling: boolean;
  ambienceEnabled: boolean;
  /** Opaque catalogue key. */
  ambienceTrackKey: string | null;
  maxSilenceSeconds: number;
  maxCallMinutes: number;
  aiDecidedHangup: boolean;
  voicemailDetection: boolean;
  rejectUnknownCallers: boolean;
};

export type HandoffSettings = {
  transferEnabled: boolean;
  transferNumber: string | null;
};

export type AgentSettings = {
  general: GeneralSettings;
  greeting: GreetingSettings;
  brain: BrainSettings;
  voice: VoiceSettings;
  speech: SpeechSettings;
  behavior: BehaviorSettings;
  handoff: HandoffSettings;
  /** Section 7 — the organization-wide fallbacks. See lib/voice/callData.ts. */
  callData: DefaultCallData;
};

/**
 * The defaults a brand-new agent starts with.
 *
 * Deliberately a WORKING configuration rather than a form full of blanks: an
 * admin who presses "+ New agent" and then Save should get an agent that can
 * hold a sensible screening conversation, not one that says nothing.
 *
 * Two defaults are safety choices rather than taste:
 *   - `rejectUnknownCallers` is ON. This agent's job is outbound screening; an
 *     inbound stranger reaching it is not a feature.
 *   - `transferEnabled` is OFF with no number, because a handoff that dials an
 *     unset number is worse than no handoff.
 */
export function defaultAgentSettings(
  { companyName }: { companyName?: string | null } = {}
): AgentSettings {
  return {
    general: {
      name: "Screening agent",
      purpose: "screening",
      companyName: companyName?.trim() || null,
      callerNumber: null,
    },
    greeting: {
      welcomeMessage:
        "Hello, am I speaking with {{candidate.name}}? I'm calling about your application " +
        "for the {{job.title}} role.",
      closingMessage:
        "That's everything — thank you for your time. Someone from the team will review this " +
        "and be in touch about next steps.",
    },
    brain: {
      persona:
        "A recruitment coordinator doing a first-round screen. Calm, unhurried, and genuinely " +
        "interested in the answers.",
      tone: "professional",
      systemPrompt:
        "Ask the configured questions in order, one at a time. Listen to the whole answer " +
        "before moving on. If an answer is unclear, ask one short follow-up, then move on. " +
        "Do not evaluate the candidate out loud and do not promise an outcome.",
      guardrails: [
        "Never state or imply a hiring decision.",
        "Never discuss salary beyond what the candidate volunteers.",
        "Never ask about age, marital status, religion, caste, or health.",
        "If the candidate asks to stop, end the call politely and immediately.",
      ],
      modelKey: null,
      responseLength: "short",
      temperature: 0.3,
    },
    voice: { voiceKey: null },
    speech: { sttKey: null },
    behavior: {
      allowInterruption: true,
      interruptionSensitivity: 0.5,
      backchanneling: true,
      ambienceEnabled: false,
      ambienceTrackKey: null,
      maxSilenceSeconds: 10,
      maxCallMinutes: 8,
      aiDecidedHangup: true,
      voicemailDetection: true,
      rejectUnknownCallers: true,
    },
    handoff: { transferEnabled: false, transferNumber: null },
    callData: normalizeDefaultCallData(null),
  };
}

// -----------------------------------------------------------------------------
// Normalisation.
//
// Never throws and never rejects: unknown keys are dropped, bad types fall back
// to the default, out-of-range numbers are CLAMPED rather than refused. The
// caller is a form somebody has been typing into, and losing six good fields
// because the seventh is malformed is the worse failure.
// -----------------------------------------------------------------------------

function text(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed.slice(0, maxLength);
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

/**
 * A catalogue key, or null.
 *
 * Constrained to the shape lib/voice/catalog.ts mints — `kind_hex` — so a
 * hand-edited row cannot smuggle a provider model name in through this field and
 * have the adapter pass it straight through. An unrecognised value becomes null,
 * which means "platform default", which is always safe.
 */
const CATALOG_KEY_PATTERN = /^[a-z]{2,12}_[0-9a-f]{6,16}$/;

export function normalizeCatalogKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return CATALOG_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(number(value, min, max, fallback));
}

/** Rounded to 2dp so a slider cannot store 0.30000000000000004. */
function fraction(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(number(value, min, max, fallback) * 100) / 100;
}

function list(value: unknown, itemMax: number, countMax: number): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.slice(0, itemMax))
    .slice(0, countMax);
}

/**
 * A phone number, kept as the user typed it minus the noise.
 *
 * NOT reformatted to E.164 here. Different countries write numbers differently
 * and a wrong "correction" produces a call to a stranger; the dialling code
 * checks digit count at the point it dials (see the adapter), which is where a
 * bad number can actually be refused rather than silently rewritten.
 */
function phone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d+\-() ]/g, "").trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, LIMITS.phoneMax);
}

export function normalizeAgentSettings(
  raw: unknown,
  options: { companyName?: string | null } = {}
): AgentSettings {
  const defaults = defaultAgentSettings(options);
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const section = (key: string): Record<string, unknown> => {
    const value = input[key];
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  };

  const general = section("general");
  const greeting = section("greeting");
  const brain = section("brain");
  const voice = section("voice");
  const speech = section("speech");
  const behavior = section("behavior");
  const handoff = section("handoff");

  const transferNumber = phone(handoff.transferNumber);

  return {
    general: {
      name: text(general.name, LIMITS.nameMax, defaults.general.name),
      purpose: isAgentPurpose(general.purpose) ? general.purpose : defaults.general.purpose,
      companyName:
        optionalText(general.companyName, LIMITS.companyNameMax) ?? defaults.general.companyName,
      callerNumber: phone(general.callerNumber),
    },
    greeting: {
      welcomeMessage: text(
        greeting.welcomeMessage,
        LIMITS.messageMax,
        defaults.greeting.welcomeMessage
      ),
      closingMessage: text(
        greeting.closingMessage,
        LIMITS.messageMax,
        defaults.greeting.closingMessage
      ),
    },
    brain: {
      persona: text(brain.persona, LIMITS.personaMax, defaults.brain.persona),
      tone: (AGENT_TONES as readonly string[]).includes(brain.tone as string)
        ? (brain.tone as AgentTone)
        : defaults.brain.tone,
      systemPrompt: text(brain.systemPrompt, LIMITS.systemPromptMax, defaults.brain.systemPrompt),
      // An empty list is a legitimate choice ("I'll write my own rules into the
      // prompt"), so `?? defaults` only fires when the value was not a list at
      // all — not when it was an empty one.
      guardrails: list(brain.guardrails, LIMITS.guardrailMax, LIMITS.guardrailCount) ??
        defaults.brain.guardrails,
      modelKey: normalizeCatalogKey(brain.modelKey),
      responseLength: (RESPONSE_LENGTHS as readonly string[]).includes(
        brain.responseLength as string
      )
        ? (brain.responseLength as ResponseLength)
        : defaults.brain.responseLength,
      temperature: fraction(
        brain.temperature,
        LIMITS.temperatureMin,
        LIMITS.temperatureMax,
        defaults.brain.temperature
      ),
    },
    voice: { voiceKey: normalizeCatalogKey(voice.voiceKey) },
    speech: { sttKey: normalizeCatalogKey(speech.sttKey) },
    behavior: {
      allowInterruption: bool(behavior.allowInterruption, defaults.behavior.allowInterruption),
      interruptionSensitivity: fraction(
        behavior.interruptionSensitivity,
        LIMITS.interruptionMin,
        LIMITS.interruptionMax,
        defaults.behavior.interruptionSensitivity
      ),
      backchanneling: bool(behavior.backchanneling, defaults.behavior.backchanneling),
      ambienceEnabled: bool(behavior.ambienceEnabled, defaults.behavior.ambienceEnabled),
      ambienceTrackKey: normalizeCatalogKey(behavior.ambienceTrackKey),
      maxSilenceSeconds: integer(
        behavior.maxSilenceSeconds,
        LIMITS.silenceSecondsMin,
        LIMITS.silenceSecondsMax,
        defaults.behavior.maxSilenceSeconds
      ),
      maxCallMinutes: integer(
        behavior.maxCallMinutes,
        LIMITS.callMinutesMin,
        LIMITS.callMinutesMax,
        defaults.behavior.maxCallMinutes
      ),
      aiDecidedHangup: bool(behavior.aiDecidedHangup, defaults.behavior.aiDecidedHangup),
      voicemailDetection: bool(behavior.voicemailDetection, defaults.behavior.voicemailDetection),
      rejectUnknownCallers: bool(
        behavior.rejectUnknownCallers,
        defaults.behavior.rejectUnknownCallers
      ),
    },
    handoff: {
      /*
        FAILS CLOSED. "Transfer to a human" with no number to transfer to would
        drop the candidate mid-call, so the toggle cannot be on without a number
        — enforced here rather than only in the form, because the form is not the
        boundary.
      */
      transferEnabled: bool(handoff.transferEnabled, defaults.handoff.transferEnabled)
        ? transferNumber !== null
        : false,
      transferNumber,
    },
    callData: normalizeDefaultCallData(input.callData),
  };
}

/**
 * Splits the settings object into the row shape the table stores.
 *
 * The four General fields are real COLUMNS (they are queried, displayed in the
 * switcher and used by the dialling path), the rest is the `config` blob, and
 * Default Call Data has its own column because a different code path reads it —
 * see lib/voice/callData.ts. One save writes all three parts in one statement.
 */
export function splitForStorage(settings: AgentSettings): {
  name: string;
  purpose: AgentPurpose;
  company_name: string | null;
  caller_number: string | null;
  config: Record<string, unknown>;
  default_call_data: Record<string, unknown>;
} {
  return {
    name: settings.general.name,
    purpose: settings.general.purpose,
    company_name: settings.general.companyName,
    caller_number: settings.general.callerNumber,
    config: {
      // `general` is deliberately NOT duplicated into config. Two copies of the
      // agent's name would disagree the first time one write path forgot the
      // other, and the switcher reads the column.
      greeting: settings.greeting,
      brain: settings.brain,
      voice: settings.voice,
      speech: settings.speech,
      behavior: settings.behavior,
      handoff: settings.handoff,
    },
    default_call_data: settings.callData,
  };
}

/** Rebuilds the settings object from a stored row. Inverse of splitForStorage. */
export function settingsFromRow(
  row: {
    name: string;
    purpose: string;
    company_name: string | null;
    caller_number: string | null;
    config: unknown;
    default_call_data: unknown;
  },
  options: { companyName?: string | null } = {}
): AgentSettings {
  const config = (typeof row.config === "object" && row.config !== null ? row.config : {}) as
    Record<string, unknown>;

  return normalizeAgentSettings(
    {
      ...config,
      general: {
        name: row.name,
        purpose: row.purpose,
        companyName: row.company_name,
        callerNumber: row.caller_number,
      },
      callData: row.default_call_data,
    },
    options
  );
}

// -----------------------------------------------------------------------------
// Setup progress, and phone formatting.
//
// Both pure, both here rather than in the console, because both are rules about
// what a valid agent looks like — and a rule that lives in a component is one the
// API cannot apply.
// -----------------------------------------------------------------------------

/** The sections that hold configuration. */
export const CONFIGURABLE_SECTIONS = [
  "general",
  "greeting",
  "brain",
  "voice",
  "speech",
  "behavior",
  "calldata",
  "handoff",
] as const;

export type ConfigurableSection = (typeof CONFIGURABLE_SECTIONS)[number];

/**
 * Which sections a person has actually made a decision about.
 *
 * EIGHT, NOT NINE. Test Agent is an action, not a setting — there is nothing in it
 * to configure, so counting it would leave the indicator permanently short of its
 * own total, which reads as an unfinished agent rather than a finished one.
 *
 * "Configured" means a DELIBERATE choice, which is not the same as non-empty.
 * `behavior` and `handoff` ship with real working defaults, so they count as done
 * from the start — an indicator that nagged about a section whose defaults are
 * correct would teach people to ignore it. What does not count is a section whose
 * value is still literally absent: no voice chosen, no company name, no call data.
 */
export function configuredSections(settings: AgentSettings): ConfigurableSection[] {
  const done: ConfigurableSection[] = [];

  if (settings.general.name.trim() && settings.general.companyName?.trim()) done.push("general");
  if (settings.greeting.welcomeMessage.trim() && settings.greeting.closingMessage.trim()) {
    done.push("greeting");
  }
  if (settings.brain.persona.trim() && settings.brain.systemPrompt.trim()) done.push("brain");

  // A null key means "platform default" — a fallback, not a choice somebody made.
  if (settings.voice.voiceKey !== null) done.push("voice");
  if (settings.speech.sttKey !== null) done.push("speech");

  // Defaults here are genuine positions (interruption on, 8-minute cap), so this
  // section is complete unless somebody empties it, which the normaliser prevents.
  done.push("behavior");

  if (settings.callData.fields.length > 0 || settings.callData.fallbackQuestions.length > 0) {
    done.push("calldata");
  }

  // Transfer deliberately OFF is a decision. Transfer ON with no number cannot be
  // stored at all (see normalizeAgentSettings), so on-with-a-number is the only
  // other reachable state.
  done.push("handoff");

  return done;
}

/**
 * The default country dialling code.
 *
 * Matches the rest of this product's India-first defaults — currency INR, the
 * `+91` samples in the placeholder catalogue. A DEFAULT, never a restriction:
 * pasting a number with any other code is accepted unchanged, because a
 * recruitment desk that hires across borders must not be told its candidate's
 * number is invalid.
 */
export const DEFAULT_DIAL_CODE = "+91";

/**
 * Is this dialable?
 *
 * Counts DIGITS, not characters, so every way a person writes the same number
 * passes — "+91 98765 43210", "+919876543210", "091-98765-43210". The lower bound
 * is 8 because the shortest national numbers in use are around that; the upper is
 * 15, which is the E.164 maximum and therefore a real ceiling rather than a guess.
 *
 * An EMPTY value is valid. The caller number is optional — an agent with none
 * falls back to the provider's account number — so refusing empty would block a
 * save for a field nobody has to fill.
 */
export function isDialableNumber(value: string | null): boolean {
  if (value === null || value.trim().length === 0) return true;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}

/**
 * Prefixes the default dialling code when a number plainly has none.
 *
 * Only when the value is bare digits of national length. A value already carrying
 * `+`, or a leading `0` trunk prefix, is left exactly as typed — guessing a
 * country for a number that already states one is how a call reaches a stranger.
 */
export function withDialCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith("+") || trimmed.startsWith("0")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== trimmed.length) return trimmed;
  if (digits.length < 6 || digits.length > 11) return trimmed;

  return `${DEFAULT_DIAL_CODE} ${trimmed}`;
}

/**
 * Whether "Save agent" is available.
 *
 * EXTRACTED FROM THE CONSOLE so the rule can be tested rather than read. It is
 * two booleans, but they decide whether the page's only primary button looks
 * usable — and the bug this page shipped with was exactly that: a Save that read
 * as permanently dead beside a banner promising you could save.
 *
 * Three facts, in priority order:
 *   1. an invalid caller number blocks it, whatever else is true
 *   2. an unsynced save is always retryable, even with no further edits
 *   3. otherwise it follows `dirty` — nothing to save, nothing to press
 */
export function canSaveAgent({
  dirty,
  unsynced,
  callerNumberValid,
}: {
  dirty: boolean;
  /** A previous save stored locally but never reached the provider. */
  unsynced: boolean;
  callerNumberValid: boolean;
}): boolean {
  if (!callerNumberValid) return false;
  if (unsynced) return true;
  return dirty;
}
