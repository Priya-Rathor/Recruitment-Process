import { activeDefinitions } from "@/lib/customFields/queries";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { listTeamMembers } from "@/lib/jobs/queries";
import { listClients } from "@/lib/clients/queries";
import { isAgencyMode } from "@/lib/organizations/hiringModel";
import { JobForm } from "../JobForm";

export const metadata = { title: "New job" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  // Spec section 9: "Create/edit job — Viewer: No". Blocked here as well as in
  // the API, and stated plainly rather than shown as a dead form.
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t create jobs</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Your role is Viewer, which has read-only access. Ask an Owner or Admin if you need to
            create requisitions.
          </p>
          <Link className="button" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </AppShell>
    );
  }

  const agencyMode = isAgencyMode(membership.organization);

  const [members, { clients }, customFields] = await Promise.all([
    listTeamMembers(membership.organization.id),
    agencyMode
      ? listClients({ organizationId: membership.organization.id })
      : Promise.resolve({ clients: [], failed: false }),
    // MODULE 27. No values to load — the job does not exist yet, so the form
    // holds the draft and writes it once the job has an id.
    activeDefinitions(membership.organization.id, "job"),
  ]);

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/jobs">Jobs</Link> / New
        </p>
        <h1 className="title is-4 mb-1">New job</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          Paste a description to have AI structure it, or fill the form in yourself.
        </p>
      </div>

      <JobForm
        customFields={customFields}
        mode="create"
        members={members}
        clients={clients}
        agencyMode={agencyMode}
        currentUserId={user.id}
        // The creator becomes the owner by default, so they may set any status.
        canClose
      />
    </AppShell>
  );
}
