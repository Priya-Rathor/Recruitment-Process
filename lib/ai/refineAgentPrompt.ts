// =============================================================================
// AI Service Layer — revise a voice agent's instructions from a plain request.
//
// "Make her sound more formal", "add a line about remote work flexibility" — the
// operator describes the change, this returns a revised prompt. It is the same
// shape as adjustMessageTone(): structured input, text output, no database handle,
// no ability to save anything.
//
// THE OUTPUT IS A PROPOSAL, NOT A WRITE.
//
// This function cannot replace the stored prompt and the route that calls it does
// not either. The revision comes back, the console shows it beside the original,
// and a person presses Accept — the propose-then-confirm pattern this product uses
// everywhere an AI touches text a human owns. That is enforced structurally: there
// is nothing in this module that could persist a change.
//
// TWO GUARDS, and they are the reason this file is longer than the prompt it
// sends:
//
//   1. THE GUARDRAILS MUST SURVIVE. A voice agent's guardrails are the lines that
//      stop it discussing salary or implying a hiring decision. "Make her sound
//      warmer" must not quietly drop them. Any guardrail that goes missing gets
//      the revision REJECTED, not flagged — a reviewer skims a fluent rewrite and
//      would not notice an absent rule.
//
//   2. NO PROVIDER NAMES, NO CREDENTIALS, NO TOKENS. The revision is displayed on
//      a page that must stay provider-neutral, and it is written by a model that
//      was given free-text instructions by a user. A revision that introduces a
//      provider name or something shaped like a key is rejected.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";

/** Longest change request we will act on. Beyond this it is a rewrite, not an edit. */
export const MAX_INSTRUCTION_LENGTH = 400;

/** Matches lib/voice/settings.ts LIMITS.systemPromptMax, so the result can be saved. */
export const MAX_PROMPT_LENGTH = 8000;

export type PromptRevision = {
  /** The proposed replacement. Validated; safe to show for approval. */
  prompt: string;
  /** Guardrails confirmed still present, so the UI can say what was checked. */
  preservedGuardrails: string[];
  /** One line on what changed, for the diff header. */
  summary: string;
};

/**
 * Words that must not appear in a revision.
 *
 * The same list the adapter scrubs catalogue labels with, for the same reason:
 * this text is displayed on the Voice Agent Console, which is required to stay
 * provider-neutral in its copy. A model asked to "mention the technology we use"
 * would happily name one.
 */
const FORBIDDEN_TERMS = [
  "bolna",
  "elevenlabs",
  "deepgram",
  "openai",
  "anthropic",
  "gpt-",
  "claude",
  "gemini",
  "twilio",
  "plivo",
  "api key",
  "api_key",
  "bearer ",
  "sk-",
];

function buildSystemPrompt(guardrails: string[]): string {
  const guardrailList =
    guardrails.length > 0
      ? guardrails.map((rule) => `- ${rule}`).join("\n")
      : "(none configured)";

  return `You revise the instructions given to an automated voice agent that screens job candidates by telephone.

You will be given the CURRENT INSTRUCTIONS and a CHANGE REQUEST. Return the full revised instructions.

THESE RULES MUST STILL BE OBEYED BY YOUR REVISION. If any of them appears in the current instructions, it must still appear — in the same words or clearly stronger wording:
${guardrailList}

You must NOT:
- remove or soften any rule listed above
- name any technology vendor, model, or product
- include an API key, token, or anything resembling a credential
- add a factual claim about the employer that was not already there (a salary, a start date, a benefit)
- instruct the agent to conceal that it is automated, or to skip the recorded-call disclosure

You MAY change tone, register, ordering, sentence structure, and add or remove guidance about HOW to conduct the conversation.

Keep the result under ${MAX_PROMPT_LENGTH} characters.

Respond with JSON only: {"prompt": "the full revised instructions", "summary": "one short sentence describing what you changed"}`;
}

type RawRevision = { prompt?: unknown; summary?: unknown };

/**
 * Normalises a rule for comparison.
 *
 * A guardrail counts as preserved if its MEANINGFUL WORDS survive, not if the
 * string matches byte for byte — the whole point of the feature is rewording, and
 * demanding an exact copy would reject every useful revision. Punctuation and
 * casing go; the words stay.
 */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

/**
 * Did this guardrail survive the rewrite?
 *
 * Requires most of its significant words to still be present. A threshold rather
 * than all-or-nothing because "Never state or imply a hiring decision" legitimately
 * becomes "Do not indicate any hiring decision" — four of six words survive, and
 * the rule plainly did too.
 */
function guardrailSurvives(rule: string, revised: string): boolean {
  const words = significantWords(rule);
  if (words.length === 0) return true;

  const haystack = revised.toLowerCase();
  const found = words.filter((word) => haystack.includes(word)).length;

  return found / words.length >= 0.6;
}

export async function refineAgentPrompt({
  currentPrompt,
  instruction,
  guardrails,
  personaHint,
}: {
  currentPrompt: string;
  /** What the operator asked for, in their own words. */
  instruction: string;
  /** The agent's configured guardrails. These must survive. */
  guardrails: string[];
  /** The agent's persona, for context only — never edited by this function. */
  personaHint?: string | null;
}): Promise<AiResult<PromptRevision>> {
  const prompt = currentPrompt.trim();
  const change = instruction.trim();

  if (prompt.length === 0) {
    return aiFailure("invalid_output", "There are no instructions to revise yet. Write a first draft, then ask for an edit.");
  }
  if (change.length === 0) {
    return aiFailure("invalid_output", "Describe what you'd like changed.");
  }
  if (change.length > MAX_INSTRUCTION_LENGTH) {
    return aiFailure(
      "invalid_output",
      `Keep the request under ${MAX_INSTRUCTION_LENGTH} characters — it describes a change, not the whole prompt.`
    );
  }

  const result = await completeJson<RawRevision>({
    system: buildSystemPrompt(guardrails),
    user: [
      personaHint?.trim() ? `PERSONA (context only, do not rewrite):\n${personaHint.trim()}` : null,
      `CURRENT INSTRUCTIONS:\n${prompt}`,
      `CHANGE REQUEST:\n${change}`,
    ]
      .filter((part): part is string => part !== null)
      .join("\n\n"),
    // Low. This is a constrained edit of text somebody owns, and every degree of
    // freedom is a degree of freedom to drop a guardrail.
    temperature: 0.3,
    maxOutputTokens: 1600,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawRevision) : null,
  });

  if (!result.ok) return result;

  const revised = typeof result.data.prompt === "string" ? result.data.prompt.trim() : "";
  const summary =
    typeof result.data.summary === "string" && result.data.summary.trim().length > 0
      ? result.data.summary.trim().slice(0, 200)
      : "Revised the instructions.";

  if (revised.length === 0) {
    return aiFailure("invalid_output", "The revision came back empty. Your instructions are unchanged.");
  }
  if (revised.length > MAX_PROMPT_LENGTH) {
    return aiFailure(
      "invalid_output",
      "The revision came back longer than an agent prompt may be. Your instructions are unchanged."
    );
  }

  // --- GUARD 1: the guardrails --------------------------------------------
  const dropped = guardrails.filter(
    (rule) => guardrailSurvives(rule, prompt) && !guardrailSurvives(rule, revised)
  );

  if (dropped.length > 0) {
    console.error("[ai] prompt revision rejected — guardrails dropped:", dropped);
    return aiFailure(
      "invalid_output",
      `That edit would have dropped a guardrail (${dropped[0]}). Your instructions are unchanged — try asking for a smaller change.`
    );
  }

  // --- GUARD 2: nothing that shouldn't be in there ------------------------
  const lowered = revised.toLowerCase();
  const leaked = FORBIDDEN_TERMS.find((term) => lowered.includes(term));

  if (leaked) {
    console.error(`[ai] prompt revision rejected — contained a forbidden term: ${leaked}`);
    return aiFailure(
      "invalid_output",
      "The revision mentioned a vendor or credential, so it was discarded. Your instructions are unchanged."
    );
  }

  return {
    ok: true,
    data: {
      prompt: revised,
      preservedGuardrails: guardrails.filter((rule) => guardrailSurvives(rule, revised)),
      summary,
    },
  };
}
