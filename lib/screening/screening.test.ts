import { describe, expect, it } from "vitest";
import {
  assertScriptIsCompliant,
  buildCallScript,
  buildConsentDisclosure,
  isConsentRefusal,
  MAX_QUESTIONS,
} from "./script";
import {
  canPlaceFirstCall,
  decideRetry,
  DEFAULT_RETRY_POLICY,
  MAX_ALLOWED_ATTEMPTS,
  MIN_ALLOWED_DELAY_MINUTES,
  normalizeRetryPolicy,
  type RetryPolicy,
} from "./retry";

const scriptInput = {
  candidateName: "Rahul Sharma",
  jobTitle: "Senior Java Developer",
  organizationName: "ABC Tech",
  questions: [
    "What is your current role?",
    "How many years of Java experience do you have?",
    "What is your expected CTC?",
    "What is your notice period?",
  ],
};

describe("consent disclosure is mandatory and cannot be removed", () => {
  it("always opens with the consent segment", () => {
    const script = buildCallScript(scriptInput);
    expect(script.segments[0].kind).toBe("consent");
  });

  it("states the call is automated", () => {
    expect(buildCallScript(scriptInput).segments[0].text.toLowerCase()).toContain("automated");
  });

  it("states the call may be recorded", () => {
    expect(buildCallScript(scriptInput).segments[0].text.toLowerCase()).toContain("record");
  });

  it("offers a way out and captures the answer as consent", () => {
    const consent = buildCallScript(scriptInput).segments[0];
    expect(consent.text.toLowerCase()).toMatch(/rather not continue|end the call/);
    // The answer IS the consent, so it must be recorded.
    expect(consent.expectsAnswer).toBe(true);
  });

  it("names who is calling and why", () => {
    const text = buildConsentDisclosure({
      candidateName: "Rahul Sharma",
      organizationName: "ABC Tech",
      jobTitle: "Senior Java Developer",
    });
    expect(text).toContain("Rahul Sharma");
    expect(text).toContain("ABC Tech");
    expect(text).toContain("Senior Java Developer");
  });

  it("has no option to build a script without it", () => {
    // There is deliberately no flag to disable the disclosure. Even with no
    // questions at all, the consent segment is still emitted.
    const script = buildCallScript({ ...scriptInput, questions: [] });
    expect(script.segments[0].kind).toBe("consent");
  });
});

describe("assertScriptIsCompliant — the pre-dial gate", () => {
  it("passes a properly built script", () => {
    expect(assertScriptIsCompliant(buildCallScript(scriptInput))).toEqual({ ok: true });
  });

  it("REFUSES a script whose first segment is not the disclosure", () => {
    // Catches a script assembled elsewhere — e.g. by a future Module 13
    // automation — that skipped the disclosure.
    const script = buildCallScript(scriptInput);
    const tampered = { ...script, segments: script.segments.slice(1) };
    const result = assertScriptIsCompliant(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/consent disclosure/i);
  });

  it("REFUSES a disclosure that omits 'automated'", () => {
    const script = buildCallScript(scriptInput);
    const tampered = {
      ...script,
      segments: [
        { ...script.segments[0], text: "Hello, this call may be recorded. Carry on?" },
        ...script.segments.slice(1),
      ],
    };
    const result = assertScriptIsCompliant(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/automated/i);
  });

  it("REFUSES a disclosure that omits recording", () => {
    const script = buildCallScript(scriptInput);
    const tampered = {
      ...script,
      segments: [
        { ...script.segments[0], text: "Hello, this is an automated call. Carry on?" },
        ...script.segments.slice(1),
      ],
    };
    const result = assertScriptIsCompliant(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/recorded/i);
  });

  it("REFUSES a job with no screening questions", () => {
    const result = assertScriptIsCompliant(buildCallScript({ ...scriptInput, questions: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no screening questions/i);
  });
});

describe("script assembly", () => {
  it("asks the job's questions in order", () => {
    const script = buildCallScript(scriptInput);
    expect(script.questions).toEqual(scriptInput.questions);
  });

  it("caps the number of questions", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Question ${i}?`);
    expect(buildCallScript({ ...scriptInput, questions: many }).questions).toHaveLength(
      MAX_QUESTIONS
    );
  });

  it("drops blank questions", () => {
    const script = buildCallScript({
      ...scriptInput,
      questions: ["Real question?", "   ", ""],
    });
    expect(script.questions).toEqual(["Real question?"]);
  });

  it("falls back gracefully on a missing name", () => {
    const script = buildCallScript({ ...scriptInput, candidateName: "  " });
    expect(script.segments[0].text).toContain("there");
  });

  it("ends with a closing that sets expectations", () => {
    const script = buildCallScript(scriptInput);
    const last = script.segments[script.segments.length - 1];
    expect(last.kind).toBe("closing");
    expect(last.expectsAnswer).toBe(false);
  });
});

describe("isConsentRefusal — biased towards stopping", () => {
  it("treats plain refusals as refusals", () => {
    for (const answer of ["No", "no thanks", "Not interested", "Stop", "please remove me"]) {
      expect(isConsentRefusal(answer)).toBe(true);
    }
  });

  it("treats a recording objection as a refusal", () => {
    expect(isConsentRefusal("Please don't record this")).toBe(true);
  });

  it("treats a callback request as a refusal to continue now", () => {
    expect(isConsentRefusal("Can you call back later?")).toBe(true);
    expect(isConsentRefusal("I'm busy right now")).toBe(true);
  });

  it("treats a wrong number as a refusal", () => {
    expect(isConsentRefusal("wrong number")).toBe(true);
  });

  it("does not treat agreement as refusal", () => {
    for (const answer of ["Yes", "Sure, go ahead", "That's fine", "Okay"]) {
      expect(isConsentRefusal(answer)).toBe(false);
    }
  });

  it("treats silence as neither, leaving the call flow to decide", () => {
    expect(isConsentRefusal(null)).toBe(false);
    expect(isConsentRefusal("")).toBe(false);
  });
});

describe("retry policy — 'respects max attempts and delay exactly as configured'", () => {
  const policy: RetryPolicy = { maxAttempts: 3, delayMinutes: 120 };
  const endedAt = new Date("2026-08-14T10:00:00Z");

  it("allows a retry once the delay has elapsed", () => {
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "no_answer", endedAt },
      policy,
      now: new Date("2026-08-14T12:00:00Z"),
    });
    expect(decision.shouldRetry).toBe(true);
    if (decision.shouldRetry) expect(decision.nextAttemptNumber).toBe(2);
  });

  it("refuses one minute before the delay elapses", () => {
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "no_answer", endedAt },
      policy,
      now: new Date("2026-08-14T11:59:00Z"),
    });
    expect(decision.shouldRetry).toBe(false);
    if (!decision.shouldRetry) expect(decision.reason).toMatch(/1 minute/);
  });

  it("STOPS at exactly the configured maximum", () => {
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 3, status: "no_answer", endedAt },
      policy,
      now: new Date("2026-08-20T10:00:00Z"),
    });
    expect(decision.shouldRetry).toBe(false);
    if (!decision.shouldRetry) expect(decision.reason).toMatch(/maximum of 3/);
  });

  it("allows the final permitted attempt", () => {
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 2, status: "no_answer", endedAt },
      policy,
      now: new Date("2026-08-20T10:00:00Z"),
    });
    expect(decision.shouldRetry).toBe(true);
    if (decision.shouldRetry) expect(decision.nextAttemptNumber).toBe(3);
  });

  it("retries every retryable outcome", () => {
    for (const status of ["no_answer", "busy", "failed"] as const) {
      const decision = decideRetry({
        lastAttempt: { attemptNumber: 1, status, endedAt },
        policy,
        now: new Date("2026-08-20T10:00:00Z"),
      });
      expect(decision.shouldRetry).toBe(true);
    }
  });

  it("NEVER retries a completed call", () => {
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "completed", endedAt },
      policy,
      now: new Date("2026-08-20T10:00:00Z"),
    });
    expect(decision.shouldRetry).toBe(false);
  });

  it("NEVER auto-retries a callback request, and says why", () => {
    // The candidate asked for a different time. Dialling again on our schedule
    // ignores what they said.
    const decision = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "callback_requested", endedAt },
      policy,
      now: new Date("2026-08-20T10:00:00Z"),
    });
    expect(decision.shouldRetry).toBe(false);
    if (!decision.shouldRetry) {
      expect(decision.reason).toMatch(/asked to be called back/i);
      expect(decision.reason).toMatch(/manually/i);
    }
  });

  it("NEVER retries a cancelled call", () => {
    expect(
      decideRetry({
        lastAttempt: { attemptNumber: 1, status: "cancelled", endedAt },
        policy,
        now: new Date("2026-08-20T10:00:00Z"),
      }).shouldRetry
    ).toBe(false);
  });

  it("does not stack a second call on one in progress", () => {
    for (const status of ["queued", "dialing"] as const) {
      const decision = decideRetry({
        lastAttempt: { attemptNumber: 1, status, endedAt },
        policy,
        now: new Date("2026-08-20T10:00:00Z"),
      });
      expect(decision.shouldRetry).toBe(false);
      if (!decision.shouldRetry) expect(decision.reason).toMatch(/already in progress/i);
    }
  });

  it("honours a custom policy exactly", () => {
    const custom: RetryPolicy = { maxAttempts: 2, delayMinutes: 30 };
    const tooSoon = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "no_answer", endedAt },
      policy: custom,
      now: new Date("2026-08-14T10:29:00Z"),
    });
    const justRight = decideRetry({
      lastAttempt: { attemptNumber: 1, status: "no_answer", endedAt },
      policy: custom,
      now: new Date("2026-08-14T10:30:00Z"),
    });
    const overCap = decideRetry({
      lastAttempt: { attemptNumber: 2, status: "no_answer", endedAt },
      policy: custom,
      now: new Date("2026-08-20T10:00:00Z"),
    });

    expect(tooSoon.shouldRetry).toBe(false);
    expect(justRight.shouldRetry).toBe(true);
    expect(overCap.shouldRetry).toBe(false);
  });
});

describe("normalizeRetryPolicy — bounds what can be configured", () => {
  it("falls back to the defaults for garbage", () => {
    expect(normalizeRetryPolicy(null)).toEqual(DEFAULT_RETRY_POLICY);
    expect(normalizeRetryPolicy({})).toEqual(DEFAULT_RETRY_POLICY);
    expect(normalizeRetryPolicy({ maxAttempts: "lots" })).toEqual(DEFAULT_RETRY_POLICY);
  });

  it("CAPS attempts, so a bad config cannot harass a candidate", () => {
    expect(normalizeRetryPolicy({ maxAttempts: 500 }).maxAttempts).toBe(MAX_ALLOWED_ATTEMPTS);
  });

  it("enforces a minimum delay", () => {
    // A one-minute retry loop would be indistinguishable from harassment.
    expect(normalizeRetryPolicy({ delayMinutes: 1 }).delayMinutes).toBe(
      DEFAULT_RETRY_POLICY.delayMinutes
    );
    expect(normalizeRetryPolicy({ delayMinutes: MIN_ALLOWED_DELAY_MINUTES }).delayMinutes).toBe(
      MIN_ALLOWED_DELAY_MINUTES
    );
  });

  it("rejects zero or negative attempts", () => {
    expect(normalizeRetryPolicy({ maxAttempts: 0 }).maxAttempts).toBe(
      DEFAULT_RETRY_POLICY.maxAttempts
    );
    expect(normalizeRetryPolicy({ maxAttempts: -3 }).maxAttempts).toBe(
      DEFAULT_RETRY_POLICY.maxAttempts
    );
  });

  it("accepts a valid custom policy", () => {
    expect(normalizeRetryPolicy({ maxAttempts: 2, delayMinutes: 60 })).toEqual({
      maxAttempts: 2,
      delayMinutes: 60,
    });
  });
});

describe("canPlaceFirstCall", () => {
  it("allows the first call", () => {
    expect(canPlaceFirstCall({ existingAttempts: 0, policy: DEFAULT_RETRY_POLICY })).toEqual({
      ok: true,
    });
  });

  it("blocks once the cap is used up", () => {
    const result = canPlaceFirstCall({ existingAttempts: 3, policy: DEFAULT_RETRY_POLICY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/all 3 screening attempts/);
  });

  it("allows a manual attempt while under the cap", () => {
    expect(canPlaceFirstCall({ existingAttempts: 1, policy: DEFAULT_RETRY_POLICY }).ok).toBe(true);
  });
});
