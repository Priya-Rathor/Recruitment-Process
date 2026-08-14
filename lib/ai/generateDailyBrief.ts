// =============================================================================
// AI Service Layer function — Module 2's Daily Operations Brief.
//
// Turns the counts the dashboard has ALREADY computed into a short narrative.
// The spec is emphatic: "AI explains the numbers, it does not invent them", and
// the test is "AI brief never states a number that contradicts the KPI tiles".
//
// That is enforced mechanically here, not just requested in the prompt:
//   1. The function receives only the computed counts — no database handle, so
//      there is nothing else it could report on.
//   2. Every digit-run in the generated text is checked against the numbers we
//      supplied. Anything else means the model invented a figure, and the brief
//      is rejected as invalid output rather than shown to a manager.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";
import { findUnsupportedNumbers as sharedFindUnsupportedNumbers } from "@/lib/ai/numericGuard";

export type DailyBriefInput = {
  /** Metric label -> value. Only metrics that actually resolved are passed in. */
  counts: Record<string, number>;
  /** Number of items in the attention queue. */
  attentionCount: number;
  /** Threshold behind "overdue"/"no movement for N days", so citing it is valid. */
  overdueDays: number;
  /** "organization" or "own" — changes the brief's voice (team vs. your work). */
  scope: "organization" | "own";
};

export type DailyBrief = {
  /** 2-4 sentence plain-language narrative. */
  summary: string;
  /** Up to 3 short suggested focus areas. Advisory only — never auto-actioned. */
  focus: string[];
};

const MAX_SUMMARY_LENGTH = 700;

/**
 * Every number the model is permitted to state: the values we gave it, plus the
 * overdue threshold, plus 0 (safe to say "no failed calls").
 */
export function allowedNumbers(input: DailyBriefInput): Set<number> {
  const allowed = new Set<number>([0, input.overdueDays, input.attentionCount]);
  for (const value of Object.values(input.counts)) allowed.add(value);
  return allowed;
}

/**
 * Figures in `text` that aren't in `allowed`. Exported for unit testing — this
 * is the guard that makes "the brief can't contradict the tiles" true.
 *
 * Delegates to the shared guard, which closes three bypasses the first version
 * had: "1,234" split into two false offenders, spelled-out numbers skipping the
 * check entirely, and a computed "42%" passing because 42 was allowed elsewhere.
 */
export function findUnsupportedNumbers(text: string, allowed: Set<number>): string[] {
  return sharedFindUnsupportedNumbers(text, allowed, { rejectUnlistedPercentages: true });
}

function validateShape(value: unknown): DailyBrief | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (summary.length === 0 || summary.length > MAX_SUMMARY_LENGTH) return null;

  const focus = Array.isArray(raw.focus)
    ? raw.focus
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 160)
        .slice(0, 3)
    : [];

  return { summary, focus };
}

const SYSTEM_PROMPT = `You write a short daily operations brief for a recruitment team.

You will be given a JSON object of figures already computed by the system.

Return ONLY a JSON object:
{ "summary": string, "focus": string[] }

Absolute rules:
- State ONLY figures present in the input. Never estimate, extrapolate, total, average, or invent a number.
- Write every number as digits ("4", not "four").
- Do not perform arithmetic on the figures; do not report a number that is not literally in the input.
- summary: 2 to 4 short sentences of plain language, no bullet points, no headings.
- focus: up to 3 very short suggested focus areas. Advisory only.
- If a figure is 0, either say so plainly or omit it — never imply activity that did not happen.
- If the input has almost no activity, say that briefly rather than padding.
- No commentary outside the JSON object.`;

export async function generateDailyBrief(
  input: DailyBriefInput
): Promise<AiResult<DailyBrief>> {
  const hasAnySignal =
    Object.values(input.counts).some((value) => value > 0) || input.attentionCount > 0;

  // Nothing happened — don't spend a token to narrate an empty day. This is a
  // real "no data" answer, not a failure, so it returns ok.
  if (!hasAnySignal) {
    return {
      ok: true,
      data: {
        summary:
          input.scope === "own"
            ? "Nothing needs your attention yet today. New candidates, screenings, and interviews will appear here as they happen."
            : "No activity recorded yet today. New candidates, screenings, and interviews will appear here as they happen.",
        focus: [],
      },
    };
  }

  const allowed = allowedNumbers(input);

  const userPrompt = JSON.stringify(
    {
      scope: input.scope,
      overdueThresholdDays: input.overdueDays,
      itemsNeedingAttention: input.attentionCount,
      figures: input.counts,
    },
    null,
    2
  );

  return completeJson<DailyBrief>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    // Low temperature: this is reporting, not writing.
    temperature: 0.1,
    maxOutputTokens: 400,
    validate: (value) => {
      const brief = validateShape(value);
      if (!brief) return null;

      // The numeric-consistency guard. Reject rather than render — a brief that
      // contradicts the tiles beside it destroys trust in both.
      const offenders = [
        ...findUnsupportedNumbers(brief.summary, allowed),
        ...brief.focus.flatMap((item) => findUnsupportedNumbers(item, allowed)),
      ];
      if (offenders.length > 0) {
        console.error(
          `[ai] daily brief cited unsupported figures: ${offenders.join(", ")}`
        );
        return null;
      }

      return brief;
    },
  });
}
