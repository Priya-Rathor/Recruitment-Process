// =============================================================================
// Loading the Evaluation panel.
//
// Reads THREE sources and normalises them into one list (see
// lib/applications/evaluations.ts for why they are not merged into one table).
// Every query is tenant-scoped, and a failure in one source degrades that
// section rather than the page: a screening report that will not load must not
// take the director-round history down with it.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import {
  outcomeFromInterest,
  outcomeFromRecommendation,
  scaleScore,
  sortEntries,
  type EvaluationEntry,
  type EvaluationStage,
  type InterestLevel,
} from "@/lib/applications/evaluations";

/** Every evaluation entry for one application, newest first. */
export async function listEvaluationEntries({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<EvaluationEntry[]> {
  const [screening, interviews, manual] = await Promise.all([
    loadScreeningEntries({ organizationId, applicationId }),
    loadInterviewEntries({ organizationId, applicationId }),
    loadManualEntries({ organizationId, applicationId }),
  ]);

  return sortEntries([...screening, ...interviews, ...manual]);
}

/**
 * AI screening calls (Modules 8/9).
 *
 * One entry per CALL, not per report — the spec's "a call can happen more than
 * once, e.g. retries" is the whole reason this section is repeatable, and a
 * failed call with no report is still a call that happened. Joining from the
 * call side keeps those visible; joining from the report side would hide every
 * attempt that never produced one.
 */
async function loadScreeningEntries({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<EvaluationEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("screening_calls")
    .select(
      "id, status, attempt_number, started_at, created_at, failure_reason, " +
        "report:screening_reports(id, summary_text, interest_level, score)"
    )
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId);

  if (error) {
    console.error("[evaluations] screening calls failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    status: string;
    attempt_number: number | null;
    started_at: string | null;
    created_at: string;
    failure_reason: string | null;
    report: { id: string; summary_text: string; interest_level: string; score: number | null } | null;
  }[]).map((call) => {
    const report = Array.isArray(call.report) ? call.report[0] : call.report;
    const interest = (report?.interest_level ?? null) as InterestLevel | null;

    return {
      id: call.id,
      stage: "ai_screening_call" as EvaluationStage,
      occurredAt: call.started_at ?? call.created_at,
      score: report?.score ?? null,
      nativeScore: report?.score ?? null,
      nativeScale: 10,
      outcome: report ? outcomeFromInterest(interest) : null,
      interested: interest,
      summary:
        report?.summary_text ??
        // A failed call has no report; saying why beats an empty row that looks
        // like a call nobody wrote up.
        (call.failure_reason ? `Call did not complete: ${call.failure_reason}` : null),
      loggedByName: null,
      source: "screening_report" as const,
      // Edited on Module 9's report screen, not here — two update paths for one
      // row is how they drift.
      href: report ? `/applications/${applicationId}/screening-report` : null,
      editable: false,
    };
  });
}

/**
 * Scheduled interviews (Module 11), phone and video.
 *
 * Surfaced rather than duplicated: the spec says to reuse the existing
 * scheduling flow, so these rows are read-only here and edited where they are
 * scheduled. `mode` maps straight onto the stage, which is why no translation
 * table is needed.
 */
async function loadInterviewEntries({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<EvaluationEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, scheduled_at, mode, status, notes, " +
        "feedback:interview_feedback(rating, recommendation, notes, " +
        "author:users!interview_feedback_submitted_by_fkey(name, email))"
    )
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .in("mode", ["phone", "video"]);

  if (error) {
    console.error("[evaluations] interviews failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    scheduled_at: string;
    mode: "phone" | "video" | "onsite";
    status: string;
    notes: string | null;
    feedback:
      | {
          rating: number;
          recommendation: string;
          notes: string | null;
          author: { name: string | null; email: string } | null;
        }[]
      | null;
  }[]).map((interview) => {
    // Panel interviews can carry several feedback rows; the most generous
    // reading is the first submitted, and the row links out for the rest.
    const feedback = interview.feedback?.[0] ?? null;

    return {
      id: interview.id,
      stage: (interview.mode === "phone" ? "phone_interview" : "video_interview") as EvaluationStage,
      occurredAt: interview.scheduled_at,
      // interview_feedback is 1-5; the panel's badges are 1-10.
      score: scaleScore(feedback?.rating ?? null, 5),
      nativeScore: feedback?.rating ?? null,
      nativeScale: 5,
      outcome: feedback ? outcomeFromRecommendation(feedback.recommendation) : "pending",
      interested: null,
      summary: feedback?.notes ?? interview.notes,
      loggedByName: feedback?.author?.name ?? feedback?.author?.email ?? null,
      source: "interview" as const,
      href: `/interviews/${interview.id}`,
      editable: false,
    };
  });
}

/** Entries logged by hand, for stages with no engine behind them. */
async function loadManualEntries({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<EvaluationEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("application_evaluations")
    .select(
      "id, stage_key, occurred_at, score, outcome, summary, " +
        "author:users!application_evaluations_logged_by_fkey(name, email)"
    )
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId);

  if (error) {
    // Migration 0022 not applied yet — a build state, not a failure.
    if (isMissingRelation(error)) {
      console.info("[evaluations] application_evaluations not created yet — run migration 0022.");
      return [];
    }
    console.error("[evaluations] manual entries failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    stage_key: EvaluationStage;
    occurred_at: string;
    score: number | null;
    outcome: "pass" | "fail" | "pending";
    summary: string | null;
    author: { name: string | null; email: string } | null;
  }[]).map((row) => ({
    id: row.id,
    stage: row.stage_key,
    occurredAt: row.occurred_at,
    score: row.score,
    nativeScore: row.score,
    nativeScale: 10,
    outcome: row.outcome,
    interested: null,
    summary: row.summary,
    loggedByName: row.author?.name ?? row.author?.email ?? null,
    source: "manual" as const,
    href: null,
    // The only source this panel owns, so the only one it may edit.
    editable: true,
  }));
}
