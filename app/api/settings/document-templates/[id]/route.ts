// =============================================================================
// One document template — edit, reorder, or remove.
//
// EDITING NEVER TOUCHES A HIRE IN PROGRESS. onboarding_documents snapshot their
// name, required flag and owner at generation time, so there is nothing here to
// propagate and nothing to guard against. That is by design, not by omission —
// see the note at the top of migration 0026.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { validateTemplate } from "@/lib/onboarding/templates";
import { formatDbError } from "@/lib/supabase/errors";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    // A toggle-only request (active, required) is the common case and must not
    // have to resend the whole row — so the full validator runs only when the
    // name is actually being changed.
    if ("name" in raw || "description" in raw || "expected_from" in raw) {
      const parsed = validateTemplate({
        name: raw.name,
        description: raw.description,
        expected_from: raw.expected_from,
        required: raw.required,
        active: raw.active,
      });
      if (!parsed.ok) return jsonError(parsed.error, 400);

      updates.name = parsed.value.name;
      updates.description = parsed.value.description;
      updates.expected_from = parsed.value.expected_from;
    }

    if ("required" in raw) {
      if (typeof raw.required !== "boolean") return jsonError("Invalid required flag.", 400);
      updates.required = raw.required;
    }

    if ("active" in raw) {
      if (typeof raw.active !== "boolean") return jsonError("Invalid active flag.", 400);
      updates.active = raw.active;
    }

    if ("display_order" in raw) {
      const order = raw.display_order;
      if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
        return jsonError("Invalid display order.", 400);
      }
      updates.display_order = order;
    }

    if (Object.keys(updates).length === 0) return jsonError("No valid fields provided.", 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_document_templates")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, name, description, required, expected_from, display_order, active, created_at")
      .maybeSingle();

    if (error) {
      if (formatDbError(error).includes("23505")) {
        return jsonError("A document type with that name already exists.", 409);
      }
      console.error(`[onboarding] template update failed: ${formatDbError(error)}`);
      return jsonError("Could not save that change.", 400);
    }
    if (!data) return jsonError("Document type not found.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE — remove a document type from the checklist.
 *
 * Documents already generated from it survive: onboarding_documents.template_id
 * is ON DELETE SET NULL, so a hire midway through still owes what they owed. A
 * cascade here would silently delete a verified PAN card from somebody's record.
 *
 * Deactivating is usually the better move, and the UI says so — but a type added
 * by mistake five minutes ago should be removable, not permanently greyed out.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    const supabase = await createClient();
    const { error } = await supabase
      .from("organization_document_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      console.error(`[onboarding] template delete failed: ${formatDbError(error)}`);
      return jsonError("Could not remove that document type.", 400);
    }

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleRouteError(error);
  }
}
