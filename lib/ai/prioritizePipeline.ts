// =============================================================================
// AI Service Layer function — "Ask Pipeline AI: what should I work on first?"
//
// Two hard rules from the spec, both enforced structurally rather than by
// prompt wording:
//
//   "AI turns constant manual board-monitoring into a supervisor role; it does
//    not move cards or change stages on its own."
//     -> this function returns a RANKED LIST. It has no database handle and no
//        way to mutate anything. Acting on the list is the recruiter's click.
//
//   "AI attention summary and prioritization never suggest an action outside
//    the recruiter's permission scope." (spec test)
//     -> the caller passes ONLY the applications already visible to that user,
//        and validation discards any id the model returns that was not in that
//        input. It cannot suggest work on something it was never shown, and it
//        cannot invent an id.
// =============================================================================
import { completeJson, type AiResult } from "@/lib/ai/provider";

/** The de-identified view of one card the model is given. */
export type PipelineItem = {
  id: string;
  candidateName: string;
  jobTitle: string;
  stage: string;
  daysInStage: number;
  slaStatus: "ok" | "at_risk" | "breached" | "not_tracked";
  overdueDays: number;
  matchScore: number | null;
  /** True when a screening report exists but nobody has reviewed it. */
  awaitingScreeningReview: boolean;
};

export type PrioritizedItem = {
  applicationId: string;
  /** 1 = do this first. */
  rank: number;
  reason: string;
};

export type PipelinePriorities = {
  /** Short overview of the board — the spec's "attention summary". */
  attentionSummary: string;
  priorities: PrioritizedItem[];
};

const MAX_PRIORITIES = 8;
/** More than this and we are sending a database dump, not a question. */
export const MAX_ITEMS_SENT = 60;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

/**
 * Validates the model's output against the ids it was actually given.
 *
 * `allowedIds` is the scope boundary. Anything outside it is dropped silently —
 * a suggestion to act on an application the recruiter cannot even see would be
 * both useless and a permission leak.
 */
export function validatePriorities(
  value: unknown,
  allowedIds: Set<string>
): PipelinePriorities | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const attentionSummary = cleanText(raw.attentionSummary, 600);
  if (!attentionSummary) return null;

  const priorities: PrioritizedItem[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw.priorities)) {
    for (const entry of raw.priorities) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;

      const applicationId = cleanText(item.applicationId, 64);
      const reason = cleanText(item.reason, 300);
      if (!applicationId || !reason) continue;

      // THE SCOPE GATE. An id we did not supply cannot be prioritised.
      if (!allowedIds.has(applicationId)) continue;
      // And no duplicates, which would inflate a single item's importance.
      if (seen.has(applicationId)) continue;

      seen.add(applicationId);
      priorities.push({ applicationId, rank: priorities.length + 1, reason });

      if (priorities.length >= MAX_PRIORITIES) break;
    }
  }

  return { attentionSummary, priorities };
}

const SYSTEM_PROMPT = `You are helping a recruiter decide what to work on first, from their pipeline board.

You are given a JSON array of applications they can see. Each has an id, the candidate and job, the stage, how long it has sat there, its SLA status, a match score where one exists, and whether a screening report is waiting to be reviewed.

Return ONLY a JSON object:
{
  "attentionSummary": string,
  "priorities": [{ "applicationId": string, "reason": string }]
}

Rules:
- Use ONLY the applicationId values present in the input. Never invent one, and never refer to work that is not in the list.
- priorities: at most 8, most urgent first. Fewer is better than padding.
- reason: one short sentence saying why this one first, grounded in the data given (stage, days waiting, SLA breach, match score, pending review). Do not speculate about the candidate.
- attentionSummary: 2 to 3 sentences describing the board as a whole — where work is piling up and what kind of action is needed. State only counts you can derive from the input.
- Do not recommend rejecting, hiring, or moving anyone to a specific stage. Recommend what to LOOK AT. The recruiter decides what happens.
- Do not comment on any candidate's personal characteristics.
- If nothing needs attention, say so plainly and return an empty priorities array.
- Return no commentary outside the JSON object.`;

export async function prioritizePipeline(
  items: PipelineItem[]
): Promise<AiResult<PipelinePriorities>> {
  if (items.length === 0) {
    // A real answer, not a failure — and it costs nothing.
    return {
      ok: true,
      data: {
        attentionSummary: "Your board is empty — there's nothing waiting on you right now.",
        priorities: [],
      },
    };
  }

  // Cap what we send. The board can be large; the question is "what first?",
  // which the most-stalled items answer.
  const sorted = [...items]
    .sort((a, b) => b.overdueDays - a.overdueDays || b.daysInStage - a.daysInStage)
    .slice(0, MAX_ITEMS_SENT);

  const allowedIds = new Set(sorted.map((item) => item.id));

  return completeJson<PipelinePriorities>({
    system: SYSTEM_PROMPT,
    user: JSON.stringify(sorted, null, 2),
    temperature: 0.2,
    maxOutputTokens: 900,
    validate: (value) => validatePriorities(value, allowedIds),
  });
}
