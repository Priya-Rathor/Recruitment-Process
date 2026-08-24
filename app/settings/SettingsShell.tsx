import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bell,
  Briefcase,
  Building,
  ClipboardList,
  FileCheck,
  Kanban,
  Lock,
  Mail,
  PhoneCall,
  Plug,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import type { OrgRole } from "@/lib/types";
import { hasRole } from "@/lib/tenant";

type SettingsSection = {
  href: string;
  label: string;
  description: string;
  /**
   * One icon per row, matching the icon-per-item pattern the top nav already
   * uses (components/nav/navItems.ts types its icons the same way).
   *
   * Not decoration: this list is twelve rows of similar-length text, and an icon
   * is what makes a row findable by shape on the second visit rather than by
   * reading every label. Typed as LucideIcon so a section cannot ship without one.
   */
  icon: LucideIcon;
  /** Roles that may open it. Omitted means everyone. */
  roles?: OrgRole[];
};

/**
 * Left navigation.
 *
 * Sections a role may not open are HIDDEN, not greyed out — the spec requires
 * "hide or disable (not just visually gray out without blocking)", and every
 * page re-checks independently. A Recruiter sees the two sections that are
 * genuinely theirs rather than a wall of locked doors.
 */
const SECTIONS: SettingsSection[] = [
  {
    href: "/settings/organization",
    icon: Building,
    label: "Organization",
    description: "Name, timezone, branding",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/users",
    icon: Users,
    label: "Team & permissions",
    description: "Who can do what",
  },
  {
    href: "/settings/recruitment",
    icon: Briefcase,
    label: "Recruitment",
    description: "Defaults for new applications and interviews",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/screening",
    icon: PhoneCall,
    label: "Screening",
    description: "Call attempts, retry delay, language",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/privacy",
    icon: Shield,
    label: "Privacy & consent",
    description: "Recording, consent, retention, data rights",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/pipeline",
    icon: Kanban,
    label: "Pipeline",
    description: "Stage SLA targets",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/onboarding",
    icon: FileCheck,
    label: "Onboarding documents",
    description: "The checklist every new hire owes",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/forms",
    icon: ClipboardList,
    label: "Forms",
    description: "Application forms and questionnaires",
    /*
      RECRUITERS TOO, unlike most of this list.

      A form is the thing a recruiter shares to fill their own pipeline — gating
      it behind an Owner would make "put this role online" a request rather than
      a task. It sits under Settings because it is configuration a person visits
      occasionally, not a daily surface; the job page carries the shortcut that
      actually gets used.
    */
    roles: ["owner", "admin", "recruiter"],
  },
  {
    href: "/settings/templates",
    icon: Mail,
    label: "Message templates",
    description: "What candidates are told, and when",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    label: "Notifications",
    description: "What reaches you, and how",
  },
  {
    href: "/settings/integrations",
    icon: Plug,
    label: "Integrations",
    description: "Bolna, Calendar, Email, WhatsApp, AI, n8n",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/security",
    icon: Lock,
    label: "Security & data",
    description: "Retention, audit log, danger zone",
    roles: ["owner", "admin"],
  },
];

export function visibleSections(role: OrgRole): SettingsSection[] {
  return SECTIONS.filter((section) => !section.roles || hasRole(role, section.roles));
}

export function SettingsShell({
  role,
  current,
  title,
  description,
  children,
}: {
  role: OrgRole;
  /** The href of the active section. */
  current: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const sections = visibleSections(role);

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="title is-4 mb-1">Settings</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Configure the product without touching code.
        </p>
      </div>

      <div className="is-flex" style={{ gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Stacks above the panel on narrow screens rather than becoming a
            cramped sidebar. */}
        <nav className="card" style={{ flex: "0 0 240px", minWidth: 220, padding: 12 }}>
          {sections.map((section) => {
            const active = current === section.href;
            const Icon = section.icon;

            return (
              <Link
                key={section.href}
                href={section.href}
                className={`settings-nav__item${active ? " is-active" : ""}`}
              >
                {/*
                  The icon sits in its own column beside the two lines of text,
                  rather than inline with the label — inline, the description
                  underneath would hang under the icon and the rows would lose
                  their left edge. `aria-hidden` because the label already names
                  the section; announcing "building, Organization" adds nothing.
                */}
                <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                <span className="settings-nav__text">
                  <span className="settings-nav__label">{section.label}</span>
                  <span className="settings-nav__description">{section.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <div className="mb-4">
            <h2 className="title is-5 mb-1">{title}</h2>
            {description && (
              <p className="has-text-secondary" style={{ fontSize: 13 }}>
                {description}
              </p>
            )}
          </div>
          {children}
        </div>
      </div>
    </AppShell>
  );
}

/** The shared "your role can't open this" panel. */
export function RestrictedPanel({ what }: { what: string }) {
  return (
    <div className="card">
      <h2 className="title is-5">You can&apos;t manage {what}</h2>
      <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
        Only an Owner or Admin can change this. You can still see the settings that affect your own
        work.
      </p>
      <Link className="button" href="/settings/notifications">
        Your notification settings
      </Link>
    </div>
  );
}
