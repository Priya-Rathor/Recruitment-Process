"use client";

// =============================================================================
// The top navigation bar.
//
// Three zones, one bar: wordmark | nav links | account menu.
//
// Client component because two things here can only be known in the browser:
// which route is active (usePathname), and whether the mobile drawer is open.
// Everything it renders comes in as plain props from the server shell, so no
// session data is fetched here.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";
import { AccountRows } from "./AccountRows";
import { isActiveHref, NAV_GROUPS } from "./navItems";

export function TopNav({
  isAdmin,
  account,
}: {
  isAdmin: boolean;
  account: AccountMenuProps;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lock the page behind an open drawer, so scrolling the drawer does not
  // scroll the page underneath it.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const groups = NAV_GROUPS.map((group) =>
    group.filter((item) => !item.adminOnly || isAdmin)
  ).filter((group) => group.length > 0);

  return (
    <header className="topnav">
      <div className="topnav__inner">
        {/* ---- Left zone: wordmark only. ---------------------------------- */}
        <Link href="/dashboard" className="topnav__brand">
          Recruitment OS
        </Link>

        {/* ---- Mobile: hamburger between the wordmark and the avatar. ----- */}
        <button
          type="button"
          className="topnav__hamburger"
          onClick={() => setDrawerOpen((value) => !value)}
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={drawerOpen}
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        {/* ---- Centre-left zone: the links. ------------------------------- */}
        <nav className="topnav__links" aria-label="Main navigation">
          {groups.map((group, groupIndex) => (
            <div className="topnav__group" key={group[0]?.href ?? groupIndex}>
              {groupIndex > 0 && <span className="topnav__divider" aria-hidden="true" />}
              {group.map((item) => {
                const active = isActiveHref(pathname, item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`topnav__link ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ---- Right zone: one cluster. ----------------------------------- */}
        <div className="topnav__account">
          <AccountMenu {...account} />
          <span className="topnav__account-compact">
            <AccountMenu {...account} compact />
          </span>
        </div>
      </div>

      {/* ---- Mobile drawer. ---------------------------------------------- */}
      {drawerOpen && (
        <>
          <div
            className="topnav__scrim"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="topnav__drawer" role="dialog" aria-label="Navigation">
            <div className="topnav__drawer-head">
              <span className="topnav__brand">Recruitment OS</span>
              <button
                type="button"
                className="topnav__drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav className="topnav__drawer-links" aria-label="Main navigation">
              {groups.flat().map((item) => {
                const active = isActiveHref(pathname, item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`topnav__drawer-link ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    // Closed here rather than in an effect watching pathname:
                    // the click IS the navigation, so this is where the intent
                    // lives, and it avoids a setState-in-effect.
                    onClick={() => setDrawerOpen(false)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="topnav__drawer-divider" />

            {/* The same account rows as the desktop dropdown — shared, so the
                two can never drift apart. */}
            <div className="topnav__drawer-account">
              <div className="account-menu__header">
                {account.userName && (
                  <span className="account-menu__header-name">{account.userName}</span>
                )}
                <span className="account-menu__header-email">{account.userEmail}</span>
              </div>
              <AccountRows
                unreadCount={account.unreadCount}
                canSwitchOrganization={account.canSwitchOrganization}
                isAdmin={isAdmin}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        </>
      )}
    </header>
  );
}
