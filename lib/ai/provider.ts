// =============================================================================
// AI Service Layer — provider boundary.
//
// This is the ONLY file in the codebase that talks to an LLM provider over the
// wire. Every AI feature is a named, purpose-specific function in this folder
// (parseResume, matchCandidateToJob, generateScreeningSummary, ...) that calls
// completeJson() here. No React component or route handler may call a provider
// directly, and there is deliberately no generic askAI() export — swapping
// OpenAI for Claude or Gemini later means editing this file only.
//
// Implemented with fetch against an OpenAI-compatible /chat/completions
// endpoint so the provider stays swappable without a vendor SDK dependency.
// =============================================================================

/**
 * Discriminated result used by every AI Service Layer function. AI failures are
 * an expected, recoverable state in this product — the caller must always be
 * able to fall back to the manual workflow (and, once the cost-tracking
 * retrofit lands, to surface an "AI budget exceeded" message the same way).
 * Hence a result object rather than a thrown exception.
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AiErrorCode; message: string };

export type AiErrorCode =
  /** No API key configured — AI features are simply unavailable, not broken. */
  | "not_configured"
  /** Provider unreachable, rate-limited, or returned a non-2xx response. */
  | "provider_error"
  /** Provider responded, but the output failed schema validation. */
  | "invalid_output";

export function aiFailure<T>(code: AiErrorCode, message: string): AiResult<T> {
  return { ok: false, code, message };
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Cheap/small model default. Per the cost model chapter, high-volume low-
 * complexity work (resume parsing) should use a cheaper model — individual
 * functions can override `model` when they need more capability.
 */
const DEFAULT_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

export type CompleteJsonOptions<T> = {
  /** Purpose-specific system instruction from the calling AI function. */
  system: string;
  /** The structured input for this call. Never raw, unscoped DB access. */
  user: string;
  /**
   * Validator that narrows the parsed JSON to T. Malformed AI output must be
   * rejected here rather than rendered — this is the "Validation" step of the
   * platform-wide Raw Data -> AI -> Structured Output -> Validation -> Human
   * Review -> Business Action sequence.
   */
  validate: (value: unknown) => T | null;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort budget in ms; AI must never hang a request indefinitely. */
  timeoutMs?: number;
};

export async function completeJson<T>({
  system,
  user,
  validate,
  model = DEFAULT_MODEL,
  temperature = 0.2,
  maxOutputTokens = 1200,
  timeoutMs = 30_000,
}: CompleteJsonOptions<T>): Promise<AiResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return aiFailure(
      "not_configured",
      "AI is not configured. Add an LLM provider API key in Settings to enable AI suggestions."
    );
  }

  const baseUrl = process.env.AI_BASE_URL ?? DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Log detail server-side; return a plain message to the caller.
      console.error(`[ai] provider returned ${response.status}`, await response.text());
      return aiFailure(
        "provider_error",
        "The AI service is temporarily unavailable. You can continue manually and retry later."
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    raw = payload.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.error("[ai] provider call failed:", error);
    return aiFailure(
      "provider_error",
      aborted
        ? "The AI service took too long to respond. You can continue manually and retry later."
        : "Could not reach the AI service. You can continue manually and retry later."
    );
  } finally {
    clearTimeout(timeout);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[ai] provider returned non-JSON output");
    return aiFailure(
      "invalid_output",
      "The AI response could not be read. Please retry or continue manually."
    );
  }

  const validated = validate(parsed);
  if (!validated) {
    console.error("[ai] provider output failed schema validation");
    return aiFailure(
      "invalid_output",
      "The AI response was incomplete or in an unexpected format. Please retry or continue manually."
    );
  }

  return { ok: true, data: validated };
}
