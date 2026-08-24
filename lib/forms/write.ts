// =============================================================================
// Creating a form, and saving its fields.
//
// TWO CALLERS, ONE SET OF RULES: the job-creation hook (which mints the default
// application form) and the field editor (which saves whatever the recruiter
// arranged). Both go through here so a form created automatically and a form
// edited by hand can never end up shaped differently.
//
// THE FIELD SAVE IS A DIFF, NOT DELETE-THEN-INSERT.
//
// job_screening_questions is replaced wholesale, and that is right for a short
// unordered list nobody has answered. It is wrong here for two reasons:
//
//   1. ANSWERS ARE KEYED ON field_key. Deleting and re-inserting mints new rows
//      for the same questions; the keys would survive only by accident, and any
//      slip would orphan every answer already collected.
//   2. Migration 0033 REFUSES to delete the email or resume field of a job
//      application form. A wholesale delete would hit that trigger and fail the
//      save — correctly, but with a database error instead of a form.
//
// So: update what exists, insert what is new, delete only what the recruiter
// actually removed.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { formatDbError } from "@/lib/supabase/errors";
import { DEFAULT_APPLICATION_FIELDS, defaultFormName } from "@/lib/forms/fields";
import type { FieldDefinition } from "@/lib/forms/validation";

type Client = SupabaseClient | Awaited<ReturnType<typeof createClient>>;

/**
 * Creates a job's application form, with the default questions, as a DRAFT.
 *
 * Called from POST /api/jobs. BEST EFFORT, ALWAYS: it returns null instead of
 * throwing, and the caller ignores the result. A job whose form did not get
 * created is a recoverable inconvenience — the card on the job page offers to
 * create one — whereas a job creation that failed because of a form is a
 * recruiter losing a requisition they just typed out.
 *
 * Draft, not published: publishing puts a URL on the public internet, and that
 * is a decision a person makes, not a side effect of creating a job.
 */
export async function ensureJobApplicationForm({
  organizationId,
  jobId,
  jobTitle,
  actorId,
  client,
}: {
  organizationId: string;
  jobId: string;
  jobTitle: string;
  actorId: string | null;
  client?: Client;
}): Promise<string | null> {
  try {
    const supabase = client ?? (await createClient());

    const { data: existing } = await supabase
      .from("forms")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .eq("purpose", "job_application")
      .maybeSingle();

    if (existing) return (existing as { id: string }).id;

    const { data, error } = await supabase
      .from("forms")
      .insert({
        organization_id: organizationId,
        job_id: jobId,
        purpose: "job_application",
        status: "draft",
        name: defaultFormName(jobTitle),
        description: null,
        created_by: actorId,
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = the unique index on (job_id) where purpose='job_application'.
      // Two concurrent creates raced; the other one won and the form exists.
      if (error.code !== "23505") {
        console.error(`[forms] auto-create failed: ${formatDbError(error)}`);
      }
      return null;
    }

    const formId = (data as { id: string }).id;

    const { error: fieldError } = await supabase.from("form_fields").insert(
      DEFAULT_APPLICATION_FIELDS.map((field, index) => ({
        organization_id: organizationId,
        form_id: formId,
        field_key: field.field_key,
        label: field.label,
        help_text: field.help_text ?? null,
        field_type: field.field_type,
        options: [],
        required: field.required,
        // True for everything shipped by default. Never settable by a client —
        // see replaceFormFields().
        is_standard: true,
        display_order: index,
      }))
    );

    if (fieldError) {
      console.error(`[forms] default fields failed: ${formatDbError(fieldError)}`);
    }

    return formId;
  } catch (error) {
    console.error(`[forms] auto-create threw: ${formatDbError(error)}`);
    return null;
  }
}

export type FieldSaveResult = { ok: true } | { ok: false; error: string };

/**
 * Saves the field list, as a diff against what is already there.
 *
 * `is_standard` is NOT taken from the payload. It is read from the existing row
 * (or false for a new field), because it decides which fields the database
 * protects and which answers are treated as profile data — and a client that
 * could set it would be able to mark its own question as a standard one, or
 * un-protect the email field by claiming it is custom.
 */
export async function replaceFormFields({
  client,
  organizationId,
  formId,
  fields,
}: {
  client: Client;
  organizationId: string;
  formId: string;
  /** Already validated against the form's purpose by parseFieldDefinitions(). */
  fields: FieldDefinition[];
}): Promise<FieldSaveResult> {
  const { data: existingRows, error: readError } = await client
    .from("form_fields")
    .select("id, field_key, is_standard")
    .eq("organization_id", organizationId)
    .eq("form_id", formId);

  if (readError) {
    console.error(`[forms] reading fields failed: ${formatDbError(readError)}`);
    return { ok: false, error: "Could not read the form's current questions." };
  }

  const existing = new Map(
    ((existingRows ?? []) as { id: string; field_key: string; is_standard: boolean }[]).map(
      (row) => [row.field_key, row]
    )
  );

  const keptKeys = new Set(fields.map((field) => field.field_key));

  // --- Removed questions ------------------------------------------------------
  //
  // Their answers stay in form_responses.raw_answers: a question a recruiter
  // stopped asking is not a question nobody answered, and the responses card
  // still shows the orphaned key.
  const removedIds = [...existing.values()]
    .filter((row) => !keptKeys.has(row.field_key))
    .map((row) => row.id);

  if (removedIds.length > 0) {
    const { error } = await client
      .from("form_fields")
      .delete()
      .eq("organization_id", organizationId)
      .eq("form_id", formId)
      .in("id", removedIds);

    if (error) {
      console.error(`[forms] deleting fields failed: ${formatDbError(error)}`);
      // The likeliest cause is migration 0033's protect trigger, whose message
      // is written for a person to read, so it is passed through.
      return {
        ok: false,
        error: error.message?.includes("cannot be removed")
          ? error.message
          : "Could not remove a question from this form.",
      };
    }
  }

  // --- Updates and inserts ---------------------------------------------------
  for (const field of fields) {
    const current = existing.get(field.field_key);

    const payload = {
      label: field.label,
      help_text: field.help_text,
      field_type: field.field_type,
      options: field.options,
      required: field.required,
      display_order: field.display_order,
    };

    if (current) {
      const { error } = await client
        .from("form_fields")
        .update(payload)
        .eq("id", current.id)
        .eq("organization_id", organizationId);

      if (error) {
        console.error(`[forms] updating field failed: ${formatDbError(error)}`);
        return {
          ok: false,
          error: error.message?.includes("cannot be made optional")
            ? error.message
            : `Could not save "${field.label}".`,
        };
      }
      continue;
    }

    const { error } = await client.from("form_fields").insert({
      ...payload,
      organization_id: organizationId,
      form_id: formId,
      field_key: field.field_key,
      // A newly added question is never standard, whatever the payload claims.
      is_standard: false,
    });

    if (error) {
      console.error(`[forms] inserting field failed: ${formatDbError(error)}`);
      return { ok: false, error: `Could not add "${field.label}".` };
    }
  }

  return { ok: true };
}
