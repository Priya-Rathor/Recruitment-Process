// =============================================================================
// Module 19 — the default document checklist, and template validation.
//
// The defaults are DUPLICATED between here and migration 0026's
// seed_default_document_templates(). That is deliberate and it is tested: the
// SQL is what a real organization gets, and this list is what the test and the
// settings screen's empty state can read without a database. A test asserts the
// two match, so the duplicate cannot drift silently.
// =============================================================================
import { isDocumentOwner, type DocumentOwner } from "@/lib/onboarding/documents";

export type DocumentTemplateSeed = {
  name: string;
  description: string;
  required: boolean;
  expected_from: DocumentOwner;
  display_order: number;
};

/**
 * Indian-market defaults, matching the spec's list.
 *
 * Background Verification Consent is REQUIRED and not presented as optional
 * anywhere: running a background check without written consent is unlawful in
 * most jurisdictions, so it is a precondition of the check rather than a nice
 * to have. Same reasoning as the call-recording disclosure in Module 8.
 */
export const DEFAULT_DOCUMENT_TEMPLATES: DocumentTemplateSeed[] = [
  {
    name: "Signed Offer Letter",
    description: "The countersigned offer, filed by the recruiter.",
    required: true,
    expected_from: "recruiter",
    display_order: 1,
  },
  {
    name: "PAN Card",
    description: "Permanent Account Number card, for payroll and tax.",
    required: true,
    expected_from: "candidate",
    display_order: 2,
  },
  {
    name: "Aadhaar / Government ID",
    description: "Any government photo ID. Aadhaar is the usual one in India.",
    required: true,
    expected_from: "candidate",
    display_order: 3,
  },
  {
    name: "Educational Certificates",
    description: "Degree or diploma certificates for the highest qualification claimed.",
    required: true,
    expected_from: "candidate",
    display_order: 4,
  },
  {
    name: "Bank Account Details",
    description: "Cancelled cheque or bank letter, for salary credit.",
    required: true,
    expected_from: "candidate",
    display_order: 5,
  },
  {
    name: "Background Verification Consent",
    description:
      "Written consent before any background check is run. Not optional — a check " +
      "run without it is unlawful in most jurisdictions.",
    required: true,
    expected_from: "candidate",
    display_order: 6,
  },
  {
    name: "Previous Employment Relieving Letter",
    description:
      "From the last employer. Optional: a first-time employee has none, and a " +
      "candidate serving notice may not have it yet.",
    required: false,
    expected_from: "candidate",
    display_order: 7,
  },
];

export const MAX_TEMPLATE_NAME = 120;
export const MAX_TEMPLATE_DESCRIPTION = 500;

export type TemplateInput = {
  name: string;
  description: string | null;
  required: boolean;
  expected_from: DocumentOwner;
  active: boolean;
};

/**
 * Validates one template's fields.
 *
 * Returns the cleaned values or a message, rather than throwing — the route
 * turns the message into a 400 the form can display next to the field.
 */
export function validateTemplate(
  body: unknown
): { ok: true; value: TemplateInput } | { ok: false; error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0) return { ok: false, error: "Give this document type a name." };
  if (name.length > MAX_TEMPLATE_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_TEMPLATE_NAME} characters.` };
  }

  const descriptionRaw = raw.description;
  if (descriptionRaw !== undefined && descriptionRaw !== null && typeof descriptionRaw !== "string") {
    return { ok: false, error: "Description must be text." };
  }
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw.trim()
      : null;
  if (description && description.length > MAX_TEMPLATE_DESCRIPTION) {
    return { ok: false, error: `Keep the description under ${MAX_TEMPLATE_DESCRIPTION} characters.` };
  }

  if (!isDocumentOwner(raw.expected_from)) {
    return { ok: false, error: "Choose who provides this document — Candidate or Recruiter." };
  }

  // Booleans default rather than fail: a form that omits an unchecked box is
  // normal, and rejecting it would be pedantry with a 400 attached.
  const required = raw.required === undefined ? true : raw.required === true;
  const active = raw.active === undefined ? true : raw.active === true;

  return {
    ok: true,
    value: { name, description, required, expected_from: raw.expected_from, active },
  };
}

/**
 * Reorders a list of ids into contiguous display_order values.
 *
 * Contiguous from 1 rather than preserving gaps: the ordering only ever means
 * "this before that", and a list that drifts to 1, 4, 900 after enough edits is
 * harder to reason about with no benefit.
 */
export function orderingFromIds(ids: string[]): { id: string; display_order: number }[] {
  return ids.map((id, index) => ({ id, display_order: index + 1 }));
}
