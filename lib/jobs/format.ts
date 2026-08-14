// Display formatting for job fields, shared by the list and detail views so the
// two can never drift.

/** "4-7 yrs" / "5+ yrs" / "up to 3 yrs" / "—". */
export function formatExperience(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null) return `${min}-${max} yrs`;
  if (min !== null) return `${min}+ yrs`;
  return `up to ${max} yrs`;
}

/**
 * Salary band. Deliberately unit-less: the organization's currency lives in
 * Module 17's settings, so prefixing a symbol here would be a guess.
 */
export function formatSalary(min: number | null, max: number | null): string {
  const format = (value: number) => value.toLocaleString("en-IN");
  if (min === null && max === null) return "—";
  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`;
  if (min !== null) return `${format(min)}+`;
  return `up to ${format(max!)}`;
}
