import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { getStatus as getBolnaStatus } from "@/lib/integrations/bolna";
import { ErrorState } from "@/components/states";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { ScreeningForm } from "./ScreeningForm";

export const metadata = { title: "Screening settings" };
export const dynamic = "force-dynamic";

export default async function ScreeningSettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      title="Screening"
      description="How the AI screening call behaves."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="screening settings" />
      ) : (
        <ScreeningBody organizationId={membership.organization.id} />
      )}
    </SettingsShell>
  );
}

async function ScreeningBody({ organizationId }: { organizationId: string }) {
  const [{ settings, failed }, bolna] = await Promise.all([
    getOrganizationSettings(organizationId),
    getBolnaStatus(organizationId),
  ]);

  if (failed) return <ErrorState message="Couldn't load these settings." />;

  return (
    <>
      {bolna.status !== "connected" && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>Bolna isn&apos;t connected</strong>, so no screening calls are being placed.
            These settings can be saved now and will apply once it is connected.
          </p>
        </div>
      )}

      <ScreeningForm initial={settings.screening_settings} />
    </>
  );
}
