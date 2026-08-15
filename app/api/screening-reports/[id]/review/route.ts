import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { getReport } from "@/lib/screening/reportQueries";
import { applyCorrections, parseCorrections, type ReportValues } from "@/lib/screening/report";
import { logActivity } from "@/lib/activity/log";

/**
 * POST /api/screening-reports/:id/review — apply corrections and mark reviewed.
 *
 * The spec's flow: "Recruiter reviews, corrects if needed, marks as reviewed",
 * after which the report is treated as authoritative by Modules 5, 10 and 16.
 *
 * Corrections only ever touch the current values. The ai_* columns are immutable
 * (enforced by a database trigger), so what the model originally said stays
 * recoverable and corrected_fields stays meaningful.
 *
 * "Review/correct report" is Owner/Admin/Recruiter; Viewer denied.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const report = await getReport({
      organizationId: membership.organization.id,
      reportId: id,
    });
    if (!report) return jsonError("Screening report not found.", 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const corrections = parseCorrections((body as Record<string, unknown> | null)?.corrections);

    const aiOriginal: ReportValues = {
      summary_text: report.ai_summary_text,
      interest_level: report.ai_interest_level,
      expected_ctc: report.ai_expected_ctc,
      notice_period_days: report.ai_notice_period_days,
      location_accepted: report.ai_location_accepted,
      availability_notes: report.ai_availability_notes,
    };

    const current: ReportValues = {
      summary_text: report.summary_text,
      interest_level: report.interest_level,
      expected_ctc: report.expected_ctc,
      notice_period_days: report.notice_period_days,
      location_accepted: report.location_accepted,
      availability_notes: report.availability_notes,
    };

    const { updates, correctedFields } = applyCorrections({ aiOriginal, current, corrections });

    const supabase = await createClient();
    const { error } = await supabase
      .from("screening_reports")
      .update({
        ...updates,
        corrected_fields: correctedFields,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      if (error.message?.includes("original AI extraction cannot be edited")) {
        return jsonError("The original AI extraction cannot be edited.", 400);
      }
      console.error("[api] report review failed:", error);
      return jsonError("Could not save that review.", 400);
    }

    // Module 14. WHICH fields a human corrected, not what they were corrected
    // to — the report row holds the values, and this log answers "how often does
    // the AI get the interest level wrong?", which is the question worth asking.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "screening_report",
      entityId: id,
      eventType: "screening_report.reviewed",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { corrected_fields: correctedFields },
    });

    return NextResponse.json({
      data: { corrected_fields: correctedFields, reviewed_at: new Date().toISOString() },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
