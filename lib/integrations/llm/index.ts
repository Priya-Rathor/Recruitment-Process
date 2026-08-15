// =============================================================================
// LLM provider adapter.
//
// Completes the adapter set the spec names:
// lib/integrations/{bolna, calendar, email, llm, n8n}/.
//
// A NOTE ON WHAT THIS DOES AND DOESN'T CONTROL TODAY.
//
// lib/ai/provider.ts is the single place an LLM is called, and it reads its key
// from OPENAI_API_KEY in the server environment. This adapter lets an Owner
// store a per-organization key and see its health — but provider.ts does NOT yet
// read from here, because doing so would mean every AI call in the product
// makes a database round trip and a decrypt first, and would change the
// signature of a function eleven modules already depend on.
//
// So `getStatus()` reports the truth of the situation rather than a convenient
// fiction: it distinguishes "this organization has stored its own key" from
// "the server has an environment key" from "AI is unavailable". The settings UI
// says which is in force. Wiring provider.ts to prefer the stored key is a
// follow-up recorded in docs/modules/17-settings-notes.md.
//
// Reporting "connected" here while provider.ts silently used a different key
// would be the worse outcome — an admin would rotate a key and see no change.
// =============================================================================
import { isAiConfigured } from "@/lib/ai/provider";
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

export const LLM_PROVIDER = "llm" as const;

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type LlmStatus = BaseStatus & {
  /** Which key the product would actually use for the next AI call. */
  activeSource: "organization_key" | "server_environment" | "none";
  model: string | null;
};

type LlmCredentials = { apiKey: string };

const DEFAULT_BASE_URL = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";

export async function getStatus(organizationId: string): Promise<LlmStatus> {
  const integration = await loadIntegration(organizationId, LLM_PROVIDER);
  const base = baseStatusFrom(LLM_PROVIDER, integration);

  const serverConfigured = isAiConfigured();
  const orgConnected = base.status === "connected";

  return {
    ...base,
    // Honest ordering: today provider.ts uses the server key regardless, so a
    // stored organization key is reported as stored, not as active.
    activeSource: serverConfigured
      ? "server_environment"
      : orgConnected
        ? "organization_key"
        : "none",
    model: typeof base.settings.model === "string" ? base.settings.model : null,
  };
}

export async function connect({
  organizationId,
  apiKey,
  model,
  connectedBy,
}: {
  organizationId: string;
  apiKey: string;
  model?: string;
  connectedBy?: string | null;
}): Promise<AdapterResult<{ credentialHint: string }>> {
  const trimmed = apiKey.trim();
  if (trimmed.length < 16) {
    return { ok: false, error: "That API key looks too short." };
  }

  const credentialHint = maskCredential(trimmed);

  const saved = await saveCredentials({
    organizationId,
    provider: LLM_PROVIDER,
    credentials: { apiKey: trimmed } satisfies LlmCredentials,
    credentialHint,
    settings: { model: model?.trim() || "gpt-4o-mini" },
    connectedBy,
  });

  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, data: { credentialHint } };
}

/**
 * Safe health check: lists models. A config read, not a completion — a "test"
 * that generated tokens would cost money every time someone pressed it.
 */
export async function test(
  organizationId: string
): Promise<AdapterResult<{ status: IntegrationStatus }>> {
  const integration = await loadIntegration(organizationId, LLM_PROVIDER);
  const credentials = await readCredentials<LlmCredentials>(integration);

  if (!credentials) {
    return { ok: false, error: "No AI provider key is stored for this organization." };
  }

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const invalid = response.status === 401 || response.status === 403;
      const message = invalid
        ? "The AI provider rejected that key."
        : `The AI provider returned an error (${response.status}).`;

      await recordTestResult({
        organizationId,
        provider: LLM_PROVIDER,
        status: invalid ? "error" : "needs_attention",
        errorCode: invalid ? "invalid_credentials" : "provider_error",
        errorMessage: message,
      });

      // Plain message; the raw provider body is never shown to a user.
      return { ok: false, error: message };
    }

    await recordTestResult({
      organizationId,
      provider: LLM_PROVIDER,
      status: "connected",
    });

    return { ok: true, data: { status: "connected" } };
  } catch (error) {
    console.error("[llm] test failed:", error);
    await recordTestResult({
      organizationId,
      provider: LLM_PROVIDER,
      status: "error",
      errorCode: "provider_unreachable",
      errorMessage: "Could not reach the AI provider.",
    });

    return { ok: false, error: "Could not reach the AI provider. Try again shortly." };
  }
}

export async function disconnect(organizationId: string): Promise<AdapterResult<null>> {
  const result = await clearCredentials({ organizationId, provider: LLM_PROVIDER });
  if (!result.ok) return { ok: false, error: result.error ?? "Could not disconnect." };
  return { ok: true, data: null };
}
