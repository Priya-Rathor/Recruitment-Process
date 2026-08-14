import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { extractJobFromDescription } from "@/lib/ai/extractJobFromDescription";

/**
 * POST /api/jobs/ai-action — extract structured fields + draft questions from a
 * pasted job description.
 *
 * Note this sits on the COLLECTION, not on /api/jobs/:id as spec section 6's
 * generic template says. The extraction happens on /jobs/new, before any job
 * exists — an :id-scoped endpoint could not serve the flow the spec describes in
 * section 7 ("Recruiter pastes a raw job description" → step 1 of creation).
 * The same function is reachable from the edit page for a job that already
 * exists; it simply doesn't need the id.
 *
 * Returns unsaved proposals. Nothing is written: the recruiter reviews and edits
 * before saving, per "AI proposes, human confirms".
 *
 * Restricted to the roles that may create/edit a job (Viewer denied), so a
 * read-only user cannot spend the organization's AI budget.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const description = (body as Record<string, unknown> | null)?.description;
    if (typeof description !== "string" || description.trim().length === 0) {
      return jsonError("Paste a job description to extract from.", 400);
    }

    const result = await extractJobFromDescription(description);

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events
    // once logActivity() exists — required by the Module 14 retrofit.
    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
