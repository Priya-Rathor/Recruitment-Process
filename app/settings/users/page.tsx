import Link from "next/link";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { SettingsShell } from "../SettingsShell";
import { ORG_ROLES, type OrgRole } from "@/lib/types";

export const metadata = { title: "Team & permissions · Recruitment OS" };
export const dynamic = "force-dynamic";

/**
 * The permission summary.
 *
 * "View permission summary | Owner Yes | Admin Yes | Recruiter Yes (view) |
 * Viewer Yes (view)" — so this page is readable by everyone, and it is
 * READ-ONLY for all of them. Changing a role happens on the team page, which
 * has its own Owner/Admin check and its own RLS.
 *
 * The table is written out rather than derived from code, deliberately: it is
 * documentation of intent, and a version generated from the implementation
 * would agree with a bug as readily as with correct behaviour.
 */
const PERMISSIONS: { area: string; permission: string; allowed: OrgRole[]; note?: string }[] = [
  { area: "Jobs", permission: "Create and edit jobs", allowed: ["owner", "admin", "recruiter"] },
  { area: "Jobs", permission: "Close a job", allowed: ["owner", "admin", "recruiter"], note: "Recruiters, own jobs only" },
  { area: "Candidates", permission: "Add and edit candidates", allowed: ["owner", "admin", "recruiter"] },
  { area: "Candidates", permission: "Archive a candidate", allowed: ["owner", "admin"] },
  { area: "Applications", permission: "Move an application between stages", allowed: ["owner", "admin", "recruiter"] },
  { area: "Screening", permission: "Start an AI screening call", allowed: ["owner", "admin", "recruiter"] },
  { area: "Screening", permission: "Review a screening report", allowed: ["owner", "admin", "recruiter"] },
  { area: "Interviews", permission: "Schedule an interview", allowed: ["owner", "admin", "recruiter"] },
  { area: "Interviews", permission: "Submit feedback", allowed: ["owner", "admin", "recruiter"], note: "Recruiters, own interviews only" },
  { area: "Clients", permission: "Send a candidate to a client", allowed: ["owner", "admin", "recruiter"] },
  { area: "Automations", permission: "Create or activate an automation", allowed: ["owner", "admin"] },
  { area: "Automations", permission: "View run history", allowed: ["owner", "admin", "recruiter", "viewer"], note: "Recruiters, own scope" },
  { area: "Analytics", permission: "View analytics", allowed: ["owner", "admin", "recruiter", "viewer"], note: "Recruiters, own scope" },
  { area: "Analytics", permission: "Company-wide recruiter comparisons", allowed: ["owner", "admin"] },
  { area: "Analytics", permission: "Export CSV", allowed: ["owner", "admin", "recruiter"], note: "Recruiters, own scope" },
  { area: "Audit", permission: "View the security audit log", allowed: ["owner", "admin"] },
  { area: "Settings", permission: "Manage organization settings", allowed: ["owner", "admin"] },
  { area: "Settings", permission: "Manage integrations and credentials", allowed: ["owner", "admin"] },
  { area: "Settings", permission: "Manage own notification preferences", allowed: ["owner", "admin", "recruiter"] },
  { area: "Team", permission: "Invite and remove members", allowed: ["owner", "admin"] },
  { area: "Team", permission: "Grant or revoke Owner", allowed: ["owner"], note: "Owners only, and never the last one" },
];

export default async function UsersSettingsPage() {
  const membership = await requireMembershipOrRedirect();
  const canManage = hasRole(membership.role, ["owner", "admin"]);

  return (
    <SettingsShell
      role={membership.role}
      current="/settings/users"
      title="Team & permissions"
      description="What each role can do. Every rule below is enforced by the API and by the database, not just by hiding buttons."
    >
      <div className="card mb-4">
        <p style={{ fontSize: 14, margin: 0 }}>
          You are <strong style={{ textTransform: "capitalize" }}>{membership.role}</strong> in{" "}
          {membership.organization.name}.
        </p>
        {canManage && (
          <Link className="button is-small is-primary mt-3" href="/team/invite">
            Manage the team
          </Link>
        )}
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table is-fullwidth is-narrow">
            <thead>
              <tr>
                <th>Permission</th>
                {ORG_ROLES.map((role) => (
                  <th key={role} style={{ textTransform: "capitalize", textAlign: "center" }}>
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((entry, index) => {
                const newArea = index === 0 || PERMISSIONS[index - 1].area !== entry.area;

                return (
                  <tr key={`${entry.area}-${entry.permission}`}>
                    <td style={{ fontSize: 13 }}>
                      {newArea && (
                        <span
                          className="is-block has-text-secondary"
                          style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}
                        >
                          {entry.area}
                        </span>
                      )}
                      {entry.permission}
                      {entry.note && (
                        <span className="is-block has-text-secondary" style={{ fontSize: 12 }}>
                          {entry.note}
                        </span>
                      )}
                    </td>
                    {ORG_ROLES.map((role) => (
                      <td key={role} style={{ textAlign: "center", fontSize: 13 }}>
                        {/* A word, not just a colour or a tick — the row is
                            read by screen readers too. */}
                        {entry.allowed.includes(role) ? (
                          <span style={{ color: "var(--color-success)" }}>Yes</span>
                        ) : (
                          <span className="has-text-secondary">No</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsShell>
  );
}
