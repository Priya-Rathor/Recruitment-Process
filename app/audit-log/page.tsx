import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { listActivity } from "@/lib/activity/queries";
import { SENSITIVE_EVENT_TYPES } from "@/lib/activity/events";
import { eventLabel } from "@/lib/activity/events";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

async function AuditEntries({ eventType }: { eventType?: string }) {
  const membership = await requireMembershipOrRedirect();

  const { events, total, failed } = await listActivity({
    organizationId: membership.organization.id,
    filters: {
      sensitiveOnly: true,
      eventType: eventType && SENSITIVE_EVENT_TYPES.includes(eventType as never) ? eventType : null,
    },
    limit: 100,
  });

  if (failed) return <ErrorState message="Couldn't load the audit log." />;

  if (events.length === 0) {
    return (
      <EmptyState
        message={
          eventType
            ? "No events of that kind have been recorded."
            : "No security or settings events have been recorded yet. Role changes, invites, integration connections and automation activations appear here."
        }
      />
    );
  }

  return (
    <>
      <p className="has-text-secondary mb-4" style={{ fontSize: 13 }}>
        Showing {events.length} of {total} event{total === 1 ? "" : "s"}.
      </p>
      <ActivityTimeline events={events} showEntity />
    </>
  );
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ event_type?: string }>;
}) {
  const [membership, query] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);

  // Spec section 9: "View security/settings audit log — Recruiter: No,
  // Viewer: No". Blocked outright, not greyed out. RLS hides the rows too, so
  // this page could not show them even if the check were removed.
  if (!hasRole(membership.role, ["owner", "admin"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">The audit log is restricted</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Only an Owner or Admin can view security and settings events. You can still see the
            activity on records you work with.
          </p>
          <Link className="button" href="/dashboard">
            Back to the dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Audit log</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Security and settings events: who changed access, connected an integration, or turned an
          automation on. Append-only — entries cannot be edited or deleted, by anyone.
        </p>
      </div>

      <div className="card mb-4">
        <div className="buttons">
          <Link
            className={`button is-small ${!query.event_type ? "is-primary" : ""}`}
            href="/audit-log"
          >
            All
          </Link>
          {SENSITIVE_EVENT_TYPES.map((type) => (
            <Link
              key={type}
              className={`button is-small ${query.event_type === type ? "is-primary" : ""}`}
              href={`/audit-log?event_type=${type}`}
            >
              {eventLabel(type)}
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <Suspense fallback={<SkeletonRows rows={6} />}>
          <AuditEntries eventType={query.event_type} />
        </Suspense>
      </div>
    </AppShell>
  );
}
