// =============================================================================
// Agent Center — the PROVIDER axis, and what each provider can actually do.
//
// CLIENT-SAFE and pure. Connection STATE is server-side (./registry.ts); this
// file is only the capability matrix, so the create flow can decide which
// providers to offer for a type without a request.
//
// A CAPABILITY IS A CLAIM WITH EVIDENCE, NOT A CHECKBOX. Each entry records
// where it came from, because "every provider supports every type" is the
// assumption this matrix exists to refuse. Checked against the providers'
// official documentation on 2026-09-25:
//
//   Bolna  — API reference documents Create/Update Voice AI Agent, Make Voice
//            AI Call, batches, executions and call webhooks. No video.
//   Sarvam — documents hosted voice and chat agents that run on your own
//            telephony (Twilio, Exotel) or a rented number, plus speech, TTS
//            and translation APIs. No first-party outbound-call API was found,
//            and no video.
//
// Adding a provider is one entry here plus an adapter — never a change to
// lib/agents/types.ts. Adding a type is the reverse. That independence is the
// whole design.
// =============================================================================
import type { AgentType } from "./types";

export const PROVIDER_IDS = ["bolna", "sarvam"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type ProviderCapability = {
  type: AgentType;
  /** Where the claim comes from, in one line. */
  evidence: string;
};

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  /**
   * Whether Scoreboad has an adapter for this provider.
   *
   * A provider can document a capability that Scoreboad cannot yet use. The
   * create flow shows such a provider, disabled and labelled, rather than
   * hiding it — hiding it would make "we haven't built it" look like "they
   * can't do it", which is a false statement about somebody else's product.
   */
  adapter: "built" | "not_built";
  capabilities: ProviderCapability[];
};

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  bolna: {
    id: "bolna",
    label: "Bolna",
    adapter: "built",
    capabilities: [
      {
        type: "voice_screening",
        evidence: "Outbound calls via Make Voice AI Call; wired into screening since Module 8.",
      },
      {
        type: "voice_interview",
        evidence: "Hosts conversational voice agents (Create Voice AI Agent). Scoreboad's interview flow isn't built.",
      },
    ],
  },
  sarvam: {
    id: "sarvam",
    label: "Sarvam",
    adapter: "not_built",
    capabilities: [
      {
        type: "voice_screening",
        evidence: "Hosted voice agents on your own telephony. No first-party outbound-call API documented.",
      },
      {
        type: "voice_interview",
        evidence: "Hosted voice agents on your own telephony. No first-party outbound-call API documented.",
      },
    ],
  },
};

export function supports(provider: ProviderId, type: AgentType): boolean {
  return PROVIDERS[provider].capabilities.some((capability) => capability.type === type);
}

export const supportsVoiceScreening = (provider: ProviderId) => supports(provider, "voice_screening");
export const supportsVoiceInterview = (provider: ProviderId) => supports(provider, "voice_interview");

/** Every provider that documents this type, built or not. */
export function providersFor(type: AgentType): ProviderDefinition[] {
  return PROVIDER_IDS.map((id) => PROVIDERS[id]).filter((provider) => supports(provider.id, type));
}

/**
 * The providers a user can actually CHOOSE for this type: documented AND with
 * an adapter built. The create flow offers only these; a documented provider
 * without an adapter gets a one-line "not available yet", never a card.
 */
export function selectableProvidersFor(type: AgentType): ProviderDefinition[] {
  return providersFor(type).filter((provider) => provider.adapter === "built");
}
