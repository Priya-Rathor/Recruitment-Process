// =============================================================================
// Reordering the checklist.
//
// ONE REQUEST FOR THE WHOLE ORDER, not one per moved row. A drag that shifts
// five rows would otherwise be five requests, and a failure halfway through
// would leave the list in an order nobody arranged.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { orderingFromIds } from "@/lib/onboarding/templates";
import { formatDbError } from "@/lib/supabase/errors";

export async function PUT(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const ids = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return jsonError("Send the full ordered list of ids.", 400);
    }
    if (ids.length === 0) return jsonError("Nothing to reorder.", 400);
    if (new Set(ids).size !== ids.length) return jsonError("Duplicate ids in the order.", 400);

    const supabase = await createClient();

    // Every id must already belong to this org. Checked BEFORE writing anything:
    // RLS would refuse a foreign row anyway, but it would refuse it silently
    // partway through and leave half an order applied.
    const { data: owned, error: readError } = await supabase
      .from("organization_document_templates")
      .select("id")
      .eq("organization_id", membership.organization.id)
      .in("id", ids as string[]);

    if (readError) {
      console.error(`[onboarding] reorder read failed: ${formatDbError(readError)}`);
      return jsonError("Could not save the new order.", 400);
    }
    if ((owned ?? []).length !== ids.length) {
      return jsonError("That list refers to a document type that isn't yours.", 400);
    }

    for (const row of orderingFromIds(ids as string[])) {
      const { error } = await supabase
        .from("organization_document_templates")
        .update({ display_order: row.display_order })
        .eq("id", row.id)
        .eq("organization_id", membership.organization.id);

      if (error) {
        // Partially applied. Said out loud rather than reported as success: the
        // user's screen shows the order they dragged, and the database does not.
        console.error(`[onboarding] reorder write failed: ${formatDbError(error)}`);
        return jsonError(
          "The new order was only partly saved. Reload to see what stuck.",
          400
        );
      }
    }

    return NextResponse.json({ data: { ordered: ids.length } });
  } catch (error) {
    return handleRouteError(error);
  }
}
