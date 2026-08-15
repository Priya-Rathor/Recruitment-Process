// The application shell that every module's page reuses.
//
// Server component: it reads the session-resolved organization so no page can
// render with an unresolved or client-supplied tenant. The bar itself is a
// client component (it needs the active route and a dropdown), so this file's
// only job is to hand it plain, already-scoped data — no session object, no
// functions, nothing that crosses the boundary badly.
import { getCurrentMembership, getCurrentUser, getUserMemberships, hasRole } from "@/lib/tenant";
import { countUnread } from "@/lib/notifications/queries";
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
  const unreadCount = membership ? await countUnread(membership.organization.id) : null;

  return (
    <div className="app-shell">
      {membership && user && (
        <TopNav
          isAdmin={hasRole(membership.role, ["owner", "admin"])}
          account={{
            userName: user.name,
            userEmail: user.email,
            organizationName: membership.organization.name,
            role: membership.role,
            unreadCount,
            canSwitchOrganization: memberships.length > 1,
            isAdmin: hasRole(membership.role, ["owner", "admin"]),
          }}
        />
      )}

      <main className="section">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
