import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { getApplicationDetail } from "@/lib/applications/queries";
import { BriefPanel } from "./BriefPanel";

export const metadata = { title: "Interview brief" };
export const dynamic = "force-dynamic";

export default async function InterviewBriefPage({
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

  return (
    <AppShell>
      <div className="mb-5">
        <p className="has-text-secondary mb-1" style={{ fontSize: 13 }}>
          <Link href="/applications">Applications</Link> /{" "}
          <Link href={`/applications/${application.id}`}>{application.candidate_name}</Link> /
          Interview brief
        </p>
        <h1 className="title is-4 mb-1">Interview brief</h1>
        <p className="has-text-secondary" style={{ fontSize: 13 }}>
          {application.candidate_name} for {application.job_title}
        </p>
      </div>

      {/* Every role may view the brief — an interviewer is not always a recruiter. */}
      <BriefPanel applicationId={application.id} />
    </AppShell>
  );
}
