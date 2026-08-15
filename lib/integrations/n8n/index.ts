// =============================================================================
// n8n adapter.
//
// WHAT n8n ACTUALLY IS IN THIS PRODUCT TODAY.
//
// The spec's stack names n8n as the automation executor. Module 13 does NOT use
// it: the automation engine runs in-process, deliberately, because routing
// execution through an unprovisioned external orchestrator would mean every
// rule silently failed while the UI reported success (see
// docs/modules/13-automations-notes.md).
//
// That decision stands. This adapter therefore does something narrower and
// truthful: it lets an Owner record an n8n instance and shows whether it is
// reachable, which is what the spec's "n8n health is visible" asks for. It does
// not claim to execute anything.
//
// getStatus() returns `not_used_for_execution: true` so the settings card can
// say so plainly. An integration card reading "Connected" beside an engine that
// never calls it would be the kind of quiet lie this codebase keeps avoiding.
// =============================================================================
import {
  baseStatusFrom,
  clearCredentials,
  loadIntegration,
  maskCredential,
  readCredentials,
  recordTestResult,
  saveCredentials,
  type BaseStatus,
  type IntegrationStatus,
} from "@/lib/integrations/store";
import { describeDbError } from "@/lib/supabase/errors";

export const N8N_PROVIDER = "n8n" as const;

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type N8nStatus = BaseStatus & {
  instanceUrl: string | null;
  /**
   * Always true today. Module 13 executes automations in-process; this
   * connection is monitored, not used.
   */
  notUsedForExecution: boolean;
};

type N8nCredentials = { apiKey: string };

export async function getStatus(organizationId: string): Promise<N8nStatus> {
  const integration = await loadIntegration(organizationId, N8N_PROVIDER);
  const base = baseStatusFrom(N8N_PROVIDER, integration);

  return {
    ...base,
    instanceUrl: typeof base.settings.instanceUrl === "string" ? base.settings.instanceUrl : null,
    notUsedForExecution: true,
  };
}

export async function connect({
  organizationId,
  instanceUrl,
  apiKey,
  connectedBy,
}: {
  organizationId: string;
  instanceUrl: string;
  apiKey: string;
  connectedBy?: string | null;
}): Promise<AdapterResult<{ credentialHint: string }>> {
  const trimmedUrl = instanceUrl.trim().replace(/\/+$/, "");
  const trimmedKey = apiKey.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    return { ok: false, error: "Enter a valid n8n instance URL." };
  }

  // https only. An API key sent to an http endpoint is a key sent in clear text
  // over whatever network sits between here and there.
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "The n8n instance URL must use https." };
  }

  if (trimmedKey.length < 8) {
    return { ok: false, error: "That API key looks too short." };
  }

  const credentialHint = maskCredential(trimmedKey);

  const saved = await saveCredentials({
    organizationId,
    provider: N8N_PROVIDER,
    credentials: { apiKey: trimmedKey } satisfies N8nCredentials,
    credentialHint,
    // The URL is not a secret — it appears in every request — so it lives in
    // settings where the UI can show it without a decrypt.
    settings: { instanceUrl: trimmedUrl },
    connectedBy,
  });

  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, data: { credentialHint } };
}

/** Health check against n8n's own health endpoint. Executes no workflow. */
export async function test(
  organizationId: string
): Promise<AdapterResult<{ status: IntegrationStatus }>> {
  const integration = await loadIntegration(organizationId, N8N_PROVIDER);
  const credentials = await readCredentials<N8nCredentials>(integration);
  const instanceUrl = integration?.settings?.instanceUrl as string | undefined;

  if (!credentials || !instanceUrl) {
    return { ok: false, error: "n8n isn't connected yet." };
  }

  try {
    const response = await fetch(`${instanceUrl}/api/v1/workflows?limit=1`, {
      method: "GET",
      headers: { "X-N8N-API-KEY": credentials.apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const invalid = response.status === 401 || response.status === 403;
      const message = invalid
        ? "n8n rejected that API key."
        : `n8n returned an error (${response.status}).`;

      await recordTestResult({
        organizationId,
        provider: N8N_PROVIDER,
        status: invalid ? "error" : "needs_attention",
        errorCode: invalid ? "invalid_credentials" : "provider_error",
        errorMessage: message,
      });

      return { ok: false, error: message };
    }

    await recordTestResult({ organizationId, provider: N8N_PROVIDER, status: "connected" });
    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error("[n8n] test failed:", describeDbError(error));
    await recordTestResult({
      organizationId,
      provider: N8N_PROVIDER,
      status: "error",
      errorCode: "provider_unreachable",
      errorMessage: "Could not reach that n8n instance.",
    });

    return { ok: false, error: "Could not reach that n8n instance. Check the URL and try again." };
  }
}

export async function disconnect(organizationId: string): Promise<AdapterResult<null>> {
  const result = await clearCredentials({ organizationId, provider: N8N_PROVIDER });
  if (!result.ok) return { ok: false, error: result.error ?? "Could not disconnect." };
  return { ok: true, data: null };
}
