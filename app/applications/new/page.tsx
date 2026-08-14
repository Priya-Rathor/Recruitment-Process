import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getLinkableOptions } from "@/lib/applications/queries";
import { NewApplicationForm } from "./NewApplicationForm";

export const metadata = { title: "New application · Recruitment OS" };
export const dynamic = "force-dynamic";

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ candidate_id?: string; job_id?: string }>;
}) {
  const [membership, preset] = await Promise.all([
    requireMembershipOrRedirect(),
    searchParams,
  ]);

  // Spec section 9: "Create/edit application — Viewer: No".
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t create applications</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Your role is Viewer, which has read-only access.
          </p>
          <Link className="button" href="/applications">
            Back to applications
          </Link>
        </div>
      </AppShell>
    );
  }

  const { jobs, candidates } = await getLinkableOptions(membership.organization.id);

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> / New
        </p>
        <h1 className="title is-4 mb-1">Link a candidate to a job</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          This creates the pipeline that match scores, screening results and interviews attach to.
        </p>
      </div>

      <NewApplicationForm
        candidates={candidates}
        jobs={jobs}
        presetCandidateId={preset.candidate_id}
        presetJobId={preset.job_id}
      />
    </AppShell>
  );
}
