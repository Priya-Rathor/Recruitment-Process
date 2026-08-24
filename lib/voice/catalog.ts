// =============================================================================
// The voice-agent catalogue — types only.
//
// Model, voice, speech-recognition and ambience choices are fetched from the
// backend adapter, never hardcoded in the frontend, so this page does not need a
// redeploy when the provider adds a new voice.
//
// WHAT CROSSES THE WIRE IS A KEY AND A LABEL, NOTHING ELSE.
//
//   { key: "voice_9c1f0ab27d34", label: "Aditi", language: "Hindi" }
//
// The key is opaque and minted server-side from the provider's own identifier
// (see lib/integrations/bolna/agentMapping.ts). The browser therefore cannot
// learn a provider model string, a provider voice id, or the provider's name from
// this data — which is what "no provider-identifying information reaches the
// frontend" has to mean if it is to be more than a naming convention.
//
// THIS FILE IS IMPORTED BY CLIENT COMPONENTS. It deliberately contains no
// provider names (not even in a denylist), no crypto, and no fetch — anything
// that must know a provider's name lives in the adapter, server-side.
// =============================================================================

/** Which dropdown an option belongs to. Also the prefix of its key. */
export type CatalogKind = "model" | "voice" | "stt" | "amb";

export type CatalogOption = {
  /** Opaque, stable, minted server-side. Matches /^[a-z]{2,12}_[0-9a-f]{6,16}$/. */
  key: string;
  /** What the user reads. A human name, never an internal identifier. */
  label: string;
  /** Display language, when the option is language-specific. */
  language: string | null;
};

/**
 * The four lists, plus an honest degraded state.
 *
 * `degraded` is not cosmetic. When the catalogue cannot be fetched — the
 * integration is not connected, the provider is unreachable, the server has no
 * encryption key — the options list is EMPTY and `reason` says why. It is never
 * backfilled with invented options: a dropdown offering a voice that does not
 * exist would let someone save a configuration that cannot run, and they would
 * find out when a candidate answered the phone.
 *
 * The console keeps whatever the agent already has selected and says the list
 * could not be loaded, which is the "explicit pending state" the architecture
 * rules require rather than a fake zero.
 */
export type AgentCatalog = {
  models: CatalogOption[];
  voices: CatalogOption[];
  stt: CatalogOption[];
  ambience: CatalogOption[];
  degraded: boolean;
  reason: string | null;
};

export const EMPTY_CATALOG: AgentCatalog = {
  models: [],
  voices: [],
  stt: [],
  ambience: [],
  degraded: true,
  reason: null,
};

export function degradedCatalog(reason: string): AgentCatalog {
  return { ...EMPTY_CATALOG, reason };
}

/**
 * Finds an option's label for display.
 *
 * Returns null when the key is not in the list, which the console renders as
 * "saved selection — options unavailable" rather than silently showing the first
 * option as if it were the stored one.
 */
export function findOption(options: CatalogOption[], key: string | null): CatalogOption | null {
  if (!key) return null;
  return options.find((option) => option.key === key) ?? null;
}
