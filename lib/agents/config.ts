// =============================================================================
// Agent Center — per-type configuration, and the one validator for it.
//
// CLIENT-SAFE and pure. The create flow renders its Step 3 from CONFIG_FIELDS
// and the API validates with normalizeAgentInput() — the same list, so a field
// the form shows is a field the server accepts, and nothing else is. A type
// never shows a field that belongs to another.
//
// Provider credentials are NOT configuration and have no field here. They live
// in the encrypted integration store (lib/integrations/store.ts) and never come
// near this object.
// =============================================================================
import { AGENT_TYPE_META, isAgentType, type AgentType } from "./types";
import { isProviderId, PROVIDERS, supports, type ProviderId } from "./providers";

export type ConfigField = {
  key: string;
  label: string;
  help?: string;
  kind: "textarea" | "number";
  required: boolean;
  /** Text: max characters. Number: the inclusive range. */
  max: number;
  min?: number;
  step?: number;
};

const instructions = (label: string, help: string, max = 8000): ConfigField => ({
  key: "instructions",
  label,
  help,
  kind: "textarea",
  required: true,
  max,
});

const criteria: ConfigField = {
  key: "criteria",
  label: "Evaluation criteria",
  help: "What a strong answer looks like. One criterion per line.",
  kind: "textarea",
  required: false,
  max: 4000,
};

export const CONFIG_FIELDS: Record<AgentType, ConfigField[]> = {
  voice_screening: [
    instructions(
      "Call instructions",
      "How the agent runs the call. The questions themselves come from each job's screening questions.",
    ),
  ],
  voice_interview: [
    instructions("Interview instructions", "How the agent conducts the interview."),
    { ...criteria, key: "structure", label: "Interview structure", help: "The sections of the interview, in order. One per line." },
    criteria,
  ],
  video_interview: [
    instructions("Interview instructions", "How the agent conducts the interview."),
    { ...criteria, key: "structure", label: "Interview structure", help: "The sections of the interview, in order. One per line." },
    criteria,
  ],
  // Configured on its own page (see EXTERNALLY_MANAGED); never stored here.
  whatsapp_reply: [],
  email_reply: [
    instructions("Reply instructions", "What the agent may answer, and when it should hand over to a person.", 4000),
    {
      key: "tone",
      label: "Tone",
      help: "For example: warm and brief, first name, no exclamation marks.",
      kind: "textarea",
      required: false,
      max: 2000,
    },
  ],
  assessment: [
    instructions("Instructions", "What the agent is given and how it should work."),
    {
      key: "objective",
      label: "Objective",
      help: "What this assessment is meant to find out.",
      kind: "textarea",
      required: true,
      max: 2000,
    },
    { ...criteria, required: true },
  ],
  universal: [instructions("Instructions", "What the agent does.")],
  custom_llm: [
    instructions("System instructions", "The agent's standing instructions."),
    {
      key: "temperature",
      label: "Temperature",
      help: "0 is the most consistent, 1 the most varied. The platform default is 0.2.",
      kind: "number",
      required: false,
      min: 0,
      max: 1,
      step: 0.1,
    },
  ],
};

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 1000;

export type AgentInput = {
  type: AgentType;
  provider: ProviderId | null;
  name: string;
  description: string | null;
  configuration: Record<string, string | number>;
};

export type NormalizeResult = { ok: true; value: AgentInput } | { ok: false; error: string };

/**
 * Validates a create request. Untrusted input: every field is narrowed here.
 *
 * REFUSES rather than clamps. Unlike the voice console's normaliser — where
 * silently fixing a slider beats losing a form — this is a create action, and
 * an agent saved with different instructions from the ones typed is worse
 * than an error message.
 */
export function normalizeAgentInput(raw: unknown): NormalizeResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Send the agent as JSON." };
  const body = raw as Record<string, unknown>;

  if (!isAgentType(body.type)) return { ok: false, error: "Choose an agent type." };
  const type = body.type;

  if (type === "whatsapp_reply") {
    return { ok: false, error: "The WhatsApp agent is set up on its own settings page." };
  }

  // Provider: required exactly when the type takes one, refused otherwise.
  let provider: ProviderId | null = null;
  if (AGENT_TYPE_META[type].dependency.kind === "provider") {
    if (type === "video_interview") {
      if (body.provider !== undefined && body.provider !== null) {
        return { ok: false, error: "No video interview provider is available yet." };
      }
    } else {
      if (!isProviderId(body.provider)) return { ok: false, error: "Choose a provider." };
      if (!supports(body.provider, type)) {
        return { ok: false, error: `${PROVIDERS[body.provider].label} doesn't support this agent type.` };
      }
      if (PROVIDERS[body.provider].adapter !== "built") {
        return { ok: false, error: `${PROVIDERS[body.provider].label} isn't available in Scoreboad yet.` };
      }
      provider = body.provider;
    }
  } else if (body.provider !== undefined && body.provider !== null) {
    return { ok: false, error: "This agent type doesn't use a provider." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Give the agent a name." };
  if (name.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") return { ok: false, error: "The description must be text." };
    const trimmed = body.description.trim();
    if (trimmed.length > DESCRIPTION_MAX) {
      return { ok: false, error: `Keep the description under ${DESCRIPTION_MAX} characters.` };
    }
    description = trimmed || null;
  }

  const configuration = normalizeConfiguration(type, body.configuration);
  if (!configuration.ok) return configuration;

  return { ok: true, value: { type, provider, name, description, configuration: configuration.value } };
}

/** Validates the type-specific part alone. Unknown keys are refused, not dropped. */
export function normalizeConfiguration(
  type: AgentType,
  raw: unknown
): { ok: true; value: Record<string, string | number> } | { ok: false; error: string } {
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "The configuration must be an object." };
  }
  const fields = CONFIG_FIELDS[type];
  const known = new Set(fields.map((field) => field.key));
  const entries = input as Record<string, unknown>;

  for (const key of Object.keys(entries)) {
    if (!known.has(key)) return { ok: false, error: `"${key}" isn't a setting for this agent type.` };
  }

  const value: Record<string, string | number> = {};
  for (const field of fields) {
    const given = entries[field.key];
    const empty = given === undefined || given === null || given === "";

    if (empty) {
      if (field.required) return { ok: false, error: `${field.label} is required.` };
      continue;
    }

    if (field.kind === "number") {
      const number = typeof given === "number" ? given : Number(given);
      if (!Number.isFinite(number) || number < (field.min ?? 0) || number > field.max) {
        return { ok: false, error: `${field.label} must be between ${field.min ?? 0} and ${field.max}.` };
      }
      value[field.key] = number;
      continue;
    }

    if (typeof given !== "string") return { ok: false, error: `${field.label} must be text.` };
    const trimmed = given.trim();
    if (!trimmed) {
      if (field.required) return { ok: false, error: `${field.label} is required.` };
      continue;
    }
    if (trimmed.length > field.max) {
      return { ok: false, error: `Keep ${field.label.toLowerCase()} under ${field.max} characters.` };
    }
    value[field.key] = trimmed;
  }

  return { ok: true, value };
}

/**
 * How many automations (stage workflows included — they are automation rows)
 * reference this agent. Pure, so the list and the delete guard agree.
 *
 * Mirrors the SQL in migration 0043's delete guard: any action whose config
 * names the agent, whatever the action type.
 */
export function countAgentUsage(automations: { actions: unknown }[], agentId: string): number {
  return automations.filter((automation) =>
    Array.isArray(automation.actions) &&
    automation.actions.some(
      (action) =>
        typeof action === "object" &&
        action !== null &&
        typeof (action as { config?: unknown }).config === "object" &&
        (action as { config: Record<string, unknown> | null }).config?.agent_id === agentId
    )
  ).length;
}

export const AGENT_IN_USE_MESSAGE =
  "This agent is currently used by one or more workflows. Remove its assignments before deleting it.";

/** True for migration 0043's delete guard, whichever table the delete started from. */
export function isAgentInUseError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23503" && error.message === "agent_in_use";
}
