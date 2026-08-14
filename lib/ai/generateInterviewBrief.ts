// =============================================================================
// AI Service Layer function — Module 11's interview brief.
//
// Replaces opening the resume, screening report, notes and job description in
// four tabs: "Rahul Sharma — Senior Java Developer. Strong areas: Java, Spring
// Boot, AWS. Verify: Kubernetes depth, system-design experience. Expected CTC:
// 19 LPA. Notice: 30 days."
//
// THE HARD RULE: "The human interviewer still conducts the interview and enters
// the actual feedback — AI prepares, it does not evaluate the candidate."
//
// Enforced three ways, not just asked for:
//   1. The output schema has NO verdict, score, or recommendation field. There
//      is nowhere for an evaluation to go.
//   2. Validation rejects hire/no-hire language anywhere in the text, so it
//      cannot smuggle a verdict into prose.
//   3. Figures are checked against the facts supplied, so the brief cannot
//      contradict the application summary built from the same data.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { findUnsupportedNumbers, numbersInText } from "@/lib/ai/numericGuard";

export type InterviewBriefInput = {
  candidateName: string;
  jobTitle: string;
  /** Strong matches from Module 7, already computed. */
  strengths: string[];
  /** Gaps and things to verify from Module 7. */
  toVerify: string[];
  currentRole: string | null;
  currentCompany: string | null;
  totalExperienceYears: number | null;
  /** From the REVIEWED screening report (Module 9), when one exists. */
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  screeningSummary: string | null;
  /** The job's configured interview questions, if any. */
  existingQuestions: string[];
};

export type InterviewBrief = {
  /** 2-3 sentence orientation. */
  summary: string;
  /** Areas the candidate looks strong in, worth confirming rather than probing. */
  strongAreas: string[];
  /** What this interview should actually establish. */
  areasToVerify: string[];
  /** Questions that probe the gaps specifically. */
  suggestedQuestions: string[];
};

const MAX_ITEMS = 8;

/**
 * Language that would make the brief an evaluation rather than a preparation.
 *
 * A brief that says "strong hire" has decided the outcome before the interview
 * happened, which is exactly what the spec forbids — and what makes an interview
 * a formality rather than an assessment.
 */
const VERDICT_PATTERNS = [
  /\bstrong (?:hire|yes|no)\b/i,
  /\b(?:do not|don'?t|should not|shouldn'?t) hire\b/i,
  /\brecommend(?:ed|s|ation)? (?:to )?(?:hire|reject|against)\b/i,
  /\b(?:hire|reject) (?:this |the )?candidate\b/i,
  /\bnot a (?:good )?fit\b/i,
  /\b(?:clear|obvious) (?:pass|fail)\b/i,
  /\b(?:unsuitable|unqualified|perfect candidate)\b/i,
  /\boverall (?:score|rating|verdict|assessment)\b/i,
];

/** Returns the verdict-like phrases found in `text`. Empty means clean. */
export function findVerdictLanguage(text: string): string[] {
  const found: string[] = [];
  for (const pattern of VERDICT_PATTERNS) {
    const match = text.match(pattern);
    if (match) found.push(match[0]);
  }
  return found;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const text = cleanText(item, 300);
    if (text) output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

/** Numbers the brief is allowed to state: those we supplied. */
export function allowedBriefNumbers(input: InterviewBriefInput): Set<number> {
  const allowed = new Set<number>([0]);

  if (input.totalExperienceYears !== null) allowed.add(input.totalExperienceYears);
  if (input.noticePeriodDays !== null) {
    allowed.add(input.noticePeriodDays);
    if (input.noticePeriodDays % 30 === 0) allowed.add(input.noticePeriodDays / 30);
  }
  if (input.expectedCtc !== null) {
    allowed.add(input.expectedCtc);
    allowed.add(Math.round(input.expectedCtc / 100_000)); // "19 LPA"
  }

  // Anything already stated in the supplied text is fair to repeat.
  for (const text of [
    ...input.strengths,
    ...input.toVerify,
    ...input.existingQuestions,
    input.screeningSummary ?? "",
  ]) {
    for (const value of numbersInText(text)) allowed.add(value);
  }

  return allowed;
}

function validate(value: unknown, input: InterviewBriefInput): InterviewBrief | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const summary = cleanText(raw.summary, 800);
  if (!summary) return null;

  const brief: InterviewBrief = {
    summary,
    strongAreas: cleanList(raw.strongAreas),
    areasToVerify: cleanList(raw.areasToVerify),
    suggestedQuestions: cleanList(raw.suggestedQuestions, 10),
  };

  const allText = [
    brief.summary,
    ...brief.strongAreas,
    ...brief.areasToVerify,
    ...brief.suggestedQuestions,
  ].join("\n");

  // Gate 2: no verdict, anywhere.
  const verdicts = findVerdictLanguage(allText);
  if (verdicts.length > 0) {
    console.error(`[ai] interview brief contained verdict language: ${verdicts.join(", ")}`);
    return null;
  }

  // Gate 3: no figure the interviewer's other screens would contradict.
  const ungrounded = findUnsupportedNumbers(allText, allowedBriefNumbers(input));
  if (ungrounded.length > 0) {
    console.error(`[ai] interview brief cited unsupported figures: ${ungrounded.join(", ")}`);
    return null;
  }

  return brief;
}

const SYSTEM_PROMPT = `You prepare a briefing document for a human interviewer, from facts already recorded about a candidate and a job.

Return ONLY a JSON object:
{
  "summary": string,
  "strongAreas": string[],
  "areasToVerify": string[],
  "suggestedQuestions": string[]
}

Absolute rules:
- You PREPARE the interviewer. You do NOT evaluate the candidate. Never state or imply whether they should be hired, whether they are a good fit, or how strong they are overall. The interviewer decides that after the interview.
- Never use words like "strong hire", "recommend", "not a fit", "unsuitable", or any overall verdict, score, or rating.
- State only facts present in the input. Never invent a figure, and never estimate one.
- summary: 2 to 3 sentences orienting the interviewer — who this person is and what this interview needs to establish.
- strongAreas: what looks solid, so the interviewer confirms rather than re-covers it.
- areasToVerify: what this interview should actually establish. This is the useful part — be specific.
- suggestedQuestions: questions that probe the areasToVerify specifically. Practical and open-ended, not trivia. Do not repeat questions already listed in the input.
- Say nothing about the candidate's personality, accent, age, gender, or any protected characteristic.
- Return no commentary outside the JSON object.`;

export async function generateInterviewBrief(
  input: InterviewBriefInput
): Promise<AiResult<InterviewBrief>> {
  // Nothing to brief from. Better to say so than to produce a generic template
  // that looks informed.
  if (input.strengths.length === 0 && input.toVerify.length === 0 && !input.screeningSummary) {
    return {
      ok: false,
      code: "invalid_output",
      message:
        "There's nothing to brief from yet — run a match or a screening call first, and the brief will have something to work with.",
    };
  }

  const facts: Record<string, unknown> = {
    candidate: input.candidateName,
    role: input.jobTitle,
    strengths: input.strengths,
    toVerify: input.toVerify,
  };

  if (input.currentRole) facts.currentRole = input.currentRole;
  if (input.currentCompany) facts.currentCompany = input.currentCompany;
  if (input.totalExperienceYears !== null) facts.totalExperienceYears = input.totalExperienceYears;
  if (input.expectedCtc !== null) facts.expectedCtc = input.expectedCtc;
  if (input.noticePeriodDays !== null) facts.noticePeriodDays = input.noticePeriodDays;
  if (input.screeningSummary) facts.screeningSummary = input.screeningSummary;
  if (input.existingQuestions.length > 0) facts.questionsAlreadyPlanned = input.existingQuestions;

  return completeJson<InterviewBrief>({
    system: SYSTEM_PROMPT,
    user: JSON.stringify(facts, null, 2),
    temperature: 0.2,
    maxOutputTokens: 1000,
    validate: (value) => validate(value, input),
  });
}
