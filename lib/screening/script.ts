// =============================================================================
// Screening call script.
//
// Builds what the AI agent says, from the job's configured screening questions.
//
// THE CONSENT DISCLOSURE IS NOT OPTIONAL.
//
// The Privacy & Compliance chapter assigns this module: "The call script's
// opening line must state that the call is automated and may be recorded, and
// the candidate's continuation is treated as consent." It also warns that "call
// recording without consent is illegal in many jurisdictions, independent of any
// data-protection law."
//
// That chapter is staged as a later retrofit. It is implemented here instead,
// because deferring it would mean every call placed in the meantime records a
// member of the public with no disclosure — a legal exposure, not a piece of
// data hygiene.
//
// buildCallScript() therefore always emits the disclosure as the first segment.
// There is no parameter to disable it, and a test asserts it cannot be removed.
// =============================================================================

export type ScriptSegment = {
  kind: "consent" | "greeting" | "question" | "closing";
  text: string;
  /** Segments the candidate is expected to answer. */
  expectsAnswer: boolean;
};

export type CallScript = {
  segments: ScriptSegment[];
  /** Flattened text, for sending to the provider and for the review UI. */
  fullText: string;
  /** Questions actually asked, in order — Module 9 maps answers back to these. */
  questions: string[];
};

export type ScriptInput = {
  candidateName: string;
  jobTitle: string;
  organizationName: string;
  /** From job_screening_questions, in display order. */
  questions: string[];
  language?: string;
};

/** Longest script we will send. Beyond this a call stops being a screen. */
export const MAX_QUESTIONS = 12;

/**
 * The mandatory opening. States three things a recruiter is obliged to disclose:
 * who is calling, that it is automated, and that it may be recorded — then makes
 * continuing an explicit, informed choice.
 */
export function buildConsentDisclosure({
  candidateName,
  organizationName,
  jobTitle,
}: {
  candidateName: string;
  organizationName: string;
  jobTitle: string;
}): string {
  return (
    `Hello, am I speaking with ${candidateName}? ` +
    `I'm an automated assistant calling on behalf of ${organizationName} about your application ` +
    `for the ${jobTitle} role. ` +
    `Before we start: this is an automated call and it may be recorded so a recruiter can review it. ` +
    `If you'd rather not continue, just say so and I'll end the call and arrange for a person to ` +
    `contact you instead. Is it alright to carry on?`
  );
}

/**
 * Builds the script.
 *
 * The consent segment is always first and always present. Everything else is
 * derived from the job's configured questions.
 */
export function buildCallScript(input: ScriptInput): CallScript {
  const candidateName = input.candidateName.trim() || "there";
  const jobTitle = input.jobTitle.trim() || "the role";
  const organizationName = input.organizationName.trim() || "our team";

  const questions = input.questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
    .slice(0, MAX_QUESTIONS);

  const segments: ScriptSegment[] = [
    {
      kind: "consent",
      text: buildConsentDisclosure({ candidateName, organizationName, jobTitle }),
      // The answer to this IS the consent, so it must be captured.
      expectsAnswer: true,
    },
  ];

  segments.push({
    kind: "greeting",
    text:
      `Thank you. This will take about five minutes. ` +
      `I'll ask a few short questions about your experience and availability.`,
    expectsAnswer: false,
  });

  for (const question of questions) {
    segments.push({ kind: "question", text: question, expectsAnswer: true });
  }

  segments.push({
    kind: "closing",
    text:
      `That's everything — thank you for your time. ` +
      `A recruiter from ${organizationName} will review this and be in touch about next steps.`,
    expectsAnswer: false,
  });

  return {
    segments,
    fullText: segments.map((segment) => segment.text).join("\n\n"),
    questions,
  };
}

/**
 * Verifies a script is safe to send. Called immediately before dialling, so a
 * script assembled anywhere — including by a future Module 13 automation —
 * cannot reach a candidate without the disclosure.
 */
export function assertScriptIsCompliant(script: CallScript): { ok: true } | { ok: false; reason: string } {
  const first = script.segments[0];

  if (!first || first.kind !== "consent") {
    return { ok: false, reason: "The script must open with the consent disclosure." };
  }

  const text = first.text.toLowerCase();
  if (!text.includes("automated")) {
    return { ok: false, reason: "The opening line must state that the call is automated." };
  }
  if (!text.includes("record")) {
    return { ok: false, reason: "The opening line must state that the call may be recorded." };
  }

  if (script.questions.length === 0) {
    return {
      ok: false,
      reason: "This job has no screening questions configured, so there is nothing to ask.",
    };
  }

  return { ok: true };
}

/**
 * Decides whether the candidate's answer to the disclosure was a refusal.
 *
 * Deliberately conservative: anything that reads as a decline counts as one.
 * Treating an ambiguous reply as consent is the failure mode that matters, so
 * the bias is towards stopping.
 */
export function isConsentRefusal(answer: string | null | undefined): boolean {
  if (!answer) return false;
  const text = answer.trim().toLowerCase();
  if (text.length === 0) return false;

  const refusals = [
    "no",
    "no thanks",
    "not now",
    "don't record",
    "do not record",
    "stop",
    "remove me",
    "not interested",
    "call back",
    "later",
    "busy",
    "wrong number",
  ];

  return refusals.some((phrase) => text.includes(phrase));
}
