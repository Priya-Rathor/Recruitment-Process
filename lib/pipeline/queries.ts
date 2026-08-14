// Pipeline board data. Caller-scoped in one place, so the AI layer physically
// cannot be handed work the user isn't allowed to see.
import { createClient } from "@/lib/supabase/server";
import { assessSla, toSlaConfig, type SlaAssessment, type SlaConfig } from "@/lib/pipeline/sla";
import { PIPELINE_STAGES, type ApplicationStage } from "@/lib/applications/stages";
import { daysSince } from "@/lib/time";
import type { OrgRole } from "@/lib/types";
import type { PipelineItem } from "@/lib/ai/prioritizePipeline";

export type BoardCard = {
  id: string;
  candidateId: string;
  candidateName: string;
  jobId: string;
  jobTitle: string;
  stage: ApplicationStage;
  matchScore: number | null;
  recruiterName: string | null;
  daysInStage: number;
  sla: SlaAssessment;
  awaitingScreeningReview: boolean;
};

export type Board = {
  columns: { stage: ApplicationStage; cards: BoardCard[] }[];
  /** Terminal outcomes, shown as counts rather than columns. */
  exits: { stage: ApplicationStage; count: number }[];
  slaConfig: SlaConfig;
  totalCards: number;
  failed: boolean;
};

/** The organization's SLA targets. */
export async function getSlaConfig(organizationId: string): Promise<SlaConfig> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_sla_config")
    .select("stage, target_days")
    .eq("organization_id", organizationId);

  if (error) {
    console.error("[pipeline] SLA config load failed:", error);
    return {};
  }
  return toSlaConfig((data ?? []) as { stage: string; target_days: number }[]);
}

/**
 * Builds the board.
 *
 * `viewerRole`/`viewerId` apply the same scoping as the applications list: a
 * Recruiter sees their own plus unassigned work. This is the ONLY place board
 * scoping happens, and Ask Pipeline AI is fed from its output — which is what
 * makes "never suggests work outside the recruiter's scope" hold.
 */
export async function getBoard({
  organizationId,
  viewerRole,
  viewerId,
  jobId,
  now = new Date(),
}: {
  organizationId: string;
  viewerRole: OrgRole;
  viewerId: string;
  jobId?: string | null;
  now?: Date;
}): Promise<Board> {
  const supabase = await createClient();
  const slaConfig = await getSlaConfig(organizationId);

  let query = supabase
    .from("applications")
    .select(
      "id, stage, match_score, updated_at, candidate_id, job_id, " +
        "candidate:candidates(id, name), job:jobs(id, title), " +
        "recruiter:users!applications_assigned_recruiter_id_fkey(name, email)"
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("updated_at", { ascending: true })
    .limit(500);

  if (jobId) query = query.eq("job_id", jobId);

  if (viewerRole === "recruiter") {
    query = query.or(`assigned_recruiter_id.eq.${viewerId},assigned_recruiter_id.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[pipeline] board load failed:", error);
    return { columns: [], exits: [], slaConfig, totalCards: 0, failed: true };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    stage: ApplicationStage;
    match_score: number | null;
    updated_at: string;
    candidate_id: string;
    job_id: string;
    candidate: { id: string; name: string } | null;
    job: { id: string; title: string } | null;
    recruiter: { name: string | null; email: string } | null;
  }[];

  // Which applications have a screening report nobody has reviewed. One query
  // rather than per card — the spec's headline attention signal.
  const pendingReview = new Set<string>();
  if (rows.length > 0) {
    const { data: reports } = await supabase
      .from("screening_reports")
      .select("application_id")
      .eq("organization_id", organizationId)
      .is("reviewed_at", null)
      .in(
        "application_id",
        rows.map((row) => row.id)
      );

    for (const report of (reports ?? []) as { application_id: string }[]) {
      pendingReview.add(report.application_id);
    }
  }

  const cards: BoardCard[] = rows.map((row) => {
    // updated_at is a proxy for stage entry. Exact time-in-stage lives in
    // application_stage_history; reading it per card would be an N+1, and
    // Module 16 does that properly for analytics.
    const daysInStage = daysSince(row.updated_at, now);

    return {
      id: row.id,
      candidateId: row.candidate_id,
      candidateName: row.candidate?.name ?? "Unknown candidate",
      jobId: row.job_id,
      jobTitle: row.job?.title ?? "Unknown job",
      stage: row.stage,
      matchScore: row.match_score,
      recruiterName: row.recruiter ? row.recruiter.name ?? row.recruiter.email : null,
      daysInStage,
      sla: assessSla({ stage: row.stage, daysInStage, config: slaConfig }),
      awaitingScreeningReview: pendingReview.has(row.id),
    };
  });

  const columns = PIPELINE_STAGES.map((stage) => ({
    stage,
    cards: cards
      .filter((card) => card.stage === stage)
      // Most overdue first, so the top of each column is what needs doing.
      .sort((a, b) => b.sla.overdueDays - a.sla.overdueDays || b.daysInStage - a.daysInStage),
  }));

  // rejected/withdrawn are exits from the board, not columns — otherwise the
  // board fills with finished work and stops being a work queue.
  const exits = (["rejected", "withdrawn"] as ApplicationStage[]).map((stage) => ({
    stage,
    count: cards.filter((card) => card.stage === stage).length,
  }));

  return { columns, exits, slaConfig, totalCards: cards.length, failed: false };
}

/**
 * Converts board cards into the de-identified shape Ask Pipeline AI receives.
 * Terminal stages are excluded — finished work is not "what to do next".
 */
export function boardToPipelineItems(board: Board): PipelineItem[] {
  return board.columns
    .flatMap((column) => column.cards)
    .filter((card) => card.sla.status !== "not_tracked")
    .map((card) => ({
      id: card.id,
      candidateName: card.candidateName,
      jobTitle: card.jobTitle,
      stage: card.stage,
      daysInStage: card.daysInStage,
      slaStatus: card.sla.status,
      overdueDays: card.sla.overdueDays,
      matchScore: card.matchScore,
      awaitingScreeningReview: card.awaitingScreeningReview,
    }));
}

/** Open jobs, for the board's job filter. */
export async function listBoardJobs(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .in("status", ["open", "on_hold"])
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []) as { id: string; title: string }[];
}
