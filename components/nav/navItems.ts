// =============================================================================
// Navigation vocabulary.
//
// Shared by the desktop bar and the mobile drawer so the two can never drift —
// a link added here appears in both, with the same icon and the same group.
//
// GROUPS exist to break eleven items into readable runs. They are separated by
// a hairline divider and carry NO labels: the spec is explicit that a divider
// alone is the signal, and a labelled group would turn a minimal bar into a
// mega-menu.
//
// The grouping is by what a recruiter is actually doing:
//   1. core recruiting flow — the day's work, in the order it happens
//   2. people & scheduling  — the parts that involve other humans
//   3. ops & config         — set up once, checked occasionally
// =============================================================================
import {
  BarChart2,
  Briefcase,
  Building2,
  Calendar,
  FileText,
  History,
  type LucideIcon,
  Kanban,
  LayoutGrid,
  Settings,
  Users,
  Zap,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Owner/Admin only. Hidden entirely for other roles, never shown-and-refused. */
  adminOnly?: boolean;
};

/** Each inner array is one visual group; a divider is drawn between them. */
export const NAV_GROUPS: NavItem[][] = [
  [
    { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/candidates", label: "Candidates", icon: Users },
    { href: "/applications", label: "Applications", icon: FileText },
  ],
  [
    { href: "/pipeline", label: "Pipeline", icon: Kanban },
    { href: "/interviews", label: "Interviews", icon: Calendar },
    { href: "/clients", label: "Clients", icon: Building2 },
  ],
  [
    { href: "/automations", label: "Automations", icon: Zap },
    { href: "/analytics", label: "Analytics", icon: BarChart2 },
  ],
];

/**
 * Admin routes that live in the ACCOUNT MENU rather than the bar.
 *
 * Measured, not assumed: eleven icon+label items needed 1227px of a 962px bar
 * at 1440px — a 265px overflow that grouping and gap tuning could not close.
 * Something had to move.
 *
 * These two are the right two. Both are Owner/Admin-only configuration rather
 * than daily recruiting work, and Settings was already duplicated in the
 * dropdown. Every route stays reachable; neither is now reachable twice.
 */
export const ACCOUNT_NAV_ITEMS: NavItem[] = [
  { href: "/audit-log", label: "Audit log", icon: History, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

/**
 * Whether a nav item is the current page.
 *
 * Prefix matching, so /jobs/abc/edit still highlights "Jobs" — a user three
 * levels deep should still be able to see where they are. /dashboard is matched
 * exactly, because everything is nested under nothing and a prefix rule would
 * light it up permanently.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Initials for the avatar badge. "Priya Rathor" -> "PR". */
export function initialsFrom(name: string | null | undefined, email: string): string {
  const source = name?.trim();

  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0][0].toUpperCase();
  }

  // Falls back to the email's local part, never showing the address itself.
  return email.slice(0, 2).toUpperCase();
}
