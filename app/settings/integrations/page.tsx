import { Suspense } from "react";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SkeletonRows } from "@/components/states";
import { getAllIntegrationHealth } from "@/lib/settings/integrations";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { IntegrationCard } from "./IntegrationCard";

export const metadata = { title: "Integrations · Recruitment OS" };
export const dynamic = "force-dynamic";

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

          <Suspense
            fallback={
              <div className="card">
                <SkeletonRows rows={5} />
              </div>
            }
          >
            <IntegrationList organizationId={membership.organization.id} />
          </Suspense>
        </>
      )}
    </SettingsShell>
  );
}

async function IntegrationList({ organizationId }: { organizationId: string }) {
  const integrations = await getAllIntegrationHealth(organizationId);

  return (
    <>
      {integrations.map((integration) => (
        <IntegrationCard key={integration.provider} integration={integration} />
      ))}

      <p className="has-text-secondary" style={{ fontSize: 12 }}>
        Credentials are encrypted before storage and can never be read back — not by this page, not
        by the API, and not by anyone&apos;s browser session. Only the last four characters are kept
        for display.
      </p>
    </>
  );
}
