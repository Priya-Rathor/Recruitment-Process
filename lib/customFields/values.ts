// =============================================================================
// Custom field VALUES — what a stored answer may be, and how it reads.
//
// PURE MODULE, like ./definitions.ts. The public form's server-side validator,
// the API route, and the client-side inputs all run the same functions, because
// three implementations of "is this a valid number for this field" is three
// chances to accept something the database then rejects.
//
// -----------------------------------------------------------------------------
// EVERY VALUE ARRIVING HERE IS UNTRUSTED.
//
// AGENTS.md rule 6. The public application form (Module 23) is open to anyone on
// the internet, so `raw` may be any JSON at all — a nested object where a string
// was expected, an array of 10,000 entries, a number as a string. coerceValue()
// narrows explicitly and returns a reason rather than throwing, so the applicant
// sees which field is wrong instead of a generic failure.
// =============================================================================
import type { CustomFieldDefinition, FormFieldType } from "@/lib/customFields/definitions";

/** Caps a single answer. Generous for a paragraph, finite for a database. */
const MAX_TEXT = 5000;
const MAX_SHORT_TEXT = 500;
/** Mirrors what a person could plausibly mean, and keeps jsonb small. */
const MAX_CHECKBOX_SELECTIONS = 100;

export type CoerceResult =
  | { ok: true; value: unknown | null }
  | { ok: false; error: string };

/** An answer that is present in form terms — "" and [] are not. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function coerceText(raw: unknown, max: number): CoerceResult {
  if (typeof raw !== "string") return { ok: false, error: "Expected text." };
  const trimmed = raw.trim();
  if (trimmed.length > max) return { ok: false, error: `Keep this under ${max} characters.` };
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

/**
 * Narrows one submitted answer to the shape its field_type stores.
 *
 * Returns `value: null` for a blank answer of any type — a single "no answer"
 * representation, so a reader never has to ask whether "" and null mean
 * different things. Requiredness is checked separately by validateValue(),
 * because a blank optional answer is valid and must still round-trip.
 */
export function coerceValue(fieldType: FormFieldType, options: string[], raw: unknown): CoerceResult {
  if (isBlank(raw)) return { ok: true, value: null };

  switch (fieldType) {
    case "short_text":
      return coerceText(raw, MAX_SHORT_TEXT);

    case "long_text":
      return coerceText(raw, MAX_TEXT);

    case "url": {
      const text = coerceText(raw, MAX_SHORT_TEXT);
      if (!text.ok || text.value === null) return text;
      const value = String(text.value);
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return { ok: false, error: "Enter a full web address, including https://" };
      }
      // http/https only. A javascript: or data: URL stored here would later be
      // rendered as a link on an internal page — this is the cheapest place to
      // refuse it, and the only one every writer passes through.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Only http:// and https:// addresses are allowed." };
      }
      return { ok: true, value };
    }

    case "number": {
      // Accepts the string a form control actually submits, as well as a real
      // number from an API caller. Number("") is 0, which is why isBlank ran first.
      const numeric = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(numeric)) return { ok: false, error: "Enter a number." };
      return { ok: true, value: numeric };
    }

    case "date": {
      if (typeof raw !== "string") return { ok: false, error: "Expected a date." };
      const value = raw.trim();
      // Stored as the plain YYYY-MM-DD the input produces, NOT as a timestamp.
      // A date field has no time and no zone; converting it to a Date here would
      // shift it by a day for anyone east or west of the server — the exact bug
      // lib/time.ts exists to prevent.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { ok: false, error: "Enter a date as YYYY-MM-DD." };
      }
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return { ok: false, error: "That date isn't valid." };
      return { ok: true, value };
    }

    case "yes_no": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const text = String(raw).trim().toLowerCase();
      if (["yes", "true", "1"].includes(text)) return { ok: true, value: true };
      if (["no", "false", "0"].includes(text)) return { ok: true, value: false };
      return { ok: false, error: "Choose yes or no." };
    }

    case "dropdown":
    case "radio": {
      if (typeof raw !== "string") return { ok: false, error: "Choose one of the options." };
      const value = raw.trim();
      // Membership is checked, not assumed. The <select> is cosmetic; a direct
      // POST can carry anything, and an unlisted value would render as a choice
      // nobody offered.
      if (!options.includes(value)) return { ok: false, error: "Choose one of the options." };
      return { ok: true, value };
    }

    case "checkbox": {
      const list = Array.isArray(raw) ? raw : [raw];
      if (list.length > MAX_CHECKBOX_SELECTIONS) {
        return { ok: false, error: "Too many selections." };
      }
      const chosen: string[] = [];
      for (const entry of list) {
        if (typeof entry !== "string") return { ok: false, error: "Choose from the options." };
        const value = entry.trim();
        if (!options.includes(value)) return { ok: false, error: "Choose from the options." };
        // De-duplicated: a repeated checkbox value is a submission artefact, not
        // a second selection.
        if (!chosen.includes(value)) chosen.push(value);
      }
      return { ok: true, value: chosen.length === 0 ? null : chosen };
    }

    default:
      // Unreachable while CUSTOM_FIELD_TYPES stays a subset of FORM_FIELD_TYPES,
      // but a new forms type would land here rather than being stored unchecked.
      return { ok: false, error: "This field type can't be saved." };
  }
}

export type ValueError = { field_key: string; label: string; error: string };

/**
 * Coerces and requiredness-checks one answer against its definition.
 *
 * An INACTIVE definition is skipped by the callers that render forms, but this
 * function does not refuse one: a value already stored against a retired field
 * must remain readable and re-savable, or deactivating a field would make an
 * otherwise-valid record unsaveable.
 */
export function validateValue(
  definition: Pick<CustomFieldDefinition, "field_key" | "label" | "field_type" | "options" | "required">,
  raw: unknown
): { ok: true; value: unknown | null } | { ok: false; error: ValueError } {
  const coerced = coerceValue(definition.field_type, definition.options, raw);

  if (!coerced.ok) {
    return {
      ok: false,
      error: { field_key: definition.field_key, label: definition.label, error: coerced.error },
    };
  }

  if (definition.required && coerced.value === null) {
    return {
      ok: false,
      error: {
        field_key: definition.field_key,
        label: definition.label,
        error: `${definition.label} is required.`,
      },
    };
  }

  return { ok: true, value: coerced.value };
}

/**
 * How a stored value reads as text — in a table cell, on a detail card, and in
 * a {{custom.*}} placeholder.
 *
 * ONE formatter for all three, so a message to a candidate cannot describe
 * their answer differently from the page a recruiter is looking at while
 * reading it back to them.
 */
export function formatValue(fieldType: FormFieldType, value: unknown): string {
  if (value === null || value === undefined) return "";

  switch (fieldType) {
    case "yes_no":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "checkbox":
      return Array.isArray(value) ? value.join(", ") : "";
    case "number":
      return typeof value === "number" ? String(value) : "";
    default:
      return typeof value === "string" ? value : String(value);
  }
}
