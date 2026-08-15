// =============================================================================
// Where the evaluation verdict's inputs come from.
//
// Server-only reads that feed the shared four-part shape. Each one exists to
// avoid duplicating a judgement that is already stored somewhere:
//
//   * strengths/concerns for the resume gate come from Module 7's
//     application_matches — strong_matches, gaps and needs_verification are
//     already labelled lists, each tagged with whether code or AI produced it.
//   * per-stage thresholds come from the SAME job_hiring_stages rows the caller
//     already loaded for stage visibility, so the two cannot disagree.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { formatDbError } from "@/lib/supabase/errors";
import { normalizeHighlights } from "@/lib/evaluation/verdict";
import type { JobHiringStage } from "@/lib/hiring-stages/queries";
import type { EvaluationStage } from "@/lib/applications/evaluations";

/** A labelled item in one of Module 7's three lists. */
type MatchItem = { label?: string; detail?: string; reason?: string } | string;

function itemText(item: MatchItem): string {
  if (typeof item === "string") return item;
  return item.label ?? item.detail ?? item.reason ?? "";
}

/**
 * Module 7's lists, mapped onto the shared vocabulary.
 *
 * strong_matches -> strengths. gaps AND needs_verification -> concerns: a gap
 * is a known shortfall and an unverified claim is an unknown one, and both are
 * things a recruiter should look at before advancing someone. Keeping them in
 * separate buckets would need a third column the pattern does not have.
 */
export async function getMatchHighlights({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<{ strengths: string[]; concerns: string[] }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("application_matches")
    .select("strong_matches, gaps, needs_verification")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelation(error)) {
      console.error(`[evaluation] match highlights failed: ${formatDbError(error)}`);
    }
    return { strengths: [], concerns: [] };
  }
  if (!data) return { strengths: [], concerns: [] };

  const row = data as unknown as {
    strong_matches: MatchItem[] | null;
    gaps: MatchItem[] | null;
    needs_verification: MatchItem[] | null;
  };

  return {
    strengths: normalizeHighlights((row.strong_matches ?? []).map(itemText)),
    concerns: normalizeHighlights([
      ...(row.gaps ?? []).map(itemText),
      ...(row.needs_verification ?? []).map(itemText),
    ]),
  };
}

/**
 * The job's resume gate.
 *
 * Null means no gate configured, which reads as Needs Review rather than Fail —
 * rejecting candidates against a number nobody set would be worse than
 * declining to judge.
 */
export async function getJobResumeThreshold({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("resume_passing_score")
    .eq("organization_id", organizationId)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (!isMissingRelation(error)) {
      console.error(`[evaluation] resume threshold failed: ${formatDbError(error)}`);
    }
    return null;
  }

  return (data as { resume_passing_score: number | null } | null)?.resume_passing_score ?? null;
}

/** Passing score per stage, read from rows the caller already has. */
export function thresholdsFromStages(
  rows: JobHiringStage[]
): Partial<Record<EvaluationStage, number | null>> {
  const thresholds: Partial<Record<EvaluationStage, number | null>> = {};

  for (const row of rows) {
    const config = row.config as { passingScore?: number | null };
    thresholds[row.stage_key as EvaluationStage] = config?.passingScore ?? null;
  }

  return thresholds;
}
