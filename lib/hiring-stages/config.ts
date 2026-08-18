// =============================================================================
// Per-stage config — the jsonb column's shape, validated.
//
// `config` is jsonb because the four stages genuinely need different things: a
// time limit means nothing to a phone call, and a language means nothing to a
// written test. Columns would leave three nulls out of four on every row.
//
// The cost of jsonb is that nothing stops a caller writing anything into it, so
// EVERY value that reaches the column goes through normalizeStageConfig() first.
// The browser holds a PostgREST client and can write this column directly, so
// this is a "make the API's output sane" guard rather than a security boundary
// — the security boundary is RLS, which decides WHO may write, not what.
// =============================================================================
import { STAGE_KEYS, isStageKey, type StageKey } from "@/lib/hiring-stages/catalog";
import { RESUME_SCORE_MAX, ROUND_SCORE_MAX, normalizeThreshold } from "@/lib/evaluation/verdict";
import { COMPONENT_WEIGHTS, type ComponentKey } from "@/lib/matching/deterministic";

/** Longest a single free-text list item may be, matching job questions. */
const MAX_ITEM_LENGTH = 500;
/** Most items in any one list. Beyond this it is not a stage, it is a syllabus. */
const MAX_ITEMS = 25;

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;
export const MIN_CALL_ATTEMPTS = 1;
export const MAX_CALL_ATTEMPTS = 10;

/**
 * The score at or above which this stage passes.
 *
 * Present on EVERY stage config. The brief described this as an existing
 * "passing_score pattern built for Written Assessment" — it was not; no stage
 * had one. Adding it to all four at once is what makes the four-part verdict
 * (score + status + strengths + concerns) mean the same thing everywhere.
 *
 * Null means no gate is configured, which reads as Needs Review rather than
 * Fail — failing candidates against a number nobody set would be worse than
 * declining to judge.
 */
export type PassingScore = { passingScore: number | null };

/**
 * Per-component weights for the deterministic half of the resume score.
 *
 * Stored as whole numbers that need not sum to 100 — scoreDeterministic()
 * renormalises whatever it is given, because it already has to: a component
 * with no data to judge is skipped and its weight redistributed. Forcing the
 * form to sum to exactly 100 would be a rule the scorer itself does not have.
 */
export type ScoringWeights = Record<ComponentKey, number>;

export type ResumeScoreConfig = PassingScore & {
  /** Null means the platform defaults (COMPONENT_WEIGHTS) are used. */
  weights: ScoringWeights | null;
  /**
   * How much of the score the AI read may carry, 0-100. Null means the platform
   * default (30%). Zero is a legitimate setting: it says "score me on the facts
   * only", which is exactly what a job with no budget for AI calls wants.
   */
  semanticWeightPercent: number | null;
};

export type AiScreeningConfig = PassingScore & {
  /**
   * NOTE: the question list is NOT stored here.
   *
   * The spec is explicit — "reuse the existing job_screening_questions list
   * from Module 3/8 here directly (don't build a second separate question
   * list)". A copy in this column would be a second source of truth that
   * Module 8 does not read, so the call would use one list while the
   * configuration screen showed another.
   */
  maxAttempts: number | null;
  language: string | null;
};

export type PhoneInterviewConfig = PassingScore & {
  durationMinutes: number | null;
  questions: string[];
};

export type VideoInterviewConfig = PassingScore & {
  durationMinutes: number | null;
  questions: string[];
  /** Free text; feeds Module 11's interview brief once that integration exists. */
  whatToEvaluate: string | null;
};

export type WrittenAssessmentConfig = PassingScore & {
  questions: string[];
  timeLimitMinutes: number | null;
};

export type StageConfig =
  | ResumeScoreConfig
  | AiScreeningConfig
  | PhoneInterviewConfig
  | VideoInterviewConfig
  | WrittenAssessmentConfig;

/**
 * The config type a given stage key implies.
 *
 * Worth the conditional type: without it every caller gets the bare union back
 * and has to cast to reach a field, which means a typo in a cast — reading
 * `maxAttempts` off a phone-interview config — compiles happily and returns
 * undefined at runtime.
 */
export type ConfigForStage<K extends StageKey> = K extends "resume_score"
  ? ResumeScoreConfig
  : K extends "ai_screening_call"
    ? AiScreeningConfig
    : K extends "phone_interview"
      ? PhoneInterviewConfig
      : K extends "video_interview"
        ? VideoInterviewConfig
        : WrittenAssessmentConfig;

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_ITEM_LENGTH)
    .slice(0, MAX_ITEMS);
}

function cleanNumber(value: unknown, min: number, max: number): number | null {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  // Clamped rather than rejected: a recruiter typing 600 minutes means "a long
  // time", and refusing the whole save over it would lose the rest of the form.
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

/** The config a stage starts with, so a new row is never `{}` in disguise. */
export function emptyStageConfig<K extends StageKey>(stageKey: K): ConfigForStage<K> {
  return emptyStageConfigImpl(stageKey) as ConfigForStage<K>;
}

function emptyStageConfigImpl(stageKey: StageKey): StageConfig {
  switch (stageKey) {
    case "resume_score":
      // Nulls throughout: an unconfigured row must score exactly as the platform
      // default does, so it cannot be told apart from never having been touched.
      return { passingScore: null, weights: null, semanticWeightPercent: null };

    case "ai_screening_call":
      return { maxAttempts: null, language: null, passingScore: null };
    case "phone_interview":
      return { durationMinutes: null, questions: [], passingScore: null };
    case "video_interview":
      return { durationMinutes: null, questions: [], whatToEvaluate: null, passingScore: null };
    case "written_assessment":
      return { questions: [], timeLimitMinutes: null, passingScore: null };
  }
}

/**
 * Coerces whatever arrived into the shape this stage expects.
 *
 * Never throws and never rejects: unknown keys are dropped, bad types become
 * null, out-of-range numbers are clamped. A configuration screen that refuses
 * to save because one field is malformed loses the other six, and the caller
 * here is a form the user has been typing into.
 */
export function normalizeStageConfig<K extends StageKey>(
  stageKey: K,
  raw: unknown
): ConfigForStage<K> {
  // One cast, here, where the switch below proves the mapping. Every caller
  // then gets a precisely typed config without casting.
  return normalizeStageConfigImpl(stageKey, raw) as ConfigForStage<K>;
}

/**
 * Weights, or null.
 *
 * All-or-nothing on purpose. A partial map ("skills: 60" and nothing else) has
 * no honest reading — the four unnamed components would either vanish or keep
 * defaults that no longer sum sensibly beside the one that changed. Null means
 * "use the defaults", and the form always sends all five.
 */
function cleanWeights(value: unknown): ScoringWeights | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const weights = {} as ScoringWeights;
  let total = 0;

  for (const key of Object.keys(COMPONENT_WEIGHTS) as ComponentKey[]) {
    const numeric =
      typeof raw[key] === "number"
        ? (raw[key] as number)
        : typeof raw[key] === "string"
          ? Number(raw[key])
          : NaN;
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const clamped = Math.min(Math.round(numeric), 100);
    weights[key] = clamped;
    total += clamped;
  }

  // Every component zeroed would make the deterministic score meaningless
  // rather than configurable, and scoreDeterministic() would divide by zero.
  return total > 0 ? weights : null;
}

function normalizeStageConfigImpl(stageKey: StageKey, raw: unknown): StageConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  switch (stageKey) {
    case "resume_score":
      return {
        // A percentage, not a 1-10 round score — this gate reads jobs.match_score.
        passingScore: normalizeThreshold(input.passingScore, RESUME_SCORE_MAX),
        weights: cleanWeights(input.weights),
        semanticWeightPercent: normalizeThreshold(input.semanticWeightPercent, 100),
      };

    case "ai_screening_call":
      return {
        maxAttempts: cleanNumber(input.maxAttempts, MIN_CALL_ATTEMPTS, MAX_CALL_ATTEMPTS),
        // A short code, not a display name: Module 17 stores "en" and Bolna
        // expects the same.
        language: cleanText(input.language, 12),
        passingScore: normalizeThreshold(input.passingScore, ROUND_SCORE_MAX),
      };

    case "phone_interview":
      return {
        durationMinutes: cleanNumber(
          input.durationMinutes,
          MIN_DURATION_MINUTES,
          MAX_DURATION_MINUTES
        ),
        questions: cleanList(input.questions),
        passingScore: normalizeThreshold(input.passingScore, ROUND_SCORE_MAX),
      };

    case "video_interview":
      return {
        durationMinutes: cleanNumber(
          input.durationMinutes,
          MIN_DURATION_MINUTES,
          MAX_DURATION_MINUTES
        ),
        questions: cleanList(input.questions),
        whatToEvaluate: cleanText(input.whatToEvaluate, 2000),
        passingScore: normalizeThreshold(input.passingScore, ROUND_SCORE_MAX),
      };

    case "written_assessment":
      return {
        questions: cleanList(input.questions),
        timeLimitMinutes: cleanNumber(
          input.timeLimitMinutes,
          MIN_DURATION_MINUTES,
          MAX_DURATION_MINUTES
        ),
        passingScore: normalizeThreshold(input.passingScore, ROUND_SCORE_MAX),
      };
  }
}

/** Longest a stage script may be. Beyond this nobody reads it, including an AI. */
export const MAX_PROMPT_LENGTH = 8000;

export function normalizePromptTemplate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_PROMPT_LENGTH);
}

export type StagePayload = {
  stageKey: StageKey;
  enabled: boolean;
  promptTemplate: string | null;
  config: StageConfig;
};

export type ParseResult =
  | { ok: true; stages: StagePayload[] }
  | { ok: false; error: string };

/**
 * Parses the whole "save my stages" request body.
 *
 * Accepts a partial list — a save that touches one stage sends one stage,
 * rather than the client having to round-trip all four and risk clobbering a
 * change someone else made to another stage in the meantime.
 */
export function parseStagesPayload(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }

  const raw = (body as Record<string, unknown>).stages;
  if (!Array.isArray(raw)) return { ok: false, error: "Send a list of stages." };
  if (raw.length > STAGE_LIMIT) return { ok: false, error: "Too many stages." };

  const stages: StagePayload[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "Each stage must be an object." };
    }
    const entry = item as Record<string, unknown>;

    if (!isStageKey(entry.stage_key)) {
      return { ok: false, error: "Unknown hiring stage." };
    }
    // Two entries for one stage would make the outcome depend on which the
    // database happened to apply last.
    if (seen.has(entry.stage_key)) {
      return { ok: false, error: "Each stage may appear only once." };
    }
    seen.add(entry.stage_key);

    stages.push({
      stageKey: entry.stage_key,
      enabled: entry.enabled === true,
      promptTemplate: normalizePromptTemplate(entry.prompt_template),
      config: normalizeStageConfig(entry.stage_key, entry.config),
    });
  }

  return { ok: true, stages };
}

/**
 * As many stages as the catalogue defines; anything longer is a malformed or
 * hostile request. Derived rather than written as a literal, so adding a stage
 * never leaves a number behind that quietly rejects it.
 */
const STAGE_LIMIT = STAGE_KEYS.length;
