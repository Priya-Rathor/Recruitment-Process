import { Suspense } from "react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { getAllIntegrationHealth, type IntegrationHealth } from "@/lib/settings/integrations";
import type { Provider } from "@/lib/integrations/store";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { IntegrationCard } from "./IntegrationCard";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

/**
 * Category grouping.
 *
 * Bolna, Calendar, Email and the AI provider are not four of the same thing —
 * one telephones candidates, one writes to a calendar, one sends mail, one is the
 * engine every AI feature runs on. As one undifferentiated stack they read as a
 * list of equals; grouped, an admin can find the one they came for.
 *
 * Declared as data rather than as markup so a new provider is a one-line
 * addition, and so the completeness check below can prove nothing was dropped.
 */
const CATEGORIES: { label: string; providers: Provider[] }[] = [
  { label: "Calling & scheduling", providers: ["bolna", "calendar"] },
  { label: "Communication", providers: ["email", "whatsapp"] },
  { label: "AI & automation", providers: ["llm", "n8n"] },
];

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar_connected?: string; calendar_error?: string }>;
}) {
  const [membership, query] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/integrations"
      title="Integrations"
      description="Connect the services this product talks to, and check they still work."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="integrations" />
      ) : (
        <>
          {/* The OAuth callback redirects here with one of these. */}
          {query.calendar_connected === "true" && (
            <div className="card mb-4" style={{ borderColor: "var(--color-success)" }}>
              <p style={{ fontSize: 14, color: "var(--color-success)" }}>
                Google Calendar is connected. Interview invites will be sent from now on.
              </p>
            </div>
          )}
          {query.calendar_error && (
            <div className="card mb-4" style={{ borderColor: "var(--color-error)" }}>
              <p style={{ fontSize: 14, color: "var(--color-error)" }}>{query.calendar_error}</p>
            </div>
          )}

          <StatusLegend />

          <Suspense
            fallback={
              <div className="card">
                <SkeletonRows rows={5} />
              </div>
            }
          >
            <IntegrationList
              organizationId={membership.organization.id}
              timeZone={membership.organization.timezone}
            />
          </Suspense>
        </>
      )}
    </SettingsShell>
  );
}

/**
 * The key for the chips on the cards below.
 *
 * Built from the SAME StatusChip the cards use, not from three coloured spans
 * that look like it — a legend drawn separately is a legend that eventually
 * describes a chip the product no longer renders.
 *
 * "Error" is deliberately absent. It is a real status, but a legend listing every
 * state a system can reach stops being a glanceable key; these three are the ones
 * a card sits in day to day, and an errored card says so in words as well.
 */
function StatusLegend() {
  return (
    <div className="integrations-legend">
      <span className="integrations-legend__label">Status key:</span>
      <StatusChip tone="success" label="Connected" />
      <StatusChip tone="neutral" label="Disconnected" />
      <StatusChip tone="warning" label="Needs attention" />
    </div>
  );
}

async function IntegrationList({
  organizationId,
  timeZone,
}: {
  organizationId: string;
  timeZone: string;
}) {
  const integrations = await getAllIntegrationHealth(organizationId);

  const byProvider = new Map<string, IntegrationHealth>(
    integrations.map((integration) => [integration.provider, integration])
  );

  const grouped = CATEGORIES.map((category) => ({
    label: category.label,
    // Filtered against what the adapter layer actually returned, so a category
    // naming a provider this deployment does not have renders one card, not a gap.
    items: category.providers
      .map((provider) => byProvider.get(provider))
      .filter((integration): integration is IntegrationHealth => Boolean(integration)),
  })).filter((category) => category.items.length > 0);

  /*
    ANYTHING THE CATEGORIES FORGOT STILL GETS RENDERED.

    A hardcoded grouping is a second list that has to stay in step with
    PROVIDER_DESCRIPTORS, and the failure mode is silent: add a provider, forget
    this file, and its card simply never appears — an admin cannot connect a
    service the page does not mention. So the leftovers get their own group rather
    than being dropped.
  */
  const categorised = new Set(CATEGORIES.flatMap((category) => category.providers));
  const uncategorised = integrations.filter(
    (integration) => !categorised.has(integration.provider)
  );

  return (
    <>
      {grouped.map((category) => (
        <section className="integration-group" key={category.label}>
          <h2 className="integration-group__label">{category.label}</h2>
          {category.items.map((integration) => (
            <IntegrationCard
              key={integration.provider}
              integration={integration}
              timeZone={timeZone}
            />
          ))}
        </section>
      ))}

      {uncategorised.length > 0 && (
        <section className="integration-group">
          <h2 className="integration-group__label">Other</h2>
          {uncategorised.map((integration) => (
            <IntegrationCard
              key={integration.provider}
              integration={integration}
              timeZone={timeZone}
            />
          ))}
        </section>
      )}

      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        Credentials are encrypted before storage and can never be read back — not by this page, not
        by the API, and not by anyone&apos;s browser session. Only the last four characters are kept
        for display.
      </p>
    </>
  );
}
