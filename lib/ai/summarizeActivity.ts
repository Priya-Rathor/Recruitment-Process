// =============================================================================
// AI Service Layer — "What's happened with Rahul?"
//
// Condenses a long event history into a few sentences. The value is real: a
// candidate two months into a pipeline can have forty rows, and a recruiter
// picking up someone else's work needs the shape of it, not the rows.
//
// THE CONSTRAINT THAT SHAPES EVERYTHING HERE: the narrative must not state an
// event that isn't in the log. That is checked mechanically by
// findUngroundedClaims() AFTER generation, and a narrative that fails the check
// is REJECTED — not shown with a warning, not shown with the offending sentence
// removed. A summary a reader has to fact-check is worth less than no summary,
// because they will not fact-check it.
//
// The model is also given rendered descriptions rather than raw rows, so what it
// can say is bounded by what the timeline already shows a human.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";
import { findUngroundedClaims, type TimelineFact } from "@/lib/activity/grounding";

export type ActivityNarrative = {
  narrative: string;
  /** How many events it was built from — shown so the reader can judge it. */
  eventCount: number;
  /** Range covered, so a stale summary is visible as stale. */
  from: string;
  to: string;
};

const SYSTEM_PROMPT = `You summarise a recruitment activity log into a short narrative for a recruiter.

ABSOLUTE RULE: describe only what is in the events given to you. Never state, imply, or infer anything that is not there.
- If there is no screening event, do not mention screening — not even to say it is pending.
- If there is no interview event, do not mention interviews.
- Do not guess why something happened, what happens next, or how a candidate performed.
- Do not state any number that is not in the events.
- Do not state any date that is not an event's date.
- If the events are sparse, write a shorter narrative. A short accurate summary is correct; a fuller one that fills gaps is wrong.

Style:
- 2 to 4 sentences, past tense, plain professional English.
- Refer to dates the way the events do (e.g. "on August 10").
- Do not editorialise about the candidate's quality, suitability, or any protected characteristic.
- Do not open with "This candidate" or restate the question.

Respond with JSON only: {"narrative": "..."}`;

type RawNarrative = { narrative?: unknown };

/**
 * Summarises a timeline.
 *
 * Structured input only — rendered descriptions and timestamps, no database
 * handle and no raw rows.
 */
export async function summarizeActivity({
  subjectLabel,
  facts,
}: {
  /** e.g. "Rahul Sharma" — how the narrative should refer to the subject. */
  subjectLabel: string;
  facts: TimelineFact[];
}): Promise<AiResult<ActivityNarrative>> {
  if (facts.length === 0) {
    return aiFailure(
      "invalid_output",
      "There's no recorded activity to summarise yet."
    );
  }

  // One event is a timeline, not a history. The spec's single-record edge case:
  // a "narrative" of one line adds nothing over the line itself, and paying for
  // an AI call to restate it is the cost model's exact complaint.
  if (facts.length < 3) {
    return aiFailure(
      "invalid_output",
      "There isn't enough history yet for a summary — the timeline below is shorter than the summary would be."
    );
  }

  const ordered = [...facts].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  // Bounded: a very long history would otherwise grow the prompt without bound.
  // The earliest and latest events carry the shape of the story, so the middle
  // is what gets dropped, and the narrative says so via eventCount.
  const sample =
    ordered.length <= 60 ? ordered : [...ordered.slice(0, 30), ...ordered.slice(-30)];

  const eventLines = sample
    .map((fact) => {
      const when = new Date(fact.occurredAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      return `- ${when}: ${fact.description}`;
    })
    .join("\n");

  const result = await completeJson<RawNarrative>({
    system: SYSTEM_PROMPT,
    user: `Subject: ${subjectLabel}\n\nEvents, oldest first:\n${eventLines}`,
    temperature: 0.1,
    maxOutputTokens: 400,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawNarrative) : null,
  });

  if (!result.ok) return result;

  const narrative =
    typeof result.data.narrative === "string" ? result.data.narrative.trim() : "";

  if (narrative.length < 20) {
    return aiFailure("invalid_output", "The summary came back empty. Try again.");
  }

  // THE GATE. Checked against the events actually supplied, not the sample —
  // a claim grounded only in a dropped middle event is still grounded.
  const violations = findUngroundedClaims({ narrative, facts: ordered });

  if (violations.length > 0) {
    console.error("[ai] activity narrative rejected as ungrounded:", violations);
    return aiFailure(
      "invalid_output",
      // Named plainly. A recruiter who knows the summary was wrong once will
      // read the next one properly, which is the behaviour we want.
      "The generated summary mentioned something that isn't in the activity log, so it was discarded. The full timeline below is accurate."
    );
  }

  return {
    ok: true,
    data: {
      narrative,
      eventCount: ordered.length,
      from: ordered[0].occurredAt,
      to: ordered[ordered.length - 1].occurredAt,
    },
  };
}
