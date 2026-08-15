// The application shell (nav + content area) that every module's pages reuse.
// Server component: it reads the session-resolved organization so no page can
// render with an unresolved or client-supplied tenant.
import Link from "next/link";
import { getCurrentMembership, getCurrentUser, getUserMemberships, hasRole } from "@/lib/tenant";
import { SignOutButton } from "@/components/SignOutButton";
import { countUnread } from "@/lib/notifications/queries";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/candidates", label: "Candidates" },
  { href: "/applications", label: "Applications" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/interviews", label: "Interviews" },
  { href: "/clients", label: "Clients" },
  { href: "/automations", label: "Automations" },
  { href: "/analytics", label: "Analytics" },
];

/**
 * Owner/Admin only, so it is not in NAV_ITEMS — the spec requires a restricted
 * action to be hidden rather than shown-and-refused.
 */
const ADMIN_NAV_ITEMS = [{ href: "/audit-log", label: "Audit log" }];

export async function AppShell({ children }: { children: ReactNode }) {
  const [user, membership, memberships] = await Promise.all([
    getCurrentUser(),
    getCurrentMembership(),
    getUserMemberships(),
  ]);

  // null means the count could not be read — rendered as a dot rather than a
  // confident "0", which would hide exactly the alerts that matter most.
  const unread = membership ? await countUnread(membership.organization.id) : null;

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Main navigation">
        <div className="is-flex is-align-items-center is-justify-content-space-between">
          <div className="is-flex is-align-items-center" style={{ gap: "1.25rem" }}>
            <Link href="/dashboard" className="app-nav__brand">
              Recruitment OS
            </Link>
            <div className="is-flex" style={{ gap: "0.25rem" }}>
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className="app-nav__link">
                  {item.label}
                </Link>
              ))}
              {membership &&
                hasRole(membership.role, ["owner", "admin"]) &&
                ADMIN_NAV_ITEMS.map((item) => (
                  <Link key={item.href} href={item.href} className="app-nav__link">
                    {item.label}
                  </Link>
                ))}
            </div>
          </div>

          <div className="is-flex is-align-items-center" style={{ gap: "0.75rem" }}>
            {membership && (
              <>
                <span className="has-text-secondary" style={{ fontSize: 13 }}>
                  {membership.organization.name}
                </span>
                <span className="tag is-light" style={{ textTransform: "capitalize" }}>
                  {membership.role}
                </span>
              </>
            )}
            {memberships.length > 1 && (
              <Link href="/organizations/switch" className="app-nav__link">
                Switch
              </Link>
            )}
            <Link href="/notifications" className="app-nav__link">
              Notifications
              {unread !== null && unread > 0 && (
                <span
                  className="ml-1"
                  style={{
                    background: "var(--color-primary)",
                    color: "#fff",
                    borderRadius: 999,
                    padding: "1px 7px",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link href="/team/invite" className="app-nav__link">
              Team
            </Link>
            {user && (
              <span className="has-text-secondary" style={{ fontSize: 13 }}>
                {user.email}
              </span>
            )}
            <SignOutButton />
          </div>
        </div>
      </nav>

      <main className="section">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
