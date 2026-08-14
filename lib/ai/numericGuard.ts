// =============================================================================
// Numeric-consistency guard, shared by every AI function that narrates figures
// the UI also displays (Module 2's daily brief, Module 5's application summary,
// and later Modules 9/10/16).
//
// The platform rule is that AI explains numbers, it never invents them. Prompt
// wording alone cannot enforce that, so output is checked mechanically: every
// number in the generated text must be one we supplied.
//
// Three bypasses this closes, all found by review of the first implementation:
//   - "1,234" naively splits into 1 and 234, wrongly rejecting a valid figure
//   - spelled-out numbers ("eighty-nine") skip a digit-only check entirely
//   - "42%" passes whenever 42 happens to be an allowed value elsewhere
// =============================================================================

/** Number words that would otherwise slip past a digit-only check. */
const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen)\b/gi;

export type NumericGuardOptions = {
  /**
   * Treat a numeral immediately followed by % as an offender unless the
   * percentage itself was supplied. Percentages are usually computed by the
   * model rather than read, so they are the most common fabrication.
   */
  rejectUnlistedPercentages?: boolean;
};

/**
 * Returns the figures in `text` that were not supplied in `allowed`.
 * An empty array means the text is safe to display beside the real values.
 */
export function findUnsupportedNumbers(
  text: string,
  allowed: Set<number>,
  options: NumericGuardOptions = {}
): string[] {
  const offenders: string[] = [];

  // Normalise thousands separators first so a legitimate "1,234" is read as one
  // number rather than two false offenders.
  const normalised = text.replace(/(\d),(?=\d{3}\b)/g, "$1");

  for (const match of normalised.matchAll(/(\d+(?:\.\d+)?)(\s*%)?/g)) {
    const raw = match[1];
    const isPercentage = Boolean(match[2]);
    const value = Number(raw);

    if (!allowed.has(value)) {
      offenders.push(isPercentage ? `${raw}%` : raw);
      continue;
    }

    // The value is allowed, but as a percentage it may be a coincidence — the
    // model computing "42%" from an unrelated count of 42.
    if (isPercentage && options.rejectUnlistedPercentages) {
      offenders.push(`${raw}%`);
    }
  }

  for (const word of normalised.match(NUMBER_WORDS) ?? []) {
    offenders.push(word.toLowerCase());
  }

  return offenders;
}

/**
 * Every number appearing in a STRING, normalised for thousands separators.
 * Distinct from numbersInValue(), which walks a structured payload.
 */
export function numbersInText(text: string): Set<number> {
  const found = new Set<number>();
  const normalised = text.replace(/(\d),(?=\d{3}\b)/g, "$1");

  for (const raw of normalised.match(/\d+(?:\.\d+)?/g) ?? []) {
    const value = Number(raw);
    if (Number.isFinite(value)) found.add(value);
  }
  return found;
}

/** Collects every number appearing in a structured input payload. */
export function numbersIn(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(value);
    // A figure stored as 88.50 is legitimately written "89" in prose.
    if (!Number.isInteger(value)) into.add(Math.round(value));
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) numbersIn(item, into);
  }
  return into;
}
