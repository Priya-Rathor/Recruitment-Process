// =============================================================================
// Surfacing a form answer on the application. SERVER ONLY.
//
// -----------------------------------------------------------------------------
// BY REFERENCE. NOTHING IS COPIED, EVER.
//
// The brief is explicit: "read-only, sourced from form_responses — do not
// duplicate the data into a second table, just display it by reference."
//
// So there is no column, no table and no cached value anywhere in this feature.
// The configuration — which question, and what to call it — lives in the
// `request_form` action's config, which is a POINTER. The value is read from
// form_responses.raw_answers at display time, every time.
//
// Three things that follow from that, all of them wanted:
//
//   1. A candidate who resubmits shows their new answer immediately. A copied
//      value would show the old one until somebody noticed and rebuilt it.
//   2. Deleting the response — which Module 22's retention rules eventually do —
//      removes the surfaced field too. A copy would outlive the data it came
//      from, which is exactly the leak a retention policy exists to prevent.
//   3. There is no write path to get wrong. The field is derived, so it cannot
//      drift.
//
// The cost is a join at read time, which is one query per application detail
// page against a table indexed on application_id.
//
// -----------------------------------------------------------------------------
// WHY THE CONFIGURATION IS READ FROM THE JOB'S WORKFLOW RATHER THAN STORED.
//
// "Which answer should this application show?" is a property of the JOB's stage
// workflow, not of the application — every application to a job surfaces the
// same field. Storing it per application would mean one row per application per
// surfaced field, all identical, all needing a backfill the moment a recruiter
// changed the label.
// =============================================================================
import { formatDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import type { Action } from "@/lib/automations/catalog";

export type SurfacedAnswer = {
  /** What the recruiter chose to call it — "Preferred Call Time". */
  label: string;
  /** The form it came from, for the "where is this from?" line. */
  formName: string;
  /**
   * The answer, rendered as text. Null means the candidate has not answered yet.
   *
   * NULL AND "" ARE DIFFERENT and both reach the UI distinctly: null is "no
   * response yet", an empty string is "they submitted and left it blank". A
   * component that showed both as an em dash would let a recruiter believe a
   * form was never sent when it was answered and skipped.
   */
  value: string | null;
  /** When they answered. Null while unanswered. */
  answeredAt: string | null;
};

/**
 * Reads a surfaced answer's raw value into display text.
 *
 * Handles the shapes form_responses.raw_answers actually holds: a string from
 * the text and choice fields, an array from `checkbox`, a boolean from
 * `yes_no`, a number from `number`. Anything else renders as JSON rather than
 * as "[object Object]", which at least tells whoever sees it what went wrong.
 */
export function renderAnswer(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(", ");
  }
  return JSON.stringify(raw);
}

/**
 * Every answer this application's job asked to surface, with its current value.
 *
 * Returns an empty list when the job's workflow surfaces nothing, which is the
 * normal state for a job that has not applied a flow template.
 */
export async function loadSurfacedAnswers({
  organizationId,
  applicationId,
  jobId,
}: {
  organizationId: string;
  applicationId: string;
  jobId: string;
}): Promise<SurfacedAnswer[]> {
  const supabase = await createClient();

  // --- What this job asked to surface ---------------------------------------
  const { data: ruleData, error: ruleError } = await supabase
    .from("automations")
    .select("actions")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("source", "stage_workflow");

  if (ruleError) {
    console.error(`[workflow] surfaced-answer config read failed: ${formatDbError(ruleError)}`);
    return [];
  }

  /** form_id -> the fields that form was asked to surface. */
  const wanted = new Map<string, { fieldKey: string; label: string }[]>();

  for (const row of (ruleData ?? []) as unknown as { actions: Action[] }[]) {
    for (const action of collectActions(row.actions ?? [])) {
      if (action.type !== "request_form") continue;

      const config = action.config ?? {};
      const formId = config.form_id;
      const fieldKey = config.surface_field_key;
      const label = config.surface_label;

      if (
        typeof formId !== "string" ||
        typeof fieldKey !== "string" ||
        typeof label !== "string"
      ) {
        continue;
      }

      const list = wanted.get(formId) ?? [];
      // A job could surface the same field twice through two rules — the same
      // form requested on two stages, say. One entry per (form, field), because
      // two identical rows on the application would read as a rendering bug.
      if (!list.some((entry) => entry.fieldKey === fieldKey)) {
        list.push({ fieldKey, label });
      }
      wanted.set(formId, list);
    }
  }

  if (wanted.size === 0) return [];

  // --- What the candidate actually answered ---------------------------------
  const formIds = [...wanted.keys()];

  const [responses, forms] = await Promise.all([
    supabase
      .from("form_responses")
      .select("form_id, raw_answers, created_at")
      .eq("organization_id", organizationId)
      .eq("application_id", applicationId)
      .in("form_id", formIds)
      // Newest first: a candidate who resubmitted meant the second answer.
      .order("created_at", { ascending: false }),
    supabase
      .from("forms")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", formIds),
  ]);

  if (responses.error) {
    console.error(`[workflow] surfaced-answer read failed: ${formatDbError(responses.error)}`);
    /**
     * A FAILED READ RETURNS NOTHING RATHER THAN "not answered yet".
     *
     * The two look identical on screen and mean opposite things. Rendering a
     * failed read as an unanswered field would tell a recruiter the candidate had
     * not replied when they had — so the section simply does not appear, and the
     * error is in the log where it belongs.
     */
    return [];
  }

  const formNames = new Map(
    ((forms.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name])
  );

  /** The newest response per form. */
  const latest = new Map<string, { raw_answers: Record<string, unknown>; created_at: string }>();
  for (const row of (responses.data ?? []) as unknown as {
    form_id: string;
    raw_answers: Record<string, unknown>;
    created_at: string;
  }[]) {
    if (!latest.has(row.form_id)) latest.set(row.form_id, row);
  }

  const surfaced: SurfacedAnswer[] = [];

  for (const [formId, fields] of wanted) {
    const response = latest.get(formId);

    for (const field of fields) {
      surfaced.push({
        label: field.label,
        formName: formNames.get(formId) ?? "a form",
        // No response at all is null; a response that omitted the key is also
        // null, because the candidate did not answer that question either.
        value: response ? renderAnswer(response.raw_answers?.[field.fieldKey]) : null,
        answeredAt: response?.created_at ?? null,
      });
    }
  }

  return surfaced;
}

/**
 * Flattens an action list, descending into `wait_then`'s nested actions.
 *
 * Without this, a Request Form scheduled after a wait would configure a surfaced
 * field that never appeared — the config would be one level down from where the
 * scan looked, and the failure would be a permanently missing field with no
 * error anywhere.
 */
function collectActions(actions: Action[]): Action[] {
  const flat: Action[] = [];

  for (const action of actions) {
    flat.push(action);
    if (action.type === "wait_then" && Array.isArray(action.config?.actions)) {
      flat.push(...(action.config.actions as Action[]));
    }
  }

  return flat;
}
