import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect } from "@/lib/tenant";

export const metadata = { title: "Dashboard · Recruitment OS" };

/**
 * Placeholder landing page. Module 2 (Dashboard) replaces this with real KPI
 * tiles, the attention queue, and the AI daily brief — it is deliberately NOT
 * built here, since Module 2 depends on tables Modules 4/5/8/11/13 introduce.
 */
export default async function DashboardPage() {
  const membership = await requireMembershipOrRedirect();

  return (
    <AppShell>
      <h1 className="title is-4">{membership.organization.name}</h1>
      <p className="subtitle is-6 has-text-secondary">
        Signed in as <span style={{ textTransform: "capitalize" }}>{membership.role}</span> ·
        timezone {membership.organization.timezone}
      </p>

      <div className="card">
        <span className="tag is-info is-light mb-3">Module 2 not built yet</span>
        <p style={{ fontSize: 15 }}>
          Authentication and your organization are set up. The Dashboard&apos;s KPI tiles,
          attention queue, and AI daily brief arrive with Module 2, once Jobs, Candidates, and
          Applications exist to count.
        </p>
        <div className="buttons mt-4">
          <Link className="button is-primary" href="/team/invite">
            Invite your team
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
