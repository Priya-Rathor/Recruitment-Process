import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  describeEvent,
  eventLabel,
  isSensitiveEvent,
  SENSITIVE_EVENT_TYPES,
} from "@/lib/activity/events";
import { sanitizeMetadata } from "@/lib/activity/log";
import { findUngroundedClaims, toTimelineFacts, type TimelineFact } from "@/lib/activity/grounding";

// -----------------------------------------------------------------------------
// The catalogue.
// -----------------------------------------------------------------------------
describe("event catalogue", () => {
  it("renders a sentence for every event, from empty metadata", () => {
    // The failure this catches: a describe() that assumes a field is present and
    // throws on an old row written before that field existed. An audit entry
    // that cannot render is an audit entry nobody can read.
    for (const type of EVENT_TYPES) {
      const rendered = describeEvent(type, {});
      expect(rendered, `${type} rendered empty`).toBeTruthy();
      expect(rendered.length, `${type} rendered too short`).toBeGreaterThan(3);
    }
  });

  it("renders an unknown event rather than dropping or throwing", () => {
    expect(describeEvent("something.invented", {})).toBe("something invented");
    expect(eventLabel("something.invented")).toBe("something invented");
  });

  it("survives metadata of the wrong shape", () => {
    expect(() =>
      describeEvent("member.role_changed", { from: 42, to: null, member_name: [] })
    ).not.toThrow();
  });

  /**
   * The security boundary. Anything that changes who can do what, or that
   * touches credentials, must be Owner/Admin only — RLS reads the is_sensitive
   * column, and logActivity() sets it from this list rather than from the
   * caller.
   */
  it("marks every access, credential and automation-control event sensitive", () => {
    const mustBeSensitive = [
      "member.invited",
      "member.invite_accepted",
      "member.invite_revoked",
      "member.role_changed",
      "member.removed",
      "organization.created",
      "organization.updated",
      "integration.connected",
      "integration.disconnected",
      "integration.tested",
      "automation.created",
      "automation.activated",
      "automation.paused",
      "automation.deleted",
    ];

    for (const type of mustBeSensitive) {
      expect(isSensitiveEvent(type), `${type} must be sensitive`).toBe(true);
    }
  });

  it("does not hide ordinary recruitment work behind the audit log", () => {
    // A Recruiter has to be able to see what happened to their own candidates.
    // Marking these sensitive would silently empty their timelines.
    const mustBeVisible = [
      "candidate.created",
      "application.stage_changed",
      "resume.parsed",
      "match.calculated",
      "screening_call.completed",
      "interview.scheduled",
      "client.submission_sent",
      "automation.run",
      "ai.invoked",
    ];

    for (const type of mustBeVisible) {
      expect(isSensitiveEvent(type), `${type} must NOT be sensitive`).toBe(false);
    }
  });

  it("exposes the sensitive slice the audit log page filters on", () => {
    expect(SENSITIVE_EVENT_TYPES.length).toBeGreaterThan(0);
    expect(SENSITIVE_EVENT_TYPES.every((type) => isSensitiveEvent(type))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Metadata sanitisation. This table is append-only and never expires, so
// anything that lands here is permanent.
// -----------------------------------------------------------------------------
describe("sanitizeMetadata", () => {
  it("drops credential-shaped keys whatever a caller passes", () => {
    const cleaned = sanitizeMetadata({
      apiKey: "sk-live-abc123",
      api_key: "sk-live-abc123",
      password: "hunter2",
      access_token: "t0ken",
      authorization: "Bearer x",
      client_secret: "shh",
      name: "ACME Corp",
    });

    expect(cleaned).toEqual({ name: "ACME Corp" });
  });

  it("drops transcript, prompt and completion keys", () => {
    // These are the three that would quietly turn the audit log into a second
    // permanent copy of a candidate's personal data.
    const cleaned = sanitizeMetadata({
      transcript: "The candidate said...",
      prompt: "You are a helpful...",
      completion: "Rahul seems...",
      status: "completed",
    });

    expect(cleaned).toEqual({ status: "completed" });
  });

  it("drops nested objects, which is how a whole payload gets logged by accident", () => {
    const cleaned = sanitizeMetadata({
      provider_response: { choices: [{ message: { content: "..." } }] },
      score: 82,
    });

    expect(cleaned).toEqual({ score: 82 });
  });

  it("truncates long strings rather than storing them whole", () => {
    const cleaned = sanitizeMetadata({ note: "x".repeat(2000) });
    expect((cleaned.note as string).length).toBeLessThanOrEqual(501);
  });

  it("keeps falsy values that are real data", () => {
    // 0 and false are answers, not absences. Dropping them would silently change
    // what an event says.
    const cleaned = sanitizeMetadata({ score: 0, ok: false, reason: null });
    expect(cleaned).toEqual({ score: 0, ok: false, reason: null });
  });
});

// -----------------------------------------------------------------------------
// THE SPEC'S HARD CONSTRAINT.
//
//   "AI narrative never states an event absent from the underlying log."
//
// These test the enforcement, not the prompt.
// -----------------------------------------------------------------------------
const FACTS: TimelineFact[] = [
  {
    eventType: "candidate.created",
    description: "Added Rahul Sharma to the database",
    occurredAt: "2026-08-10T09:00:00.000Z",
    metadata: {},
  },
  {
    eventType: "match.calculated",
    description: "Match score calculated: 86%",
    occurredAt: "2026-08-10T09:05:00.000Z",
    metadata: { score: 86 },
  },
  {
    eventType: "application.stage_changed",
    description: "Moved from new to shortlisted",
    occurredAt: "2026-08-12T11:00:00.000Z",
    metadata: {},
  },
];

describe("findUngroundedClaims", () => {
  it("accepts a narrative that only describes logged events", () => {
    const narrative =
      "Rahul Sharma was added on August 10 and matched 86% with the role. He was shortlisted on August 12.";
    expect(findUngroundedClaims({ narrative, facts: FACTS })).toEqual([]);
  });

  /**
   * The one that matters most. This narrative is fluent, plausible, and in the
   * house style — a reader will not catch it, which is exactly why the check
   * cannot be left to a reader.
   */
  it("rejects a screening call that never happened", () => {
    const narrative =
      "Rahul Sharma was added on August 10, completed AI screening, and was shortlisted on August 12.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].kind).toBe("unlogged_event");
    expect(violations[0].detail).toContain("screening");
  });

  it("rejects an interview that never happened", () => {
    const narrative =
      "Rahul was added on August 10 and an interview was scheduled for later that week.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.some((v) => v.kind === "unlogged_event")).toBe(true);
  });

  it("rejects a client submission that never happened", () => {
    const narrative = "Rahul was shortlisted on August 12 and submitted to ABC Tech.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.some((v) => v.kind === "unlogged_event")).toBe(true);
  });

  it("rejects a figure that isn't in the log", () => {
    // 92 is nowhere in the events. A confidently wrong match score is acted on.
    const narrative = "Rahul was added on August 10 and matched 92% with the role.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.some((v) => v.kind === "unsupported_number")).toBe(true);
  });

  it("rejects a date nothing happened on", () => {
    const narrative = "Rahul was added on August 10 and shortlisted on August 25.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.some((v) => v.kind === "unsupported_date")).toBe(true);
  });

  it("does not flag the real event dates as unsupported", () => {
    // The regression this guards: a date check strict enough to reject every
    // correct narrative would be turned off within a week.
    const narrative = "Rahul was added on August 10 and shortlisted on August 12.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.filter((v) => v.kind === "unsupported_date")).toEqual([]);
  });

  it("does not read a year as a fabricated number", () => {
    const narrative = "Rahul was added on 10 August 2026 and matched 86%.";
    const violations = findUngroundedClaims({ narrative, facts: FACTS });
    expect(violations.filter((v) => v.kind === "unsupported_number")).toEqual([]);
  });

  it("handles day-first dates in both directions", () => {
    // A regression pair. The original date stripper matched "August 20" out of
    // "10 August 2026" — biting the year in half — so a correct narrative
    // reported "10" and "26" as invented figures, and a fabricated day-first
    // date went entirely unchecked.
    const correct = findUngroundedClaims({
      narrative: "Rahul was added on 10 August and shortlisted on 12 August.",
      facts: FACTS,
    });
    expect(correct).toEqual([]);

    const fabricated = findUngroundedClaims({
      narrative: "Rahul was added on 10 August and shortlisted on 25 August.",
      facts: FACTS,
    });
    expect(fabricated.some((v) => v.kind === "unsupported_date")).toBe(true);
  });

  it("catches a screening claim phrased without the word 'call'", () => {
    // "completed AI screening" asserts the same thing as "completed a screening
    // call"; an earlier pattern required the word "call" and let this through.
    const violations = findUngroundedClaims({
      narrative: "Rahul was added on August 10 and completed AI screening.",
      facts: FACTS,
    });
    expect(violations.some((v) => v.kind === "unlogged_event")).toBe(true);
  });

  it("accepts a screening claim once the screening event exists", () => {
    const withScreening: TimelineFact[] = [
      ...FACTS,
      {
        eventType: "screening_call.completed",
        description: "AI screening call completed with the candidate's consent",
        occurredAt: "2026-08-11T10:00:00.000Z",
        metadata: {},
      },
    ];

    const narrative =
      "Rahul was added on August 10, matched 86%, completed AI screening on August 11, and was shortlisted on August 12.";
    expect(findUngroundedClaims({ narrative, facts: withScreening })).toEqual([]);
  });

  it("accepts the spec's own worked example against its own timeline", () => {
    // Section 10's example, checked against the events it says produced it. If
    // the guard rejected this, the guard would be wrong.
    const specFacts: TimelineFact[] = [
      {
        eventType: "resume.uploaded",
        description: "Uploaded rahul.pdf",
        occurredAt: "2026-08-10T09:00:00.000Z",
        metadata: {},
      },
      {
        eventType: "resume.parsed",
        description: "AI parsed the resume",
        occurredAt: "2026-08-10T09:01:00.000Z",
        metadata: {},
      },
      {
        eventType: "match.calculated",
        description: "Match score calculated: 86%",
        occurredAt: "2026-08-10T09:02:00.000Z",
        metadata: { score: 86 },
      },
      {
        eventType: "screening_call.completed",
        description: "AI screening call completed with the candidate's consent",
        occurredAt: "2026-08-11T10:00:00.000Z",
        metadata: {},
      },
      {
        eventType: "screening_report.reviewed",
        description: "Reviewed the screening report and confirmed it",
        occurredAt: "2026-08-11T12:00:00.000Z",
        metadata: {},
      },
      {
        eventType: "application.stage_changed",
        description: "Moved from recruiter_review to shortlisted",
        occurredAt: "2026-08-11T12:05:00.000Z",
        metadata: {},
      },
      {
        eventType: "client.submission_sent",
        description: "Submitted to ABC Tech",
        occurredAt: "2026-08-12T09:00:00.000Z",
        metadata: {},
      },
      {
        eventType: "interview.scheduled",
        description: "Interview scheduled for 18 August",
        occurredAt: "2026-08-13T09:00:00.000Z",
        metadata: {},
      },
    ];

    const narrative =
      "Rahul entered the system on August 10, matched 86% with the Java role, completed AI screening on August 11, was shortlisted after recruiter review and submitted to ABC Tech on August 12. The client requested an interview, which was scheduled on August 13.";

    expect(findUngroundedClaims({ narrative, facts: specFacts })).toEqual([]);
  });
});

describe("toTimelineFacts", () => {
  it("gives the model rendered descriptions, not raw metadata", () => {
    // So the model cannot paraphrase a field nobody chose to surface — what it
    // may say is bounded by what the timeline already shows a human.
    const facts = toTimelineFacts(
      [
        {
          event_type: "match.calculated",
          created_at: "2026-08-10T09:00:00.000Z",
          metadata: { score: 86, internal_note: "do not surface" },
        },
      ],
      describeEvent
    );

    expect(facts[0].description).toBe("Match score calculated: 86%");
    expect(facts[0].description).not.toContain("do not surface");
  });
});
