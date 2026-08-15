import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { getPreferences } from "@/lib/notifications/queries";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { PreferenceEditor } from "./PreferenceEditor";

export const metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

async function Preferences() {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  const [{ preferences, failed }, email] = await Promise.all([
    getPreferences({ organizationId: membership.organization.id, userId: user.id }),
    getEmailStatus(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load your notification settings." />;

  return (
    <>
      {email.status !== "connected" && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>Email isn&apos;t connected.</strong> The email switches below can be set now,
            but nothing will be delivered until an Owner connects an email provider. In-app
            notifications are unaffected.
          </p>
        </div>
      )}

      <PreferenceEditor
        preferences={preferences}
        canEditOrganization={hasRole(membership.role, ["owner", "admin"])}
      />
    </>
  );
}

export default async function NotificationSettingsPage() {
  await requireMembershipOrRedirect();

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/notifications">Notifications</Link> / Settings
        </p>
        <h1 className="title is-4 mb-1">Notification settings</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Choose what reaches you, and how.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={6} />
          </div>
        }
      >
        <Preferences />
      </Suspense>
    </AppShell>
  );
}
