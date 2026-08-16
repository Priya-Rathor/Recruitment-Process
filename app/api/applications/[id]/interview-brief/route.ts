import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { logAiCall } from "@/lib/activity/log";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getMatch } from "@/lib/matching/queries";
import { getReportForApplication } from "@/lib/screening/reportQueries";
import { generateInterviewBrief } from "@/lib/ai/generateInterviewBrief";

export const maxDuration = 60;

/**
 * POST /api/applications/:id/interview-brief — generate the interviewer's brief.
 *
 * Facts are gathered SERVER-SIDE from the match (Module 7) and the screening
 * report (Module 9). Nothing comes from the request body, so the brief is drawn
 * from the same data as the application summary and cannot contradict it — the
 * spec's test.
 *
 * Available to every role: "View AI interview brief" is Yes for all four,
 * including Viewer, because an interviewer may not be a recruiter.
 */
/** Order-preserving, case-insensitive dedupe for the merged question lists. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (text.length === 0) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const application = await getApplicationDetail({
      organizationId: membership.organization.id,
      applicationId: id,
    });
    if (!application) return jsonError("Application not found.", 404);

    const supabase = await createClient();

    const [match, report, candidateRow, questionRows] = await Promise.all([
      getMatch({ organizationId: membership.organization.id, applicationId: id }),
      getReportForApplication({ organizationId: membership.organization.id, applicationId: id }),
      supabase
        .from("candidates")
        .select("current_role, current_company, total_experience_years")
        .eq("id", application.candidate_id)
        .eq("organization_id", membership.organization.id)
        .maybeSingle(),
      // The job's interview stages, not job_interview_questions.
      //
      // That table backed a standalone list on the job form that no longer
      // exists — the questions moved into the Phone Interview and Video
      // Interview stages' own suggested lists (migration 0025 copied them).
      // Reading the retired table would have left this brief quietly frozen on
      // whatever was there the day the form changed.
      supabase
        .from("job_hiring_stages")
        .select("stage_key, config")
        .eq("organization_id", membership.organization.id)
        .eq("job_id", application.job_id)
        .in("stage_key", ["phone_interview", "video_interview"]),
    ]);

    const candidate = candidateRow.data as unknown as {
      current_role: string | null;
      current_company: string | null;
      total_experience_years: number | null;
    } | null;

    // Strengths and gaps come from the match rather than being re-derived, so
    // the brief and the match page say the same thing.
    const strengths = (match?.strong_matches ?? []).map((finding) => finding.detail);
    const toVerify = [
      ...(match?.gaps ?? []).map((finding) => finding.detail),
      ...(match?.needs_verification ?? []).map((finding) => finding.detail),
    ];

    const result = await generateInterviewBrief({
      candidateName: application.candidate_name,
      jobTitle: application.job_title,
      strengths,
      toVerify,
      currentRole: candidate?.current_role ?? null,
      currentCompany: candidate?.current_company ?? null,
      totalExperienceYears: candidate?.total_experience_years ?? null,
      // Only a REVIEWED report is authoritative enough to brief from.
      expectedCtc: report?.reviewed_at ? report.expected_ctc : null,
      noticePeriodDays: report?.reviewed_at ? report.notice_period_days : null,
      screeningSummary: report?.reviewed_at ? report.summary_text : null,
      // Both stages' lists, deduplicated. The brief is for whoever runs the
      // next round and does not know which one that is, so offering the union
      // beats guessing — and 0025 seeded both from one list, so overlap is
      // expected rather than a sign of duplication.
      existingQuestions: dedupe(
        ((questionRows.data ?? []) as { stage_key: string; config: { questions?: string[] } }[])
          .flatMap((row) => row.config?.questions ?? [])
      ),
    });

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // Module 14 (section 10): every AI call recorded at summary level — which
    // feature ran and whether it worked. Never the prompt or the completion:
    // those carry candidate personal data, and this table is append-only.
    const aiActor = await requireCurrentUser();
    await logAiCall({
      organizationId: membership.organization.id,
      actorId: aiActor.id,
      actorLabel: aiActor.name ?? aiActor.email,
      feature: "generateInterviewBrief",
      entityType: "application",
      entityId: id,
      ok: true,
    });

    return NextResponse.json({
      data: result.data,
      // Explicit: preparation, not a verdict. Nothing is saved.
      saved: false,
      usedReviewedReport: Boolean(report?.reviewed_at),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
