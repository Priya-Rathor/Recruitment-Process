import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listNotifications } from "@/lib/notifications/queries";
import { getStatus as getEmailStatus } from "@/lib/integrations/email";
import { NotificationList } from "./NotificationList";
import { ReminderButton } from "./ReminderButton";

export const metadata = { title: "Notifications · Recruitment OS" };
export const dynamic = "force-dynamic";

async function Notifications({ unreadOnly }: { unreadOnly: boolean }) {
  const membership = await requireMembershipOrRedirect();
  const timeZone = membership.organization.timezone;

  const [{ notifications, failed }, email] = await Promise.all([
    listNotifications({ organizationId: membership.organization.id, unreadOnly, limit: 100 }),
    getEmailStatus(membership.organization.id),
  ]);

  if (failed) return <ErrorState message="Couldn't load your notifications." />;

  return (
    <>
      {/*
        The spec's "graceful degradation when the email integration is
        disconnected (in-app still works)". Said plainly rather than left for
        someone to discover when a candidate doesn't turn up.
      */}
      {email.status !== "connected" && (
        <div className="card mb-4">
          <p style={{ fontSize: 14 }}>
            <strong>Email isn&apos;t connected.</strong> Everything below still works — nothing is
            lost. External messages aren&apos;t being delivered, and each one says so.
            {email.encryptionUnavailable
              ? " Credential encryption isn't configured on this server, so email can't be connected yet."
              : " Connecting it arrives with Settings (Module 17)."}
          </p>
        </div>
      )}

      <div className="card">
        <NotificationList notifications={notifications} timeZone={timeZone} />
      </div>
    </>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string }>;
}) {
  const [membership, query] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);

  const unreadOnly = query.unread === "true";
  // "Send/approve external messages | Viewer: No" — a read-only user cannot make
  // the product send anything.
  const canSendReminders = hasRole(membership.role, ["owner", "admin", "recruiter"]);

  return (
    <AppShell>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-start mb-5">
        <div>
          <h1 className="title is-4 mb-1">Notifications</h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            What needs your attention.
          </p>
        </div>
        <Link className="button" href="/settings/notifications">
          Settings
        </Link>
      </div>

      <div className="card mb-4">
        <div className="is-flex is-justify-content-space-between is-align-items-center">
          <div className="buttons mb-0">
            <Link
              className={`button is-small ${!unreadOnly ? "is-primary" : ""}`}
              href="/notifications"
            >
              All
            </Link>
            <Link
              className={`button is-small ${unreadOnly ? "is-primary" : ""}`}
              href="/notifications?unread=true"
            >
              Unread
            </Link>
          </div>

          {canSendReminders && <ReminderButton />}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <Notifications unreadOnly={unreadOnly} />
      </Suspense>
    </AppShell>
  );
}
