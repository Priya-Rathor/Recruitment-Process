// =============================================================================
// Custom field VALUES — save the answers on one record.
//
// Owner/Admin/Recruiter (brief §6: "the same roles who can already edit that
// entity's other fields"). Viewer is read-only and never reaches the write.
//
// -----------------------------------------------------------------------------
// THIS ROUTE IS NOT A BACKDOOR INTO THE FIXED FIELDS.
//
// It writes to custom_field_values and nowhere else. It cannot touch
// candidates.name, .email or .phone — the columns migration 0023 restricted to
// the Candidate page — because it never issues an UPDATE against candidates at
// all. The reserved-key constraint is what stops a custom field being NAMED
// after one of them; this route is what stops it being written like one.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import {
  activeDefinitions,
  saveValues,
  valuesForEntities,
  type ValueWrite,
} from "@/lib/customFields/queries";
import { isCustomFieldEntity, type CustomFieldEntity } from "@/lib/customFields/definitions";
import { validateValue, type ValueError } from "@/lib/customFields/values";

/** The table each entity_type lives in. */
const TABLE_BY_ENTITY: Record<CustomFieldEntity, string> = {
  job: "jobs",
  candidate: "candidates",
  application: "applications",
};

/**
 * Confirms the record exists AND belongs to the caller's organization.
 *
 * AGENTS.md rule 5. Without this, entity_id is an unchecked id from a request
 * body: a recruiter in one tenant could attach values to another tenant's job.
 * The integrity trigger in migration 0039 checks the DEFINITION's tenant, not
 * the entity's — nothing else covers this.
 */
async function entityBelongsToOrg(
  organizationId: string,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[entityType])
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", entityId)
    .maybeSingle();

  return !error && data !== null;
}

/**
 * PUT /api/custom-fields/values
 *
 * Body: { entity_type, entity_id, values: { [field_key]: unknown } }
 *
 * Keyed by field_key rather than definition id, so a caller composes the body
 * from what it rendered without having to carry ids around. The definitions are
 * re-read here and the mapping done server-side, which also means an unknown or
 * inactive key is ignored rather than trusted.
 */
export async function PUT(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    if (!isCustomFieldEntity(raw.entity_type)) {
      return jsonError("Unknown entity type.", 400);
    }
    if (typeof raw.entity_id !== "string" || raw.entity_id.length === 0) {
      return jsonError("Missing record id.", 400);
    }
    if (typeof raw.values !== "object" || raw.values === null || Array.isArray(raw.values)) {
      return jsonError("Missing values.", 400);
    }

    const entityType = raw.entity_type;
    const entityId = raw.entity_id;
    const submitted = raw.values as Record<string, unknown>;

    // 404, not 403 — a cross-tenant id must not reveal that the row exists.
    if (!(await entityBelongsToOrg(membership.organization.id, entityType, entityId))) {
      return jsonError("That record no longer exists.", 404);
    }

    const definitions = await activeDefinitions(membership.organization.id, entityType);

    const writes: ValueWrite[] = [];
    const errors: ValueError[] = [];

    for (const definition of definitions) {
      // A key the caller did not send is LEFT ALONE, not cleared. A partial
      // save — one section of a page, one inline edit — must not wipe answers
      // that were never on screen.
      if (!(definition.field_key in submitted)) continue;

      const result = validateValue(definition, submitted[definition.field_key]);

      if (!result.ok) {
        errors.push(result.error);
        continue;
      }

      writes.push({ definitionId: definition.id, value: result.value });
    }

    if (errors.length > 0) {
      // Every failing field at once. Reporting only the first turns a form with
      // three mistakes into three round trips.
      return NextResponse.json(
        { error: errors[0].error, field_errors: errors },
        { status: 400 }
      );
    }

    const saved = await saveValues({
      organizationId: membership.organization.id,
      entityType,
      entityId,
      writes,
    });

    if (!saved.ok) return jsonError(saved.error, 400);

    return NextResponse.json({ data: { saved: writes.length } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * GET /api/custom-fields/values?entity_type=candidate&entity_ids=a,b,c
 *
 * Values for a set of records, for the list pages' optional custom columns.
 *
 * WHY THE LIST PAGES READ THIS INSTEAD OF BEING SERVER-RENDERED WITH IT.
 * The candidates table replaces its rows client-side when somebody searches, so
 * values preloaded for the first page would be missing for every search result —
 * and a missing value renders as "—", which is a LIE about the data rather than
 * a gap in it. Fetching for whatever rows are on screen has one code path and is
 * right in both cases.
 *
 * Every member may read: these are ordinary record fields, and a Viewer who can
 * see the table can see the columns in it.
 */
export async function GET(request: NextRequest) {
  try {
    const membership = await requireMembership();
    const params = request.nextUrl.searchParams;

    const entityType = params.get("entity_type");
    if (!isCustomFieldEntity(entityType)) {
      return jsonError("Unknown entity type.", 400);
    }

    const entityIds = (params.get("entity_ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    // Capped. An unbounded IN list is a way to ask the database for the whole
    // table one request at a time; the list pages page at 50.
    if (entityIds.length > 200) {
      return jsonError("Too many records requested.", 400);
    }
    if (entityIds.length === 0) {
      return NextResponse.json({ data: {} });
    }

    // Scoped to the caller's org inside the query, so an id from another tenant
    // simply returns nothing rather than being reported as forbidden.
    const byEntity = await valuesForEntities(
      membership.organization.id,
      entityType,
      entityIds
    );

    const data: Record<string, Record<string, unknown>> = {};
    for (const [entityId, values] of byEntity) {
      data[entityId] = Object.fromEntries(values);
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
