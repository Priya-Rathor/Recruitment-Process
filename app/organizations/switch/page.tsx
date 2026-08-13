import { redirect } from "next/navigation";
import { getCurrentMembership, getCurrentUser, getUserMemberships } from "@/lib/tenant";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

export const metadata = { title: "Switch organization · Recruitment OS" };

export default async function SwitchOrganizationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/organizations/switch");

  const [memberships, active] = await Promise.all([getUserMemberships(), getCurrentMembership()]);

  return (
    <div className="auth-layout" style={{ alignItems: "flex-start", paddingTop: "3rem" }}>
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="card">
          <h1 className="title is-4">Switch organization</h1>
          <p className="subtitle is-6 has-text-secondary">
            You&apos;re signed in as {user.email}.
          </p>

          <OrganizationSwitcher
            memberships={memberships}
            activeOrganizationId={active?.organization.id ?? null}
          />
        </div>
      </div>
    </div>
  );
}
