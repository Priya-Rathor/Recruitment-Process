// =============================================================================
// The auto-reply agent's decisions, tested where they are pure.
//
// WHY THESE FOUR THINGS AND NOT THE ORCHESTRATION. Every rule that can cause an
// unattended AI message to reach a real person — or stop one — is a pure
// function, precisely so it can be tested without a provider or a database:
//
//   1. PRECEDENCE, including the master switch and a disabled job override.
//   2. THE ESCALATION GUARD, in both directions: what must be handed to a
//      person, and what must NOT be (a false escalation is cheap, but a
//      permanently escalated inbox ends with the feature switched off).
//   3. THE NUMERIC GROUNDING SET, which is what stops the agent inventing a
//      match score or an interview date. A WhatsApp message cannot be unsent,
//      so this guard is asserted directly rather than through the provider.
//   4. THE INBOX'S ORDERING, because a flagged thread that sorts below newer
//      self-answered ones is a candidate nobody gets to.
//
// lib/autoReply/run.ts is the executor and is deliberately not mocked: it does
// what these functions tell it. What it adds — the queue, the cooldown query,
// the sweep pass — is exercised by supabase/VERIFY_0042.sql against a real
// Postgres and by the manual checklist in docs/modules/15-testing-guide.md.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  autoReplyPrecedenceRows,
  resolveAutoReply,
  validateAutoReplyConfig,
  type AutoReplyConfig,
} from "@/lib/autoReply/config";
import {
  detectEscalationTopics,
  escalationReasonFrom,
  HOLDING_MESSAGE,
} from "@/lib/autoReply/escalation";
import { allowedAutoReplyNumbers, type AutoReplyInput } from "@/lib/ai/generateAutoReply";
import { findUnsupportedNumbers } from "@/lib/ai/numericGuard";
import {
  applyInboxFilter,
  countNeedsHuman,
  type ConversationSummary,
} from "@/lib/messaging/conversations";

function config(overrides: Partial<AutoReplyConfig> = {}): AutoReplyConfig {
  return {
    id: "cfg-1",
    organization_id: "org-1",
    job_id: null,
    enabled: true,
    response_timing: "immediate",
    delay_minutes: null,
    tone_instructions: null,
    context_instructions: null,
    created_by: null,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Precedence
// -----------------------------------------------------------------------------
describe("resolveAutoReply", () => {
  it("refuses everything when the master switch is off", () => {
    /*
      THE MOST IMPORTANT ASSERTION IN THIS FILE. The switch is what a recruiter
      presses when the agent has just said something wrong, and it has to mean
      "stop" with no qualification — including for a job whose override is
      enthusiastically on.
    */
    const decision = resolveAutoReply({
      masterEnabled: false,
      orgConfig: config({ enabled: true }),
      jobConfig: config({ id: "cfg-2", job_id: "job-1", enabled: true }),
    });

    expect(decision.active).toBe(false);
    expect(decision.active === false && decision.reason).toContain("whole organization");
  });

  it("uses the organization default when a job has no override", () => {
    const decision = resolveAutoReply({
      masterEnabled: true,
      orgConfig: config({ enabled: true, response_timing: "delayed", delay_minutes: 15 }),
      jobConfig: null,
    });

    expect(decision).toMatchObject({
      active: true,
      source: "organization",
      timing: "delayed",
      delayMinutes: 15,
    });
  });

  it("lets a job's override win over the organization default", () => {
    const decision = resolveAutoReply({
      masterEnabled: true,
      orgConfig: config({ enabled: true, tone_instructions: "org tone" }),
      jobConfig: config({ id: "cfg-2", job_id: "job-1", enabled: true, tone_instructions: "job tone" }),
    });

    expect(decision).toMatchObject({ active: true, source: "job" });
    expect(decision.active === true && decision.toneInstructions).toBe("job tone");
  });

  it("a DISABLED job override stops the agent instead of falling through", () => {
    /*
      The rule most likely to be implemented the other way round, and the reason
      it is spelled out in resolveAutoReply()'s comment: an admin who switched
      the agent off for one sensitive role and then found it answering anyway
      from the org default would rightly call that a bug. An override overrides
      in both directions.
    */
    const decision = resolveAutoReply({
      masterEnabled: true,
      orgConfig: config({ enabled: true }),
      jobConfig: config({ id: "cfg-2", job_id: "job-1", enabled: false }),
    });

    expect(decision.active).toBe(false);
    expect(decision.active === false && decision.reason).toContain("this job");
  });

  it("is off when nothing is configured at all", () => {
    const decision = resolveAutoReply({
      masterEnabled: true,
      orgConfig: null,
      jobConfig: null,
    });

    expect(decision.active).toBe(false);
    expect(decision.active === false && decision.reason).toContain("waiting for a person");
  });

  it("normalises an immediate reply to a zero delay", () => {
    const decision = resolveAutoReply({
      masterEnabled: true,
      orgConfig: config({ enabled: true, response_timing: "immediate" }),
      jobConfig: null,
    });

    // So no caller has to remember that 'immediate' means "due now".
    expect(decision.active === true && decision.delayMinutes).toBe(0);
  });
});

describe("the precedence preview", () => {
  it("agrees with resolveAutoReply about what is effective", () => {
    // The whole reason both are one function: a preview that computed
    // precedence its own way would be believed.
    const rows = autoReplyPrecedenceRows({
      masterEnabled: true,
      orgConfig: config({ enabled: true, tone_instructions: "org tone" }),
      jobConfig: config({ id: "cfg-2", job_id: "job-1", enabled: true, tone_instructions: "job tone" }),
    });

    const tone = rows.find((row) => row.key === "tone_instructions");
    expect(tone).toMatchObject({
      orgDefault: "org tone",
      jobOverride: "job tone",
      effective: "job tone",
      source: "job",
    });
  });

  it("says the master switch is why nothing applies", () => {
    /*
      A table reading "On" while the agent is globally off would be the most
      misleading row on the page — an admin would go looking for a bug in the
      job config.
    */
    const rows = autoReplyPrecedenceRows({
      masterEnabled: false,
      orgConfig: config({ enabled: true }),
      jobConfig: config({ id: "cfg-2", job_id: "job-1", enabled: true }),
    });

    expect(rows.find((row) => row.key === "enabled")?.effective).toBe("Off — master switch");
  });
});

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
describe("validateAutoReplyConfig", () => {
  it("accepts an immediate configuration with no delay", () => {
    const result = validateAutoReplyConfig({
      job_id: null,
      enabled: true,
      response_timing: "immediate",
      tone_instructions: "  Friendly.  ",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toMatchObject({
      delay_minutes: null,
      tone_instructions: "Friendly.",
    });
  });

  it("requires a delay when the timing is delayed", () => {
    const result = validateAutoReplyConfig({
      enabled: true,
      response_timing: "delayed",
      delay_minutes: null,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a delay longer than WhatsApp's own reply window", () => {
    /*
      Not an arbitrary cap. Meta only accepts free-form text within 24 hours of
      the candidate's message, so a longer delay produces a reply that is refused
      at the moment it finally fires — a setting that cannot work.
    */
    const result = validateAutoReplyConfig({
      enabled: true,
      response_timing: "delayed",
      delay_minutes: 1441,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("24 hours");
  });

  it("refuses a fractional or non-numeric delay", () => {
    for (const value of [0, -5, 2.5, "soon", null]) {
      expect(
        validateAutoReplyConfig({
          enabled: true,
          response_timing: "delayed",
          delay_minutes: value,
        }).ok,
        String(value)
      ).toBe(false);
    }
  });

  it("treats blank guidance as absent rather than as an empty instruction", () => {
    const result = validateAutoReplyConfig({
      enabled: false,
      response_timing: "immediate",
      tone_instructions: "   ",
      context_instructions: "",
    });

    expect(result.ok && result.data.tone_instructions).toBeNull();
    expect(result.ok && result.data.context_instructions).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The escalation guard
// -----------------------------------------------------------------------------
describe("detectEscalationTopics", () => {
  it("hands pay and negotiation to a person", () => {
    for (const message of [
      "What's the salary for this role?",
      "Is the CTC negotiable?",
      "can you tell me the package",
      "I'd like to negotiate before accepting",
      "what about the joining bonus",
    ]) {
      expect(detectEscalationTopics(message).length, message).toBeGreaterThan(0);
    }
  });

  it("hands a contested decision to a person", () => {
    for (const message of [
      "Why was I rejected?",
      "This is unfair, please reconsider",
      "I disagree with that outcome",
    ]) {
      expect(detectEscalationTopics(message).length, message).toBeGreaterThan(0);
    }
  });

  it("hands distress, legal and data requests to a person", () => {
    expect(detectEscalationTopics("I'm struggling, please help me").length).toBeGreaterThan(0);
    expect(detectEscalationTopics("Will you sponsor my visa?").length).toBeGreaterThan(0);
    expect(detectEscalationTopics("Please delete my data").length).toBeGreaterThan(0);
  });

  it("leaves ordinary status questions alone", () => {
    /*
      THE OTHER HALF OF THE RULE, and the one that decides whether this feature
      survives contact with a real inbox. Every question below is exactly what
      the agent exists to answer; escalating them would leave a recruiter with a
      permanently flagged inbox and no reason to keep the agent on.
    */
    for (const message of [
      "What's the status of my application?",
      "When is my interview?",
      "Did I get shortlisted?",
      "What should I prepare for the technical round?",
      "Thanks! Looking forward to it",
      "Can you confirm the address?",
      "Which stage am I at now?",
    ]) {
      expect(detectEscalationTopics(message), message).toEqual([]);
    }
  });

  it("does not escalate CANCEL, END or QUIT on their own", () => {
    // All three are on the conventional list and all three are plausible
    // answers to "shall I book you in for Thursday?".
    for (const message of ["cancel", "end", "quit"]) {
      expect(detectEscalationTopics(message), message).toEqual([]);
    }
  });

  it("names the topics in the recruiter's flag", () => {
    const reason = escalationReasonFrom(detectEscalationTopics("what is the salary"));
    expect(reason).toContain("pay or negotiation");
  });

  it("has a reason even when nothing specific was detected", () => {
    // The model's own refusal, or a rejected draft, lands here.
    expect(escalationReasonFrom([])).toContain("wasn't confident");
  });

  it("keeps the holding message a promise nothing has to keep", () => {
    /*
      Fixed, not configurable, and checked here because an organization that
      could reword it could word it into a commitment ("we'll call you within
      the hour") the agent has no way to honour.
    */
    expect(HOLDING_MESSAGE).toContain("get back to you");
    expect(HOLDING_MESSAGE).not.toMatch(/\d/);
    expect(HOLDING_MESSAGE).not.toMatch(/hour|today|tomorrow|minute/i);
  });
});

// -----------------------------------------------------------------------------
// The numeric grounding set
// -----------------------------------------------------------------------------
describe("the anti-fabrication guard", () => {
  const input: AutoReplyInput = {
    inboundMessage: "What's my status?",
    history: [],
    candidateName: "Rahul Sharma",
    candidateCurrentRole: "Senior Engineer",
    candidateCurrentCompany: "Acme",
    candidateSkills: ["React", "Node"],
    applications: [
      {
        jobTitle: "Staff Engineer",
        stageLabel: "Director Round",
        matchScore: 88,
        nextInterviewAt: "24 Sep 2026, 15:00",
        nextInterviewMode: "video",
        nextInterviewLocation: null,
        hasInterviewLink: true,
        screeningOutcome: "completed",
        interviewRecommendation: "Proceed",
        jobRequirements: "Required skills: React, Node. Experience: 5-8 years.",
      },
    ],
    organizationName: "Webbee",
    toneInstructions: null,
    contextInstructions: null,
  };

  const allowed = allowedAutoReplyNumbers(input);

  it("allows the real match score", () => {
    expect(findUnsupportedNumbers("You're at 88% on this role.", allowed)).toEqual([]);
  });

  it("catches a score the model rounded or invented", () => {
    // 89 when the truth is 88 is a lie told to a candidate, not a rounding error
    // on a dashboard.
    // Reported WITH the percent sign, because that is how it appeared — the
    // offender list is what a developer reads in the rejection log.
    expect(findUnsupportedNumbers("You're at 89% on this role.", allowed)).toContain("89%");
    expect(findUnsupportedNumbers("You scored 95.", allowed)).toContain("95");
  });

  it("allows the digits inside a formatted interview time", () => {
    /*
      The reason allowedAutoReplyNumbers() runs numbersInText() over every fact
      string rather than only collecting numeric fields: a legitimate reply says
      "on 24 Sep at 15:00", and those digits live inside a preformatted date.
      Without this the guard would reject every correct answer about a time.
    */
    expect(
      findUnsupportedNumbers("Your interview is on 24 Sep 2026, 15:00.", allowed)
    ).toEqual([]);
  });

  it("catches an invented date", () => {
    expect(findUnsupportedNumbers("Your interview is on 27 Sep.", allowed)).toContain("27");
  });

  it("allows the experience range the job actually states", () => {
    expect(findUnsupportedNumbers("The role asks for 5-8 years.", allowed)).toEqual([]);
  });

  it("catches a spelled-out number too", () => {
    // Otherwise "eighty-nine percent" walks straight past a digit-only check.
    expect(findUnsupportedNumbers("You scored eighty-nine percent.", allowed)).toContain(
      "eighty"
    );
  });

  it("grounds numbers the candidate themselves used", () => {
    const withHistory = allowedAutoReplyNumbers({
      ...input,
      inboundMessage: "I have 7 years of experience, is that enough?",
    });
    expect(findUnsupportedNumbers("You mentioned 7 years.", withHistory)).toEqual([]);
  });

  it("does not ground a number nobody supplied", () => {
    expect(allowed.has(42)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The inbox's ordering
// -----------------------------------------------------------------------------
describe("the inbox filters", () => {
  const thread = (overrides: Partial<ConversationSummary>): ConversationSummary => ({
    id: "c1",
    candidate_id: "cand-1",
    candidate_name: "A",
    phone_number: "919876543210",
    last_message_at: "2026-09-20T10:00:00Z",
    last_inbound_at: "2026-09-20T10:00:00Z",
    last_message_preview: "hello",
    unread_count: 0,
    last_message_auto_replied: false,
    needs_human: false,
    needs_human_reason: null,
    ...overrides,
  });

  const conversations = [
    thread({ id: "newest-auto", last_message_auto_replied: true }),
    thread({ id: "older-flagged", needs_human: true, needs_human_reason: "Mentions pay" }),
    thread({ id: "older-plain" }),
  ];

  it("lifts flagged threads above newer self-answered ones", () => {
    /*
      The pipeline board's most-overdue-first rule, applied to an inbox. A list
      ordered purely by recency buries the one person waiting on a human under
      every thread that handled itself — and each new auto-reply pushes them
      further down.
    */
    expect(applyInboxFilter(conversations, "all").map((c) => c.id)).toEqual([
      "older-flagged",
      "newest-auto",
      "older-plain",
    ]);
  });

  it("filters to just the threads waiting on a person", () => {
    expect(applyInboxFilter(conversations, "needs_human").map((c) => c.id)).toEqual([
      "older-flagged",
    ]);
  });

  it("filters to what the agent answered, for spot-checking", () => {
    expect(applyInboxFilter(conversations, "auto_replied").map((c) => c.id)).toEqual([
      "newest-auto",
    ]);
  });

  it("counts what is waiting, for the tab badge", () => {
    expect(countNeedsHuman(conversations)).toBe(1);
    expect(countNeedsHuman([])).toBe(0);
  });

  it("keeps the order stable within each group", () => {
    // So a thread does not move while somebody is reading it.
    const twoFlagged = [
      thread({ id: "flag-a", needs_human: true }),
      thread({ id: "plain" }),
      thread({ id: "flag-b", needs_human: true }),
    ];
    expect(applyInboxFilter(twoFlagged, "all").map((c) => c.id)).toEqual([
      "flag-a",
      "flag-b",
      "plain",
    ]);
  });
});
