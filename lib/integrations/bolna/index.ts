// =============================================================================
// Bolna integration adapter.
//
// The spec's forward-stub for Module 8: "Build the lib/integrations/bolna/
// adapter now and have placeCall() read credentials from a minimal
// organization_integrations table ... even before Module 17 builds the full
// settings UI around that same table."
//
// This is the ONLY place that talks to Bolna. Module 13's automation action must
// call placeCall() rather than re-implementing the API call, and Module 17 must
// replace the credential storage WITHOUT changing these signatures.
//
// Exposes the standard adapter shape every integration in this product uses:
//   connect / test / getStatus / disconnect  (+ placeCall, specific to Bolna)
//
// SAFETY: this dials real people. It refuses to place a call unless the
// integration is explicitly connected, the script passes its compliance check,
// and the retry cap allows it. There is no default that dials.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, isEncryptionConfigured, maskSecret } from "@/lib/integrations/crypto";
import { assertScriptIsCompliant, buildCallScript, type CallScript } from "@/lib/screening/script";
import { normalizeRetryPolicy, type RetryPolicy } from "@/lib/screening/retry";
import { formatDbError } from "@/lib/supabase/errors";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { decideDialingAgent, type DialingDecision } from "@/lib/voice/dialing";
import type { AgentStatus } from "@/lib/agents/types";
// MODULE 24. Neutral types in, provider shapes built in agentMapping.ts — see
// the section at the foot of this file.
import type { AgentSettings } from "@/lib/voice/settings";
import { degradedCatalog, type AgentCatalog, type CatalogOption } from "@/lib/voice/catalog";
import {
  AMBIENCE_TRACKS,
  ambienceOptions,
  extractCatalogArray,
  parseCatalogEntry,
  resolveCatalogKey,
  toProviderAgentPayload,
  type ResolvedProviderIds,
} from "@/lib/integrations/bolna/agentMapping";

export const BOLNA_PROVIDER = "bolna";

export type IntegrationStatus = "disconnected" | "connected" | "needs_attention" | "error";

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type BolnaStatus = {
  status: IntegrationStatus;
  credentialHint: string | null;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
  retryPolicy: RetryPolicy;
  /** True when this environment cannot store credentials at all. */
  encryptionUnavailable: boolean;
};

type StoredIntegration = {
  id: string;
  status: IntegrationStatus;
  encrypted_credentials: string | null;
  settings: Record<string, unknown>;
  credential_hint: string | null;
  last_tested_at: string | null;
  last_success_at: string | null;
  error_message: string | null;
};

const BOLNA_BASE_URL = process.env.BOLNA_BASE_URL ?? "https://api.bolna.dev";

/**
 * Loads the integration row, including ciphertext, via the service-role client.
 *
 * organization_id is filtered explicitly because this client bypasses RLS —
 * that filter IS the tenant boundary here.
 */
async function loadIntegration(organizationId: string): Promise<StoredIntegration | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("organization_integrations")
    .select(
      "id, status, encrypted_credentials, settings, credential_hint, last_tested_at, last_success_at, error_message"
    )
    .eq("organization_id", organizationId)
    .eq("provider", BOLNA_PROVIDER)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as StoredIntegration;
}

/** Current connection state. Never returns the credential itself. */
export async function getStatus(organizationId: string): Promise<BolnaStatus> {
  const encryptionUnavailable = !isEncryptionConfigured();
  const integration = await loadIntegration(organizationId);

  if (!integration) {
    return {
      status: "disconnected",
      credentialHint: null,
      lastTestedAt: null,
      lastSuccessAt: null,
      errorMessage: null,
      retryPolicy: normalizeRetryPolicy(null),
      encryptionUnavailable,
    };
  }

  return {
    status: integration.status,
    credentialHint: integration.credential_hint,
    lastTestedAt: integration.last_tested_at,
    lastSuccessAt: integration.last_success_at,
    errorMessage: integration.error_message,
    retryPolicy: normalizeRetryPolicy(integration.settings?.retryPolicy),
    encryptionUnavailable,
  };
}

/**
 * Stores credentials. Returns only masked metadata, per the spec's credential
 * pattern: "the backend must never return a complete API key to the browser".
 */
export async function connect({
  organizationId,
  apiKey,
  agentId,
  settings,
  connectedBy,
}: {
  organizationId: string;
  apiKey: string;
  agentId: string;
  settings?: Record<string, unknown>;
  /** MODULE 17: recorded for the audit trail. Optional, so no caller broke. */
  connectedBy?: string | null;
}): Promise<AdapterResult<{ credentialHint: string }>> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      error:
        "Server-side credential storage isn't configured. Set SUPABASE_SERVICE_ROLE_KEY to connect integrations.",
    };
  }

  const trimmedKey = apiKey.trim();
  const trimmedAgent = agentId.trim();
  if (trimmedKey.length < 8) return { ok: false, error: "That API key looks too short." };
  if (trimmedAgent.length === 0) return { ok: false, error: "An agent ID is required." };

  // Fails closed: we do not store a secret we cannot encrypt.
  const encrypted = await encryptSecret(JSON.stringify({ apiKey: trimmedKey, agentId: trimmedAgent }));
  if (!encrypted.ok) return { ok: false, error: encrypted.error };

  const credentialHint = maskSecret(trimmedKey);

  const { error } = await admin.from("organization_integrations").upsert(
    {
      organization_id: organizationId,
      provider: BOLNA_PROVIDER,
      status: "connected" as IntegrationStatus,
      encrypted_credentials: encrypted.value,
      credential_hint: credentialHint,
      settings: settings ?? {},
      error_code: null,
      error_message: null,
      connected_by: connectedBy ?? null,
    },
    { onConflict: "organization_id,provider" }
  );

  if (error) {
    console.error(`[bolna] connect failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not save those credentials." };
  }

  return { ok: true, data: { credentialHint } };
}

/**
 * Safe health check — a config read, NOT a real call. The spec is explicit:
 * "makes a safe provider health/config check (not a real candidate call for
 * Bolna, unless explicitly required)".
 */
export async function test(organizationId: string): Promise<AdapterResult<{ status: IntegrationStatus }>> {
  const admin = createAdminClient();
  const integration = await loadIntegration(organizationId);

  if (!admin || !integration?.encrypted_credentials) {
    return { ok: false, error: "Bolna isn't connected yet." };
  }

  const credentials = await decryptSecret(integration.encrypted_credentials);
  if (!credentials.ok) return { ok: false, error: credentials.error };

  const { apiKey } = JSON.parse(credentials.value) as { apiKey: string };
  const now = new Date().toISOString();

  try {
    const response = await fetch(`${BOLNA_BASE_URL}/v2/agent/all`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const status: IntegrationStatus = response.status === 401 ? "error" : "needs_attention";
      const message =
        response.status === 401
          ? "Bolna rejected the API key."
          : `Bolna returned an error (${response.status}).`;

      await admin
        .from("organization_integrations")
        .update({
          status,
          last_tested_at: now,
          // MODULE 17: machine-readable, so the settings card offers
          // "reconnect" rather than "try again" for a rejected key.
          error_code: response.status === 401 ? "invalid_credentials" : "provider_error",
          error_message: message,
        })
        .eq("id", integration.id);

      // Plain message; the raw provider body is never shown to a user.
      return { ok: false, error: message };
    }

    await admin
      .from("organization_integrations")
      .update({
        status: "connected" as IntegrationStatus,
        last_tested_at: now,
        last_success_at: now,
        error_code: null,
        error_message: null,
      })
      .eq("id", integration.id);

    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error(`[bolna] test failed: ${formatDbError(error)}`);
    await admin
      .from("organization_integrations")
      .update({
        status: "error" as IntegrationStatus,
        last_tested_at: now,
        error_code: "provider_unreachable",
        error_message: "Could not reach Bolna.",
      })
      .eq("id", integration.id);

    return { ok: false, error: "Could not reach Bolna. Check the network and try again." };
  }
}

/** Clears the credentials and marks the integration disconnected. */
export async function disconnect(organizationId: string): Promise<AdapterResult<null>> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Server-side credential storage isn't configured." };

  const { error } = await admin
    .from("organization_integrations")
    .update({
      status: "disconnected" as IntegrationStatus,
      encrypted_credentials: null,
      credential_hint: null,
      error_code: null,
      error_message: null,
      connected_by: null,
    })
    .eq("organization_id", organizationId)
    .eq("provider", BOLNA_PROVIDER);

  if (error) {
    console.error(`[bolna] disconnect failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not disconnect Bolna." };
  }

  return { ok: true, data: null };
}

export type PlaceCallInput = {
  organizationId: string;
  /** Our screening_calls row id, echoed back by the webhook. */
  screeningCallId: string;
  phoneNumber: string;
  script: CallScript;
  language?: string;
  webhookUrl: string;
  /**
   * MODULE 24. The resolved call-data context — org defaults with the job's own
   * settings already taking priority (lib/voice/callData.ts).
   *
   * OPTIONAL, and its absence changes nothing: omitting it produces exactly the
   * payload this adapter sent before the console existed, which is why every
   * existing caller still holds.
   */
  callContext?: Record<string, string>;
  /**
   * MODULE 25. The voice_agents row this call should use, chosen on the stage
   * workflow — a "CV Shortlisting Agent" persona on one stage, a "Technical
   * Screening Agent" on another.
   *
   * OPTIONAL, and its absence is the pre-Module-25 behaviour exactly: fall back
   * to the console's default agent, then to the id captured when the integration
   * was connected. See resolveDialingAgentId().
   */
  voiceAgentId?: string | null;
};

/**
 * Keys the call payload owns, which Default Call Data may not overwrite.
 *
 * An admin typing `script` or `questions` into the Default Call Data section
 * would otherwise replace the compliance-checked script with arbitrary text
 * AFTER assertScriptIsCompliant() had passed — a hole with a text box in front of
 * it. Dropped silently here, and the console warns about the key at edit time.
 */
function stripReservedContextKeys(
  context: Record<string, string> | undefined
): Record<string, string> {
  if (!context) return {};
  const reserved = new Set(["script", "questions", "language", "is_test"]);
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => !reserved.has(key))
  );
}

/**
 * Places the call.
 *
 * Module 13's automation action must call THIS — the spec is explicit that it
 * "must call it directly, not re-implement it". Module 17 may change how
 * credentials are stored but not this signature.
 *
 * Three gates before anything dials, in order of how badly they'd fail:
 *   1. the script must pass its compliance check (consent disclosure present)
 *   2. the integration must be explicitly connected
 *   3. the phone number must be plausible
 */
export async function placeCall(
  input: PlaceCallInput
): Promise<AdapterResult<{ providerCallId: string }>> {
  // Compliance first. A non-compliant script must not reach a person even if
  // everything else is perfectly configured.
  const compliance = assertScriptIsCompliant(input.script);
  if (!compliance.ok) {
    return { ok: false, error: compliance.reason };
  }

  const digits = input.phoneNumber.replace(/\D/g, "");
  if (digits.length < 8) {
    return { ok: false, error: "That phone number doesn't look dialable." };
  }

  const integration = await loadIntegration(input.organizationId);
  if (!integration || integration.status !== "connected" || !integration.encrypted_credentials) {
    return {
      ok: false,
      error: "Bolna isn't connected. Connect it before starting screening calls.",
    };
  }

  const credentials = await decryptSecret(integration.encrypted_credentials);
  if (!credentials.ok) return { ok: false, error: credentials.error };

  const { apiKey, agentId } = JSON.parse(credentials.value) as {
    apiKey: string;
    agentId: string;
  };

  /*
    MODULE 24: the agent the Voice Agent Console marked as default is the one
    that dials, falling back to the id captured at connect time.

    This is what makes the console real rather than decorative — configuring an
    agent nobody calls with would be a settings page that changes nothing. An
    organization that has never opened the console resolves to exactly the id it
    used before.
  */
  const dialing = await resolveDialingAgentId(
    input.organizationId,
    agentId,
    input.voiceAgentId ?? null
  );
  if (!dialing.ok) return { ok: false, error: dialing.reason };
  const dialingAgentId = dialing.providerAgentId;

  try {
    const response = await fetch(`${BOLNA_BASE_URL}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: dialingAgentId,
        recipient_phone_number: input.phoneNumber,
        // Echoed back on the webhook so we can reconcile without trusting the
        // payload's own idea of which call it is.
        metadata: { screening_call_id: input.screeningCallId },
        webhook_url: input.webhookUrl,
        user_data: {
          script: input.script.fullText,
          questions: input.script.questions,
          language: input.language ?? "en",
          // Spread LAST but guarded: the resolved call data must not be able to
          // replace the script or the question list, whatever key an admin typed
          // into Default Call Data.
          ...stripReservedContextKeys(input.callContext),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error("[bolna] placeCall rejected:", response.status, await response.text());
      return {
        ok: false,
        error:
          response.status === 401
            ? "Bolna rejected the API key. Reconnect the integration."
            : "Bolna could not start the call. Try again shortly.",
      };
    }

    const payload = (await response.json()) as { call_id?: string; id?: string };
    const providerCallId = payload.call_id ?? payload.id;

    if (!providerCallId) {
      return { ok: false, error: "Bolna accepted the call but returned no call id." };
    }

    return { ok: true, data: { providerCallId } };
  } catch (error) {
    // The spec's test: "failure to reach Bolna degrades gracefully without
    // crashing the application record". Never throws.
    console.error(`[bolna] placeCall failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not reach Bolna. The call was not placed." };
  }
}

// =============================================================================
// MODULE 24 — Voice Agent Console.
//
// Three additions, following the connect/test/getStatus/placeCall pattern above
// rather than opening a second integration path:
//
//   listAgentCatalog()   the model / voice / speech-recognition options the
//                        console's dropdowns are populated from
//   updateAgentConfig()  pushes a neutral AgentSettings object to the provider
//   placeTestCall()      the console's "Call me" button
//
// EVERYTHING PROVIDER-SHAPED STAYS ON THIS SIDE OF THE BOUNDARY. The functions
// take and return neutral types (AgentSettings, AgentCatalog) — the mapping to
// the provider's own schema is lib/integrations/bolna/agentMapping.ts, and the
// opaque catalogue keys the browser sees are minted there too.
// =============================================================================

/**
 * Catalogue endpoints, tried in order until one answers.
 *
 * A LIST rather than a single path, deliberately: provider catalogue routes move
 * between versions, and an admin whose voice dropdown is empty cannot tell a
 * renamed endpoint from an outage. Trying the known candidates and degrading
 * honestly when none answer is the difference between "we could not load these"
 * and a silently empty list that reads as "there are no voices".
 *
 * Override with BOLNA_CATALOG_PATHS (comma-separated, prefixed `kind:path`) when
 * a deployment's provider account exposes them elsewhere — no redeploy needed.
 */
const DEFAULT_CATALOG_PATHS: Record<"model" | "voice" | "stt", string[]> = {
  voice: ["/v2/voices", "/voices", "/v2/synthesizer/voices"],
  model: ["/v2/models", "/models", "/v2/llm/models"],
  stt: ["/v2/transcriber/models", "/v2/languages", "/languages"],
};

function catalogPaths(kind: "model" | "voice" | "stt"): string[] {
  const override = process.env.BOLNA_CATALOG_PATHS;
  if (!override) return DEFAULT_CATALOG_PATHS[kind];

  const configured = override
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${kind}:`))
    .map((entry) => entry.slice(kind.length + 1))
    .filter((path) => path.startsWith("/"));

  return configured.length > 0 ? configured : DEFAULT_CATALOG_PATHS[kind];
}

/** The decrypted bundle. Never returned to a caller outside this file. */
type BolnaCredentials = { apiKey: string; agentId: string };

async function readApiKey(
  organizationId: string
): Promise<{ ok: true; credentials: BolnaCredentials } | { ok: false; error: string }> {
  const integration = await loadIntegration(organizationId);

  if (!integration || integration.status !== "connected" || !integration.encrypted_credentials) {
    return { ok: false, error: "The voice provider isn't connected yet." };
  }

  const decrypted = await decryptSecret(integration.encrypted_credentials);
  if (!decrypted.ok) return { ok: false, error: decrypted.error };

  try {
    const credentials = JSON.parse(decrypted.value) as BolnaCredentials;
    if (!credentials.apiKey) return { ok: false, error: "Stored credentials are incomplete." };
    return { ok: true, credentials };
  } catch {
    return { ok: false, error: "Stored credentials could not be read." };
  }
}

/**
 * Fetches one catalogue list.
 *
 * Returns the neutral options AND the provider ids they were minted from, so the
 * caller can resolve a saved key back without a second round trip.
 */
async function fetchCatalogList(
  kind: "model" | "voice" | "stt",
  apiKey: string
): Promise<{ options: CatalogOption[]; sourceIds: string[] } | null> {
  for (const path of catalogPaths(kind)) {
    try {
      const response = await fetch(`${BOLNA_BASE_URL}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) continue;

      const entries = extractCatalogArray(await response.json());
      const options: CatalogOption[] = [];
      const sourceIds: string[] = [];
      const seen = new Set<string>();

      for (const entry of entries) {
        const parsed = parseCatalogEntry(kind, entry);
        if (!parsed || seen.has(parsed.option.key)) continue;
        seen.add(parsed.option.key);
        options.push(parsed.option);
        sourceIds.push(parsed.sourceId);
      }

      if (options.length === 0) continue;

      options.sort((a, b) => a.label.localeCompare(b.label));
      return { options, sourceIds };
    } catch {
      // Try the next candidate path. A single unreachable endpoint is not proof
      // the provider is down.
      continue;
    }
  }

  return null;
}

/**
 * The console's dropdown options.
 *
 * NEVER THROWS and never invents an option. When the provider cannot be reached
 * the result is `degraded: true` with a plain reason and empty lists, and the
 * console keeps whatever the agent already had selected — the architecture rule
 * about not reporting a fake zero applies just as much to a fake list of voices.
 */
export async function listAgentCatalog(organizationId: string): Promise<AgentCatalog> {
  const credentials = await readApiKey(organizationId);
  if (!credentials.ok) {
    return degradedCatalog(credentials.error);
  }

  const [voices, models, stt] = await Promise.all([
    fetchCatalogList("voice", credentials.credentials.apiKey),
    fetchCatalogList("model", credentials.credentials.apiKey),
    fetchCatalogList("stt", credentials.credentials.apiKey),
  ]);

  // Ambience is a fixed set in the provider's schema rather than a served list,
  // so it is always available — including while the rest is degraded.
  const ambience = ambienceOptions();

  if (!voices && !models && !stt) {
    return {
      ...degradedCatalog(
        "Voice and model options couldn't be loaded from the provider just now. Your saved selections are unchanged."
      ),
      ambience,
    };
  }

  return {
    models: models?.options ?? [],
    voices: voices?.options ?? [],
    stt: stt?.options ?? [],
    ambience,
    // Partial success is still degraded: an empty Voice dropdown beside a full
    // Model one needs to say why.
    degraded: !voices || !models || !stt,
    reason:
      !voices || !models || !stt
        ? "Some option lists couldn't be loaded from the provider. Your saved selections are unchanged."
        : null,
  };
}

/**
 * Resolves the opaque catalogue keys in a settings object back to provider ids.
 *
 * Re-fetches the catalogue rather than keeping a mapping table, so a key that
 * refers to a voice the provider has retired resolves to null — "use the account
 * default" — instead of to a stale id the provider would reject.
 */
async function resolveIds(
  organizationId: string,
  settings: AgentSettings,
  apiKey: string
): Promise<ResolvedProviderIds> {
  const [voices, models, stt] = await Promise.all([
    settings.voice.voiceKey ? fetchCatalogList("voice", apiKey) : null,
    settings.brain.modelKey ? fetchCatalogList("model", apiKey) : null,
    settings.speech.sttKey ? fetchCatalogList("stt", apiKey) : null,
  ]);

  return {
    voice: resolveCatalogKey("voice", settings.voice.voiceKey, voices?.sourceIds ?? []),
    model: resolveCatalogKey("model", settings.brain.modelKey, models?.sourceIds ?? []),
    stt: resolveCatalogKey("stt", settings.speech.sttKey, stt?.sourceIds ?? []),
    ambienceTrack: resolveCatalogKey(
      "amb",
      settings.behavior.ambienceTrackKey,
      AMBIENCE_TRACKS.map((track) => track.id)
    ),
  };
}

export type UpdateAgentConfigInput = {
  organizationId: string;
  settings: AgentSettings;
  /** The provider's id for this agent, when it has already been created there. */
  providerAgentId: string | null;
  /** Where the provider should report call outcomes. */
  webhookUrl: string;
};

/**
 * Pushes an agent configuration to the provider.
 *
 * Creates on first save (no providerAgentId yet), updates thereafter. Returns the
 * provider's id so the caller can store it.
 *
 * Never throws. A provider failure comes back as `ok: false` with a message safe
 * to show a user — the console then keeps the form populated and says the save
 * did not reach the provider, rather than reporting success over a failure.
 */
export async function updateAgentConfig(
  input: UpdateAgentConfigInput
): Promise<AdapterResult<{ providerAgentId: string }>> {
  const credentials = await readApiKey(input.organizationId);
  if (!credentials.ok) return { ok: false, error: credentials.error };

  const { apiKey } = credentials.credentials;

  const ids = await resolveIds(input.organizationId, input.settings, apiKey);
  const payload = toProviderAgentPayload({
    settings: input.settings,
    ids,
    webhookUrl: input.webhookUrl,
  });

  const creating = !input.providerAgentId;
  const url = creating
    ? `${BOLNA_BASE_URL}/v2/agent`
    : `${BOLNA_BASE_URL}/v2/agent/${encodeURIComponent(input.providerAgentId!)}`;

  try {
    const response = await fetch(url, {
      method: creating ? "POST" : "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // Logged server-side in full; the caller gets a plain sentence. The raw
      // provider body never reaches a browser.
      console.error(
        `[bolna] updateAgentConfig rejected: ${response.status} ${await response.text()}`
      );
      return {
        ok: false,
        error:
          response.status === 401
            ? "The voice provider rejected the stored credentials. Reconnect the integration."
            : "The voice provider wouldn't accept this configuration. It's saved here and can be retried.",
      };
    }

    const body = (await response.json()) as { agent_id?: string; id?: string };
    const providerAgentId = body.agent_id ?? body.id ?? input.providerAgentId;

    if (!providerAgentId) {
      return {
        ok: false,
        error: "The voice provider accepted the configuration but returned no agent reference.",
      };
    }

    return { ok: true, data: { providerAgentId } };
  } catch (error) {
    console.error(`[bolna] updateAgentConfig failed: ${formatDbError(error)}`);
    return {
      ok: false,
      error: "Couldn't reach the voice provider. Your settings are saved here and can be synced later.",
    };
  }
}

/**
 * The provider agent id that should actually dial for this organization.
 *
 * Prefers the console's DEFAULT agent, falling back to the id captured when the
 * integration was connected. That fallback is what keeps Module 8 working
 * unchanged for an organization that has never opened this console — and it is
 * why placeCall()'s signature did not have to change.
 *
 * Reads a column whose SELECT is revoked from every browser session, so this must
 * stay server-side.
 */
async function resolveDialingAgentId(
  organizationId: string,
  credentialAgentId: string,
  /**
   * MODULE 25. A specific agent named by a stage workflow. Takes priority over
   * the organization default, because it is the more specific statement: "this
   * stage uses the Technical Screening persona" is a decision about this call,
   * and the default is a decision about calls in general.
   *
   * An id that does not resolve falls back to the default rather than failing
   * the call. A deleted agent must not silently stop a pipeline from dialling —
   * and the run log records which agent was used either way.
   */
  requestedAgentId: string | null = null
): Promise<DialingDecision> {
  const admin = createAdminClient();
  if (!admin) return { ok: true, providerAgentId: credentialAgentId };

  // organization_id is filtered explicitly on every read: this is the admin
  // client, so RLS is off and an agent id from a rule is not proof of tenancy.
  const readVoice = (column: "id" | "is_default", value: string | boolean) =>
    admin
      .from("voice_agents")
      .select("id, provider_agent_id")
      .eq("organization_id", organizationId)
      .eq(column, value)
      .maybeSingle();

  const [requested, fallback] = await Promise.all([
    requestedAgentId ? readVoice("id", requestedAgentId) : Promise.resolve(null),
    readVoice("is_default", true),
  ]);

  const rows = [requested?.data, fallback?.data].filter(Boolean) as {
    id: string;
    provider_agent_id: string | null;
  }[];

  // MIGRATION 0043: the Agent Center's status. A missing table (0043 not yet
  // applied) means null status, which decideDialingAgent() treats as the
  // pre-0043 behaviour exactly. Any OTHER read failure refuses the call — an
  // unknown status must not be read as "active" on the path that phones people.
  const statuses = new Map<string, AgentStatus>();
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("agents")
      .select("id, status")
      .eq("organization_id", organizationId)
      .in("id", rows.map((row) => row.id));
    if (error && !isMissingRelation(error)) {
      console.error(`[bolna] agent status read failed: ${formatDbError(error)}`);
      return { ok: false, reason: "Couldn't confirm the voice agent is active. The call was not placed." };
    }
    for (const row of (data ?? []) as { id: string; status: AgentStatus }[]) statuses.set(row.id, row.status);
  }

  const candidate = (row: { id: string; provider_agent_id: string | null } | null | undefined) =>
    row ? { providerAgentId: row.provider_agent_id, status: statuses.get(row.id) ?? null } : null;

  return decideDialingAgent({
    requested: candidate(requested?.data as { id: string; provider_agent_id: string | null } | null),
    fallbackDefault: candidate(fallback?.data as { id: string; provider_agent_id: string | null } | null),
    credentialAgentId,
  });
}

/** How many test calls one organization may place in a rolling hour. */
export const TEST_CALL_HOURLY_CAP = 10;

export type PlaceTestCallInput = {
  organizationId: string;
  /** Our voice_agent_test_calls row id, echoed back by the webhook. */
  testCallId: string;
  phoneNumber: string;
  settings: AgentSettings;
  providerAgentId: string | null;
  webhookUrl: string;
};

/**
 * Places the console's test call.
 *
 * SAME THREE GATES AS placeCall(), for the same reason: this dials a real
 * telephone. The callee is usually the admin's own handset, which changes who is
 * inconvenienced by a mistake but not whether the disclosure is required — the
 * opening line still states the call is automated and may be recorded, because
 * the person answering may not be the person who pressed the button.
 *
 * The hourly cap lives with the caller (it needs to count rows); what is enforced
 * here is connection, compliance and a dialable number.
 */
export async function placeTestCall(
  input: PlaceTestCallInput
): Promise<AdapterResult<{ providerCallId: string }>> {
  const digits = input.phoneNumber.replace(/\D/g, "");
  if (digits.length < 8) {
    return { ok: false, error: "That phone number doesn't look dialable." };
  }

  const credentials = await readApiKey(input.organizationId);
  if (!credentials.ok) return { ok: false, error: credentials.error };

  const agentId = input.providerAgentId?.trim() || credentials.credentials.agentId;
  if (!agentId) {
    return {
      ok: false,
      error: "Save this agent first — there's nothing configured at the provider to call with yet.",
    };
  }

  // The disclosure is not optional, and it is built by the same function every
  // candidate call uses rather than written out here.
  const script = buildCallScript({
    candidateName: "there",
    jobTitle: "a test of your voice agent settings",
    organizationName: input.settings.general.companyName ?? "your team",
    questions: [
      "This is a configuration test, so there's nothing you need to answer — but say a sentence or two if you'd like to check how the transcript reads.",
    ],
    instructions: input.settings.brain.systemPrompt,
  });

  const compliance = assertScriptIsCompliant(script);
  if (!compliance.ok) return { ok: false, error: compliance.reason };

  try {
    const response = await fetch(`${BOLNA_BASE_URL}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        recipient_phone_number: input.phoneNumber,
        // Namespaced differently from a screening call so the webhook can tell a
        // test from a candidate call without guessing.
        metadata: { voice_agent_test_call_id: input.testCallId },
        webhook_url: input.webhookUrl,
        user_data: {
          script: script.fullText,
          questions: script.questions,
          is_test: true,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error("[bolna] placeTestCall rejected:", response.status, await response.text());
      return {
        ok: false,
        error:
          response.status === 401
            ? "The voice provider rejected the stored credentials. Reconnect the integration."
            : "The voice provider couldn't start the test call. Try again shortly.",
      };
    }

    const body = (await response.json()) as { call_id?: string; id?: string };
    const providerCallId = body.call_id ?? body.id;
    if (!providerCallId) {
      return { ok: false, error: "The test call was accepted but no call reference came back." };
    }

    return { ok: true, data: { providerCallId } };
  } catch (error) {
    console.error(`[bolna] placeTestCall failed: ${formatDbError(error)}`);
    return { ok: false, error: "Couldn't reach the voice provider. No call was placed." };
  }
}
