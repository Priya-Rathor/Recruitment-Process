import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorState, SkeletonRows } from "@/components/states";
import { requireMembershipOrRedirect, hasRole } from "@/lib/tenant";
import { getBoard, listBoardJobs } from "@/lib/pipeline/queries";
import { editableSlaRows } from "@/lib/pipeline/sla";
import { PipelineBoard } from "./PipelineBoard";
import { AskPipelineAI } from "./AskPipelineAI";
import { SlaSettings } from "./SlaSettings";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export async function PipelineContent({ jobId }: { jobId?: string | null }) {
  const membership = await requireMembershipOrRedirect();

  const canMove = hasRole(membership.role, ["owner", "admin", "recruiter"]);
  const canAskAi = canMove;
  const canEditSla = hasRole(membership.role, ["owner", "admin"]);

  const [board, jobs] = await Promise.all([
    getBoard({
      organizationId: membership.organization.id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
      jobId,
    }),
    listBoardJobs(membership.organization.id),
  ]);

  if (board.failed) return <ErrorState message="Couldn't load the pipeline." />;

  const activeJob = jobId ? jobs.find((job) => job.id === jobId) : null;

  return (
    <>
      <div className="is-flex is-justify-content-space-between is-align-items-flex-end mb-4">
        <div>
          <h1 className="title is-4 mb-1">
            {activeJob ? activeJob.title : "Pipeline"}
          </h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {board.totalCards} application{board.totalCards === 1 ? "" : "s"} on the board
            {membership.role === "recruiter" && " · yours and unassigned"}
          </p>
        </div>
        <SlaSettings rows={editableSlaRows(board.slaConfig)} canEdit={canEditSla} />
      </div>

      {jobs.length > 0 && (
        <div className="card mb-4">
          <div className="buttons">
            <Link className={`button is-small ${!jobId ? "is-primary" : ""}`} href="/pipeline">
              All jobs
            </Link>
            {jobs.slice(0, 12).map((job) => (
              <Link
                key={job.id}
                className={`button is-small ${jobId === job.id ? "is-primary" : ""}`}
                href={`/pipeline/${job.id}`}
              >
                {job.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {canAskAi && <AskPipelineAI jobId={jobId} />}

      <PipelineBoard board={board} canMove={canMove} />
    </>
  );
}

export default async function PipelinePage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <PipelineContent />
      </Suspense>
    </AppShell>
  );
}
