"use client";

// =============================================================================
// Account menu — the right zone, collapsed into one clickable cluster.
//
// This replaces six separate controls that used to sit loose in the bar: the
// org name, a bordered "Owner" chip, a bell + "Notifications", a person icon +
// "Team", the user's raw email address, and a solid black "Sign out" button.
//
// TWO THINGS DRIVE THE DESIGN.
//
// 1. The email does not belong in a persistent bar. It is shown to the same
//    person on every page, tells them nothing they don't know, and puts an
//    address on screen during every screen-share and screenshot. It lives in
//    the dropdown header now, which is where someone actually looks when they
//    want to check which account they are in.
//
// 2. Sign out was a solid black button — the only black element in the product,
//    and visually the loudest thing in the bar despite being the least-used
//    control. It is now the last row of the menu, in error red, visually
//    separated by a divider.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AccountRows } from "./AccountRows";
import { ACCOUNT_NAV_ITEMS, initialsFrom, isActiveHref } from "./navItems";

export type AccountMenuProps = {
  userName: string | null;
  userEmail: string;
  organizationName: string;
  role: string;
  unreadCount: number | null;
  /** True when the user belongs to more than one organization. */
  canSwitchOrganization: boolean;
  /** Gates the admin-only rows that moved out of the bar. */
  isAdmin: boolean;
  /** Mobile shows the avatar alone; the org/role text is dropped. */
  compact?: boolean;
};

export function AccountMenu({
  userName,
  userEmail,
  organizationName,
  role,
  unreadCount,
  canSwitchOrganization,
  isAdmin,
  compact = false,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Both are expected of a menu, and
  // their absence is the kind of thing that makes a dropdown feel homemade.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = initialsFrom(userName, userEmail);
  /*
    Settings, Analytics and the Audit log live in this menu, not in the main
    bar — so on those pages NOTHING in the bar was marked current and a user
    had no "you are here". The trigger carries the active state instead, and
    its accessible name says which section is open.
  */
  const pathname = usePathname();
  const currentSection = ACCOUNT_NAV_ITEMS.find((item) => isActiveHref(pathname, item.href));
  const hasUnread = unreadCount !== null && unreadCount > 0;

  return (
    <div ref={containerRef} className="account-menu">
      <button
        type="button"
        className={`account-menu__trigger${currentSection ? " is-active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={currentSection ? `Account menu, current section: ${currentSection.label}` : "Account menu"}
      >
        <span className="account-menu__avatar" aria-hidden="true">
          {initials}
          {/* The unread signal rides the avatar on mobile, where the bell row
              inside the menu is not visible without opening it. */}
          {hasUnread && compact && <span className="account-menu__dot" />}
        </span>

        {!compact && (
          <>
            <span className="account-menu__identity">
              <span className="account-menu__org">{organizationName}</span>
              <span className="account-menu__role">{role}</span>
            </span>
            <ChevronDown size={14} className="account-menu__chevron" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div className="account-menu__panel" role="menu">
          {/* The email's home: read-only, inside the menu, not in the bar. */}
          <div className="account-menu__header">
            {userName && <span className="account-menu__header-name">{userName}</span>}
            <span className="account-menu__header-email">{userEmail}</span>
          </div>

          <div className="account-menu__divider" />

          <AccountRows
            unreadCount={unreadCount}
            canSwitchOrganization={canSwitchOrganization}
            isAdmin={isAdmin}
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
