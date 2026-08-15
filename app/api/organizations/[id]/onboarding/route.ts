import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * POST /api/organizations/:id/onboarding
 *
 * Completes the onboarding questionnaire: stores the org's industry/size and
 * hiring-focus answer, and stamps onboarding_completed_at. Separate from the
 * ai-action endpoint on purpose — this is the explicit human "accept/skip"
 * step that follows AI's proposal.
 *
 * Owner/Admin only (section 9: "Accept onboarding AI suggestions").
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
    const text = (value: unknown, max: number) =>
      typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : null;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organizations")
      .update({
        industry: text(payload.industry, 120),
        size: text(payload.size, 120),
        onboarding_answer: text(payload.hiringFocus, 2000),
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[api] onboarding save failed: ${formatDbError(error)}`);
      return jsonError("Could not save your onboarding answers.", 400);
    }
    if (!data) return jsonError("Organization not found.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
