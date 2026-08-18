// =============================================================================
// Adding a one-off document to one hire's checklist.
//
// For something specific to this person — a visa copy, a professional licence —
// that does not belong on the organization-wide template. template_id stays
// null, which is also what makes it deletable: the RLS delete policy allows
// template_id IS NULL only, so nobody can quietly shrink the standard checklist
// for one hire.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { getOnboardingDetail } from "@/lib/onboarding/queries";
import { isDocumentOwner } from "@/lib/onboarding/documents";
import { formatDbError } from "@/lib/supabase/errors";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (name.length === 0) return jsonError("Give the document a name.", 400);
    if (name.length > 120) return jsonError("Keep the name under 120 characters.", 400);

    if (!isDocumentOwner(raw.expected_from)) {
      return jsonError("Choose who provides this document — Candidate or Recruiter.", 400);
    }

    const detail = await getOnboardingDetail({
      organizationId: membership.organization.id,
      recordId: id,
    });
    if (!detail) return jsonError("Onboarding record not found.", 404);

    if (detail.status === "completed") {
      // Adding a requirement to a finished onboarding would reopen it by
      // implication without saying so. Reopen it explicitly first.
      return jsonError(
        "This onboarding is marked complete. Reopen it before adding a document.",
        409
      );
    }

    const isAdmin = hasRole(membership.role, ["owner", "admin"]);
    if (!isAdmin && detail.assigned_to !== null && detail.assigned_to !== membership.user_id) {
      return jsonError("This hire's onboarding is assigned to someone else.", 403);
    }

    // Appended after everything already on the checklist, within its group.
    const maxOrder = detail.documents.reduce(
      (highest, document) => Math.max(highest, document.display_order),
      0
    );

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("onboarding_documents")
      .insert({
        organization_id: membership.organization.id,
        onboarding_record_id: id,
        template_id: null,
        name,
        required: raw.required === true,
        expected_from: raw.expected_from,
        display_order: maxOrder + 1,
        status: "pending",
        notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 2000) : null,
      })
      .select("id, name, required, expected_from, status, display_order")
      .single();

    if (error) {
      console.error(`[onboarding] one-off document insert failed: ${formatDbError(error)}`);
      return jsonError("Could not add that document.", 400);
    }

    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: detail.application_id,
      eventType: "onboarding.document_added",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { onboarding_id: id, document_name: name },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
