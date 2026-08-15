import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import type { OrgRole } from "@/lib/types";
import { hasRole } from "@/lib/tenant";

type SettingsSection = {
  href: string;
  label: string;
  description: string;
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
    label: "Organization",
    description: "Name, timezone, branding",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/users",
    label: "Team & permissions",
    description: "Who can do what",
  },
  {
    href: "/settings/recruitment",
    label: "Recruitment",
    description: "Defaults for new applications and interviews",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/screening",
    label: "Screening",
    description: "Call attempts, retry delay, language",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/pipeline",
    label: "Pipeline",
    description: "Stage SLA targets",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "What reaches you, and how",
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    description: "Bolna, Calendar, Email, AI, n8n",
    roles: ["owner", "admin"],
  },
  {
    href: "/settings/security",
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
            return (
              <Link
                key={section.href}
                href={section.href}
                className="is-block"
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: active ? "var(--color-primary)" : "transparent",
                  color: active ? "#fff" : "var(--color-text)",
                  textDecoration: "none",
                  marginBottom: 2,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: active ? 600 : 400 }}>
                  {section.label}
                </span>
                <span
                  className="is-block"
                  style={{
                    fontSize: 12,
                    color: active ? "rgba(255,255,255,0.8)" : "var(--color-secondary-text)",
                  }}
                >
                  {section.description}
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
