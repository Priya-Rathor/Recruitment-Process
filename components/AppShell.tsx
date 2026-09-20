// The application shell that every module's page reuses.
//
// Server component: it reads the session-resolved organization so no page can
// render with an unresolved or client-supplied tenant. The bar itself is a
// client component (it needs the active route and a dropdown), so this file's
// only job is to hand it plain, already-scoped data — no session object, no
// functions, nothing that crosses the boundary badly.
import { getCurrentMembership, getCurrentUser, getUserMemberships, hasRole } from "@/lib/tenant";
import { isAgencyMode } from "@/lib/organizations/hiringModel";
import { countUnread } from "@/lib/notifications/queries";
import { countUnreadConversations } from "@/lib/messaging/queries";
import { TopNav } from "@/components/nav/TopNav";
import type { ReactNode } from "react";

export async function AppShell({ children }: { children: ReactNode }) {
  const [user, membership, memberships] = await Promise.all([
    getCurrentUser(),
    getCurrentMembership(),
    getUserMemberships(),
  ]);

  // null means the count could not be read — rendered as no badge rather than a
  // confident "0", which would hide exactly the alerts that matter most.
  //
  // Both counts in parallel. They are independent reads and the shell wraps
  // every page in the product, so serialising them would add a round trip to
  // every navigation for no reason.
  const [unreadCount, unreadMessages] = membership
    ? await Promise.all([
        countUnread(membership.organization.id),
        countUnreadConversations({
          organizationId: membership.organization.id,
          // Scoped exactly like the inbox itself, so the badge cannot promise a
          // recruiter threads the inbox will not show them.
          viewerRole: membership.role,
          viewerId: membership.user_id,
        }),
      ])
    : [null, null];

  return (
    <div className="app-shell">
      {membership && user && (
        <TopNav
          isAdmin={hasRole(membership.role, ["owner", "admin"])}
          agencyMode={isAgencyMode(membership.organization)}
          account={{
            userName: user.name,
            userEmail: user.email,
            organizationName: membership.organization.name,
            role: membership.role,
            unreadCount,
            canSwitchOrganization: memberships.length > 1,
            isAdmin: hasRole(membership.role, ["owner", "admin"]),
          }}
          badges={{ messages: unreadMessages }}
        />
      )}

      <main className="section">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
