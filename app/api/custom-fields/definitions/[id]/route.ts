// =============================================================================
// One custom field definition — edit, reorder, deactivate, delete.
//
// Owner/Admin only, matching the create route.
//
// -----------------------------------------------------------------------------
// WHAT CANNOT BE EDITED, AND WHY.
//
// field_key and entity_type are immutable after creation. The key is what every
// stored value and every saved {{custom.*}} token points at; changing it would
// orphan the data and turn a message template into a sentence with a hole in
// it. entity_type is worse still — moving a definition from job to candidate
// would leave its existing values filed against rows of the wrong kind, and the
// integrity trigger in migration 0039 would then reject any further write.
//
// field_type is editable, deliberately, but the UI warns: existing values keep
// their old shape, and the renderer formats by the CURRENT type. Narrowing a
// dropdown's options can therefore leave a stored answer that is no longer
// offered — which is why values are validated on write, not on read, so an old
// answer stays readable rather than disappearing from a record.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";
import { countValuesForDefinition } from "@/lib/customFields/queries";
import { isCustomFieldType, needsOptions } from "@/lib/customFields/definitions";

type Context = { params: Promise<{ id: string }> };

/**
 * Reads the definition, scoped to the caller's organization.
 *
 * Filters organization_id AS WELL AS id — AGENTS.md rule 5. A definition id
 * from another tenant returns 404 rather than 403, so nobody can use this
 * endpoint to learn which ids exist.
 */
async function loadDefinition(organizationId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select("id, entity_type, field_key, field_type, options, active, display_order")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`[api] custom field read failed: ${formatDbError(error)}`);
    return null;
  }

  return (data as unknown as {
    id: string;
    entity_type: "job" | "candidate" | "application";
    field_key: string;
    field_type: string;
    options: unknown;
    active: boolean;
    display_order: number;
  } | null) ?? null;
}

/** GET — one definition, plus how many records hold a value for it. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const { id } = await context.params;

    const definition = await loadDefinition(membership.organization.id, id);
    if (!definition) return jsonError("That field no longer exists.", 404);

    const valueCount = await countValuesForDefinition(membership.organization.id, id);
    return NextResponse.json({ data: { ...definition, value_count: valueCount } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH — label, type, options, required, public-form toggle, order, active.
 *
 * One endpoint for all of them because they are all "edit this definition", and
 * the reorder handles and the active switch would otherwise be two more routes
 * repeating the same tenancy check.
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    const existing = await loadDefinition(membership.organization.id, id);
    if (!existing) return jsonError("That field no longer exists.", 404);

    const update: Record<string, unknown> = {};

    if (typeof raw.label === "string") {
      const label = raw.label.trim();
      if (!label) return jsonError("Give the field a label.", 400);
      if (label.length > 120) return jsonError("Label must be 120 characters or fewer.", 400);
      // The KEY is not recomputed. See the header.
      update.label = label;
    }

    if (raw.field_type !== undefined) {
      if (!isCustomFieldType(raw.field_type)) {
        return jsonError("That field type isn't available for custom fields.", 400);
      }
      update.field_type = raw.field_type;
    }

    if (raw.options !== undefined) {
      if (!Array.isArray(raw.options)) return jsonError("Options must be a list.", 400);
      const options = raw.options
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter(Boolean);
      if (new Set(options).size !== options.length) {
        return jsonError("Options must be unique.", 400);
      }
      update.options = options;
    }

    // The options/type pair is checked TOGETHER, against the values that will
    // actually land in the row — whichever of the two this request changes.
    // Checking each against the stored other is how a dropdown ends up with no
    // options: change the type in one request, the options in the next.
    const effectiveType = (update.field_type ?? existing.field_type) as string;
    const effectiveOptions = (update.options ??
      (Array.isArray(existing.options) ? existing.options : [])) as string[];

    if (isCustomFieldType(effectiveType) && needsOptions(effectiveType)) {
      if (effectiveOptions.length === 0) {
        return jsonError("Add at least one option for this field type.", 400);
      }
    } else if (effectiveOptions.length > 0) {
      // Leaving stale options behind means they reappear if the type is ever
      // changed back — a list nobody wrote and nobody can see to correct.
      update.options = [];
    }

    if (raw.required !== undefined) update.required = raw.required === true;
    if (raw.active !== undefined) update.active = raw.active === true;

    if (raw.show_on_public_form !== undefined) {
      const show = raw.show_on_public_form === true;
      if (show && existing.entity_type !== "job") {
        return jsonError("Only job fields can appear on a public application form.", 400);
      }
      update.show_on_public_form = show;
    }

    if (raw.display_order !== undefined) {
      const order = Number(raw.display_order);
      if (!Number.isInteger(order) || order < 0 || order > 10_000) {
        return jsonError("Invalid position.", 400);
      }
      update.display_order = order;
    }

    if (Object.keys(update).length === 0) {
      return jsonError("Nothing to update.", 400);
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("custom_field_definitions")
      .update(update)
      .eq("organization_id", membership.organization.id)
      .eq("id", id);

    if (error) {
      console.error(`[api] custom field update failed: ${formatDbError(error)}`);
      return jsonError("Could not save that field.", 400);
    }

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE — deactivates by default; erases only when nothing would be lost.
 *
 * THE BRIEF ASKS FOR SOFT DELETE AND IT IS RIGHT: "Deleting it will hide that
 * data (not erase it)". So the default is active = false, and every stored
 * answer survives and stays queryable.
 *
 * `?permanent=true` is offered for the other case — a field created by mistake,
 * with no data behind it — because otherwise every typo becomes permanent
 * clutter in the settings list. It is REFUSED the moment a single value exists,
 * server-side, regardless of what the client sends. A destructive option that
 * the caller alone decides is safe is not a safe option.
 */
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const { id } = await context.params;

    const existing = await loadDefinition(membership.organization.id, id);
    if (!existing) return jsonError("That field no longer exists.", 404);

    const valueCount = await countValuesForDefinition(membership.organization.id, id);
    const wantsPermanent = request.nextUrl.searchParams.get("permanent") === "true";
    const supabase = await createClient();

    if (wantsPermanent) {
      if (valueCount > 0) {
        return jsonError(
          `${valueCount} record${valueCount === 1 ? "" : "s"} still hold data in this field. ` +
            "Turn it off instead — that hides it without erasing anything.",
          409
        );
      }

      const { error } = await supabase
        .from("custom_field_definitions")
        .delete()
        .eq("organization_id", membership.organization.id)
        .eq("id", id);

      if (error) {
        console.error(`[api] custom field delete failed: ${formatDbError(error)}`);
        return jsonError("Could not delete that field.", 400);
      }

      return NextResponse.json({ data: { id, deleted: true } });
    }

    const { error } = await supabase
      .from("custom_field_definitions")
      .update({ active: false })
      .eq("organization_id", membership.organization.id)
      .eq("id", id);

    if (error) {
      console.error(`[api] custom field deactivate failed: ${formatDbError(error)}`);
      return jsonError("Could not turn that field off.", 400);
    }

    return NextResponse.json({ data: { id, deleted: false, hidden_values: valueCount } });
  } catch (error) {
    return handleRouteError(error);
  }
}
