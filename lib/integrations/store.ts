// =============================================================================
// Shared integration storage.
//
// Six adapters repeat the same mechanics: load the row through the service-role
// client, decrypt, record a test result, clear on disconnect. Module 8 and
// Module 15 each wrote their own copy; this is the one they should have shared,
// extracted once there were five rather than two, and reused unchanged by the
// sixth (WhatsApp) — which is the point of having extracted it.
//
// The adapters keep their own connect()/test()/getStatus()/disconnect() —
// provider specifics stay provider-side. Only the storage is shared.
//
// EVERY FUNCTION HERE USES THE SERVICE-ROLE CLIENT, WHICH BYPASSES RLS.
// organization_id is therefore filtered explicitly on every query: that filter
// IS the tenant boundary in this file. There is no session to fall back on.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/integrations/crypto";
import { formatDbError } from "@/lib/supabase/errors";

export const PROVIDERS = ["bolna", "calendar", "email", "llm", "n8n", "whatsapp"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export type IntegrationStatus = "disconnected" | "connected" | "needs_attention" | "error";

export type CredentialMode = "platform_managed" | "organization_managed";

/**
 * Machine-readable failure reasons.
 *
 * The UI picks a remedy from these rather than parsing an English message —
 * "reconnect" and "try again in a minute" are different instructions, and
 * getting them the wrong way round wastes an admin's afternoon.
 */
export type IntegrationErrorCode =
  | "invalid_credentials"
  | "expired_oauth"
  | "provider_unreachable"
  | "provider_error"
  | "not_configured"
  | "encryption_unavailable";

export type StoredIntegration = {
  id: string;
  organization_id: string;
  provider: Provider;
  status: IntegrationStatus;
  encrypted_credentials: string | null;
  settings: Record<string, unknown>;
  credential_hint: string | null;
  credential_mode: CredentialMode;
  last_tested_at: string | null;
  last_success_at: string | null;
  error_code: IntegrationErrorCode | null;
  error_message: string | null;
  connected_by: string | null;
  updated_at: string;
};

/** Everything safe to send to a browser. Note the absent ciphertext. */
export type PublicIntegration = Omit<StoredIntegration, "encrypted_credentials">;

const COLUMNS =
  "id, organization_id, provider, status, encrypted_credentials, settings, credential_hint, " +
  "credential_mode, last_tested_at, last_success_at, error_code, error_message, connected_by, updated_at";

/**
 * Strips the ciphertext before anything crosses the wire.
 *
 * The column-level REVOKE already stops a browser reading it directly, and the
 * ciphertext would be useless without the key — but a secret that is never
 * serialised cannot be leaked by a logging middleware, an error reporter, or a
 * future endpoint that returns "the whole row".
 */
export function toPublic(integration: StoredIntegration): PublicIntegration {
  // Rebuilt field by field rather than destructured-and-spread: a new column
  // added to StoredIntegration later would be carried through automatically by
  // a spread, and the whole point of this function is that nothing reaches a
  // browser unless it was named here deliberately.
  return {
    id: integration.id,
    organization_id: integration.organization_id,
    provider: integration.provider,
    status: integration.status,
    settings: integration.settings,
    credential_hint: integration.credential_hint,
    credential_mode: integration.credential_mode,
    last_tested_at: integration.last_tested_at,
    last_success_at: integration.last_success_at,
    error_code: integration.error_code,
    error_message: integration.error_message,
    connected_by: integration.connected_by,
    updated_at: integration.updated_at,
  };
}

export async function loadIntegration(
  organizationId: string,
  provider: Provider
): Promise<StoredIntegration | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("organization_integrations")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as StoredIntegration;
}

export async function loadAllIntegrations(
  organizationId: string
): Promise<StoredIntegration[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const { data, error } = await admin
    .from("organization_integrations")
    .select(COLUMNS)
    .eq("organization_id", organizationId);

  if (error) {
    console.error(`[integrations] load all failed: ${formatDbError(error)}`);
    return [];
  }

  return (data ?? []) as unknown as StoredIntegration[];
}

export type SaveResult = { ok: true } | { ok: false; error: string; code: IntegrationErrorCode };

/**
 * Encrypts and stores a credential bundle.
 *
 * FAILS CLOSED on encryption: a secret we cannot encrypt is not stored at all.
 * Writing it in plaintext "temporarily" is how a credential ends up in a
 * database backup forever.
 */
export async function saveCredentials({
  organizationId,
  provider,
  credentials,
  credentialHint,
  settings,
  credentialMode = "organization_managed",
  connectedBy,
}: {
  organizationId: string;
  provider: Provider;
  /** Serialised and encrypted as one blob. */
  credentials: Record<string, unknown>;
  /** Masked display value, e.g. "••••4F8A". Never the secret. */
  credentialHint: string;
  settings?: Record<string, unknown>;
  credentialMode?: CredentialMode;
  connectedBy?: string | null;
}): Promise<SaveResult> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      error:
        "Server-side credential storage isn't configured. Set SUPABASE_SERVICE_ROLE_KEY to connect integrations.",
    };
  }

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      code: "encryption_unavailable",
      error:
        "Credential encryption isn't configured on this server, so credentials can't be stored.",
    };
  }

  const encrypted = await encryptSecret(JSON.stringify(credentials));
  if (!encrypted.ok) {
    return { ok: false, code: "encryption_unavailable", error: encrypted.error };
  }

  const { error } = await admin.from("organization_integrations").upsert(
    {
      organization_id: organizationId,
      provider,
      status: "connected" as IntegrationStatus,
      encrypted_credentials: encrypted.value,
      credential_hint: credentialHint,
      credential_mode: credentialMode,
      settings: settings ?? {},
      error_code: null,
      error_message: null,
      connected_by: connectedBy ?? null,
    },
    { onConflict: "organization_id,provider" }
  );

  if (error) {
    console.error(`[integrations] saving ${provider} failed: ${formatDbError(error)}`);
    return { ok: false, code: "provider_error", error: "Could not save those credentials." };
  }

  return { ok: true };
}

/** Decrypts a stored bundle. Returns null when there is nothing usable. */
export async function readCredentials<T>(
  integration: StoredIntegration | null
): Promise<T | null> {
  if (!integration?.encrypted_credentials) return null;

  const decrypted = await decryptSecret(integration.encrypted_credentials);
  if (!decrypted.ok) return null;

  try {
    return JSON.parse(decrypted.value) as T;
  } catch {
    console.error("[integrations] stored credentials are not valid JSON");
    return null;
  }
}

/** Records the outcome of a Test Connection, updating the timestamps. */
export async function recordTestResult({
  organizationId,
  provider,
  status,
  errorCode,
  errorMessage,
}: {
  organizationId: string;
  provider: Provider;
  status: IntegrationStatus;
  errorCode?: IntegrationErrorCode | null;
  errorMessage?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const now = new Date().toISOString();

  const { error } = await admin
    .from("organization_integrations")
    .update({
      status,
      last_tested_at: now,
      // last_success_at only moves on an actual success, so "when did this last
      // work?" stays answerable after a run of failures.
      ...(status === "connected" ? { last_success_at: now } : {}),
      error_code: errorCode ?? null,
      error_message: errorMessage ?? null,
    })
    .eq("organization_id", organizationId)
    .eq("provider", provider);

  if (error) console.error(`[integrations] recording ${provider} test failed: ${formatDbError(error)}`);
}

/**
 * Clears credentials and marks the integration disconnected.
 *
 * The ROW SURVIVES, with its settings and its history. Deleting it would lose
 * last_success_at and the non-secret configuration, so reconnecting would mean
 * re-entering a retry policy and a From address that were never the problem.
 */
export async function clearCredentials({
  organizationId,
  provider,
}: {
  organizationId: string;
  provider: Provider;
}): Promise<{ ok: boolean; error?: string }> {
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
    .eq("provider", provider);

  if (error) {
    console.error(`[integrations] disconnecting ${provider} failed: ${formatDbError(error)}`);
    return { ok: false, error: "Could not disconnect that integration." };
  }

  return { ok: true };
}

/** Shared shape every adapter's getStatus() returns. */
export type BaseStatus = {
  provider: Provider;
  status: IntegrationStatus;
  credentialHint: string | null;
  credentialMode: CredentialMode;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorCode: IntegrationErrorCode | null;
  errorMessage: string | null;
  /** True when this environment cannot store credentials at all. */
  encryptionUnavailable: boolean;
  settings: Record<string, unknown>;
};

export function baseStatusFrom(
  provider: Provider,
  integration: StoredIntegration | null
): BaseStatus {
  const encryptionUnavailable = !isEncryptionConfigured();

  if (!integration) {
    return {
      provider,
      status: "disconnected",
      credentialHint: null,
      credentialMode: "organization_managed",
      lastTestedAt: null,
      lastSuccessAt: null,
      errorCode: null,
      errorMessage: null,
      encryptionUnavailable,
      settings: {},
    };
  }

  return {
    provider,
    status: integration.status,
    credentialHint: integration.credential_hint,
    credentialMode: integration.credential_mode,
    lastTestedAt: integration.last_tested_at,
    lastSuccessAt: integration.last_success_at,
    errorCode: integration.error_code,
    errorMessage: integration.error_message,
    encryptionUnavailable,
    settings: integration.settings ?? {},
  };
}

/** Masks a secret for display. Shared so every adapter masks identically. */
export function maskCredential(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
