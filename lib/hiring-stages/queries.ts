// Read side for hiring stages. One tenant-scoped place for pages and routes.
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { STAGES, type StageKey } from "@/lib/hiring-stages/catalog";
import { emptyStageConfig, normalizeStageConfig, type StageConfig } from "@/lib/hiring-stages/config";
import { formatDbError } from "@/lib/supabase/errors";

export type JobHiringStage = {
  stage_key: StageKey;
  enabled: boolean;
  prompt_template: string | null;
  config: StageConfig;
  updated_at: string | null;
};

const COLUMNS = "stage_key, enabled, prompt_template, config, updated_at";

/**
 * All four stages for a job, whether or not a row exists yet.
 *
 * ALWAYS RETURNS FOUR. A job configured before this feature shipped has no rows
 * at all, and a caller that had to handle "missing means off" in five places
 * would eventually get it wrong in one of them. The gaps are filled here, once.
 */
export async function listJobStages({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<JobHiringStage[]> {
  const stored = new Map<StageKey, JobHiringStage>();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_hiring_stages")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);

  if (error) {
    // Migration 0020 not applied yet — a build state, not a failure. Reporting
    // it as an error would raise the dev overlay's issue count on every job
    // page and teach people to ignore it (see lib/intake/queries.ts).
    if (isMissingRelation(error)) {
      console.info("[hiring-stages] job_hiring_stages not created yet — run migration 0020.");
    } else {
      console.error(`[hiring-stages] load failed: ${formatDbError(error)}`);
    }
  }

  for (const row of (data ?? []) as unknown as JobHiringStage[]) {
    stored.set(row.stage_key, {
      ...row,
      // The column is jsonb, so what comes back is whatever was written. Passed
      // through the same normaliser the write path uses, so a row written by a
      // direct PostgREST call cannot hand the UI a shape it does not expect.
      config: normalizeStageConfig(row.stage_key, row.config),
    });
  }

  return STAGES.map(
    (stage) =>
      stored.get(stage.key) ?? {
        stage_key: stage.key,
        enabled: false,
        prompt_template: null,
        config: emptyStageConfig(stage.key),
        updated_at: null,
      }
  );
}

/** Just the screening stage, for Module 8's call path. Null when not enabled. */
export async function getEnabledScreeningStage({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<JobHiringStage | null> {
  const stages = await listJobStages({ organizationId, jobId });
  const screening = stages.find((stage) => stage.stage_key === "ai_screening_call");
  return screening?.enabled ? screening : null;
}
