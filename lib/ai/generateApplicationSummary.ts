// =============================================================================
// AI Service Layer function — Module 5's one-paragraph application summary.
//
// Replaces opening five tabs: "Rahul is currently in a Director Round. Resume match
// was 89%, AI screening completed successfully, and technical interview feedback
// was positive. Client feedback has been pending for two days."
//
// The spec is explicit that the summary is "derived strictly from the
// application's own structured data", and its test is "AI summary never
// contradicts the structured fields on the same application".
//
// Enforced, not requested:
//   1. The function receives ONLY the application's own structured facts — no
//      database handle, so there is nothing else it could describe.
//   2. Every digit in the output is checked against the values supplied. A
//      match score the model rounded, inverted, or invented fails validation and
//      the summary is rejected rather than rendered beside contradicting fields.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { findUnsupportedNumbers } from "@/lib/ai/numericGuard";
import { STAGE_LABELS, type ApplicationStage } from "@/lib/applications/stages";

export type ApplicationSummaryInput = {
  candidateName: string;
  jobTitle: string;
  stage: ApplicationStage;
  /** 0-100, or null when Module 7 hasn't scored this application yet. */
  matchScore: number | null;
  daysInCurrentStage: number | null;
  /** Whole days since the application was created. */
  ageDays: number | null;
  assignedRecruiterName: string | null;
  noteCount: number;
  /** Most recent note, for context. Truncated by the caller. */
  latestNote: string | null;
};

export type ApplicationSummary = {
  summary: string;
};

const MAX_SUMMARY_LENGTH = 600;

/**
 * Numbers the model may state: the figures supplied, plus 0. Nothing else —
 * a "89%" that should be 88, or a days count the model estimated, is exactly
 * the contradiction the spec forbids.
 */
export function allowedSummaryNumbers(input: ApplicationSummaryInput): Set<number> {
  const allowed = new Set<number>([0, input.noteCount]);
  if (input.matchScore !== null) {
    allowed.add(input.matchScore);
    // A score stored as 89.00 is legitimately written "89".
    allowed.add(Math.round(input.matchScore));
  }
  if (input.daysInCurrentStage !== null) allowed.add(input.daysInCurrentStage);
  if (input.ageDays !== null) allowed.add(input.ageDays);
  return allowed;
}

/** Re-exported for the tests and callers; the implementation is shared. */
export function findUnsupportedSummaryNumbers(text: string, allowed: Set<number>): string[] {
  return findUnsupportedNumbers(text, allowed);
}

function validateShape(value: unknown): ApplicationSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (summary.length === 0 || summary.length > MAX_SUMMARY_LENGTH) return null;
  return { summary };
}

const SYSTEM_PROMPT = `You write a one-paragraph status summary of a single recruitment application.

You will be given a JSON object of facts already recorded by the system.

Return ONLY a JSON object: { "summary": string }

Absolute rules:
- Describe ONLY the facts in the input. Never infer, estimate, or invent anything — especially not interview outcomes, screening results, or client feedback that is not present.
- Write every number as digits ("89", not "eighty-nine"). Never spell a number out.
- Do not perform arithmetic. Do not state a number that is not literally in the input.
- 2 to 4 short sentences, plain language, no bullet points or headings.
- Mention the stage, and the match score only if one is given.
- If a fact is absent, omit it silently rather than saying it is unknown.
- No commentary outside the JSON object.`;

export async function generateApplicationSummary(
  input: ApplicationSummaryInput
): Promise<AiResult<ApplicationSummary>> {
  const allowed = allowedSummaryNumbers(input);

  // Only facts that exist are sent. Omitting a null is deliberate: including
  // "matchScore: null" invites the model to comment on its absence.
  const facts: Record<string, unknown> = {
    candidate: input.candidateName,
    job: input.jobTitle,
    stage: STAGE_LABELS[input.stage],
  };
  if (input.matchScore !== null) facts.matchScorePercent = input.matchScore;
  if (input.daysInCurrentStage !== null) facts.daysInCurrentStage = input.daysInCurrentStage;
  if (input.ageDays !== null) facts.daysSinceApplied = input.ageDays;
  if (input.assignedRecruiterName) facts.assignedRecruiter = input.assignedRecruiterName;
  if (input.noteCount > 0) facts.noteCount = input.noteCount;
  if (input.latestNote) facts.latestNote = input.latestNote.slice(0, 400);

  return completeJson<ApplicationSummary>({
    system: SYSTEM_PROMPT,
    user: JSON.stringify(facts, null, 2),
    // Reporting, not writing.
    temperature: 0.1,
    maxOutputTokens: 350,
    validate: (value) => {
      const parsed = validateShape(value);
      if (!parsed) return null;

      const offenders = findUnsupportedSummaryNumbers(parsed.summary, allowed);
      if (offenders.length > 0) {
        console.error(
          `[ai] application summary cited unsupported figures: ${offenders.join(", ")}`
        );
        return null;
      }

      return parsed;
    },
  });
}
