import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { logAiCall } from "@/lib/activity/log";
import { getApplicationDetail } from "@/lib/applications/queries";
import { daysInCurrentStage } from "@/lib/applications/timeline";
import { generateApplicationSummary } from "@/lib/ai/generateApplicationSummary";
import { daysSince } from "@/lib/time";

/**
 * POST /api/applications/:id/ai-action — the one-paragraph application summary.
 *
 * Facts are gathered server-side from the application's own record; nothing is
 * taken from the request body. That is what makes "derived strictly from the
 * application's own structured data" true rather than aspirational — a caller
 * cannot feed the model figures of its own choosing.
 *
 * Returns unsaved output; nothing is written.
 *
 * Available to every role: the permissions table grants Viewer "View application
 * summary/timeline".
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getApplicationDetail({
      organizationId: membership.organization.id,
      applicationId: id,
    });
    if (!detail) return jsonError("Application not found.", 404);

    const result = await generateApplicationSummary({
      candidateName: detail.candidate_name,
      jobTitle: detail.job_title,
      stage: detail.stage,
      matchScore: detail.match_score,
      daysInCurrentStage: daysInCurrentStage(detail.stageHistory),
      ageDays: daysSince(detail.created_at),
      assignedRecruiterName: detail.recruiter_name,
      noteCount: detail.notes.length,
      latestNote: detail.notes[0]?.note ?? null,
    });

    if (!result.ok) {
      // 422 = output we could not trust (including a summary citing a figure we
      // never supplied); 503 = provider unavailable. Either way the structured
      // fields and timeline below remain fully usable.
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
      feature: "generateApplicationSummary",
      entityType: "application",
      entityId: id,
      ok: true,
    });

    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
