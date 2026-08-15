import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, requireCurrentUser, hasRole } from "@/lib/tenant";
import { getJobDetail, listTeamMembers } from "@/lib/jobs/queries";
import { listClients } from "@/lib/clients/queries";
import { listJobStages } from "@/lib/hiring-stages/queries";
import { stagesToFormState } from "@/lib/hiring-stages/formState";
import { JobForm } from "../../JobForm";

export const metadata = { title: "Edit job" };
export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [membership, user] = await Promise.all([
    requireMembershipOrRedirect(),
    requireCurrentUser(),
  ]);

  // Spec section 9: "Create/edit job — Viewer: No".
  if (!hasRole(membership.role, ["owner", "admin", "recruiter"])) {
    return (
      <AppShell>
        <div className="card">
          <h1 className="title is-5">You can&apos;t edit jobs</h1>
          <p className="has-text-secondary mb-4" style={{ fontSize: 14 }}>
            Your role is Viewer, which has read-only access.
          </p>
          <Link className="button" href={`/jobs/${id}`}>
            Back to the job
          </Link>
        </div>
      </AppShell>
    );
  }

  const [job, members, { clients }, stages] = await Promise.all([
    getJobDetail({ organizationId: membership.organization.id, jobId: id }),
    listTeamMembers(membership.organization.id),
    listClients({ organizationId: membership.organization.id }),
    listJobStages({ organizationId: membership.organization.id, jobId: id }),
  ]);

  if (!job) notFound();

  // Spec section 9: "Close job — Recruiter: Yes (own jobs)". A Recruiter editing
  // someone else's job may change everything except moving it to Closed. The
  // API re-checks this, and a database trigger enforces it even against a direct
  // PostgREST write.
  const canClose =
    hasRole(membership.role, ["owner", "admin"]) || job.owner_recruiter_id === user.id;

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/jobs">Jobs</Link> / <Link href={`/jobs/${job.id}`}>{job.title}</Link> / Edit
        </p>
        <h1 className="title is-4 mb-1">Edit job</h1>
        {job.archived_at && (
          <p style={{ fontSize: 13, color: "var(--status-attention-text)" }}>
            This job is archived. Saving will not un-archive it.
          </p>
        )}
      </div>

      <JobForm
        mode="edit"
        job={job}
        initialScreeningQuestions={job.screeningQuestions.map((question) => question.question)}
        initialInterviewQuestions={job.interviewQuestions.map((question) => question.question)}
        members={members}
        clients={clients}
        currentUserId={user.id}
        canClose={canClose}
        initialStages={stagesToFormState(stages)}
      />
    </AppShell>
  );
}
