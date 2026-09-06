// =============================================================================
// Custom field DEFINITIONS — list and create.
//
// Owner/Admin for writes (brief §6). Every member may read: the render paths on
// the job, candidate and application forms need the vocabulary, and a Viewer
// who could not read it would see a form with holes in it.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";
import { listDefinitions } from "@/lib/customFields/queries";
import {
  isCustomFieldEntity,
  validateDefinition,
  type CustomFieldEntity,
  type DefinitionInput,
} from "@/lib/customFields/definitions";

/** GET /api/custom-fields/definitions?entity=job */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();

    const entityParam = request.nextUrl.searchParams.get("entity");
    if (entityParam !== null && !isCustomFieldEntity(entityParam)) {
      return jsonError("Unknown entity type.", 400);
    }

    const definitions = await listDefinitions(
      membership.organization.id,
      entityParam ?? undefined
    );

    return NextResponse.json({ data: definitions, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Narrows an untrusted body into the shape validateDefinition() expects.
 *
 * Every field is checked rather than spread: a POST can carry anything, and
 * spreading would let a caller set display_order, active, organization_id or
 * created_by — the last of which would forge authorship in the audit trail.
 */
function readBody(body: unknown):
  | { ok: true; input: DefinitionInput }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid body." };
  }

  const raw = body as Record<string, unknown>;

  if (!isCustomFieldEntity(raw.entity_type)) {
    return { ok: false, error: "Choose which records this field belongs to." };
  }
  if (typeof raw.label !== "string") {
    return { ok: false, error: "Give the field a label." };
  }
  if (typeof raw.field_type !== "string") {
    return { ok: false, error: "Choose a field type." };
  }

  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    input: {
      entity_type: raw.entity_type,
      label: raw.label,
      // Cast is safe: validateDefinition() checks membership of CUSTOM_FIELD_TYPES
      // at runtime and rejects anything else with a message naming the reason.
      field_type: raw.field_type as DefinitionInput["field_type"],
      options,
      required: raw.required === true,
      show_on_public_form: raw.show_on_public_form === true,
    },
  };
}

/** POST /api/custom-fields/definitions */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);
    const user = await requireCurrentUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = readBody(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const entityType: CustomFieldEntity = parsed.input.entity_type;

    // The keys already in use for this entity, so validateDefinition() can
    // de-duplicate rather than letting the unique index produce a 409 the
    // person has to interpret.
    const existing = await listDefinitions(membership.organization.id, entityType);
    const takenKeys = existing.map((definition) => definition.field_key);

    const validated = validateDefinition(parsed.input, takenKeys);
    if (!validated.ok) return jsonError(validated.error, 400);

    // New fields go last. Reordering is a separate, explicit act.
    const nextOrder = existing.reduce(
      (max, definition) => Math.max(max, definition.display_order),
      -1
    ) + 1;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("custom_field_definitions")
      .insert({
        organization_id: membership.organization.id,
        entity_type: entityType,
        field_key: validated.field_key,
        label: parsed.input.label.trim(),
        field_type: parsed.input.field_type,
        options: parsed.input.options,
        required: parsed.input.required,
        show_on_public_form: parsed.input.show_on_public_form,
        display_order: nextOrder,
        created_by: user.id,
      })
      .select("id, field_key")
      .single();

    if (error) {
      console.error(`[api] custom field create failed: ${formatDbError(error)}`);
      return jsonError("Could not create that field.", 400);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
