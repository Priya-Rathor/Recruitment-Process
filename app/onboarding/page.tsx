import { redirect } from "next/navigation";
import { getCurrentUser, getUserMemberships } from "@/lib/tenant";
import { Logo } from "@/components/Logo";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");

  const memberships = await getUserMemberships();
  const existing = memberships[0];

  // Already fully onboarded — nothing to do here.
  if (existing?.organization.onboarding_completed_at) {
    redirect("/dashboard");
  }

  return (
    <div className="auth-layout" style={{ alignItems: "flex-start", paddingTop: "3rem" }}>
      <div className="auth-card" style={{ maxWidth: 640 }}>
        <div className="auth-brand">
          <Logo variant="full" height={52} priority />
        </div>

        <OnboardingFlow
          existingOrganization={existing?.organization ?? null}
          // Only Owner/Admin may accept AI suggestions (spec section 9). A user
          // who created the org is always Owner, so this is defensive rather
          // than expected to fail — but the API enforces it independently.
          canUseAi={existing ? existing.role === "owner" || existing.role === "admin" : true}
        />
      </div>
    </div>
  );
}
