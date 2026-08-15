// =============================================================================
// Email integration adapter.
//
// Same shape as lib/integrations/bolna: connect / test / getStatus / disconnect,
// plus a send. Credentials are AES-GCM encrypted in organization_integrations
// and only reachable through the service-role client, exactly as Bolna's are.
//
// FAILS CLOSED. AGENTS.md: "Anything that contacts a real person (calls, emails,
// SMS) fails closed: disconnected by default, explicit confirmation in the UI, a
// hard attempt cap." So:
//
//   - there is no default provider and no fallback SMTP; not configured means
//     not sent, reported as `skipped` rather than silently dropped
//   - sendEmail() refuses unless the integration is explicitly connected
//   - it never throws, because a failed email must not take down the in-app
//     notification it accompanies
//
// Module 17 will replace the credential storage without changing these
// signatures.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
  maskSecret,
} from "@/lib/integrations/crypto";

export const EMAIL_PROVIDER = "email";

export type IntegrationStatus = "disconnected" | "connected" | "needs_attention" | "error";

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type EmailStatus = {
  status: IntegrationStatus;
  credentialHint: string | null;
  /** The verified From address, so the UI can show what recipients will see. */
  fromAddress: string | null;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
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

// Resend's API shape. Swappable: only this file knows the provider.
const EMAIL_API_URL = process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";

/**
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
    .eq("provider", EMAIL_PROVIDER)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as StoredIntegration;
}

/** Current connection state. Never returns the credential itself. */
export async function getStatus(organizationId: string): Promise<EmailStatus> {
  const encryptionUnavailable = !isEncryptionConfigured();
  const integration = await loadIntegration(organizationId);

  if (!integration) {
    return {
      status: "disconnected",
      credentialHint: null,
      fromAddress: null,
      lastTestedAt: null,
      lastSuccessAt: null,
      errorMessage: null,
      encryptionUnavailable,
    };
  }

  return {
    status: integration.status,
    credentialHint: integration.credential_hint,
    fromAddress:
      typeof integration.settings?.fromAddress === "string"
        ? (integration.settings.fromAddress as string)
        : null,
    lastTestedAt: integration.last_tested_at,
    lastSuccessAt: integration.last_success_at,
    errorMessage: integration.error_message,
    encryptionUnavailable,
  };
}

export async function connect({
  organizationId,
  apiKey,
  fromAddress,
  fromName,
  connectedBy,
}: {
  organizationId: string;
  apiKey: string;
  fromAddress: string;
  fromName?: string;
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
  const trimmedFrom = fromAddress.trim().toLowerCase();

  if (trimmedKey.length < 8) return { ok: false, error: "That API key looks too short." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedFrom)) {
    return { ok: false, error: "Enter a valid From address." };
  }

  // Fails closed: we do not store a secret we cannot encrypt.
  const encrypted = await encryptSecret(JSON.stringify({ apiKey: trimmedKey }));
  if (!encrypted.ok) return { ok: false, error: encrypted.error };

  const credentialHint = maskSecret(trimmedKey);

  const { error } = await admin.from("organization_integrations").upsert(
    {
      organization_id: organizationId,
      provider: EMAIL_PROVIDER,
      status: "connected" as IntegrationStatus,
      encrypted_credentials: encrypted.value,
      credential_hint: credentialHint,
      // The From address is not a secret — it is on every message sent.
      settings: { fromAddress: trimmedFrom, fromName: fromName?.trim() || null },
      error_code: null,
      error_message: null,
      connected_by: connectedBy ?? null,
    },
    { onConflict: "organization_id,provider" }
  );

  if (error) {
    console.error("[email] connect failed:", error);
    return { ok: false, error: "Could not save those credentials." };
  }

  return { ok: true, data: { credentialHint } };
}

/**
 * Safe health check — validates the key against the provider's own account
 * endpoint. Deliberately NOT a test send: a "test" that emails a real person is
 * not a test.
 */
export async function test(
  organizationId: string
): Promise<AdapterResult<{ status: IntegrationStatus }>> {
  const admin = createAdminClient();
  const integration = await loadIntegration(organizationId);

  if (!admin || !integration?.encrypted_credentials) {
    return { ok: false, error: "Email isn't connected yet." };
  }

  const credentials = await decryptSecret(integration.encrypted_credentials);
  if (!credentials.ok) return { ok: false, error: credentials.error };

  const { apiKey } = JSON.parse(credentials.value) as { apiKey: string };
  const now = new Date().toISOString();

  try {
    const response = await fetch(`${EMAIL_API_URL.replace(/\/emails$/, "")}/domains`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const status: IntegrationStatus = response.status === 401 ? "error" : "needs_attention";
      const message =
        response.status === 401
          ? "The email provider rejected the API key."
          : `The email provider returned an error (${response.status}).`;

      await admin
        .from("organization_integrations")
        .update({
          status,
          last_tested_at: now,
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
    console.error("[email] test failed:", error);
    await admin
      .from("organization_integrations")
      .update({
        status: "error" as IntegrationStatus,
        last_tested_at: now,
        error_code: "provider_unreachable",
        error_message: "Could not reach the email provider.",
      })
      .eq("id", integration.id);

    return { ok: false, error: "Could not reach the email provider. Try again shortly." };
  }
}

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
    .eq("provider", EMAIL_PROVIDER);

  if (error) {
    console.error("[email] disconnect failed:", error);
    return { ok: false, error: "Could not disconnect email." };
  }

  return { ok: true, data: null };
}

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  /** The integration isn't connected. A state, not a failure. */
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

/**
 * Sends one email.
 *
 * NEVER THROWS. The caller has already written the in-app notification, and an
 * exception here would roll back a request that has, in the part that matters,
 * already succeeded.
 *
 * `skipped` is distinguished from `error` because the two mean different things
 * to whoever reads the delivery row: skipped means "connect the integration",
 * failed means "something went wrong, look at it".
 */
export async function sendEmail({
  organizationId,
  to,
  subject,
  body,
}: {
  organizationId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<SendEmailResult> {
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      return { ok: false, skipped: false, error: "That recipient address isn't valid." };
    }

    const integration = await loadIntegration(organizationId);

    if (!integration || integration.status !== "connected" || !integration.encrypted_credentials) {
      return {
        ok: false,
        skipped: true,
        reason: "Email isn't connected, so nothing was sent. The in-app notification was created.",
      };
    }

    const credentials = await decryptSecret(integration.encrypted_credentials);
    if (!credentials.ok) {
      return { ok: false, skipped: false, error: credentials.error };
    }

    const { apiKey } = JSON.parse(credentials.value) as { apiKey: string };
    const fromAddress = integration.settings?.fromAddress as string | undefined;

    if (!fromAddress) {
      return {
        ok: false,
        skipped: true,
        reason: "No From address is configured, so nothing was sent.",
      };
    }

    const fromName = integration.settings?.fromName as string | undefined;
    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    const response = await fetch(EMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to.trim()], subject, text: body }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      console.error("[email] send rejected:", response.status, await response.text());
      return {
        ok: false,
        skipped: false,
        error:
          response.status === 401
            ? "The email provider rejected the API key. Reconnect the integration."
            : "The email provider could not send that message.",
      };
    }

    const payload = (await response.json()) as { id?: string };
    return { ok: true, providerMessageId: payload.id ?? "unknown" };
  } catch (error) {
    console.error("[email] send failed:", error);
    return { ok: false, skipped: false, error: "Could not reach the email provider." };
  }
}
