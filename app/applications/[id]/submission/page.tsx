import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getSubmissionForApplication } from "@/lib/clients/queries";
import { SubmissionPanel } from "./SubmissionPanel";

export const metadata = { title: "Client submission · Recruitment OS" };
export const dynamic = "force-dynamic";

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await requireMembershipOrRedirect();

  const application = await getApplicationDetail({
    organizationId: membership.organization.id,
    applicationId: id,
  });
  if (!application) notFound();

  const existing = await getSubmissionForApplication({
    organizationId: membership.organization.id,
    applicationId: id,
  });

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> /{" "}
          <Link href={`/applications/${application.id}`}>{application.candidate_name}</Link> /
          Submission
        </p>
        <h1 className="title is-4 mb-1">Submit to client</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {application.candidate_name} for {application.job_title}
        </p>
      </div>

      <SubmissionPanel
        applicationId={application.id}
        candidateName={application.candidate_name}
        existing={existing}
        canSubmit={hasRole(membership.role, ["owner", "admin", "recruiter"])}
      />
    </AppShell>
  );
}
