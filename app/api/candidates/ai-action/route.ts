import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { structureCandidateText } from "@/lib/ai/structureCandidateText";

/**
 * POST /api/candidates/ai-action — structure a free-text candidate blurb into
 * profile fields.
 *
 * On the collection rather than /api/candidates/:id (as spec section 6's generic
 * template says) because the primary use is during intake, before the candidate
 * record exists. The edit page calls the same endpoint; it simply has no id to
 * supply.
 *
 * Returns unsaved proposals. The caller merges them with
 * mergeCandidateProposal(), which fills only blank fields and surfaces
 * conflicts — AI never overwrites a verified value.
 *
 * Restricted to roles that may create/edit candidates, so a read-only Viewer
 * cannot spend the organization's AI budget.
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

    const text = (body as Record<string, unknown> | null)?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return jsonError("Paste some candidate details to structure.", 400);
    }

    const result = await structureCandidateText(text);

    if (!result.ok) {
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // TODO(Module 14): log this AI call at summary level to activity_events.
    return NextResponse.json({ data: result.data, saved: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
