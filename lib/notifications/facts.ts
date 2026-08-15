// =============================================================================
// The fixed-fact guard.
//
// The spec's test: "AI tone adjustments never alter the fixed facts in a
// template (time, names, figures)."
//
// Enforced here, mechanically, and tested as enforcement — per AGENTS.md, a
// hard constraint the spec states goes in code rather than in prompt wording.
//
// What makes this different from Module 14's grounding check: there, the model
// might invent an event that never happened. Here it might quietly change 2:00pm
// to 3:00pm in an otherwise perfect sentence. The second is harder to spot and
// lands on a real person's calendar, so the check is stricter — an exact
// substring match on every declared fact, plus a sweep for figures that were
// not in the original.
// =============================================================================
import { numbersInText } from "@/lib/ai/numericGuard";

export type FactViolation = {
  kind: "missing_fact" | "invented_number" | "invented_time";
  detail: string;
};

/**
 * Normalises for comparison WITHOUT touching digits.
 *
 * Whitespace and case are style; the model is allowed to change those. Digits,
 * punctuation inside times, and letters are content. Deliberately does not strip
 * punctuation, because "2.00pm" and "2:00pm" being treated as equal would let a
 * reformatting slip past that a mail client might render ambiguously.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Checks a rewritten message against the facts it must preserve.
 *
 * `original` is the rendered template; `rewritten` is what the model produced.
 * An empty result means the rewrite is safe to show a recruiter for approval.
 */
export function findAlteredFacts({
  rewritten,
  facts,
  original,
}: {
  rewritten: string;
  /** placeholder -> substituted value, from renderTemplate(). */
  facts: Record<string, string>;
  /** The rendered template, for the invented-figure sweep. */
  original: string;
}): FactViolation[] {
  const violations: FactViolation[] = [];
  const haystack = normalise(rewritten);

  // 1. EVERY declared fact must still be present, verbatim.
  //
  // Not "approximately present" and not fuzzy-matched. A name shortened from
  // "Rahul Sharma" to "Rahul" is a judgement call the model does not get to
  // make on an external message, and a time reworded at all is a time that may
  // now be wrong.
  for (const [key, value] of Object.entries(facts)) {
    if (!haystack.includes(normalise(value))) {
      violations.push({
        kind: "missing_fact",
        detail: `The rewrite no longer contains the ${key.replace(/_/g, " ")} "${value}".`,
      });
    }
  }

  // 2. No NEW figures.
  //
  // Catches the case a substring check alone misses: the model keeps "2:00pm"
  // and also writes "arrive by 1:45pm", inventing a fact that reads as
  // instruction. Anything numeric in the rewrite must have been in the original
  // or in a fact.
  const allowed = numbersInText(original);
  for (const value of Object.values(facts)) {
    for (const number of numbersInText(value)) allowed.add(number);
  }

  for (const number of numbersInText(rewritten)) {
    if (!allowed.has(number)) {
      violations.push({
        kind: "invented_number",
        detail: `The rewrite states "${number}", which isn't in the approved message.`,
      });
    }
  }

  // 3. No NEW clock times.
  //
  // A separate pass because a time can be invented without a new number:
  // "2:00pm" in the original permits 2 and 0, so "arrive at 2:30pm" would slip
  // past step 2 if 30 appeared anywhere else. Times are the single most
  // damaging thing to get wrong in an interview message.
  const originalTimes = new Set(clockTimesIn(original));
  for (const value of Object.values(facts)) {
    for (const time of clockTimesIn(value)) originalTimes.add(time);
  }

  for (const time of clockTimesIn(rewritten)) {
    if (!originalTimes.has(time)) {
      violations.push({
        kind: "invented_time",
        detail: `The rewrite mentions ${time}, which isn't in the approved message.`,
      });
    }
  }

  return violations;
}

/**
 * Clock times in a string, normalised so "2:00 PM", "2:00pm" and "2:00pm" are
 * one value — the model is allowed to restyle a time it did not change.
 */
export function clockTimesIn(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(/\b(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?/gi)) {
    const hour = match[1];
    const minute = match[2];
    const meridiem = match[3] ? match[3].replace(/\./g, "").toLowerCase() : "";
    found.push(`${Number(hour)}:${minute}${meridiem}`);
  }

  // Bare "3pm" — no colon, still a time, still wrong if invented.
  for (const match of text.matchAll(/\b(\d{1,2})\s*([ap]\.?m\.?)\b/gi)) {
    const meridiem = match[2].replace(/\./g, "").toLowerCase();
    found.push(`${Number(match[1])}:00${meridiem}`);
  }

  return found;
}
