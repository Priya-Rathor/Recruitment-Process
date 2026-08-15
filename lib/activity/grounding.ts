// =============================================================================
// Narrative grounding.
//
// The spec's hard constraint, stated as a test rather than a hope:
//
//   "AI narrative never states an event absent from the underlying log."
//   "AI only summarizes events that are already logged; it never fabricates or
//    infers events that weren't recorded."
//
// Prompt wording cannot enforce that, so it is enforced mechanically here and
// the enforcement is what the tests cover — per AGENTS.md: "Where an AI output
// must satisfy a hard constraint the spec states, enforce it in code and test
// the enforcement, rather than relying on prompt wording."
//
// The specific failure this prevents: a plausible narrative that says "completed
// AI screening on August 11 and was shortlisted after recruiter review" for a
// candidate who was never screened. Every clause reads like the ones that are
// true, so a human reviewer will not catch it — which is the whole reason the
// check has to be mechanical.
// =============================================================================
import { findUnsupportedNumbers, numbersInText } from "@/lib/ai/numericGuard";

export type TimelineFact = {
  eventType: string;
  /** The rendered sentence — what the model is allowed to paraphrase. */
  description: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

/**
 * Vocabulary that asserts a specific recorded milestone.
 *
 * Each entry maps a phrase the model might write to the event types that would
 * make it true. A narrative using the phrase without any of those events in the
 * log is claiming something that did not happen.
 *
 * Only unambiguous milestone claims are listed. Connective and hedging language
 * ("then", "currently", "appears to") is not a factual assertion and is left
 * alone — an over-broad list would reject good narratives and push us toward
 * turning the guard off, which is worse than a narrower guard that holds.
 */
const CLAIM_VOCABULARY: { pattern: RegExp; requires: string[]; claim: string }[] = [
  {
    // Deliberately just the word. "completed AI screening" asserts a screening
    // happened every bit as much as "completed a screening call" does, and an
    // earlier version of this pattern that required the word "call" let exactly
    // that phrasing through.
    pattern: /\b(screen(ed|ing)|phone\s+screen)\b/i,
    requires: ["screening_call.started", "screening_call.completed", "screening_report.generated"],
    claim: "a screening call",
  },
  {
    pattern: /\b(interview(ed|s)?\s+(was|were|is|scheduled|held)|scheduled\s+(an?\s+)?interview)\b/i,
    requires: ["interview.scheduled", "interview.cancelled", "interview.feedback_submitted"],
    claim: "an interview",
  },
  {
    pattern: /\b(submitted\s+to|sent\s+to\s+the\s+client|shared\s+with\s+the\s+client)\b/i,
    requires: ["client.submission_sent"],
    claim: "a client submission",
  },
  {
    pattern: /\b(shortlist(ed)?)\b/i,
    requires: ["application.stage_changed"],
    claim: "a shortlisting",
  },
  {
    pattern: /\b(hired|offer\s+(was\s+)?(made|extended)|placed)\b/i,
    requires: ["application.stage_changed"],
    claim: "an offer or hire",
  },
  {
    pattern: /\b(rejected|turned\s+down|withdrew|withdrawn)\b/i,
    requires: ["application.stage_changed"],
    claim: "a rejection or withdrawal",
  },
  {
    pattern: /\b(resume|cv)\s+(was\s+)?(uploaded|parsed|received)\b/i,
    requires: ["resume.uploaded", "resume.parsed", "resume.review_applied"],
    claim: "a resume upload",
  },
  {
    pattern: /\bmatch(ed)?\s+(score\s+)?(of\s+)?\d|\bmatch\s+score\b/i,
    requires: ["match.calculated"],
    claim: "a match score",
  },
  {
    pattern: /\b(feedback\s+(was\s+)?(submitted|given|recorded))\b/i,
    requires: ["interview.feedback_submitted"],
    claim: "interview feedback",
  },
];

export type GroundingViolation = {
  kind: "unlogged_event" | "unsupported_number" | "unsupported_date";
  detail: string;
};

/**
 * Checks a narrative against the timeline it was built from.
 *
 * An empty array means every milestone claim, figure and date in the text traces
 * to a logged event.
 */
export function findUngroundedClaims({
  narrative,
  facts,
}: {
  narrative: string;
  facts: TimelineFact[];
}): GroundingViolation[] {
  const violations: GroundingViolation[] = [];
  const loggedTypes = new Set(facts.map((fact) => fact.eventType));

  // 1. Milestone claims must have a corresponding event.
  for (const entry of CLAIM_VOCABULARY) {
    if (!entry.pattern.test(narrative)) continue;
    if (entry.requires.some((required) => loggedTypes.has(required))) continue;

    violations.push({
      kind: "unlogged_event",
      detail: `The summary mentions ${entry.claim}, but nothing like that is in the log.`,
    });
  }

  // 2. Figures must come from the supplied facts.
  //
  // Dates are stripped first: a year, day or time is a date component, checked
  // separately below, and leaving them in would make every correct narrative
  // fail the numeric guard.
  const withoutDates = stripDateLike(narrative);

  const allowedNumbers = new Set<number>();
  for (const fact of facts) {
    for (const value of numbersInText(fact.description)) allowedNumbers.add(value);
    for (const value of Object.values(fact.metadata ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) {
        allowedNumbers.add(value);
        allowedNumbers.add(Math.round(value));
      }
    }
  }

  for (const offender of findUnsupportedNumbers(withoutDates, allowedNumbers)) {
    violations.push({
      kind: "unsupported_number",
      detail: `The summary states "${offender}", which isn't in the recorded events.`,
    });
  }

  // 3. Dates must be dates something actually happened on.
  //
  // The spec's own example narrative is date-heavy ("entered the system on
  // August 10 ... completed AI screening on August 11"), and a confidently wrong
  // date is read as fact by whoever acts on it.
  const allowedDates = new Set<string>();
  for (const fact of facts) {
    const parsed = new Date(fact.occurredAt);
    if (!Number.isNaN(parsed.getTime())) {
      allowedDates.add(monthDayKey(parsed));
    }
  }

  // Both orders. "25 August" is as much a fabricated date as "August 25", and
  // checking only one of them would leave the other unguarded.
  const dateMentions: { text: string; month: string; day: number }[] = [];

  for (const mention of narrative.matchAll(
    new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(st|nd|rd|th)?(?!\\d)`, "gi")
  )) {
    dateMentions.push({ text: mention[0], month: mention[1].toLowerCase(), day: Number(mention[2]) });
  }

  for (const mention of narrative.matchAll(
    new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(${MONTH})\\b`, "gi")
  )) {
    dateMentions.push({ text: mention[0], month: mention[3].toLowerCase(), day: Number(mention[1]) });
  }

  for (const mention of dateMentions) {
    if (!allowedDates.has(`${mention.month}-${mention.day}`)) {
      violations.push({
        kind: "unsupported_date",
        detail: `The summary dates something to ${mention.text}, but no recorded event happened then.`,
      });
    }
  }

  return violations;
}

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * Removes date-shaped text so the numeric guard doesn't flag day and year
 * numbers. Dates get their own check above.
 *
 * ORDER AND ANCHORING BOTH MATTER. An earlier version matched only
 * "August 10"-style dates, with an unanchored `\d{1,2}` for the day. Given
 * "10 August 2026" it matched "August 20" — the first two digits of the YEAR —
 * and left behind "10" and "26" as two invented figures. Both correct
 * narratives failed and the guard looked broken, which is how a guard gets
 * switched off.
 *
 * So: four-digit years go FIRST, and each day number is anchored with a
 * lookahead that refuses to stop mid-number.
 */
function stripDateLike(text: string): string {
  return (
    text
      // Years first, so no later pattern can bite off half of one.
      .replace(/\b(19|20)\d{2}\b/g, " ")
      // "10 August" / "10th August"
      .replace(new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTH})\\b`, "gi"), " ")
      // "August 10" / "August 10th" — (?!\d) so it cannot stop inside a number.
      .replace(new RegExp(`\\b(${MONTH})\\s+\\d{1,2}(st|nd|rd|th)?(?!\\d)`, "gi"), " ")
      .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
  );
}

function monthDayKey(date: Date): string {
  const month = date
    .toLocaleString("en-GB", { month: "long", timeZone: "UTC" })
    .toLowerCase();
  return `${month}-${date.getUTCDate()}`;
}

/**
 * Turns stored events into the facts the model is given.
 *
 * The model sees the rendered description, never raw metadata — so it cannot
 * paraphrase a field nobody chose to surface, and what it may say is bounded by
 * what the timeline already shows a human.
 */
export function toTimelineFacts(
  events: {
    event_type: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }[],
  describe: (eventType: string, metadata: Record<string, unknown>) => string
): TimelineFact[] {
  return events.map((event) => ({
    eventType: event.event_type,
    description: describe(event.event_type, event.metadata ?? {}),
    occurredAt: event.created_at,
    metadata: event.metadata ?? {},
  }));
}
