// =============================================================================
// Voice agent reads and writes.
//
// One tenant-scoped place for the console's page, its API routes and the dialling
// path. Everything here uses the SESSION client, so RLS is the boundary — except
// the two functions that must touch the provider columns, which say so and use
// the admin client with an explicit organization_id filter.
//
// THE COLUMN LIST IS EXPLICIT, ALWAYS.
//
// `provider` and `provider_agent_id` have column-level SELECT revoked from
// `authenticated` (migration 0034). A `select("*")` through the session client
// would therefore fail outright rather than quietly omitting them — which is the
// behaviour we want, but it means every query here names its columns. That is not
// a style choice: it is what keeps a provider identifier out of a page payload
// even if someone later adds a route that returns "the whole row".
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { formatDbError } from "@/lib/supabase/errors";
import { normalizeStageConfig, type AiScreeningConfig } from "@/lib/hiring-stages/config";
import { DEFAULT_SCREENING_SETTINGS, getOrganizationSettings } from "@/lib/settings/queries";
import {
  defaultAgentSettings,
  settingsFromRow,
  splitForStorage,
  type AgentSettings,
} from "@/lib/voice/settings";
import type { JobScreeningOverrides, OrgCallDataContext } from "@/lib/voice/callData";

/** Everything about an agent that is safe to send to a browser. */
export type VoiceAgent = {
  id: string;
  isDefault: boolean;
  /** True when the last save reached the provider. */
  synced: boolean;
  lastSyncedAt: string | null;
  /** Plain sentence, safe to display. Never a provider payload. */
  syncError: string | null;
  updatedAt: string | null;
  settings: AgentSettings;
};

const AGENT_COLUMNS =
  "id, name, purpose, company_name, caller_number, is_default, config, default_call_data, " +
  "last_synced_at, sync_error, updated_at";

type AgentRow = {
  id: string;
  name: string;
  purpose: string;
  company_name: string | null;
  caller_number: string | null;
  is_default: boolean;
  config: unknown;
  default_call_data: unknown;
  last_synced_at: string | null;
  sync_error: string | null;
  updated_at: string | null;
};

function toVoiceAgent(row: AgentRow, companyName: string | null): VoiceAgent {
  return {
    id: row.id,
    isDefault: row.is_default,
    // Synced means "the provider has this version". A row that saved locally and
    // failed upstream is NOT synced, and the console says so rather than showing
    // a bare success toast over a half-completed save.
    synced: row.last_synced_at !== null && row.sync_error === null,
    lastSyncedAt: row.last_synced_at,
    syncError: row.sync_error,
    updatedAt: row.updated_at,
    settings: settingsFromRow(row, { companyName }),
  };
}

export type ListAgentsResult = {
  agents: VoiceAgent[];
  /** True when the table isn't there yet — a build state, not an error. */
  notBuilt: boolean;
  failed: boolean;
};

/**
 * Every configured agent, default first then by name.
 *
 * A missing table is reported as `notBuilt` rather than as a failure or as an
 * empty list: "you have no agents" and "migration 0034 hasn't been applied" are
 * different facts, and the console shows different things for each.
 */
export async function listVoiceAgents({
  organizationId,
  companyName,
}: {
  organizationId: string;
  companyName: string | null;
}): Promise<ListAgentsResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_agents")
    .select(AGENT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingRelation(error)) {
      console.info("[voice] voice_agents not created yet — run migration 0034.");
      return { agents: [], notBuilt: true, failed: false };
    }
    console.error(`[voice] listing agents failed: ${formatDbError(error)}`);
    return { agents: [], notBuilt: false, failed: true };
  }

  return {
    agents: (data ?? []).map((row) => toVoiceAgent(row as unknown as AgentRow, companyName)),
    notBuilt: false,
    failed: false,
  };
}

export async function getVoiceAgent({
  organizationId,
  agentId,
  companyName,
}: {
  organizationId: string;
  agentId: string;
  companyName: string | null;
}): Promise<VoiceAgent | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_agents")
    .select(AGENT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();

  if (error || !data) return null;
  return toVoiceAgent(data as unknown as AgentRow, companyName);
}

/**
 * Creates an agent with the defaults.
 *
 * `is_default` is left to the database: migration 0034's trigger makes the first
 * agent an organization has the default, so there is no window in which a
 * tenant's calls have no agent to resolve.
 */
export async function createVoiceAgent({
  organizationId,
  createdBy,
  companyName,
  name,
}: {
  organizationId: string;
  createdBy: string;
  companyName: string | null;
  name?: string;
}): Promise<{ ok: true; agent: VoiceAgent } | { ok: false; error: string }> {
  const supabase = await createClient();

  const settings = defaultAgentSettings({ companyName });
  if (name?.trim()) settings.general.name = name.trim().slice(0, 120);

  const { data, error } = await supabase
    .from("voice_agents")
    .insert({
      organization_id: organizationId,
      created_by: createdBy,
      ...splitForStorage(settings),
    })
    .select(AGENT_COLUMNS)
    .single();

  if (error || !data) {
    if (error && isMissingRelation(error)) {
      return { ok: false, error: "Voice agents aren't set up on this server yet." };
    }
    console.error(`[voice] creating agent failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't create that agent." };
  }

  return { ok: true, agent: toVoiceAgent(data as unknown as AgentRow, companyName) };
}

/**
 * Persists the whole form in ONE statement.
 *
 * The console has a single Save button and no per-section saves, so a partial
 * write has no user-visible meaning — either the agent is as the admin left it or
 * the save failed and the form keeps their edits.
 *
 * `syncError` is written by the caller AFTER it has tried the provider, so the
 * stored row always says truthfully whether the provider has this version.
 */
export async function saveVoiceAgent({
  organizationId,
  agentId,
  settings,
  makeDefault,
}: {
  organizationId: string;
  agentId: string;
  settings: AgentSettings;
  makeDefault?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("voice_agents")
    .update({
      ...splitForStorage(settings),
      ...(makeDefault ? { is_default: true } : {}),
    })
    .eq("organization_id", organizationId)
    .eq("id", agentId);

  if (error) {
    console.error(`[voice] saving agent failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't save these settings." };
  }

  return { ok: true };
}

export async function deleteVoiceAgent({
  organizationId,
  agentId,
}: {
  organizationId: string;
  agentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("voice_agents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", agentId);

  if (error) {
    console.error(`[voice] deleting agent failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't delete that agent." };
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// PROVIDER-SIDE columns. Admin client, explicit organization_id filter.
// -----------------------------------------------------------------------------

/** Reads the provider agent id. Never returned to a browser. */
export async function readProviderAgentId({
  organizationId,
  agentId,
}: {
  organizationId: string;
  agentId: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("voice_agents")
    .select("provider_agent_id")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();

  return (data as { provider_agent_id: string | null } | null)?.provider_agent_id ?? null;
}

/**
 * Records the outcome of a provider sync.
 *
 * Both halves in one write, so "synced at" and "the error that stopped it" can
 * never disagree: a success clears the error, a failure leaves last_synced_at
 * where it was and stores the reason.
 */
export async function recordProviderSync({
  organizationId,
  agentId,
  providerAgentId,
  error,
}: {
  organizationId: string;
  agentId: string;
  providerAgentId?: string | null;
  error?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const { error: writeError } = await admin
    .from("voice_agents")
    .update({
      ...(providerAgentId ? { provider_agent_id: providerAgentId, last_synced_at: new Date().toISOString() } : {}),
      sync_error: error ?? null,
    })
    .eq("organization_id", organizationId)
    .eq("id", agentId);

  if (writeError) {
    console.error(`[voice] recording sync failed: ${formatDbError(writeError)}`);
  }
}

// -----------------------------------------------------------------------------
// The precedence inputs.
// -----------------------------------------------------------------------------

/**
 * The organization side of the Default Call Data comparison.
 *
 * Reads the DEFAULT agent, because that is the agent that dials. Falls back to
 * platform defaults when no agent exists, so a job's screening call keeps working
 * for an organization that has never opened the console.
 */
export async function loadOrgCallDataContext({
  organizationId,
  companyName,
}: {
  organizationId: string;
  companyName: string | null;
}): Promise<OrgCallDataContext> {
  const [{ agents }, { settings: orgSettings }] = await Promise.all([
    listVoiceAgents({ organizationId, companyName }),
    getOrganizationSettings(organizationId),
  ]);

  const screening = orgSettings.screening_settings ?? DEFAULT_SCREENING_SETTINGS;
  const agent = agents.find((candidate) => candidate.isDefault) ?? agents[0] ?? null;
  const fallback = defaultAgentSettings({ companyName });

  return {
    callData: agent?.settings.callData ?? fallback.callData,
    orgLanguage: screening.language,
    orgMaxAttempts: screening.maxAttempts,
    agentSystemPrompt: agent?.settings.brain.systemPrompt ?? "",
    agentCompanyName: agent?.settings.general.companyName ?? companyName,
  };
}

/**
 * The job side: exactly the fields Module 3's AI Screening Call stage holds.
 *
 * Nothing new is stored per job for this feature — the spec's instruction is to
 * connect to that configuration, not to duplicate it, so this reads the same rows
 * the Hiring Stages screen writes and the same question list Module 8 dials with.
 */
export async function loadJobScreeningOverrides({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<JobScreeningOverrides | null> {
  const supabase = await createClient();

  const [jobResult, stageResult, questionResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, client:clients(name)")
      .eq("organization_id", organizationId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("job_hiring_stages")
      .select("enabled, prompt_template, config")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .eq("stage_key", "ai_screening_call")
      .maybeSingle(),
    supabase
      .from("job_screening_questions")
      .select("question, display_order")
      .eq("job_id", jobId)
      .order("display_order", { ascending: true }),
  ]);

  if (jobResult.error || !jobResult.data) return null;

  const job = jobResult.data as unknown as {
    id: string;
    title: string;
    client: { name: string } | null;
  };

  const stage = (stageResult.data ?? null) as {
    enabled: boolean;
    prompt_template: string | null;
    config: unknown;
  } | null;

  const config = normalizeStageConfig("ai_screening_call", stage?.config) as AiScreeningConfig;

  return {
    jobId: job.id,
    jobTitle: job.title,
    screeningEnabled: stage?.enabled === true,
    questions: ((questionResult.data ?? []) as { question: string }[]).map((row) => row.question),
    language: config.language,
    maxAttempts: config.maxAttempts,
    promptTemplate: stage?.prompt_template ?? null,
    clientName: job.client?.name ?? null,
  };
}

export type PreviewJobOption = {
  id: string;
  title: string;
  /** Shown in the picker so a job with screening off is not a confusing pick. */
  screeningEnabled: boolean;
};

/**
 * Jobs offered in the precedence preview's picker.
 *
 * Jobs with AI screening ENABLED come first, because those are the ones where
 * the precedence rule actually decides something. A job with it switched off is
 * still selectable — seeing "this job would use every org default" is a useful
 * answer too.
 */
export async function listPreviewJobs({
  organizationId,
  limit = 25,
}: {
  organizationId: string;
  limit?: number;
}): Promise<PreviewJobOption[]> {
  const supabase = await createClient();

  const [jobsResult, stagesResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("job_hiring_stages")
      .select("job_id, enabled")
      .eq("organization_id", organizationId)
      .eq("stage_key", "ai_screening_call")
      .eq("enabled", true),
  ]);

  if (jobsResult.error) {
    console.error(`[voice] listing preview jobs failed: ${formatDbError(jobsResult.error)}`);
    return [];
  }

  const enabled = new Set(
    ((stagesResult.data ?? []) as { job_id: string }[]).map((row) => row.job_id)
  );

  return ((jobsResult.data ?? []) as { id: string; title: string }[])
    .map((job) => ({ id: job.id, title: job.title, screeningEnabled: enabled.has(job.id) }))
    .sort((a, b) => Number(b.screeningEnabled) - Number(a.screeningEnabled));
}

// -----------------------------------------------------------------------------
// Test calls.
// -----------------------------------------------------------------------------

export type TestCall = {
  id: string;
  status: string;
  phoneNumber: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  failureReason: string | null;
  createdAt: string;
};

const TEST_CALL_COLUMNS =
  "id, status, phone_number, started_at, ended_at, duration_seconds, transcript, " +
  "failure_reason, created_at";

type TestCallRow = {
  id: string;
  status: string;
  phone_number: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  failure_reason: string | null;
  created_at: string;
};

function toTestCall(row: TestCallRow): TestCall {
  return {
    id: row.id,
    status: row.status,
    phoneNumber: row.phone_number,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    transcript: row.transcript,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

/** Counts test calls in the trailing hour, for the hard cap. */
export async function countRecentTestCalls({
  organizationId,
}: {
  organizationId: string;
}): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("voice_agent_test_calls")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", since);

  if (error) {
    // FAILS CLOSED. A cap we cannot count is a cap we cannot enforce, and the
    // thing being capped telephones people — so an unknown count is treated as
    // "at the limit" rather than as zero.
    console.error(`[voice] counting test calls failed: ${formatDbError(error)}`);
    return Number.MAX_SAFE_INTEGER;
  }

  return count ?? 0;
}

export async function createTestCall({
  organizationId,
  agentId,
  phoneNumber,
  requestedBy,
}: {
  organizationId: string;
  agentId: string;
  phoneNumber: string;
  requestedBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_agent_test_calls")
    .insert({
      organization_id: organizationId,
      voice_agent_id: agentId,
      phone_number: phoneNumber,
      status: "queued",
      requested_by: requestedBy,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[voice] creating test call failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't record the test call." };
  }

  return { ok: true, id: (data as { id: string }).id };
}

export async function getTestCall({
  organizationId,
  testCallId,
}: {
  organizationId: string;
  testCallId: string;
}): Promise<TestCall | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_agent_test_calls")
    .select(TEST_CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", testCallId)
    .maybeSingle();

  if (error || !data) return null;
  return toTestCall(data as unknown as TestCallRow);
}

export async function getLatestTestCall({
  organizationId,
  agentId,
}: {
  organizationId: string;
  agentId: string;
}): Promise<TestCall | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_agent_test_calls")
    .select(TEST_CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("voice_agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return toTestCall(data as unknown as TestCallRow);
}

/**
 * Marks a test call's provider outcome.
 *
 * Admin client because voice_agent_test_calls has NO update policy — see the
 * migration. A row's status and transcript are written by the provider path only,
 * never by a browser session.
 */
export async function markTestCall({
  organizationId,
  testCallId,
  status,
  providerCallId,
  failureReason,
}: {
  organizationId: string;
  testCallId: string;
  status: string;
  providerCallId?: string | null;
  failureReason?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const now = new Date().toISOString();

  const { error } = await admin
    .from("voice_agent_test_calls")
    .update({
      status,
      ...(providerCallId ? { provider_call_id: providerCallId, started_at: now } : {}),
      ...(failureReason ? { failure_reason: failureReason, ended_at: now } : {}),
    })
    .eq("organization_id", organizationId)
    .eq("id", testCallId);

  if (error) console.error(`[voice] marking test call failed: ${formatDbError(error)}`);
}
