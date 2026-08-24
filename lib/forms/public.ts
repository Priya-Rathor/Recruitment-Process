// =============================================================================
// The APPLICANT's side.
//
// WHY THIS FILE USES THE SERVICE-ROLE CLIENT.
//
// The applicant has no session. Every RLS policy in this product answers "is
// the caller a member of this organization?", and the honest answer here is no —
// they are applying for a job, not joining the workspace. A session-bound client
// would have every query below denied, and inventing a membership for them would
// be far worse than the narrow, explicit scoping this file does.
//
// So it is the same shape as lib/coding/candidate.ts and the Bolna webhook: no
// session exists, the service-role client is used, and EVERY query is scoped by
// an id that came out of a verified signature — never out of a request body.
//
// THE THREE RULES, in the order they are applied:
//
//   1. The form id comes from verifyFormToken(), never from the caller.
//   2. token_version from the token must equal the row's CURRENT version, so
//      "regenerate link" takes effect on the very next request.
//   3. organization_id is read from OUR row and used to scope everything after
//      it. The applicant never states which tenant they belong to.
//
// WHAT THE PAGE IS ALLOWED TO KNOW. The job's title, location and experience
// band, the organization's name, and the questions. No ids of any kind, no
// recruiter, no salary band, no other applicant, nothing about the pipeline.
// =============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDbError } from "@/lib/supabase/errors";
import { verifyFormToken } from "@/lib/forms/token";
import { normalizePrivacySettings } from "@/lib/privacy/settings";
import type { FormFieldType } from "@/lib/forms/fields";
import type { FormPurpose, FormStatus } from "@/lib/forms/types";

/** A field as the public page sees it. No id, no organization, no is_standard. */
export type PublicField = {
  fieldKey: string;
  label: string;
  helpText: string | null;
  fieldType: FormFieldType;
  options: string[];
  required: boolean;
};

export type PublicFormView = {
  name: string;
  description: string | null;
  fields: PublicField[];
  organizationName: string | null;
  job: {
    title: string;
    location: string | null;
    workMode: string | null;
    experienceMin: number | null;
    experienceMax: number | null;
  } | null;
  /**
   * The organization's own candidate privacy notice (Module 22), shown above
   * the submit button. This is the FIRST point of collection from the applicant,
   * and per AGENTS.md the disclosure cannot be switched off — so it is part of
   * the view rather than an optional prop the page might forget to render.
   */
  privacyNotice: { title: string; content: string };
};

export type PublicFormResult =
  | { ok: true; formId: string; organizationId: string; view: PublicFormView }
  /**
   * `closed`   — the link is genuine but the form is not taking applications.
   * `invalid`  — bad signature, unknown form, or a superseded token version.
   *              Deliberately indistinguishable from "no such form".
   * `unavailable` — our side is misconfigured. Never the applicant's fault and
   *              never described as their link being broken.
   */
  | { ok: false; code: "closed" | "invalid" | "unavailable"; message: string };

/*
  WHY `closed` AND `invalid` ARE ALLOWED TO DIFFER.

  Distinguishing them would normally leak which ids exist — but reaching `closed`
  requires a signature this server produced, which cannot be forged. Anybody who
  gets that far was genuinely given the link, and telling them "this role has
  stopped accepting applications" is both true and the only useful thing to say.

  A REGENERATED link is `invalid`, not `closed`, because the version no longer
  matches: the holder of an old QR code is told to ask for the current link,
  which is exactly what they need to do.
*/
const CLOSED_MESSAGE =
  "This position is no longer accepting applications. If you were asked to apply, " +
  "contact the recruiter who shared the link with you.";

const INVALID_MESSAGE =
  "This application link is no longer available. Check you opened the most recent link " +
  "you were sent, or ask the recruiter for a new one.";

const UNAVAILABLE_MESSAGE =
  "Applications can't be opened right now. Please try again shortly, or contact the recruiter " +
  "who shared this link with you.";

const FIELD_COLUMNS =
  "field_key, label, help_text, field_type, options, required, display_order";

/**
 * Resolves a token to everything the public page renders.
 *
 * Called by the page AND re-called by the submission route, because access is
 * re-checked on every request rather than only at page load: a form disabled
 * while somebody was filling it in must stop accepting the submission they are
 * about to send.
 */
export async function loadPublicForm(token: string): Promise<PublicFormResult> {
  const verified = await verifyFormToken(token);
  if (!verified) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const admin = createAdminClient();
  if (!admin) {
    // No service-role key configured. Reported as unavailable rather than as an
    // invalid link: the applicant has done nothing wrong, and telling them their
    // link is broken would send them chasing the wrong thing.
    console.error("[forms] service-role client unavailable; public applications cannot work.");
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const { data, error } = await admin
    .from("forms")
    .select(
      "id, organization_id, name, description, purpose, status, token_version, " +
        "organization:organizations(name), " +
        "job:jobs(title, location, work_mode, experience_min, experience_max, status, archived_at)"
    )
    .eq("id", verified.formId)
    .maybeSingle();

  if (error) {
    console.error(`[forms] public form load failed: ${formatDbError(error)}`);
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
  // A signature that verifies against a row that no longer exists reads exactly
  // like a forged one, on purpose.
  if (!data) return { ok: false, code: "invalid", message: INVALID_MESSAGE };

  const row = data as unknown as {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    purpose: FormPurpose;
    status: FormStatus;
    token_version: number;
    organization: { name: string } | null;
    job: {
      title: string;
      location: string | null;
      work_mode: string | null;
      experience_min: number | null;
      experience_max: number | null;
      status: string;
      archived_at: string | null;
    } | null;
  };

  // Rule 2: the link must name the CURRENT version. This is what makes
  // "Regenerate link" a revocation rather than a suggestion.
  if (row.token_version !== verified.tokenVersion) {
    return { ok: false, code: "invalid", message: INVALID_MESSAGE };
  }

  if (row.status !== "published") {
    return { ok: false, code: "closed", message: CLOSED_MESSAGE };
  }

  /*
    AN ARCHIVED JOB CLOSES ITS FORM, without anybody remembering to disable it.

    A recruiter who archives a requisition considers the role shut. Leaving the
    public link live would keep collecting applications into a job nobody is
    looking at — which is worse than a closed page, because the applicant
    believes they have applied.
  */
  if (row.purpose === "job_application" && (!row.job || row.job.archived_at)) {
    return { ok: false, code: "closed", message: CLOSED_MESSAGE };
  }

  const { data: fieldRows, error: fieldError } = await admin
    .from("form_fields")
    .select(FIELD_COLUMNS)
    .eq("form_id", row.id)
    // Rule 3: scoped by OUR row's organization, not by anything the caller said.
    .eq("organization_id", row.organization_id)
    .order("display_order", { ascending: true });

  if (fieldError) {
    console.error(`[forms] public fields load failed: ${formatDbError(fieldError)}`);
    return { ok: false, code: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const fields: PublicField[] = (
    (fieldRows ?? []) as unknown as {
      field_key: string;
      label: string;
      help_text: string | null;
      field_type: FormFieldType;
      options: unknown;
      required: boolean;
    }[]
  ).map((field) => ({
    fieldKey: field.field_key,
    label: field.label,
    helpText: field.help_text,
    fieldType: field.field_type,
    options: Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === "string")
      : [],
    required: field.required,
  }));

  // A published form with no questions would render a page with nothing but a
  // submit button. Closed rather than broken.
  if (fields.length === 0) {
    return { ok: false, code: "closed", message: CLOSED_MESSAGE };
  }

  return {
    ok: true,
    formId: row.id,
    organizationId: row.organization_id,
    view: {
      name: row.name,
      description: row.description,
      fields,
      organizationName: row.organization?.name ?? null,
      job: row.job
        ? {
            title: row.job.title,
            location: row.job.location,
            workMode: row.job.work_mode,
            experienceMin: row.job.experience_min,
            experienceMax: row.job.experience_max,
          }
        : null,
      privacyNotice: await loadPrivacyNotice(admin, row.organization_id),
    },
  };
}

/**
 * The organization's candidate privacy notice, or the platform default.
 *
 * Read with the service-role client (the applicant cannot read
 * organization_settings) and scoped explicitly by organization_id, as every
 * admin-client query in this codebase must be. A read failure falls back to the
 * default notice rather than rendering no disclosure at all — the disclosure is
 * the part that is not allowed to be missing.
 */
async function loadPrivacyNotice(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  organizationId: string
): Promise<{ title: string; content: string }> {
  const { data, error } = await admin
    .from("organization_settings")
    .select("privacy_settings")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) console.error(`[forms] privacy notice read failed: ${formatDbError(error)}`);

  const settings = normalizePrivacySettings(
    (data as { privacy_settings?: unknown } | null)?.privacy_settings
  );
  return settings.notice;
}
