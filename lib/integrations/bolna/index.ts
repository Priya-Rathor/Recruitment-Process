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
import { assertScriptIsCompliant, type CallScript } from "@/lib/screening/script";
import { normalizeRetryPolicy, type RetryPolicy } from "@/lib/screening/retry";

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
}: {
  organizationId: string;
  apiKey: string;
  agentId: string;
  settings?: Record<string, unknown>;
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
      error_message: null,
    },
    { onConflict: "organization_id,provider" }
  );

  if (error) {
    console.error("[bolna] connect failed:", error);
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
        .update({ status, last_tested_at: now, error_message: message })
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
        error_message: null,
      })
      .eq("id", integration.id);

    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error("[bolna] test failed:", error);
    await admin
      .from("organization_integrations")
      .update({
        status: "error" as IntegrationStatus,
        last_tested_at: now,
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
      error_message: null,
    })
    .eq("organization_id", organizationId)
    .eq("provider", BOLNA_PROVIDER);

  if (error) {
    console.error("[bolna] disconnect failed:", error);
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
};

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

  try {
    const response = await fetch(`${BOLNA_BASE_URL}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        recipient_phone_number: input.phoneNumber,
        // Echoed back on the webhook so we can reconcile without trusting the
        // payload's own idea of which call it is.
        metadata: { screening_call_id: input.screeningCallId },
        webhook_url: input.webhookUrl,
        user_data: {
          script: input.script.fullText,
          questions: input.script.questions,
          language: input.language ?? "en",
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
    console.error("[bolna] placeCall failed:", error);
    return { ok: false, error: "Could not reach Bolna. The call was not placed." };
  }
}
