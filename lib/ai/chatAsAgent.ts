// =============================================================================
// AI Service Layer — talk to the configured agent in text.
//
// The fast way to test a persona and a prompt: type at it and read what it says
// back, without telephoning anyone.
//
// WHAT THIS COSTS, SAID PRECISELY.
//
// It costs LLM tokens. It does NOT cost telephony, transcription or speech
// synthesis, and it creates NO call record — no `screening_calls` row, no
// `voice_agent_test_calls` row, nothing that enters a candidate's history or the
// retry cap. There is no database handle in this module, so that is a structural
// fact rather than a promise. The UI says "no phone call, no call charge" and
// means exactly that.
//
// WHAT IT CANNOT TELL YOU, and the console says so beside the tab: pacing,
// interruption handling, whether the voice is right, whether the recogniser
// copes with an accent. Those are properties of a call, and only a call tests
// them. A chat that implied otherwise would send people to production on the
// strength of a text conversation.
//
// THE CONSENT DISCLOSURE IS NOT PART OF THIS.
//
// Deliberately. It is a legal obligation attached to RECORDING A PERSON, and
// nobody is being recorded here — replaying it in a text sandbox would train
// operators to read past it. buildCallScript() still emits it as the first spoken
// segment of every real call, and no setting can switch that off.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";
import type { AgentSettings } from "@/lib/voice/settings";

/** One turn of the sandbox conversation. */
export type ChatTurn = {
  role: "operator" | "agent";
  text: string;
};

export const MAX_TURN_LENGTH = 800;
/**
 * Turns of history sent to the model.
 *
 * Capped because this is a prompt-testing sandbox, not a transcript store: an
 * unbounded history grows the token bill on every message and tests nothing a
 * dozen turns did not already show.
 */
export const MAX_HISTORY_TURNS = 20;

export type AgentReply = {
  text: string;
};

/**
 * Builds the system prompt from the SAME neutral settings a real call uses.
 *
 * Assembled here rather than by importing buildSystemPrompt() from the provider
 * adapter, and that is a deliberate trade. The adapter's version is server-only
 * and names the provider; this one must not. What matters for a prompt test is
 * that the same four inputs are in the same order — persona, tone, instructions,
 * guardrails-last — which is asserted by a test rather than left to inspection.
 */
export function buildChatSystemPrompt(settings: AgentSettings): string {
  const { brain, general, greeting } = settings;
  const company = general.companyName?.trim();
  const parts: string[] = [];

  parts.push(
    company
      ? `You are a voice agent calling on behalf of ${company} to screen a job candidate.`
      : "You are a voice agent calling to screen a job candidate."
  );
  parts.push(
    "This is a TEXT REHEARSAL with a recruiter who is testing your configuration. Answer exactly as you would speak on the call — same length, same register. Do not narrate, do not use stage directions, do not mention that this is a test."
  );

  if (brain.persona.trim()) parts.push(`Who you are: ${brain.persona.trim()}`);
  parts.push(`Tone: ${brain.tone}.`);

  const lengthGuidance: Record<AgentSettings["brain"]["responseLength"], string> = {
    short: "Keep every reply to one or two sentences.",
    medium: "Keep replies to two or three sentences.",
    long: "Replies may run to a short paragraph when the answer needs it.",
  };
  parts.push(lengthGuidance[brain.responseLength]);

  if (brain.systemPrompt.trim()) parts.push(brain.systemPrompt.trim());

  if (greeting.closingMessage.trim()) {
    parts.push(`When the conversation is finished, close with: "${greeting.closingMessage.trim()}"`);
  }

  // LAST, where a model weights it most — the same ordering the real call uses.
  if (brain.guardrails.length > 0) {
    parts.push(
      ["Rules you must not break:", ...brain.guardrails.map((rule) => `- ${rule}`)].join("\n")
    );
  }

  return parts.join("\n\n");
}

type RawReply = { reply?: unknown };

/**
 * One agent turn.
 *
 * Structured input only: the agent's settings and the conversation so far. No
 * database, no candidate, no call.
 */
export async function chatAsAgent({
  settings,
  history,
  message,
}: {
  settings: AgentSettings;
  /** Prior turns, oldest first. Trimmed to MAX_HISTORY_TURNS. */
  history: ChatTurn[];
  message: string;
}): Promise<AiResult<AgentReply>> {
  const text = message.trim();

  if (text.length === 0) {
    return aiFailure("invalid_output", "Type something for the agent to respond to.");
  }
  if (text.length > MAX_TURN_LENGTH) {
    return aiFailure("invalid_output", `Keep a message under ${MAX_TURN_LENGTH} characters.`);
  }

  const recent = history.slice(-MAX_HISTORY_TURNS);

  const transcript = recent
    .map((turn) => `${turn.role === "operator" ? "Candidate" : "You"}: ${turn.text}`)
    .join("\n");

  const result = await completeJson<RawReply>({
    system: `${buildChatSystemPrompt(settings)}\n\nRespond with JSON only: {"reply": "what you say next"}`,
    user: transcript.length > 0 ? `${transcript}\nCandidate: ${text}\nYou:` : `Candidate: ${text}\nYou:`,
    // The agent's own configured temperature, so the rehearsal behaves like the
    // call it is rehearsing. Testing at 0.2 an agent that runs at 0.8 would give
    // a false impression of how varied it is.
    temperature: settings.brain.temperature,
    // Generous enough for the "long" setting, capped so a runaway reply cannot
    // run up a bill in a sandbox.
    maxOutputTokens: 500,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawReply) : null,
  });

  if (!result.ok) return result;

  const reply = typeof result.data.reply === "string" ? result.data.reply.trim() : "";
  if (reply.length === 0) {
    return aiFailure("invalid_output", "The agent didn't say anything. Try rephrasing.");
  }

  return { ok: true, data: { text: reply.slice(0, 2000) } };
}
