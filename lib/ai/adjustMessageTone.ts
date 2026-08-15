// =============================================================================
// AI Service Layer — tone assistance within an approved template.
//
// The spec's boundary: "AI can adjust phrasing without changing the interview
// time, location, or other hard facts ... the system, not the AI, controls
// whether and how a message is actually sent."
//
// Two structural properties make that true rather than promised:
//
//   1. This function returns TEXT. It has no database handle and no send
//      capability. Nothing here can dispatch a message; the caller stores a
//      draft and a recruiter approves it.
//
//   2. Output is checked against the template's declared fixed facts, and a
//      rewrite that alters one is REJECTED — not shown with a warning. A wrong
//      interview time in a fluent, friendly message is exactly what a reviewer
//      skims past, which is why the check cannot be left to the reviewer.
//
// The original rendered template is always returned alongside, so a rejection
// degrades to "send the approved wording" rather than to nothing.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";
import { findAlteredFacts, type FactViolation } from "@/lib/notifications/facts";

export type ToneOption = "warmer" | "more_concise" | "more_formal";

export const TONE_OPTIONS: { value: ToneOption; label: string; hint: string }[] = [
  { value: "warmer", label: "Warmer", hint: "Friendlier, a little less clipped." },
  { value: "more_concise", label: "More concise", hint: "Shorter, same information." },
  { value: "more_formal", label: "More formal", hint: "Neutral and professional." },
];

export function isToneOption(value: unknown): value is ToneOption {
  return value === "warmer" || value === "more_concise" || value === "more_formal";
}

export type ToneAdjustment = {
  /** The rewritten body. Validated; safe to show for approval. */
  body: string;
  tone: ToneOption;
  /** Facts confirmed still present, so the UI can say what was checked. */
  preservedFacts: string[];
};

const TONE_INSTRUCTIONS: Record<ToneOption, string> = {
  warmer:
    "Make it warmer and more human. Keep it professional — this is a recruiter writing to a candidate, not a friend.",
  more_concise: "Make it shorter. Remove padding, keep every piece of information.",
  more_formal: "Make it more formal and neutral. No contractions, no exclamation marks.",
};

function buildSystemPrompt(facts: Record<string, string>): string {
  const factList = Object.entries(facts)
    .map(([key, value]) => `- ${key.replace(/_/g, " ")}: ${value}`)
    .join("\n");

  return `You rewrite an already-approved recruitment message to adjust its tone.

THESE FACTS MUST APPEAR IN YOUR REWRITE, CHARACTER FOR CHARACTER:
${factList}

Copy each one exactly as written above. Do not shorten a name, do not reformat a time, do not round a number, do not rephrase a location.

You must also NOT:
- add any date, time, number, or deadline that is not already in the message
- add a fact of any kind — no "please arrive 10 minutes early", no "bring your ID"
- remove information that is in the message
- add a greeting or signature that names anyone not already named

You MAY change sentence structure, word choice, ordering, and register.

If you cannot adjust the tone without breaking a rule above, return the message unchanged.

Respond with JSON only: {"body": "..."}`;
}

type RawAdjustment = { body?: unknown };

/**
 * Rewrites a rendered message in a different tone.
 *
 * Structured input only: the rendered text and the facts it must preserve.
 */
export async function adjustMessageTone({
  body,
  facts,
  tone,
}: {
  /** The rendered template body. */
  body: string;
  /** placeholder -> value, from renderTemplate(). */
  facts: Record<string, string>;
  tone: ToneOption;
}): Promise<AiResult<ToneAdjustment>> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return aiFailure("invalid_output", "There's no message to adjust.");
  }

  const result = await completeJson<RawAdjustment>({
    system: buildSystemPrompt(facts),
    user: `Tone requested: ${TONE_INSTRUCTIONS[tone]}\n\nMessage:\n${trimmed}`,
    // Low, because this is a constrained rewrite rather than a creative task —
    // and every degree of freedom here is a degree of freedom to alter a fact.
    temperature: 0.2,
    maxOutputTokens: 600,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawAdjustment) : null,
  });

  if (!result.ok) return result;

  const rewritten = typeof result.data.body === "string" ? result.data.body.trim() : "";

  if (rewritten.length === 0) {
    return aiFailure("invalid_output", "The rewrite came back empty. The approved wording stands.");
  }

  // THE GATE.
  const violations: FactViolation[] = findAlteredFacts({
    rewritten,
    facts,
    original: trimmed,
  });

  if (violations.length > 0) {
    console.error("[ai] tone adjustment rejected — facts altered:", violations);
    return aiFailure(
      "invalid_output",
      // Named plainly. A recruiter who learns the rewrite can go wrong will read
      // the next one properly, which is the behaviour worth having.
      `The reworded version changed something it shouldn't have (${violations[0].detail}) so it was discarded. The approved wording is unchanged.`
    );
  }

  return {
    ok: true,
    data: { body: rewritten, tone, preservedFacts: Object.keys(facts) },
  };
}
