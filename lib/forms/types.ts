// =============================================================================
// Row shapes for Module 23.
//
// Hand-written, like every other module's: there are no generated Supabase
// types in this project (that needs a live database to introspect), so a select
// string cannot infer a row shape and results are cast at the boundary.
// =============================================================================
import type { FormFieldType } from "@/lib/forms/fields";

export const FORM_PURPOSES = ["job_application", "pre_interview", "general"] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];

export function isFormPurpose(value: unknown): value is FormPurpose {
  return typeof value === "string" && (FORM_PURPOSES as readonly string[]).includes(value);
}

export const FORM_PURPOSE_LABELS: Record<FormPurpose, string> = {
  job_application: "Job application",
  pre_interview: "Pre-interview",
  general: "General",
};

export const FORM_STATUSES = ["draft", "published", "disabled"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export function isFormStatus(value: unknown): value is FormStatus {
  return typeof value === "string" && (FORM_STATUSES as readonly string[]).includes(value);
}

export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
  draft: "Draft",
  published: "Published",
  disabled: "Disabled",
};

export const FORM_RESPONSE_STATUSES = [
  "received",
  "linked",
  "needs_review",
  "needs_attention",
] as const;
export type FormResponseStatus = (typeof FORM_RESPONSE_STATUSES)[number];

export type Form = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  purpose: FormPurpose;
  job_id: string | null;
  status: FormStatus;
  token_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FormField = {
  id: string;
  organization_id: string;
  form_id: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: FormFieldType;
  /** Choices for dropdown/radio/checkbox. Always an array, often empty. */
  options: string[];
  required: boolean;
  is_standard: boolean;
  display_order: number;
  created_at: string;
};

/** One answer's value, as it comes out of raw_answers. */
export type AnswerValue = string | number | boolean | string[] | null;

export type FormResponse = {
  id: string;
  organization_id: string;
  form_id: string;
  application_id: string | null;
  candidate_id: string | null;
  resume_id: string | null;
  raw_answers: Record<string, AnswerValue>;
  status: FormResponseStatus;
  processing_error: string | null;
  submitted_at: string;
};

/** A form plus everything the recruiter-side screens show about it. */
export type FormSummary = Form & {
  fieldCount: number;
  submissionCount: number;
  jobTitle: string | null;
};
