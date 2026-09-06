// =============================================================================
// The public form's read of job custom fields.
//
// SEPARATE FROM ./queries.ts BECAUSE THE CLIENT IS DIFFERENT, NOT BECAUSE THE
// QUERY IS. ./queries.ts uses the session-scoped server client; the public
// application page has no session at all, so it must use the service-role
// client — which BYPASSES RLS. AGENTS.md rule 8: every admin-client query
// filters organization_id explicitly, because there is no safety net behind it.
//
// The admin client is PASSED IN rather than created here. The caller
// (lib/forms/public.ts) already holds one it built after verifying the form
// token; making a second would be a second place that could be handed the wrong
// organization id.
// =============================================================================
import type { createAdminClient } from "@/lib/supabase/admin";
import { formatDbError } from "@/lib/supabase/errors";
import { toPublicFields, type PublicCustomField, type PublicCustomSource } from "@/lib/customFields/publicForm";
import { validateValue } from "@/lib/customFields/values";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Active job-level custom fields flagged for the public form.
 *
 * Returns [] on failure rather than throwing. The caller treats a custom
 * question as additive; an application form that 500s because an optional extra
 * field could not be read would turn a degraded feature into a lost applicant.
 */
export async function loadPublicCustomFields(
  admin: Admin,
  organizationId: string,
  existingKeys: readonly string[]
): Promise<PublicCustomField[]> {
  const { data, error } = await admin
    .from("custom_field_definitions")
    .select("field_key, label, field_type, options, required, display_order")
    // Rule 8. Not optional on this client.
    .eq("organization_id", organizationId)
    .eq("entity_type", "job")
    .eq("active", true)
    .eq("show_on_public_form", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error(`[customFields] public form fields load failed: ${formatDbError(error)}`);
    return [];
  }

  const rows = ((data ?? []) as unknown as PublicCustomSource[]).map((row) => ({
    ...row,
    options: Array.isArray(row.options)
      ? row.options.filter((option): option is string => typeof option === "string")
      : [],
  }));

  return toPublicFields(rows, existingKeys);
}

/**
 * Stores a public form's custom answers AGAINST THE APPLICATION.
 *
 * entity_type is 'application' while these definitions are 'job' — the one
 * permitted mismatch, and the whole point of the feature. See the header of
 * lib/customFields/publicForm.ts.
 *
 * BEST EFFORT, AND DELIBERATELY SO. By the time this runs the answers are
 * already in form_responses.raw_answers and the application exists. Failing the
 * submission here would send an applicant away to re-type everything in order
 * to fix a problem on our side, when their answers are in fact already saved.
 * Returns the number written so the caller can log it.
 *
 * The answers stay in raw_answers as well. That is not duplication for its own
 * sake: raw_answers is the immutable record of what the applicant typed, while
 * custom_field_values is the record's CURRENT value, which a recruiter may later
 * correct on the application page. Collapsing the two would mean an edit
 * rewriting history.
 */
export async function savePublicCustomAnswers(params: {
  admin: Admin;
  organizationId: string;
  applicationId: string;
  answers: Record<string, unknown>;
}): Promise<number> {
  const { admin, organizationId, applicationId, answers } = params;
  if (Object.keys(answers).length === 0) return 0;

  const { data, error } = await admin
    .from("custom_field_definitions")
    .select("id, field_key, label, field_type, options, required")
    .eq("organization_id", organizationId)
    .eq("entity_type", "job")
    .eq("active", true)
    .eq("show_on_public_form", true);

  if (error) {
    console.error(`[customFields] public answer definitions load failed: ${formatDbError(error)}`);
    return 0;
  }

  const definitions = ((data ?? []) as unknown as {
    id: string;
    field_key: string;
    label: string;
    field_type: PublicCustomSource["field_type"];
    options: unknown;
    required: boolean;
  }[]).map((row) => ({
    ...row,
    options: Array.isArray(row.options)
      ? row.options.filter((option): option is string => typeof option === "string")
      : [],
  }));

  const rows: Record<string, unknown>[] = [];

  for (const definition of definitions) {
    if (!(definition.field_key in answers)) continue;

    // Re-validated here even though the form already validated it. This is the
    // server-side write; the shape it stores is its own responsibility, and a
    // value that reached this point through some other path must not be trusted
    // because an earlier one checked it.
    const result = validateValue(definition, answers[definition.field_key]);
    if (!result.ok || result.value === null) continue;

    rows.push({
      organization_id: organizationId,
      custom_field_definition_id: definition.id,
      entity_type: "application",
      entity_id: applicationId,
      value: result.value,
    });
  }

  if (rows.length === 0) return 0;

  const { error: writeError } = await admin
    .from("custom_field_values")
    .upsert(rows, { onConflict: "custom_field_definition_id,entity_id" });

  if (writeError) {
    console.error(`[customFields] public answers write failed: ${formatDbError(writeError)}`);
    return 0;
  }

  return rows.length;
}
