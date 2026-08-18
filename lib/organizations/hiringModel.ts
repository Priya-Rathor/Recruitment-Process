// =============================================================================
// Agency mode — does this organization recruit FOR other companies, or for
// itself?
//
// One product, two buyers. An agency has clients (Module 12): companies it
// submits candidates to, which come with submissions and feedback SLAs. An
// in-house team has none of that — it hires for itself, and every client-facing
// surface is a permanently empty page.
//
// The flag lives on `organizations` (migration 0028) rather than in
// `organization_settings`, for the same reason `timezone` does: it is part of
// who the organization IS, it is already carried on every membership lookup,
// and a page needing it should not have to make a second query to find out
// which product it is rendering.
// =============================================================================

/** Just the field, so callers can pass a membership's organization directly. */
export type HiringModelOrganization = { agency_mode?: boolean | null };

/**
 * True when the organization recruits for client companies.
 *
 * Deliberately `!== false` rather than `=== true`. The column is NOT NULL
 * DEFAULT TRUE, so a migrated row always gives a real answer — but migrations
 * here are applied by hand (README step 3), so between deploying this code and
 * running 0028 the field is simply absent.
 *
 * Absent has to read as "agency", because that is what every organization was
 * before this flag existed. The other reading would silently blank the Clients
 * module out of a live agency's product until somebody noticed.
 */
export function isAgencyMode(
  organization: HiringModelOrganization | null | undefined
): boolean {
  return organization?.agency_mode !== false;
}

/** The onboarding and settings question, asked the same way in both places. */
export const HIRING_MODEL_OPTIONS = [
  {
    value: true,
    label: "We recruit for client companies",
    hint: "A staffing agency or recruitment consultancy. Adds Clients, candidate submissions and client feedback SLAs.",
  },
  {
    value: false,
    label: "We hire for ourselves",
    hint: "An in-house talent team. Hides the client-facing parts of the product; nothing else changes.",
  },
] as const;

/**
 * Parses the flag out of an API payload.
 *
 * Returns `undefined` for "not present", which is how a PATCH distinguishes
 * "leave it alone" from "set it to false" — the trap a plain `Boolean(value)`
 * would fall into.
 */
export function parseAgencyMode(
  value: unknown
): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "boolean") {
    return { ok: false, error: "agency_mode must be true or false." };
  }
  return { ok: true, value };
}
