import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { isAgencyMode } from "@/lib/organizations/hiringModel";
import { getOrganizationSettings } from "@/lib/settings/queries";
import { RestrictedPanel, SettingsShell } from "../SettingsShell";
import { OrganizationForm } from "./OrganizationForm";

export const metadata = { title: "Organization settings" };
export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/organization"
      title="Organization"
      description="Who you are, and the timezone every date in the product is measured in."
    >
      {!hasRole(membership.role, ["owner", "admin"]) ? (
        <RestrictedPanel what="the organization profile" />
      ) : (
        <OrganizationBody
          organization={{
            id: membership.organization.id,
            name: membership.organization.name,
            industry: membership.organization.industry,
            timezone: membership.organization.timezone,
            agencyMode: isAgencyMode(membership.organization),
          }}
        />
      )}
    </SettingsShell>
  );
}

async function OrganizationBody({
  organization,
}: {
  organization: {
    id: string;
    name: string;
    industry: string | null;
    timezone: string;
    agencyMode: boolean;
  };
}) {
  const { settings } = await getOrganizationSettings(organization.id);

  return (
    <OrganizationForm
      organization={{
        id: organization.id,
        name: organization.name,
        industry: organization.industry,
        timezone: organization.timezone,
        agencyMode: organization.agencyMode,
      }}
      branding={{ logo_url: settings.logo_url, brand_color: settings.brand_color }}
    />
  );
}
