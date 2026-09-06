// =============================================================================
// Custom fields — the reads and the write.
//
// SERVER ONLY. Imports lib/supabase/server.ts, so a "use client" module may
// never import this file; the types and the pure logic it needs live in
// ./definitions.ts and ./values.ts, which touch nothing. That split is the
// project's standing rule (AGENTS.md §Client/server import boundary) and
// app/settings/clientBoundary.test.ts enforces it.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatDbError } from "@/lib/supabase/errors";
import type { CustomFieldDefinition, CustomFieldEntity } from "@/lib/customFields/definitions";

/** The columns every read selects. Listed once so they cannot drift apart. */
const DEFINITION_COLUMNS =
  "id, organization_id, entity_type, field_key, label, field_type, options, " +
  "required, show_on_public_form, display_order, active, created_by, created_at, updated_at";

function normalizeOptions(raw: unknown): string[] {
  // jsonb comes back as parsed JSON, but a hand-edited row could hold anything.
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function toDefinition(row: Record<string, unknown>): CustomFieldDefinition {
  return {
    ...(row as unknown as CustomFieldDefinition),
    options: normalizeOptions(row.options),
  };
}

/**
 * Every definition for an organization, active or not.
 *
 * The settings page needs the inactive ones — that is where a retired field is
 * seen and can be switched back on. Render paths must use activeDefinitions().
 */
export async function listDefinitions(
  organizationId: string,
  entityType?: CustomFieldEntity
): Promise<CustomFieldDefinition[]> {
  const supabase = await createClient();

  let query = supabase
    .from("custom_field_definitions")
    .select(DEFINITION_COLUMNS)
    // Explicit, even though RLS also constrains it. AGENTS.md rule 5: an
    // id-addressed or tenant-scoped read filters organization_id itself, so the
    // query is still correct if it is ever moved to the admin client.
    .eq("organization_id", organizationId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (entityType) query = query.eq("entity_type", entityType);

  const { data, error } = await query;

  if (error) {
    console.error(`[customFields] listDefinitions failed: ${formatDbError(error)}`);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toDefinition);
}

/** What a form renders: active only, in display order. */
export async function activeDefinitions(
  organizationId: string,
  entityType: CustomFieldEntity
): Promise<CustomFieldDefinition[]> {
  const all = await listDefinitions(organizationId, entityType);
  return all.filter((definition) => definition.active);
}

/**
 * The job-level fields a public application form must also ask.
 *
 * ORG-WIDE, NOT PER-JOB. The definition carries no job_id: switching
 * "Show on public application form" on makes the question appear on every job's
 * form, which is what the brief describes ("appears on that job's public
 * application page" for any job). A per-job override would need a third table
 * and is deliberately not in this pass.
 */
export async function publicFormDefinitions(
  organizationId: string
): Promise<CustomFieldDefinition[]> {
  const jobFields = await activeDefinitions(organizationId, "job");
  return jobFields.filter((definition) => definition.show_on_public_form);
}

export type CustomFieldValueRow = {
  custom_field_definition_id: string;
  entity_id: string;
  value: unknown;
};

/**
 * Values for ONE record, keyed by definition id.
 *
 * A Map rather than an array because every caller immediately asks "what is the
 * value for this definition?" — and a linear scan per field turns a 20-field
 * form into 400 comparisons for no reason.
 */
export async function valuesForEntity(
  organizationId: string,
  entityType: CustomFieldEntity,
  entityId: string
): Promise<Map<string, unknown>> {
  const byEntity = await valuesForEntities(organizationId, entityType, [entityId]);
  return byEntity.get(entityId) ?? new Map();
}

/**
 * Values for MANY records at once — the list-page column path.
 *
 * One query for the whole page. The obvious alternative (a query per row) is
 * the N+1 that makes a 50-row table take fifty round trips.
 */
export async function valuesForEntities(
  organizationId: string,
  entityType: CustomFieldEntity,
  entityIds: readonly string[]
): Promise<Map<string, Map<string, unknown>>> {
  const result = new Map<string, Map<string, unknown>>();
  if (entityIds.length === 0) return result;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("custom_field_values")
    .select("custom_field_definition_id, entity_id, value")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
    .in("entity_id", [...entityIds]);

  if (error) {
    console.error(`[customFields] valuesForEntities failed: ${formatDbError(error)}`);
    return result;
  }

  for (const row of (data ?? []) as unknown as CustomFieldValueRow[]) {
    const existing = result.get(row.entity_id) ?? new Map<string, unknown>();
    existing.set(row.custom_field_definition_id, row.value);
    result.set(row.entity_id, existing);
  }

  return result;
}

/**
 * How many records hold a value for a definition.
 *
 * Powers the delete confirmation's "12 jobs have data in this field". A count
 * the person can see is the difference between an informed decision and a
 * guess — which is why the settings UI refuses to open the dialog without it.
 */
export async function countValuesForDefinition(
  organizationId: string,
  definitionId: string
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("custom_field_values")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("custom_field_definition_id", definitionId);

  if (error) {
    console.error(`[customFields] countValuesForDefinition failed: ${formatDbError(error)}`);
    return 0;
  }

  return count ?? 0;
}

export type ValueWrite = { definitionId: string; value: unknown | null };

/**
 * Saves a set of answers for one record.
 *
 * UPSERT ON (definition, entity), never delete-then-insert: a failed second
 * statement in that pair would leave the record with its previous answers gone
 * and nothing in their place.
 *
 * A null value DELETES the row rather than storing a null. "No answer" and "a
 * row holding null" are the same fact, and keeping both shapes means every
 * reader has to handle two representations of nothing.
 */
export async function saveValues(params: {
  organizationId: string;
  entityType: CustomFieldEntity;
  entityId: string;
  writes: readonly ValueWrite[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, entityType, entityId, writes } = params;
  if (writes.length === 0) return { ok: true };

  const supabase = await createClient();

  const toUpsert = writes.filter((write) => write.value !== null);
  const toDelete = writes.filter((write) => write.value === null).map((w) => w.definitionId);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("custom_field_values").upsert(
      toUpsert.map((write) => ({
        organization_id: organizationId,
        custom_field_definition_id: write.definitionId,
        entity_type: entityType,
        entity_id: entityId,
        value: write.value,
      })),
      { onConflict: "custom_field_definition_id,entity_id" }
    );

    if (error) {
      console.error(`[customFields] saveValues upsert failed: ${formatDbError(error)}`);
      return { ok: false, error: "Could not save those fields." };
    }
  }

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("custom_field_values")
      .delete()
      .eq("organization_id", organizationId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .in("custom_field_definition_id", toDelete);

    if (error) {
      console.error(`[customFields] saveValues delete failed: ${formatDbError(error)}`);
      return { ok: false, error: "Could not clear those fields." };
    }
  }

  return { ok: true };
}
