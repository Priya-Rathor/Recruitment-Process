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
//
// There used to be a third group (Automations, Analytics). It moved into the
// account menu when Module 19 added Onboarding — see the measurements below.
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
  UserCheck,
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
    /**
     * Module 19. Next to Pipeline, because it IS the next step of the same
     * lifecycle: a hire moves off the board and onto this list.
     *
     * The href is /hires, not /onboarding. /onboarding is Module 1's workspace
     * setup wizard — the page requireMembershipOrRedirect() sends a user to
     * before they have an organization. Taking that route would have broken
     * sign-up. The LABEL stays "Onboarding" because that is what a recruiter
     * calls this.
     */
    { href: "/hires", label: "Onboarding", icon: UserCheck },
    { href: "/interviews", label: "Interviews", icon: Calendar },
    { href: "/clients", label: "Clients", icon: Building2 },
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
 *
 * MODULE 19 MOVED TWO MORE, and the reason is measured rather than argued.
 *
 * The nine-item bar fitted 1440px EXACTLY — 961px of links in 961px. Adding
 * Onboarding needed 1074px, a 113px overflow, and .topnav__links has
 * `overflow-x: auto` with the scrollbar hidden, so the overflow would not have
 * looked like a bug. It would have looked like a bar with nothing after Clients.
 *
 * Measured at 1440px, links scrollWidth / clientWidth:
 *
 *   9 items (before)                     961 / 961   fits exactly
 *   10 items, Onboarding added          1074 / 961   overflows 113px
 *   ...with Analytics moved out          974 / 961   overflows 13px
 *   ...with Analytics + Automations out  961 / 961   fits
 *
 * So one move was not enough and gap-tightening could not have closed 113px —
 * every intra-group gap plus both dividers is only ~36px at this width.
 *
 * These two are the right two to move. The group they came from was labelled
 * "set up once, checked occasionally" in this file's own header, which is
 * exactly this menu's admission criterion. Analytics and the Audit log are now
 * neighbours, which is where a reader would look for either.
 *
 * It also fixed a pre-existing clip: at 1366px the nine-item bar already
 * overflowed 70px. It now fits. The first width that still clips is 1280px, at
 * 25px, down from 156px.
 *
 * Neither is adminOnly, so a Recruiter still reaches both — AccountRows filters
 * on adminOnly, not on membership of this list.
 */
export const ACCOUNT_NAV_ITEMS: NavItem[] = [
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
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
