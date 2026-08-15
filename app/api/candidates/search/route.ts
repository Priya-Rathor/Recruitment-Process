import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership } from "@/lib/tenant";
import { logAiCall } from "@/lib/activity/log";
import { parseCandidateSearch } from "@/lib/ai/parseCandidateSearch";
import { describeFilters } from "@/lib/candidates/filters";
import { listCandidates } from "@/lib/candidates/queries";

/**
 * POST /api/candidates/search — natural-language candidate search.
 *
 * Two clearly separated steps:
 *   1. AI translates the sentence into a filter object (it never sees candidate
 *      data and never picks rows).
 *   2. The SAME deterministic listCandidates() the manual filters use executes
 *      those filters.
 *
 * That separation is what makes the spec's test hold — natural-language results
 * are identical to the literal filter equivalents, because it is literally the
 * same query path.
 *
 * Available to every role including Viewer ("Use natural-language search —
 * Viewer: Yes (read-only results)"); results are read-only for everyone here.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireMembership();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const query = (body as Record<string, unknown> | null)?.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return jsonError("Type what you're looking for.", 400);
    }

    const parsed = await parseCandidateSearch(query);

    if (!parsed.ok) {
      // AI unavailable must degrade to "use the manual filters", never to a
      // wrong or unfiltered result set.
      const status = parsed.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: parsed.message, code: parsed.code }, { status });
    }

    const { candidates, total, failed } = await listCandidates({
      organizationId: membership.organization.id,
      filters: parsed.data,
      limit: 50,
    });

    if (failed) return jsonError("Could not run that search.", 400);

    // Module 14 (section 10): every AI call recorded at summary level — which
    // feature ran and whether it worked. Never the prompt or the completion:
    // those carry candidate personal data, and this table is append-only.
    const aiActor = await requireCurrentUser();
    await logAiCall({
      organizationId: membership.organization.id,
      actorId: aiActor.id,
      actorLabel: aiActor.name ?? aiActor.email,
      feature: "parseCandidateSearch",
      entityType: "candidate",
      entityId: null,
      ok: true,
    });

    return NextResponse.json({
      data: candidates,
      total,
      // Returned so the UI can show how the sentence was interpreted, and the
      // recruiter can correct a misreading instead of silently trusting it.
      filters: parsed.data,
      interpretation: describeFilters(parsed.data),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
