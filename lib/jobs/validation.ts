// =============================================================================
// Server-side validation for job payloads.
//
// Pure and shared by POST/PATCH so create and update can never drift apart, and
// so the rules are unit-testable without a database. The client's copy of these
// rules is a convenience; this is the enforcement.
// =============================================================================
import { isJobStatus, isWorkMode, type JobStatus, type WorkMode } from "@/lib/types";

export type ParsedJobFields = {
  title?: string;
  description?: string | null;
  experience_min?: number | null;
  experience_max?: number | null;
  required_skills?: string[];
  preferred_skills?: string[];
  location?: string | null;
  work_mode?: WorkMode | null;
  salary_min?: number | null;
  salary_max?: number | null;
  status?: JobStatus;
  owner_recruiter_id?: string | null;
  client_id?: string | null;
};

export type ParseResult =
  | { ok: true; data: ParsedJobFields }
  | { ok: false; error: string };

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_SKILLS = 25;
export const MAX_SKILL_LENGTH = 120;
export const MAX_EXPERIENCE_YEARS = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function parseSkills(value: unknown, label: string) {
  if (value === null) return { ok: true as const, value: [] as string[] };
  if (!Array.isArray(value)) return { ok: false as const, error: `${label} must be a list.` };

  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false as const, error: `${label} must contain only text entries.` };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_SKILL_LENGTH) {
      return {
        ok: false as const,
        error: `Each entry in ${label} must be ${MAX_SKILL_LENGTH} characters or fewer.`,
      };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  if (output.length > MAX_SKILLS) {
    return { ok: false as const, error: `${label} cannot have more than ${MAX_SKILLS} entries.` };
  }
  return { ok: true as const, value: output };
}

function parseOptionalUuid(value: unknown, label: string) {
  if (value === null || value === "") return { ok: true as const, value: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { ok: false as const, error: `${label} is not a valid id.` };
  }
  return { ok: true as const, value };
}

/**
 * Validates a job payload.
 *
 * `mode: "create"` requires a title. `mode: "update"` accepts a partial payload
 * and only validates the keys present, so a PATCH can't be tricked into
 * blanking fields it never mentioned.
 *
 * Unknown keys are ignored rather than rejected — notably organization_id, which
 * is always resolved from the session, never from the payload.
 */
export function parseJobPayload(body: unknown, mode: "create" | "update"): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const data: ParsedJobFields = {};

  // --- title -----------------------------------------------------------------
  if ("title" in raw || mode === "create") {
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      return { ok: false, error: "A job title is required." };
    }
    if (raw.title.trim().length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
    }
    data.title = raw.title.trim();
  }

  // --- simple optional text --------------------------------------------------
  for (const [key, maxLength, label] of [
    ["description", MAX_DESCRIPTION_LENGTH, "Description"],
    ["location", 200, "Location"],
  ] as const) {
    if (key in raw) {
      const parsed = parseOptionalText(raw[key], maxLength, label);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      data[key] = parsed.value;
    }
  }

  // --- numeric ranges --------------------------------------------------------
  for (const [key, max, label] of [
    ["experience_min", MAX_EXPERIENCE_YEARS, "Minimum experience"],
    ["experience_max", MAX_EXPERIENCE_YEARS, "Maximum experience"],
    ["salary_min", Number.MAX_SAFE_INTEGER, "Minimum salary"],
    ["salary_max", Number.MAX_SAFE_INTEGER, "Maximum salary"],
  ] as const) {
    if (key in raw) {
      const parsed = parseOptionalNumber(raw[key], max, label);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      data[key] = parsed.value;
    }
  }

  // Mirrors the database CHECK constraints, so the user gets a readable message
  // instead of a raw constraint violation. Only checked when both bounds are
  // present in THIS payload — a partial update can't see the stored other half,
  // so the DB constraint remains the backstop.
  if (
    data.experience_min !== undefined &&
    data.experience_max !== undefined &&
    data.experience_min !== null &&
    data.experience_max !== null &&
    data.experience_min > data.experience_max
  ) {
    return { ok: false, error: "Minimum experience cannot be greater than maximum experience." };
  }

  if (
    data.salary_min !== undefined &&
    data.salary_max !== undefined &&
    data.salary_min !== null &&
    data.salary_max !== null &&
    data.salary_min > data.salary_max
  ) {
    return { ok: false, error: "Minimum salary cannot be greater than maximum salary." };
  }

  // --- skills ----------------------------------------------------------------
  if ("required_skills" in raw) {
    const parsed = parseSkills(raw.required_skills, "Required skills");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    data.required_skills = parsed.value;
  }
  if ("preferred_skills" in raw) {
    const parsed = parseSkills(raw.preferred_skills, "Preferred skills");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    data.preferred_skills = parsed.value;
  }

  // A skill cannot be both mandatory and merely preferred; required wins so
  // Module 7 never counts it twice.
  if (data.required_skills && data.preferred_skills) {
    const required = new Set(data.required_skills.map((skill) => skill.toLowerCase()));
    data.preferred_skills = data.preferred_skills.filter(
      (skill) => !required.has(skill.toLowerCase())
    );
  }

  // --- enums -----------------------------------------------------------------
  if ("work_mode" in raw) {
    if (raw.work_mode === null || raw.work_mode === "") {
      data.work_mode = null;
    } else if (isWorkMode(raw.work_mode)) {
      data.work_mode = raw.work_mode;
    } else {
      return { ok: false, error: "Work mode must be onsite, hybrid, or remote." };
    }
  }

  if ("status" in raw) {
    if (!isJobStatus(raw.status)) {
      return { ok: false, error: "Status must be draft, open, on_hold, or closed." };
    }
    data.status = raw.status;
  }

  // --- ids -------------------------------------------------------------------
  // owner_recruiter_id is verified to be a member of the caller's organization
  // in the route handler (needs a query); here we only check the shape.
  if ("owner_recruiter_id" in raw) {
    const parsed = parseOptionalUuid(raw.owner_recruiter_id, "Owner recruiter");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    data.owner_recruiter_id = parsed.value;
  }

  if ("client_id" in raw) {
    const parsed = parseOptionalUuid(raw.client_id, "Client");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    data.client_id = parsed.value;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "No valid fields provided." };
  }

  return { ok: true, data };
}
