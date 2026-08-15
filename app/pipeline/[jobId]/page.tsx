import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { SkeletonRows } from "@/components/states";
import { PipelineContent } from "../page";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

/** The board filtered to one job. Same component, scoped by jobId. */
export default async function JobPipelinePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card">
            <SkeletonRows rows={5} />
          </div>
        }
      >
        <PipelineContent jobId={jobId} />
      </Suspense>
    </AppShell>
  );
}
