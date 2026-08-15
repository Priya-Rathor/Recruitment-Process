// The application shell (nav + content area) that every module's pages reuse.
// Server component: it reads the session-resolved organization so no page can
// render with an unresolved or client-supplied tenant.
import Link from "next/link";
import { Bell, ChevronsUpDown, Users } from "lucide-react";
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
const ADMIN_NAV_ITEMS = [
  { href: "/audit-log", label: "Audit log" },
  { href: "/settings", label: "Settings" },
];

/**
 * TWO TIERS, because one row could not hold this.
 *
 * The UI audit found the single-row nav visibly broken at 1440px: "Audit log"
 * wrapped onto two lines, the organization name onto three, and the user's
 * email was clipped mid-word at the right edge. Eleven module links plus an org
 * name, a role badge, notifications, team, an email address and a sign-out
 * control do not fit on one line at any realistic width, and no amount of
 * tightening makes them.
 *
 * So: identity and account controls sit on the top bar, and the module links
 * get their own row that scrolls horizontally on narrow screens rather than
 * wrapping. The organization name truncates with an ellipsis instead of
 * reflowing the whole bar, and the email is hidden below 1024px where it is the
 * least load-bearing thing present.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const [user, membership, memberships] = await Promise.all([
    getCurrentUser(),
    getCurrentMembership(),
    getUserMemberships(),
  ]);

  // null means the count could not be read — rendered as nothing rather than a
  // confident "0", which would hide exactly the alerts that matter most.
  const unread = membership ? await countUnread(membership.organization.id) : null;

  const isAdmin = membership && hasRole(membership.role, ["owner", "admin"]);

  return (
    <div className="app-shell">
      <header className="app-nav">
        {/* Tier 1 — identity and account */}
        <div className="app-nav__bar">
          <Link href="/dashboard" className="app-nav__brand">
            Recruitment&nbsp;OS
          </Link>

          <div className="app-nav__account">
            {membership && (
              <div className="app-nav__org" title={membership.organization.name}>
                <span className="app-nav__org-name">{membership.organization.name}</span>
                <span className="app-nav__role">{membership.role}</span>
              </div>
            )}

            {memberships.length > 1 && (
              <Link href="/organizations/switch" className="app-nav__icon-link" title="Switch organization">
                <ChevronsUpDown size={16} aria-hidden="true" />
                <span className="app-nav__icon-label">Switch</span>
              </Link>
            )}

            <Link href="/notifications" className="app-nav__icon-link" title="Notifications">
              <Bell size={16} aria-hidden="true" />
              <span className="app-nav__icon-label">Notifications</span>
              {unread !== null && unread > 0 && (
                <span className="app-nav__badge" aria-label={`${unread} unread`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>

            <Link href="/team/invite" className="app-nav__icon-link" title="Team">
              <Users size={16} aria-hidden="true" />
              <span className="app-nav__icon-label">Team</span>
            </Link>

            {user && <span className="app-nav__email">{user.email}</span>}

            <SignOutButton />
          </div>
        </div>

        {/* Tier 2 — module navigation. Scrolls rather than wraps. */}
        <nav className="app-nav__modules" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="app-nav__link">
              {item.label}
            </Link>
          ))}
          {isAdmin &&
            ADMIN_NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="app-nav__link">
                {item.label}
              </Link>
            ))}
        </nav>
      </header>

      <main className="section">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
