import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logAiCall } from "@/lib/activity/log";
import { generateOnboardingRecommendations } from "@/lib/ai/generateOnboardingRecommendations";

/**
 * POST /api/organizations/:id/ai-action
 *
 * Invokes Module 1's AI Service Layer function and returns structured, UNSAVED
 * suggestions for human review. It writes nothing — accepting suggestions is a
 * separate, explicit action by the Owner/Admin (spec: AI proposes, human
 * confirms; AI output never writes directly to a trusted table).
 *
 * Restricted to Owner/Admin per the section 9 permission
 * "Accept onboarding AI suggestions".
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    if (membership.organization.id !== id) return jsonError("Organization not found.", 404);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const hiringFocus = typeof payload.hiringFocus === "string" ? payload.hiringFocus : "";
    if (hiringFocus.trim().length === 0) {
      return jsonError("Tell us what kind of hiring you do so we can suggest defaults.", 400);
    }

    const result = await generateOnboardingRecommendations({
      hiringFocus,
      industry: membership.organization.industry,
      teamSize: membership.organization.size,
    });

    if (!result.ok) {
      // 503 for a provider/config problem the user can retry or skip past;
      // 422 for output we received but could not trust.
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
      feature: "generateOnboardingRecommendations",
      entityType: "organization",
      entityId: id,
      ok: true,
    });

    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
