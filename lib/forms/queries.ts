// =============================================================================
// Recruiter-side reads.
//
// Everything here uses the SESSION client, so RLS is doing the tenant scoping —
// and every query filters organization_id anyway, because no module in this
// codebase relies on a single layer for that.
//
// THE SUBMISSION COUNT IS COUNTED, NEVER STORED. A `submission_count` column
// would be a number any signed-in user could PATCH through PostgREST, and
// "24 applications received" has to be a count of rows that exist. Three
// queries and a Map is the price of that being true.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatDbError } from "@/lib/supabase/errors";
import type { AnswerValue, Form, FormField, FormResponse, FormSummary } from "@/lib/forms/types";

const FORM_SELECT =
  "id, organization_id, name, description, purpose, job_id, status, token_version, " +
  "created_by, created_at, updated_at";

const FIELD_SELECT =
  "id, organization_id, form_id, field_key, label, help_text, field_type, options, " +
  "required, is_standard, display_order, created_at";

/** Normalises the jsonb options column, which can be anything on a bad write. */
function normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toField(row: Record<string, unknown>): FormField {
  return { ...(row as unknown as FormField), options: normalizeOptions(row.options) };
}

/**
 * Every form in the organization, job-linked and standalone.
 *
 * One query per relation rather than per form: an organization has tens of
 * forms, not thousands, and a per-row count would be a query per row on a
 * settings page.
 */
export async function listForms({
  organizationId,
}: {
  organizationId: string;
}): Promise<FormSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("forms")
    .select(`${FORM_SELECT}, job:jobs(title)`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[forms] list failed: ${formatDbError(error)}`);
    return [];
  }

  const rows = (data ?? []) as unknown as (Form & { job: { title: string } | null })[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [fields, responses] = await Promise.all([
    supabase.from("form_fields").select("form_id").in("form_id", ids),
    supabase.from("form_responses").select("form_id").in("form_id", ids),
  ]);

  const tally = (result: { data: unknown }) => {
    const counts = new Map<string, number>();
    for (const row of (result.data ?? []) as { form_id: string }[]) {
      counts.set(row.form_id, (counts.get(row.form_id) ?? 0) + 1);
    }
    return counts;
  };

  const fieldCounts = tally(fields);
  const responseCounts = tally(responses);

  return rows.map(({ job, ...form }) => ({
    ...form,
    fieldCount: fieldCounts.get(form.id) ?? 0,
    submissionCount: responseCounts.get(form.id) ?? 0,
    jobTitle: job?.title ?? null,
  }));
}

export type FormDetail = {
  form: Form;
  fields: FormField[];
  submissionCount: number;
  jobTitle: string | null;
};

export async function getFormDetail({
  organizationId,
  formId,
}: {
  organizationId: string;
  formId: string;
}): Promise<FormDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("forms")
    .select(`${FORM_SELECT}, job:jobs(title)`)
    .eq("organization_id", organizationId)
    .eq("id", formId)
    .maybeSingle();

  // A form belonging to another organization resolves to null here, so a
  // guessed id is indistinguishable from a genuinely missing one.
  if (error || !data) {
    if (error) console.error(`[forms] detail failed: ${formatDbError(error)}`);
    return null;
  }

  const { job, ...form } = data as unknown as Form & { job: { title: string } | null };

  const [fieldRows, count] = await Promise.all([
    supabase
      .from("form_fields")
      .select(FIELD_SELECT)
      .eq("organization_id", organizationId)
      .eq("form_id", formId)
      .order("display_order", { ascending: true }),
    supabase
      .from("form_responses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("form_id", formId),
  ]);

  return {
    form,
    fields: ((fieldRows.data ?? []) as unknown as Record<string, unknown>[]).map(toField),
    submissionCount: count.count ?? 0,
    jobTitle: job?.title ?? null,
  };
}

/**
 * The application form for one job, for the card on the job page.
 *
 * Null means no form row exists — which happens for jobs created before this
 * module, and for the rare case where auto-creation failed. The card offers to
 * create one rather than pretending the feature is missing.
 */
export async function getJobApplicationForm({
  organizationId,
  jobId,
}: {
  organizationId: string;
  jobId: string;
}): Promise<FormSummary | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("forms")
    .select(FORM_SELECT)
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("purpose", "job_application")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[forms] job form lookup failed: ${formatDbError(error)}`);
    return null;
  }

  const form = data as unknown as Form;

  const [fieldCount, responseCount] = await Promise.all([
    supabase
      .from("form_fields")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("form_id", form.id),
    supabase
      .from("form_responses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("form_id", form.id),
  ]);

  return {
    ...form,
    fieldCount: fieldCount.count ?? 0,
    submissionCount: responseCount.count ?? 0,
    jobTitle: null,
  };
}

export type ApplicationFormResponse = {
  response: FormResponse;
  formName: string;
  /** In configured order, with the label the applicant actually saw. */
  answers: { fieldKey: string; label: string; value: AnswerValue; isStandard: boolean }[];
};

/**
 * What the applicant submitted, for the card on the application detail page.
 *
 * Ordered by the form's own display_order, and labelled with the CURRENT label:
 * if a recruiter has since renamed a question, the answer still belongs to the
 * question they renamed — answers are keyed on field_key precisely so that
 * stays true.
 *
 * A key present in raw_answers but no longer a field (the question was deleted
 * after this person answered it) is appended at the end rather than dropped.
 * Discarding somebody's answer because the form changed afterwards would be
 * rewriting the record.
 */
export async function getResponseForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}): Promise<ApplicationFormResponse | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("form_responses")
    .select(
      "id, organization_id, form_id, application_id, candidate_id, resume_id, raw_answers, " +
        "status, processing_error, submitted_at, form:forms(name)"
    )
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[forms] application response failed: ${formatDbError(error)}`);
    return null;
  }

  const { form, ...row } = data as unknown as FormResponse & { form: { name: string } | null };

  const { data: fieldRows } = await supabase
    .from("form_fields")
    .select(FIELD_SELECT)
    .eq("organization_id", organizationId)
    .eq("form_id", row.form_id)
    .order("display_order", { ascending: true });

  const fields = ((fieldRows ?? []) as unknown as Record<string, unknown>[]).map(toField);
  const rawAnswers = (row.raw_answers ?? {}) as Record<string, AnswerValue>;

  const answers = fields
    .filter((field) => field.field_type !== "file_upload")
    .map((field) => ({
      fieldKey: field.field_key,
      label: field.label,
      value: rawAnswers[field.field_key] ?? null,
      isStandard: field.is_standard,
    }));

  const known = new Set(fields.map((field) => field.field_key));
  for (const [key, value] of Object.entries(rawAnswers)) {
    if (known.has(key)) continue;
    answers.push({ fieldKey: key, label: key, value, isStandard: false });
  }

  return { response: row, formName: form?.name ?? "Application form", answers };
}

export type FormSubmission = {
  id: string;
  submittedAt: string;
  status: FormResponse["status"];
  processingError: string | null;
  candidateId: string | null;
  applicationId: string | null;
  /** In the form's configured order, labelled with the current labels. */
  answers: { fieldKey: string; label: string; value: AnswerValue }[];
};

/**
 * Submissions to one form.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE APPLICATIONS LIST.
 *
 * A job application form's submissions show up as applications, which is where
 * a recruiter works — that list, its filters and its detail page are Module 5's
 * and this module does not duplicate them.
 *
 * A STANDALONE FORM HAS NO APPLICATION. A pre-interview questionnaire is
 * answered by somebody who already exists in the pipeline, so nothing new is
 * created and there is no other screen its answers could appear on. Without
 * this, publishing such a form would collect answers into a jsonb column that
 * nothing in the product ever displays — which is the same as losing them.
 *
 * Capped and newest-first: this is a review surface, not an export.
 */
export async function listFormResponses({
  organizationId,
  formId,
  limit = 50,
}: {
  organizationId: string;
  formId: string;
  limit?: number;
}): Promise<{ submissions: FormSubmission[]; total: number }> {
  const supabase = await createClient();

  const [rows, fieldRows] = await Promise.all([
    supabase
      .from("form_responses")
      .select(
        "id, submitted_at, status, processing_error, candidate_id, application_id, raw_answers",
        { count: "exact" }
      )
      .eq("organization_id", organizationId)
      .eq("form_id", formId)
      .order("submitted_at", { ascending: false })
      .limit(limit),
    supabase
      .from("form_fields")
      .select(FIELD_SELECT)
      .eq("organization_id", organizationId)
      .eq("form_id", formId)
      .order("display_order", { ascending: true }),
  ]);

  if (rows.error) {
    console.error(`[forms] submissions read failed: ${formatDbError(rows.error)}`);
    return { submissions: [], total: 0 };
  }

  const fields = ((fieldRows.data ?? []) as unknown as Record<string, unknown>[]).map(toField);

  const submissions = (
    (rows.data ?? []) as unknown as {
      id: string;
      submitted_at: string;
      status: FormResponse["status"];
      processing_error: string | null;
      candidate_id: string | null;
      application_id: string | null;
      raw_answers: Record<string, AnswerValue> | null;
    }[]
  ).map((row) => {
    const rawAnswers = row.raw_answers ?? {};

    const answers = fields
      .filter((field) => field.field_type !== "file_upload")
      .map((field) => ({
        fieldKey: field.field_key,
        label: field.label,
        value: rawAnswers[field.field_key] ?? null,
      }));

    // A question deleted after somebody answered it still shows, under its raw
    // key. Dropping the answer because the form changed afterwards would be
    // rewriting what that person said.
    const known = new Set(fields.map((field) => field.field_key));
    for (const [key, value] of Object.entries(rawAnswers)) {
      if (!known.has(key)) answers.push({ fieldKey: key, label: key, value });
    }

    return {
      id: row.id,
      submittedAt: row.submitted_at,
      status: row.status,
      processingError: row.processing_error,
      candidateId: row.candidate_id,
      applicationId: row.application_id,
      answers,
    };
  });

  return { submissions, total: rows.count ?? submissions.length };
}
