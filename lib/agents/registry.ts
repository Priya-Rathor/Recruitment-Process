// =============================================================================
// AgentProviderRegistry — the SERVER half of the provider axis.
//
// What each provider and channel is connected to, for one organization, read
// through the integration adapters that already own them. Nothing is stored
// here and no credential passes through: every adapter's getStatus() returns a
// status and a masked hint, never a key, and this file forwards only the state.
//
// NOT CLIENT-SAFE (it reaches the admin-backed integration store). The pure
// capability matrix is ./providers.ts.
// =============================================================================
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { getStatus as getCalendarStatus } from "@/lib/integrations/calendar";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";
import { isAiConfigured } from "@/lib/ai/provider";
import type { IntegrationStatus } from "@/lib/integrations/store";
import { PROVIDERS, type ProviderId } from "./providers";
import type { ChannelIntegration } from "./types";

export type ConnectionState = "connected" | "not_connected" | "needs_attention" | "unavailable";

export type Connection = {
  state: ConnectionState;
  /** Where "Connect" / "Manage connection" goes. Null when there is nowhere yet. */
  manageHref: string | null;
};

export type Connections = {
  providers: Record<ProviderId, Connection>;
  channels: Record<ChannelIntegration, Connection>;
  /** The platform AI provider, which every non-voice type runs on. */
  ai: { configured: boolean };
};

function fromIntegration(status: IntegrationStatus, manageHref: string): Connection {
  if (status === "connected") return { state: "connected", manageHref };
  if (status === "disconnected") return { state: "not_connected", manageHref };
  return { state: "needs_attention", manageHref };
}

/** One read per integration, in parallel. A failed read is "needs attention", never "connected". */
export async function loadConnections(organizationId: string): Promise<Connections> {
  const [bolna, whatsapp, email, calendar] = await Promise.allSettled([
    getBolnaStatus(organizationId),
    getWhatsAppStatus(organizationId),
    getEmailStatus(organizationId),
    getCalendarStatus(organizationId),
  ]);

  const settle = (
    result: PromiseSettledResult<{ status: IntegrationStatus }>,
    href: string
  ): Connection =>
    result.status === "fulfilled"
      ? fromIntegration(result.value.status, href)
      : { state: "needs_attention", manageHref: href };

  const providers = {} as Record<ProviderId, Connection>;
  for (const provider of Object.values(PROVIDERS)) {
    providers[provider.id] =
      provider.id === "bolna"
        ? settle(bolna, "/settings/integrations#integration-bolna")
        : // No adapter, so no connect flow. Saying "Not connected" with a
          // Connect button that leads nowhere would be the fake connection
          // this module is told not to build.
          { state: "unavailable", manageHref: null };
  }

  return {
    providers,
    channels: {
      whatsapp: settle(whatsapp, "/settings/integrations#integration-whatsapp"),
      email: settle(email, "/settings/integrations#integration-email"),
      calendar: settle(calendar, "/settings/integrations#integration-calendar"),
    },
    ai: { configured: isAiConfigured() },
  };
}
