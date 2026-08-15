// =============================================================================
// The shared shape of an evaluation result.
//
//   score  +  status  +  key strengths  +  key concerns  (+ the narrative)
//
// One pattern for every round that produces a result — resume match, screening
// call, phone/video interview, assessment, director round — so a recruiter
// learns to read it once. The narrative summary stays: the lists supplement it,
// they do not replace it. A summary answers "what happened"; the lists answer
// "what should I look at", and collapsing either into the other loses one of
// them.
//
// PURE. No database, no AI. Turning a score into Pass/Fail is arithmetic
// against a configured number, which is exactly the kind of fact that must not
// be delegated to a model.
// =============================================================================

export const EVALUATION_STATUSES = ["pass", "fail", "needs_review"] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const STATUS_LABELS: Record<EvaluationStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  needs_review: "Needs Review",
};

export const STATUS_TONE: Record<EvaluationStatus, "success" | "error" | "warning"> = {
  pass: "success",
  fail: "error",
  needs_review: "warning",
};

/** Most items shown in either list. Beyond this it is a report, not a summary. */
export const MAX_LIST_ITEMS = 4;
const MAX_ITEM_LENGTH = 200;

/**
 * Score against a threshold.
 *
 * "Needs Review" is not a third band between pass and fail — it is what a
 * MISSING input produces. A round with no score yet, or a stage with no
 * threshold configured, has not been judged, and reporting either as a Fail
 * would reject candidates on the strength of a blank field.
 *
 * The comparison is `>=`: a threshold of 70 means 70 passes. Anything else
 * makes "the passing score" a number that does not pass.
 */
export function statusFor({
  score,
  threshold,
}: {
  score: number | null | undefined;
  threshold: number | null | undefined;
}): EvaluationStatus {
  if (score === null || score === undefined) return "needs_review";
  if (threshold === null || threshold === undefined) return "needs_review";
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return "needs_review";

  return score >= threshold ? "pass" : "fail";
}

/**
 * Cleans a strengths/concerns list.
 *
 * Accepts a string[] or a newline-separated blob, because two sources feed
 * these: an AI function returning an array, and a recruiter typing into a
 * textarea. Rejecting either shape would force one of them into a workaround.
 */
export function normalizeHighlights(raw: unknown): string[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split("\n")
      : [];

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const item of items) {
    if (typeof item !== "string") continue;
    // Strip a leading bullet a recruiter typed by hand — the UI draws its own,
    // and "• • Strong AWS experience" is the alternative.
    const text = item.replace(/^\s*[-•*·]\s*/, "").trim();
    if (text.length === 0) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    cleaned.push(text.slice(0, MAX_ITEM_LENGTH));
    if (cleaned.length >= MAX_LIST_ITEMS) break;
  }

  return cleaned;
}

export type Verdict = {
  score: number | null;
  threshold: number | null;
  status: EvaluationStatus;
  summary: string | null;
  strengths: string[];
  concerns: string[];
};

/** Assembles the four-part result from whatever a source supplied. */
export function buildVerdict({
  score,
  threshold,
  summary,
  strengths,
  concerns,
}: {
  score?: number | null;
  threshold?: number | null;
  summary?: string | null;
  strengths?: unknown;
  concerns?: unknown;
}): Verdict {
  return {
    score: score ?? null,
    threshold: threshold ?? null,
    status: statusFor({ score, threshold }),
    summary: summary?.trim() || null,
    strengths: normalizeHighlights(strengths),
    concerns: normalizeHighlights(concerns),
  };
}

/** True when there is nothing to render — no score, no lists, no narrative. */
export function isEmptyVerdict(verdict: Verdict): boolean {
  return (
    verdict.score === null &&
    verdict.summary === null &&
    verdict.strengths.length === 0 &&
    verdict.concerns.length === 0
  );
}

// -----------------------------------------------------------------------------
// Thresholds
// -----------------------------------------------------------------------------

/** Scores are 1-10 on rounds and 0-100 on the resume match; both are bounded. */
export function normalizeThreshold(raw: unknown, max: number): number | null {
  const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(numeric)) return null;
  // Clamped rather than rejected: a threshold of 200 on a 1-10 scale means
  // "nothing passes", and refusing the save would lose the rest of the form.
  return Math.min(Math.max(Math.round(numeric), 0), max);
}

/** Round scores are 1-10. */
export const ROUND_SCORE_MAX = 10;
/** The resume match is a percentage. */
export const RESUME_SCORE_MAX = 100;
