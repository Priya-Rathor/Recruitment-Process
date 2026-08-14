// The application shell (nav + content area) that every module's pages reuse.
// Server component: it reads the session-resolved organization so no page can
// render with an unresolved or client-supplied tenant.
import Link from "next/link";
import { getCurrentMembership, getCurrentUser, getUserMemberships } from "@/lib/tenant";
import { SignOutButton } from "@/components/SignOutButton";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/candidates", label: "Candidates" },
  { href: "/applications", label: "Applications" },
  { href: "/pipeline", label: "Pipeline" },
];

export async function AppShell({ children }: { children: ReactNode }) {
  const [user, membership, memberships] = await Promise.all([
    getCurrentUser(),
    getCurrentMembership(),
    getUserMemberships(),
  ]);

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
