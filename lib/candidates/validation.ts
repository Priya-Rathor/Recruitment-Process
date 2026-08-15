// Server-side validation for candidate payloads. Pure and shared by POST/PATCH
// so create and update can never drift, and unit-testable without a database.
import { isCandidateSource, type CandidateSource } from "@/lib/types";
import {
  normalizeEducation,
  normalizeEmploymentHistory,
} from "@/lib/candidates/profile";

export type ParsedCandidateFields = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  current_company?: string | null;
  current_role?: string | null;
  total_experience_years?: number | null;
  skills?: string[];
  education?: import("@/lib/candidates/profile").EducationEntry[];
  employment_history?: import("@/lib/candidates/profile").EmploymentEntry[];
  expected_salary?: number | null;
  notice_period_days?: number | null;
  source?: CandidateSource;
  resume_url?: string | null;
};

export type ParseCandidateResult =
  | { ok: true; data: ParsedCandidateFields }
  | { ok: false; error: string };

export const MAX_NAME_LENGTH = 200;
export const MAX_SKILLS = 40;
export const MAX_EXPERIENCE_YEARS = 60;
export const MAX_NOTICE_DAYS = 365;

// Deliberately permissive: the point is to catch typos, not to police the RFC.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseOptionalText(value: unknown, maxLength: number, label: string) {
  if (value === null) return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true as const, value: null };
  if (trimmed.length > maxLength) {
    return { ok: false as const, error: `${label} must be ${maxLength} characters or fewer.` };
  }
  return { ok: true as const, value: trimmed };
}

function parseOptionalNumber(value: unknown, max: number, label: string) {
  if (value === null || value === "") return { ok: true as const, value: null };
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return { ok: false as const, error: `${label} must be a number.` };
  if (numeric < 0) return { ok: false as const, error: `${label} cannot be negative.` };
  if (numeric > max) return { ok: false as const, error: `${label} is unrealistically large.` };
  return { ok: true as const, value: numeric };
}

/**
 * Validates a candidate payload.
 *
 * On create, a name plus at least one contact detail is required — a record with
 * neither an email nor a phone cannot be acted on, and the database enforces the
 * same rule via a CHECK constraint.
 *
 * Unknown keys (organization_id, id, the normalised columns) are ignored: the
 * tenant always comes from the session, and normalisation is the database's job.
 */
export function parseCandidatePayload(
  body: unknown,
  mode: "create" | "update"
): ParseCandidateResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const data: ParsedCandidateFields = {};

  // --- name ------------------------------------------------------------------
  if ("name" in raw || mode === "create") {
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      return { ok: false, error: "A candidate name is required." };
    }
    if (raw.name.trim().length > MAX_NAME_LENGTH) {
      return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
    }
    data.name = raw.name.trim();
  }

  // --- contact ---------------------------------------------------------------
  if ("email" in raw) {
    const parsed = parseOptionalText(raw.email, 320, "Email");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (parsed.value !== null && !EMAIL_PATTERN.test(parsed.value)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    data.email = parsed.value ? parsed.value.toLowerCase() : null;
  }

  if ("phone" in raw) {
    const parsed = parseOptionalText(raw.phone, 40, "Phone");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (parsed.value !== null && parsed.value.replace(/\D/g, "").length < 6) {
      return { ok: false, error: "Enter a valid phone number." };
    }
    data.phone = parsed.value;
  }

  // Mirrors the candidates_contactable CHECK constraint, so the user gets a
  // readable message rather than a raw constraint violation.
  if (mode === "create" && !data.email && !data.phone) {
    return { ok: false, error: "Add an email address or a phone number." };
  }
  // On update, only block when this payload would clear BOTH at once; clearing
  // one while the other is stored is fine and the database is the backstop.
  if (mode === "update" && "email" in raw && "phone" in raw && !data.email && !data.phone) {
    return { ok: false, error: "A candidate needs an email address or a phone number." };
  }

  // --- simple text -----------------------------------------------------------
  for (const [key, maxLength, label] of [
    ["location", 120, "Location"],
    ["current_company", 200, "Current company"],
    ["current_role", 200, "Current role"],
    ["resume_url", 1000, "Resume URL"],
  ] as const) {
    if (key in raw) {
      const parsed = parseOptionalText(raw[key], maxLength, label);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      data[key] = parsed.value;
    }
  }

  // --- numbers ---------------------------------------------------------------
  for (const [key, max, label] of [
    ["total_experience_years", MAX_EXPERIENCE_YEARS, "Total experience"],
    ["expected_salary", Number.MAX_SAFE_INTEGER, "Expected salary"],
    ["notice_period_days", MAX_NOTICE_DAYS, "Notice period"],
  ] as const) {
    if (key in raw) {
      const parsed = parseOptionalNumber(raw[key], max, label);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      data[key] = parsed.value;
    }
  }

  // --- education and employment history --------------------------------------
  //
  // Normalised rather than rejected: the caller is a form someone has been
  // typing into, and refusing the whole save because one row is half-filled
  // would lose the other six. See lib/candidates/profile.ts.
  if ("education" in raw) {
    data.education = normalizeEducation(raw.education);
  }
  if ("employment_history" in raw) {
    data.employment_history = normalizeEmploymentHistory(raw.employment_history);
  }

  // --- skills ----------------------------------------------------------------
  if ("skills" in raw) {
    if (raw.skills === null) {
      data.skills = [];
    } else if (!Array.isArray(raw.skills)) {
      return { ok: false, error: "Skills must be a list." };
    } else {
      const seen = new Set<string>();
      const skills: string[] = [];
      for (const item of raw.skills) {
        if (typeof item !== "string") {
          return { ok: false, error: "Skills must contain only text entries." };
        }
        const trimmed = item.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.length > 60) {
          return { ok: false, error: "Each skill must be 60 characters or fewer." };
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        skills.push(trimmed);
      }
      if (skills.length > MAX_SKILLS) {
        return { ok: false, error: `Skills cannot have more than ${MAX_SKILLS} entries.` };
      }
      data.skills = skills;
    }
  }

  // --- source ----------------------------------------------------------------
  if ("source" in raw) {
    if (!isCandidateSource(raw.source)) {
      return { ok: false, error: "Select a valid intake source." };
    }
    data.source = raw.source;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "No valid fields provided." };
  }

  return { ok: true, data };
}
