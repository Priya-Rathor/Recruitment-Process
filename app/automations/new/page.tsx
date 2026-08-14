import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { AutomationForm } from "../AutomationForm";

export const metadata = { title: "New automation · Recruitment OS" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  const membership = await requireMembershipOrRedirect();

  // Spec section 9: "Create/edit automations — Recruiter: No, Viewer: No".
  // Blocked, not greyed out; the API and RLS refuse it independently.
  if (!hasRole(membership.role, ["owner", "admin"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t create automations</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Only an Owner or Admin can create rules that act on candidates. You can still see every
            rule and its run history.
          </p>
          <Link className="button" href="/automations">
            Back to automations
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/automations">Automations</Link> / New
        </p>
        <h1 className="title is-4 mb-1">New automation</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Saved as a draft. Activation is a separate step.
        </p>
      </div>

      <AutomationForm mode="create" canUseAi />
    </AppShell>
  );
}
