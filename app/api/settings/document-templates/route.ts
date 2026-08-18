// =============================================================================
// The organization's document checklist — list and create.
//
// Owner/Admin only, in the route AND in RLS (document_templates_insert_admin).
// The checklist is an organization-wide policy: one recruiter deciding a
// relieving letter is optional would change it for every hire from then on.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { listDocumentTemplates } from "@/lib/onboarding/queries";
import { validateTemplate } from "@/lib/onboarding/templates";
import { formatDbError } from "@/lib/supabase/errors";

/** GET — every template, active and inactive. Any member: the names appear on
 *  every hire's checklist, so a Recruiter has to be able to read them. */
export async function GET() {
  try {
    const membership = await requireMembership();

    const { templates, failed, schemaOutOfDate } = await listDocumentTemplates({
      organizationId: membership.organization.id,
      includeInactive: true,
    });

    if (failed) {
      return jsonError(
        schemaOutOfDate
          ? "The onboarding tables aren't in the database yet. Apply migration 0026."
          : "Could not load the document checklist.",
        schemaOutOfDate ? 503 : 400
      );
    }

    return NextResponse.json({ data: templates, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST — add a document type. */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = validateTemplate(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();

    // Appended, not inserted at the top: a new type is the least likely to be
    // the first thing a hire is asked for, and reordering is one drag away.
    const { data: last } = await supabase
      .from("organization_document_templates")
      .select("display_order")
      .eq("organization_id", membership.organization.id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = ((last as { display_order: number } | null)?.display_order ?? 0) + 1;

    const { data, error } = await supabase
      .from("organization_document_templates")
      .insert({
        organization_id: membership.organization.id,
        name: parsed.value.name,
        description: parsed.value.description,
        required: parsed.value.required,
        expected_from: parsed.value.expected_from,
        active: parsed.value.active,
        display_order: nextOrder,
      })
      .select("id, name, description, required, expected_from, display_order, active, created_at")
      .single();

    if (error) {
      // 23505 is the (organization_id, name) unique index. Named rather than
      // reported as a generic failure: "PAN Card already exists" tells the user
      // what to do, "could not save" does not.
      if (formatDbError(error).includes("23505")) {
        return jsonError("A document type with that name already exists.", 409);
      }
      console.error(`[onboarding] template insert failed: ${formatDbError(error)}`);
      return jsonError("Could not add that document type.", 400);
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
