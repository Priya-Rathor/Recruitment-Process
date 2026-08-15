// =============================================================================
// Integration health, and what depends on what.
//
// One place that knows about all five providers, so the settings page never
// imports five adapters and the dependency warning never hardcodes a list.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { getStatus as getCalendarStatus } from "@/lib/integrations/calendar";
import { getStatus as getLlmStatus } from "@/lib/integrations/llm";
import { getStatus as getN8nStatus } from "@/lib/integrations/n8n";
import { isGoogleOAuthConfigured } from "@/lib/integrations/calendar/oauth";
import type { IntegrationStatus, Provider } from "@/lib/integrations/store";
import { ACTION_INTEGRATIONS, ACTION_LABELS, type ActionType } from "@/lib/automations/catalog";
import { formatDbError } from "@/lib/supabase/errors";

export type ProviderDescriptor = {
  provider: Provider;
  label: string;
  description: string;
  /** How credentials are supplied — an OAuth flow, or a form. */
  connectStyle: "oauth" | "api_key";
  /** What stops working without it. Shown before disconnecting. */
  featureImpact: string[];
};

export const PROVIDER_DESCRIPTORS: Record<Provider, ProviderDescriptor> = {
  bolna: {
    provider: "bolna",
    label: "Bolna AI",
    description: "Places automated screening calls to candidates.",
    connectStyle: "api_key",
    featureImpact: [
      "AI screening calls, manual and automated",
      "Screening reports, which are built from call transcripts",
    ],
  },
  calendar: {
    provider: "calendar",
    label: "Google Calendar",
    description: "Creates interview invites and Meet links.",
    connectStyle: "oauth",
    featureImpact: [
      "Interview invites — interviews still schedule here, but nobody is invited",
      "Google Meet links on video interviews",
    ],
  },
  email: {
    provider: "email",
    label: "Email",
    description: "Delivers notifications and reminders outside the app.",
    connectStyle: "api_key",
    featureImpact: [
      "External email notifications — in-app notifications are unaffected",
      "Interview and feedback reminders by email",
    ],
  },
  llm: {
    provider: "llm",
    label: "AI provider",
    description: "Powers resume parsing, matching, summaries and drafting.",
    connectStyle: "api_key",
    featureImpact: [
      "Resume parsing, match scoring, screening reports and every AI draft",
      "Every manual workflow keeps working without it",
    ],
  },
  n8n: {
    provider: "n8n",
    label: "n8n",
    description: "Workflow engine. Monitored here; automations run in-process.",
    connectStyle: "api_key",
    featureImpact: ["Nothing — automations do not run through n8n in this version"],
  },
};

export type IntegrationHealth = {
  provider: Provider;
  label: string;
  description: string;
  connectStyle: "oauth" | "api_key";
  status: IntegrationStatus;
  credentialHint: string | null;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  encryptionUnavailable: boolean;
  /** Provider-specific extras the card renders (From address, model, URL). */
  detail: string | null;
  /** True when the SERVER lacks what this provider needs, whatever the org did. */
  serverUnavailable: boolean;
  serverUnavailableReason: string | null;
};

/**
 * Every provider's health, in one call.
 *
 * Each adapter is read independently and a failure in one does not affect the
 * others — a settings page where one broken integration hides the other four is
 * worse than one that shows four working and one in error.
 */
export async function getAllIntegrationHealth(
  organizationId: string
): Promise<IntegrationHealth[]> {
  const [bolna, calendar, email, llm, n8n] = await Promise.all([
    getBolnaStatus(organizationId).catch(() => null),
    getCalendarStatus(organizationId).catch(() => null),
    getEmailStatus(organizationId).catch(() => null),
    getLlmStatus(organizationId).catch(() => null),
    getN8nStatus(organizationId).catch(() => null),
  ]);

  const base = (provider: Provider): IntegrationHealth => ({
    ...PROVIDER_DESCRIPTORS[provider],
    status: "disconnected",
    credentialHint: null,
    lastTestedAt: null,
    lastSuccessAt: null,
    errorCode: null,
    errorMessage: null,
    encryptionUnavailable: false,
    detail: null,
    serverUnavailable: false,
    serverUnavailableReason: null,
    featureImpact: PROVIDER_DESCRIPTORS[provider].featureImpact,
  } as unknown as IntegrationHealth);

  return [
    {
      ...base("bolna"),
      status: bolna?.status ?? "disconnected",
      credentialHint: bolna?.credentialHint ?? null,
      lastTestedAt: bolna?.lastTestedAt ?? null,
      lastSuccessAt: bolna?.lastSuccessAt ?? null,
      errorMessage: bolna?.errorMessage ?? null,
      encryptionUnavailable: bolna?.encryptionUnavailable ?? false,
      detail: bolna ? `Max ${bolna.retryPolicy.maxAttempts} attempts per candidate` : null,
    },
    {
      ...base("calendar"),
      status: calendar?.status ?? "disconnected",
      credentialHint: calendar?.accountHint ?? null,
      lastTestedAt: calendar?.lastTestedAt ?? null,
      lastSuccessAt: calendar?.lastSuccessAt ?? null,
      errorCode: calendar?.errorCode ?? null,
      errorMessage: calendar?.errorMessage ?? null,
      encryptionUnavailable: calendar?.encryptionUnavailable ?? false,
      detail: calendar?.accountHint ?? null,
      // Distinguishes "this organization hasn't connected" from "this
      // deployment has no Google app at all" — different problems, different
      // people, and only one of them an admin can fix.
      serverUnavailable: !isGoogleOAuthConfigured(),
      serverUnavailableReason: isGoogleOAuthConfigured()
        ? null
        : "This deployment has no Google OAuth application configured, so Calendar can't be connected by anyone yet.",
    },
    {
      ...base("email"),
      status: email?.status ?? "disconnected",
      credentialHint: email?.credentialHint ?? null,
      lastTestedAt: email?.lastTestedAt ?? null,
      lastSuccessAt: email?.lastSuccessAt ?? null,
      errorMessage: email?.errorMessage ?? null,
      encryptionUnavailable: email?.encryptionUnavailable ?? false,
      detail: email?.fromAddress ? `Sends from ${email.fromAddress}` : null,
    },
    {
      ...base("llm"),
      status: llm?.status ?? "disconnected",
      credentialHint: llm?.credentialHint ?? null,
      lastTestedAt: llm?.lastTestedAt ?? null,
      lastSuccessAt: llm?.lastSuccessAt ?? null,
      errorCode: llm?.errorCode ?? null,
      errorMessage: llm?.errorMessage ?? null,
      encryptionUnavailable: llm?.encryptionUnavailable ?? false,
      // Honest about which key is actually in use — see lib/integrations/llm.
      detail:
        llm?.activeSource === "server_environment"
          ? "Currently using this server's own AI key, not a key stored here"
          : llm?.activeSource === "organization_key"
            ? `Using this organization's key${llm.model ? ` · ${llm.model}` : ""}`
            : "No AI key available — AI features are unavailable",
    },
    {
      ...base("n8n"),
      status: n8n?.status ?? "disconnected",
      credentialHint: n8n?.credentialHint ?? null,
      lastTestedAt: n8n?.lastTestedAt ?? null,
      lastSuccessAt: n8n?.lastSuccessAt ?? null,
      errorCode: n8n?.errorCode ?? null,
      errorMessage: n8n?.errorMessage ?? null,
      encryptionUnavailable: n8n?.encryptionUnavailable ?? false,
      detail: n8n?.instanceUrl
        ? `${n8n.instanceUrl} · monitored only, automations run in-process`
        : "Monitored only — automations run in-process in this version",
    },
  ];
}

export type Dependency = {
  kind: "automation" | "feature";
  name: string;
  /** Only automations carry one. */
  id?: string;
  /** True when this dependency is LIVE and will break immediately. */
  active: boolean;
};

/**
 * What breaks if this provider is disconnected.
 *
 * The spec's example: "Before disconnecting: High Match AI Screening, Screening
 * Retry, and Candidate Callback will be affected."
 *
 * Automations are read from Module 13's `required_integrations` rather than a
 * hardcoded list, so a rule created tomorrow appears here without anyone
 * remembering to update this file. That is the whole point — a dependency
 * warning that goes stale is worse than none, because it is trusted.
 */
export async function findDependencies({
  organizationId,
  provider,
}: {
  organizationId: string;
  provider: Provider;
}): Promise<{ dependencies: Dependency[]; failed: boolean }> {
  const descriptor = PROVIDER_DESCRIPTORS[provider];

  const features: Dependency[] = descriptor.featureImpact.map((name) => ({
    kind: "feature" as const,
    name,
    active: true,
  }));

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("automations")
    .select("id, name, status, required_integrations, actions")
    .eq("organization_id", organizationId)
    .contains("required_integrations", [provider]);

  if (error) {
    console.error(`[settings] dependency lookup failed: ${formatDbError(error)}`);
    // Report the failure rather than an empty list. "Nothing depends on this"
    // when we could not check is exactly the false reassurance that makes
    // somebody disconnect a live integration.
    return { dependencies: features, failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    status: string;
    actions: { type: ActionType }[] | null;
  }[];

  const automations: Dependency[] = rows
    .map((row) => ({
      kind: "automation" as const,
      id: row.id,
      name: row.name,
      // Active rules break NOW; drafts break whenever somebody activates them.
      active: row.status === "active",
    }))
    // Live ones first — they are the reason to hesitate.
    .sort((a, b) => Number(b.active) - Number(a.active));

  return { dependencies: [...automations, ...features], failed: false };
}

/** Which catalogue actions need this provider, for the settings copy. */
export function actionsRequiring(provider: Provider): string[] {
  return (Object.entries(ACTION_INTEGRATIONS) as [ActionType, string][])
    .filter(([, required]) => required === provider)
    .map(([action]) => ACTION_LABELS[action]);
}
