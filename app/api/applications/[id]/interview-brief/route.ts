import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
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
      supabase
        .from("job_interview_questions")
        .select("question, display_order")
        .eq("job_id", application.job_id)
        .order("display_order", { ascending: true }),
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
      existingQuestions: ((questionRows.data ?? []) as { question: string }[]).map(
        (row) => row.question
      ),
    });

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events.
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
