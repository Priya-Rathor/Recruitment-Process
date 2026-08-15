"use client";

// =============================================================================
// The account menu rows — Team, Notifications, Settings, Sign out.
//
// Shared by the desktop dropdown and the mobile drawer, because the spec asks
// for "the same account-menu rows" in both. Two copies would drift: someone
// adds a row to the dropdown, nobody remembers the drawer, and the mobile
// experience quietly loses a feature.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronsUpDown, LogOut, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ACCOUNT_NAV_ITEMS } from "./navItems";

export function AccountRows({
  unreadCount,
  canSwitchOrganization,
  isAdmin,
  onNavigate,
}: {
  unreadCount: number | null;
  canSwitchOrganization: boolean;
  /** Gates the admin-only rows that moved out of the bar. */
  isAdmin: boolean;
  /** Closes the dropdown or drawer that contains these rows. */
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const hasUnread = unreadCount !== null && unreadCount > 0;

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full refresh so the proxy re-evaluates and server components drop any
    // session-derived data from their render cache.
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {canSwitchOrganization && (
        <Link
          href="/organizations/switch"
          className="account-menu__row"
          role="menuitem"
          onClick={onNavigate}
        >
          <ChevronsUpDown size={16} aria-hidden="true" />
          Switch organization
        </Link>
      )}

      <Link href="/team/invite" className="account-menu__row" role="menuitem" onClick={onNavigate}>
        <Users size={16} aria-hidden="true" />
        Team
      </Link>

      <Link
        href="/notifications"
        className="account-menu__row"
        role="menuitem"
        onClick={onNavigate}
      >
        <Bell size={16} aria-hidden="true" />
        Notifications
        {hasUnread && (
          <span className="account-menu__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </Link>

      {/* Audit log and Settings — moved here from the bar, which could not
          hold eleven items. Hidden entirely for non-admins, as everywhere. */}
      {ACCOUNT_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="account-menu__row"
            role="menuitem"
            onClick={onNavigate}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}

      <div className="account-menu__divider" />

      {/*
        Sign out: last, visually separated, error red. It used to be a solid
        black button sitting in the bar — the only black element in the product
        and the loudest thing in the nav, despite being the least-used control.
      */}
      <button
        type="button"
        className="account-menu__row account-menu__row--danger"
        role="menuitem"
        onClick={signOut}
        disabled={signingOut}
      >
        <LogOut size={16} aria-hidden="true" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );
}
