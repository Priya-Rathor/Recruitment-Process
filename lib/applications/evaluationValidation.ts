// Request validation for evaluation entries. Pure, so the rules are testable
// without a database and the two routes cannot disagree about them.
import { MANUAL_EVALUATION_STAGES, type EvaluationOutcome } from "@/lib/applications/evaluations";

const OUTCOMES: EvaluationOutcome[] = ["pass", "fail", "pending"];

/** Matches the CHECK constraint in migration 0022. */
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
export const MAX_SUMMARY_LENGTH = 5000;

export type EvaluationPayload = {
  stageKey: (typeof MANUAL_EVALUATION_STAGES)[number];
  occurredAt: string;
  score: number | null;
  outcome: EvaluationOutcome;
  summary: string | null;
};

export type EvaluationParseResult =
  | { ok: true; data: EvaluationPayload }
  | { ok: false; error: string };

export function parseEvaluationPayload(body: unknown): EvaluationParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;

  const stageKey = raw.stage_key;
  if (
    typeof stageKey !== "string" ||
    !(MANUAL_EVALUATION_STAGES as readonly string[]).includes(stageKey)
  ) {
    // ai_screening_call is excluded on purpose: that stage has Modules 8/9
    // behind it, and a hand-written row would sit beside the real report
    // claiming equal authority.
    return { ok: false, error: "Entries can't be logged against that stage." };
  }

  // Defaults to now, so a form that omits the field records something true
  // rather than the epoch.
  let occurredAt = new Date().toISOString();
  if (raw.occurred_at !== undefined && raw.occurred_at !== null) {
    if (typeof raw.occurred_at !== "string") {
      return { ok: false, error: "Invalid date." };
    }
    const parsed = new Date(raw.occurred_at);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "Invalid date." };
    occurredAt = parsed.toISOString();
  }

  let score: number | null = null;
  if (raw.score !== undefined && raw.score !== null && raw.score !== "") {
    const numeric = typeof raw.score === "number" ? raw.score : Number(raw.score);
    if (!Number.isFinite(numeric)) return { ok: false, error: "Score must be a number." };
    const rounded = Math.round(numeric);
    if (rounded < MIN_SCORE || rounded > MAX_SCORE) {
      return { ok: false, error: `Score must be between ${MIN_SCORE} and ${MAX_SCORE}.` };
    }
    score = rounded;
  }

  const outcomeRaw = raw.outcome ?? "pending";
  if (typeof outcomeRaw !== "string" || !OUTCOMES.includes(outcomeRaw as EvaluationOutcome)) {
    return { ok: false, error: "Outcome must be Pass, Fail or Pending." };
  }

  let summary: string | null = null;
  if (typeof raw.summary === "string") {
    const trimmed = raw.summary.trim();
    summary = trimmed.length === 0 ? null : trimmed.slice(0, MAX_SUMMARY_LENGTH);
  }

  return {
    ok: true,
    data: {
      stageKey: stageKey as EvaluationPayload["stageKey"],
      occurredAt,
      score,
      outcome: outcomeRaw as EvaluationOutcome,
      summary,
    },
  };
}
