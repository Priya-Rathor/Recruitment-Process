import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { listTeamMembers } from "@/lib/jobs/queries";
import { JobForm } from "../JobForm";

export const metadata = { title: "New job · Recruitment OS" };
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

  const members = await listTeamMembers(membership.organization.id);

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
        mode="create"
        members={members}
        currentUserId={user.id}
        // The creator becomes the owner by default, so they may set any status.
        canClose
      />
    </AppShell>
  );
}
