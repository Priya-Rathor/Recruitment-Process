// =============================================================================
// Which candidate channels can actually deliver right now.
//
// Its own module rather than part of lib/settings/integrations.ts, because that
// file reads ALL SIX providers to build the settings page. An application detail
// page asking "can I email this candidate?" should not also test Bolna, Calendar,
// the AI provider and n8n.
// =============================================================================
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { getStatus as getWhatsAppStatus } from "@/lib/integrations/whatsapp";

export type ChannelAvailability = {
  emailConnected: boolean;
  whatsappConnected: boolean;
};

/**
 * Reads both channels independently.
 *
 * A failure in one never affects the other — the same rule the settings page
 * follows, and the reason the spec's "WhatsApp being disconnected doesn't block
 * email-only sends" holds all the way up to the UI: WhatsApp being unreadable
 * cannot make the email composer think email is unavailable.
 */
export async function getChannelAvailability(
  organizationId: string
): Promise<ChannelAvailability> {
  const [email, whatsapp] = await Promise.all([
    getEmailStatus(organizationId).catch(() => null),
    getWhatsAppStatus(organizationId).catch(() => null),
  ]);

  return {
    emailConnected: email?.status === "connected",
    whatsappConnected: whatsapp?.status === "connected",
  };
}
