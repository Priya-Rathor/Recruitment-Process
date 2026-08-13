// =============================================================================
// AI Service Layer function — Module 1's onboarding assistant.
//
// Takes the organization's plain-language answer to "What type of hiring do you
// mostly do?" and proposes starting defaults: screening templates, a pipeline,
// interview rounds, candidate fields, automation templates.
//
// Scope limits from the spec, enforced by shape rather than by prompt wording
// alone: this function receives only the answer string plus non-identifying org
// context — no database handle — and returns unsaved *suggestions*. AI does not
// create users, assign roles, or touch permissions here.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";

export type OnboardingRecommendationsInput = {
  /** The org's free-text answer, e.g. "IT recruitment, mostly Java, React, DevOps". */
  hiringFocus: string;
  industry?: string | null;
  teamSize?: string | null;
};

export type OnboardingRecommendations = {
  /** Pipeline stage names, in order, e.g. ["New", "Screening", ...]. */
  pipelineStages: string[];
  /** Suggested screening questions for the org's typical role. */
  screeningQuestions: string[];
  /** Suggested interview rounds, e.g. ["Technical Screen", "System Design"]. */
  interviewRounds: string[];
  /** Extra candidate profile fields worth capturing for this hiring type. */
  candidateFields: string[];
  /** Plain-language automation ideas — descriptions only, never live rules. */
  automationTemplates: string[];
  /** One-sentence rationale shown above the suggestions in the review UI. */
  rationale: string;
};

const MAX_ITEMS = 12;
const MAX_ITEM_LENGTH = 200;

/** Coerces an unknown value into a clean, bounded string array, or null. */
function toStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_ITEM_LENGTH)
    .slice(0, MAX_ITEMS);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Schema validation for the AI output. Rejects (rather than partially renders)
 * anything malformed — the caller surfaces an error and the Owner can skip AI
 * and configure defaults manually.
 */
function validate(value: unknown): OnboardingRecommendations | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const pipelineStages = toStringList(raw.pipelineStages);
  const screeningQuestions = toStringList(raw.screeningQuestions);
  const interviewRounds = toStringList(raw.interviewRounds);
  const candidateFields = toStringList(raw.candidateFields);
  const automationTemplates = toStringList(raw.automationTemplates);
  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";

  if (
    !pipelineStages ||
    !screeningQuestions ||
    !interviewRounds ||
    !candidateFields ||
    !automationTemplates ||
    rationale.length === 0
  ) {
    return null;
  }

  return {
    pipelineStages,
    screeningQuestions,
    interviewRounds,
    candidateFields,
    automationTemplates,
    rationale: rationale.slice(0, 400),
  };
}

const SYSTEM_PROMPT = `You configure starting defaults for a recruitment platform.

Given an organization's description of the hiring they do, propose sensible starting defaults they can accept, edit, or skip.

Return ONLY a JSON object with exactly these keys:
{
  "pipelineStages": string[],
  "screeningQuestions": string[],
  "interviewRounds": string[],
  "candidateFields": string[],
  "automationTemplates": string[],
  "rationale": string
}

Rules:
- Every array must contain between 3 and 10 short entries. Never return an empty array.
- pipelineStages must be ordered from first contact to hired.
- screeningQuestions are questions an automated first-round phone screen would ask.
- automationTemplates are one-line plain-language descriptions of useful rules, not executable configuration.
- rationale is a single sentence explaining your choices.
- Do not suggest anything about user accounts, roles, permissions, or access control.
- Do not include commentary outside the JSON object.`;

export async function generateOnboardingRecommendations(
  input: OnboardingRecommendationsInput
): Promise<AiResult<OnboardingRecommendations>> {
  const hiringFocus = input.hiringFocus.trim();

  // Guard before spending a token — an empty answer has nothing to reason about.
  if (hiringFocus.length < 3) {
    return {
      ok: false,
      code: "invalid_output",
      message: "Tell us a little more about your hiring before generating suggestions.",
    };
  }

  const userPrompt = [
    `Hiring focus: ${hiringFocus.slice(0, 1000)}`,
    input.industry ? `Industry: ${input.industry}` : null,
    input.teamSize ? `Team size: ${input.teamSize}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return completeJson<OnboardingRecommendations>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    validate,
  });
}
