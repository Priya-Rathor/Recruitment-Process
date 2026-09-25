// =============================================================================
// Agent Center reads and writes.
//
// The SESSION client throughout, so RLS is the tenant boundary and every
// id-addressed query ALSO filters organization_id — a cross-tenant id returns
// nothing, which the routes turn into a 404 rather than a hint that it exists.
// Nothing here touches a credential or a provider-side id; the voice columns
// that hold those are revoked from browser sessions and never selected.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { formatDbError } from "@/lib/supabase/errors";
import { defaultAgentSettings, splitForStorage } from "@/lib/voice/settings";
import {
  AGENT_IN_USE_MESSAGE,
  countAgentUsage,
  DESCRIPTION_MAX,
  isAgentInUseError,
  NAME_MAX,
  normalizeConfiguration,
  type AgentInput,
} from "./config";
import {
  AGENT_TYPE_META,
  allowedStatuses,
  isAgentStatus,
  type AgentStatus,
  type AgentType,
} from "./types";
import type { ProviderId } from "./providers";

const AGENT_COLUMNS = "id, name, description, type, provider, status, configuration, updated_at";

export type Agent = {
  id: string;
  name: string;
  description: string | null;
  type: AgentType;
  provider: ProviderId | null;
  status: AgentStatus;
  configuration: Record<string, string | number>;
  updatedAt: string;
};

export type AgentListItem = Agent & {
  /** Names of the automations that reference it — where it is used. */
  usedBy: string[];
  /** Voice screening only: the organization's default dialling agent. */
  isDefaultVoice: boolean;
  /** Set for rows that live in another module's tables (WhatsApp reply). */
  manageHref: string | null;
};

export type ListResult =
  | { state: "ok"; agents: AgentListItem[] }
  /** Migration 0043 isn't applied here. Not "no agents" — a different fact. */
  | { state: "not_set_up" }
  | { state: "error" };

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  type: AgentType;
  provider: ProviderId | null;
  status: AgentStatus;
  configuration: unknown;
  updated_at: string;
};

function toAgent(row: AgentRow): Agent {
  const configuration =
    typeof row.configuration === "object" && row.configuration !== null && !Array.isArray(row.configuration)
      ? (row.configuration as Record<string, string | number>)
      : {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    provider: row.provider,
    status: row.status,
    configuration,
    updatedAt: row.updated_at,
  };
}

export async function listAgents(organizationId: string): Promise<ListResult> {
  const supabase = await createClient();

  const [agents, automations, voice, autoReply] = await Promise.all([
    supabase
      .from("agents")
      .select(AGENT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false }),
    supabase.from("automations").select("id, name, actions").eq("organization_id", organizationId),
    supabase.from("voice_agents").select("id, is_default").eq("organization_id", organizationId),
    loadWhatsAppAgent(organizationId),
  ]);

  if (agents.error) {
    if (isMissingRelation(agents.error)) return { state: "not_set_up" };
    console.error(`[agents] list failed: ${formatDbError(agents.error)}`);
    return { state: "error" };
  }
  // "Used by" is part of what a row claims. If it can't be read, say the
  // list failed rather than show every agent as unused.
  if (automations.error || voice.error) {
    console.error(`[agents] usage read failed: ${formatDbError(automations.error ?? voice.error)}`);
    return { state: "error" };
  }

  const rules = (automations.data ?? []) as { id: string; name: string; actions: unknown }[];
  const defaults = new Set(
    ((voice.data ?? []) as { id: string; is_default: boolean }[]).filter((v) => v.is_default).map((v) => v.id)
  );

  const items: AgentListItem[] = ((agents.data ?? []) as unknown as AgentRow[]).map((row) => ({
    ...toAgent(row),
    usedBy: rules.filter((rule) => countAgentUsage([rule], row.id) > 0).map((rule) => rule.name),
    isDefaultVoice: defaults.has(row.id),
    manageHref: row.type === "voice_screening" ? `/settings/agents/voice?agent=${row.id}` : null,
  }));

  if (autoReply) items.push(autoReply);
  return { state: "ok", agents: items };
}

/**
 * The existing WhatsApp auto-reply agent, as a list row.
 *
 * READ from migration 0042's tables, never copied — see EXTERNALLY_MANAGED in
 * ./types.ts. Absent until an admin has saved its organization default, so an
 * organization that never configured it doesn't see a phantom agent. Its status
 * is derived from BOTH switches, because either one stops it.
 */
async function loadWhatsAppAgent(organizationId: string): Promise<AgentListItem | null> {
  const supabase = await createClient();
  const [config, settings] = await Promise.all([
    supabase
      .from("auto_reply_config")
      .select("id, enabled, updated_at")
      .eq("organization_id", organizationId)
      .is("job_id", null)
      .maybeSingle(),
    supabase
      .from("organization_settings")
      .select("auto_reply_master_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  if (config.error || settings.error || !config.data) return null;

  const row = config.data as { id: string; enabled: boolean; updated_at: string };
  const master = (settings.data as { auto_reply_master_enabled?: boolean } | null)?.auto_reply_master_enabled;

  return {
    id: row.id,
    name: "WhatsApp auto-reply",
    description: AGENT_TYPE_META.whatsapp_reply.purpose,
    type: "whatsapp_reply",
    provider: null,
    status: row.enabled && master === true ? "active" : "paused",
    configuration: {},
    updatedAt: row.updated_at,
    usedBy: [],
    isDefaultVoice: false,
    manageHref: "/settings/agents/whatsapp",
  };
}

export async function getAgent(organizationId: string, id: string): Promise<Agent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (!isMissingRelation(error)) console.error(`[agents] read failed: ${formatDbError(error)}`);
    return null;
  }
  return data ? toAgent(data as unknown as AgentRow) : null;
}

type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/**
 * Creates an agent as a DRAFT. Activation is always a separate, explicit act.
 *
 * A voice screening agent is two rows with one id: the identity here, and its
 * voice_agents extension carrying the call settings the console edits. Its
 * instructions go into the VOICE row's system prompt — the one the dialling
 * path actually sends — and are not duplicated into `configuration`, because
 * two copies would disagree the first time the console edited one.
 */
export async function createAgent({
  organizationId,
  createdBy,
  input,
}: {
  organizationId: string;
  createdBy: string;
  input: AgentInput;
}): Promise<WriteResult<Agent>> {
  const supabase = await createClient();
  const isVoice = input.type === "voice_screening";

  const { data, error } = await supabase
    .from("agents")
    .insert({
      organization_id: organizationId,
      created_by: createdBy,
      name: input.name,
      description: input.description,
      type: input.type,
      provider: input.provider,
      status: "draft",
      configuration: isVoice ? {} : input.configuration,
    })
    .select(AGENT_COLUMNS)
    .single();

  if (error || !data) {
    if (error && isMissingRelation(error)) {
      return { ok: false, error: "The Agent Center isn't set up on this server yet.", status: 503 };
    }
    console.error(`[agents] create failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't create that agent.", status: 500 };
  }

  const agent = toAgent(data as unknown as AgentRow);
  if (!isVoice) return { ok: true, value: agent };

  const settings = defaultAgentSettings();
  settings.general.name = input.name;
  settings.brain.systemPrompt = String(input.configuration.instructions ?? settings.brain.systemPrompt);

  const voice = await supabase
    .from("voice_agents")
    .insert({ id: agent.id, organization_id: organizationId, created_by: createdBy, ...splitForStorage(settings) });

  if (voice.error) {
    // Undo the identity row, so a half-created agent can't appear in the list
    // with no call settings behind it.
    console.error(`[agents] voice extension failed: ${formatDbError(voice.error)}`);
    await supabase.from("agents").delete().eq("organization_id", organizationId).eq("id", agent.id);
    return { ok: false, error: "Couldn't create the agent's call settings.", status: 500 };
  }

  return { ok: true, value: agent };
}

export type AgentPatch = {
  name?: unknown;
  description?: unknown;
  status?: unknown;
  configuration?: unknown;
};

/** Validates and applies an edit. Untrusted input; the type comes from the stored row. */
export async function updateAgent({
  organizationId,
  id,
  patch,
}: {
  organizationId: string;
  id: string;
  patch: AgentPatch;
}): Promise<WriteResult<Agent>> {
  const existing = await getAgent(organizationId, id);
  if (!existing) return { ok: false, error: "That agent doesn't exist.", status: 404 };

  const update: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (!name || name.length > NAME_MAX) {
      return { ok: false, error: `Give the agent a name under ${NAME_MAX} characters.`, status: 400 };
    }
    update.name = name;
  }

  if (patch.description !== undefined) {
    if (patch.description !== null && typeof patch.description !== "string") {
      return { ok: false, error: "The description must be text.", status: 400 };
    }
    const description = (patch.description ?? "").trim();
    if (description.length > DESCRIPTION_MAX) {
      return { ok: false, error: `Keep the description under ${DESCRIPTION_MAX} characters.`, status: 400 };
    }
    update.description = description || null;
  }

  if (patch.status !== undefined) {
    if (!isAgentStatus(patch.status) || !allowedStatuses(existing.type).includes(patch.status)) {
      return {
        ok: false,
        error: AGENT_TYPE_META[existing.type].blockedReason ?? "That status isn't available for this agent.",
        status: 400,
      };
    }
    update.status = patch.status;
  }

  if (patch.configuration !== undefined) {
    if (existing.type === "voice_screening") {
      return { ok: false, error: "Edit a voice agent's call settings in the voice console.", status: 400 };
    }
    const configuration = normalizeConfiguration(existing.type, patch.configuration);
    if (!configuration.ok) return { ok: false, error: configuration.error, status: 400 };
    update.configuration = configuration.value;
  }

  if (Object.keys(update).length === 0) return { ok: true, value: existing };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .update(update)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(AGENT_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    console.error(`[agents] update failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't save that agent.", status: 500 };
  }
  return { ok: true, value: toAgent(data as unknown as AgentRow) };
}

export async function deleteAgent(organizationId: string, id: string): Promise<WriteResult<null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("id");

  if (error) {
    if (isAgentInUseError(error)) return { ok: false, error: AGENT_IN_USE_MESSAGE, status: 409 };
    console.error(`[agents] delete failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't delete that agent.", status: 500 };
  }
  if (!data || data.length === 0) return { ok: false, error: "That agent doesn't exist.", status: 404 };
  return { ok: true, value: null };
}
