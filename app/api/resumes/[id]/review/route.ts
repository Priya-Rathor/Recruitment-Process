import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { getCandidate } from "@/lib/candidates/queries";
import { getParseResult, getResume } from "@/lib/resumes/queries";
import { applyReviewDecisions, parseReviewDecisions } from "@/lib/resumes/review";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/**
 * POST /api/resumes/:id/review — apply the recruiter's per-field choices.
 *
 * This is the ONLY route in the module that writes to `candidates`, and it
 * writes only fields the recruiter explicitly accepted. The decisions payload
 * names FIELDS, never values, so there is no path from a request body to an
 * attacker-chosen candidate value — the values can only come from the stored
 * parse result.
 *
 * Owner/Admin/Recruiter ("Review/confirm AI-parsed fields — Viewer: No").
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const resume = await getResume({
      organizationId: membership.organization.id,
      resumeId: id,
    });
    if (!resume) return jsonError("Resume not found.", 404);

    const parseResult = await getParseResult({
      organizationId: membership.organization.id,
      resumeId: id,
    });
    if (!parseResult) return jsonError("This resume hasn't been parsed yet.", 409);

    const candidate = await getCandidate({
      organizationId: membership.organization.id,
      candidateId: resume.candidate_id,
    });
    if (!candidate) return jsonError("Candidate not found.", 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const decisions = parseReviewDecisions(
      (body as Record<string, unknown> | null)?.decisions
    );

    const { updates, appliedFields } = applyReviewDecisions({
      candidate,
      parsed: parseResult.raw_json,
      decisions,
    });

    const supabase = await createClient();

    // Accepting nothing is a legitimate outcome — the recruiter reviewed and
    // kept everything. The review is still recorded so it isn't offered again.
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("candidates")
        .update(updates)
        .eq("id", candidate.id)
        .eq("organization_id", membership.organization.id);

      if (error) {
        if (error.message?.includes("candidates_contactable")) {
          return jsonError("A candidate needs an email address or a phone number.", 400);
        }
        console.error("[api] applying review failed:", describeDbError(error));
        return jsonError("Could not apply those changes.", 400);
      }
    }

    const reviewedAt = new Date().toISOString();

    // Which fields were applied is recorded for audit: a later "who changed the
    // expected salary?" has an answer.
    await supabase
      .from("resume_parse_results")
      .update({ applied_fields: appliedFields, reviewed_by: user.id, reviewed_at: reviewedAt })
      .eq("id", parseResult.id)
      .eq("organization_id", membership.organization.id);

    await supabase
      .from("resumes")
      .update({ parse_status: "reviewed" })
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    // Link the candidate to their most recent reviewed resume.
    await supabase
      .from("candidates")
      .update({ resume_url: resume.file_url })
      .eq("id", candidate.id)
      .eq("organization_id", membership.organization.id);

    // Module 14. Which fields a human accepted is the record that matters here:
    // it is the difference between "the AI said this" and "a recruiter agreed".
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "resume",
      entityId: id,
      eventType: "resume.review_applied",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        accepted_count: appliedFields.length,
        accepted_fields: appliedFields,
        candidate_id: candidate.id,
      },
    });

    return NextResponse.json({
      data: { applied_fields: appliedFields, reviewed_at: reviewedAt },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
