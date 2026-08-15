// =============================================================================
// Education and employment history.
//
// Two jsonb arrays on `candidates`, so nothing stops a caller writing anything
// into them — every value that reaches the column passes through here first.
//
// Pure, and deliberately FORGIVING rather than strict. The caller is a form
// someone has been typing into: a row with a company but no dates is still
// worth keeping, so a missing field becomes null instead of rejecting the save
// and losing the other six rows they filled in. Only an entry that is entirely
// empty is dropped, because that is a blank row nobody meant to add.
// =============================================================================

export type EducationEntry = {
  degree: string | null;
  institution: string | null;
  year: string | null;
};

export type EmploymentEntry = {
  company: string | null;
  role: string | null;
  duration: string | null;
};

/** Longest any single field may be. Matches the free-text limits elsewhere. */
const MAX_FIELD = 200;

/**
 * Most entries kept per list.
 *
 * Generous — a career can genuinely run to fifteen roles — but bounded, because
 * an unbounded jsonb array on a row read by every profile page is a way to make
 * one candidate slow down the whole table.
 */
export const MAX_ENTRIES = 25;

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_FIELD);
}

/** True when every field is empty — a blank row, not a record. */
function isEmpty(entry: Record<string, string | null>): boolean {
  return Object.values(entry).every((value) => value === null);
}

export function normalizeEducation(raw: unknown): EducationEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        degree: cleanField(row.degree),
        institution: cleanField(row.institution),
        year: cleanField(row.year),
      };
    })
    .filter((entry) => !isEmpty(entry))
    .slice(0, MAX_ENTRIES);
}

export function normalizeEmploymentHistory(raw: unknown): EmploymentEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return {
        company: cleanField(row.company),
        role: cleanField(row.role),
        duration: cleanField(row.duration),
      };
    })
    .filter((entry) => !isEmpty(entry))
    .slice(0, MAX_ENTRIES);
}

/** "B.Tech Computer Science — Delhi Technological University (2019)" */
export function describeEducation(entry: EducationEntry): string {
  const head = [entry.degree, entry.institution].filter(Boolean).join(" — ");
  const year = entry.year ? ` (${entry.year})` : "";
  return `${head}${year}` || "Untitled qualification";
}

/** "Senior Java Developer at Infosys · 2022–present" */
export function describeEmployment(entry: EmploymentEntry): string {
  const head =
    entry.role && entry.company
      ? `${entry.role} at ${entry.company}`
      : (entry.role ?? entry.company ?? "Untitled role");
  return entry.duration ? `${head} · ${entry.duration}` : head;
}
