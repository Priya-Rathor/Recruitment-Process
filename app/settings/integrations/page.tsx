import { Suspense } from "react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { StatusChip } from "@/components/ui/StatusChip";
import { getAllIntegrationHealth, type IntegrationHealth } from "@/lib/settings/integrations";
import type { CustomerFacingProvider } from "@/lib/settings/integrations";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { IntegrationCard } from "./IntegrationCard";
import { CredentialDisclosure } from "./CredentialDisclosure";

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
/**
 * The anchor id for one integration's card.
 *
 * The ONE place these are minted. The Settings landing grid deep-links to
 * `#integration-<provider>`, the card renders the matching id, and
 * app/settings/catalog.test.ts asserts every anchor in the grid names a provider
 * that still has a descriptor — so a renamed provider breaks the test rather than
 * the link.
 */
export function integrationAnchor(provider: string): string {
  return `integration-${provider}`;
}

const CATEGORIES: { label: string; providers: CustomerFacingProvider[] }[] = [
  { label: "Calling & scheduling", providers: ["bolna", "calendar"] },
  { label: "Communication", providers: ["email", "whatsapp"] },
  /*
    ONE provider here, not two.

    n8n used to sit beside the AI provider. It has no descriptor now — it is
    platform-managed infrastructure a customer cannot configure — so there is
    nothing to render, and the group is honest at one card rather than padded to
    two.
  */
  { label: "AI & automation", providers: ["llm"] },
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

      {/*
        The trust disclosure, as a persistent footer note.

        A flat bordered note rather than a card, deliberately: it is not one of the
        integrations, and giving it the same white card treatment would make it
        read as a sixth item in the list. The same words appear inside every
        credential-entry panel — see CredentialDisclosure.
      */}
      <CredentialDisclosure placement="footer" />
    </>
  );
}
