import { describe, expect, it } from "vitest";
import {
  APPLICATION_STAGES,
  PIPELINE_STAGES,
  availableTransitions,
  canTransition,
  isApplicationStage,
  isTerminalStage,
  stageIndex,
  STAGE_LABELS,
} from "./stages";
import {
  buildTimeline,
  currentStageRow,
  daysInCurrentStage,
  durationInDays,
  type NoteRow,
  type StageHistoryRow,
} from "./timeline";

describe("stage vocabulary", () => {
  it("matches Module 10's board order exactly", () => {
    expect(PIPELINE_STAGES).toEqual([
      "new",
      "screening",
      "recruiter_review",
      "shortlisted",
      "client_review",
      "interview",
      "offer",
      "hired",
    ]);
  });

  it("labels every stage", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it("validates stage strings", () => {
    expect(isApplicationStage("shortlisted")).toBe(true);
    expect(isApplicationStage("Shortlisted")).toBe(false);
    expect(isApplicationStage("archived")).toBe(false);
    expect(isApplicationStage(null)).toBe(false);
  });

  it("puts terminal exits off the board", () => {
    expect(stageIndex("new")).toBe(0);
    expect(stageIndex("hired")).toBe(7);
    expect(stageIndex("rejected")).toBe(-1);
    expect(stageIndex("withdrawn")).toBe(-1);
  });

  it("treats hired, rejected and withdrawn as finished", () => {
    expect(isTerminalStage("hired")).toBe(true);
    expect(isTerminalStage("rejected")).toBe(true);
    expect(isTerminalStage("withdrawn")).toBe(true);
    expect(isTerminalStage("offer")).toBe(false);
    expect(isTerminalStage("new")).toBe(false);
  });
});

describe("canTransition", () => {
  it("allows normal forward movement", () => {
    expect(canTransition("new", "screening").allowed).toBe(true);
    expect(canTransition("shortlisted", "client_review").allowed).toBe(true);
  });

  it("allows skipping stages", () => {
    // A referral can go straight to interview; the board is not a state machine
    // recruiters should have to fight.
    expect(canTransition("new", "interview").allowed).toBe(true);
  });

  it("allows moving BACKWARDS", () => {
    // A client asking for a re-review is normal; forbidding it would push
    // people to work around the tool.
    expect(canTransition("client_review", "shortlisted").allowed).toBe(true);
  });

  it("allows rejecting from any live stage", () => {
    for (const stage of PIPELINE_STAGES) {
      if (stage === "hired") continue;
      expect(canTransition(stage, "rejected").allowed).toBe(true);
    }
  });

  it("REFUSES to reopen a finished application", () => {
    // Silently resurrecting a hire or rejection would corrupt Module 16's funnel.
    for (const from of ["hired", "rejected", "withdrawn"] as const) {
      const result = canTransition(from, "screening");
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/new application/i);
    }
  });

  it("treats a no-op as allowed", () => {
    expect(canTransition("hired", "hired").allowed).toBe(true);
  });

  it("offers no onward transitions once terminal", () => {
    expect(availableTransitions("hired")).toEqual([]);
    expect(availableTransitions("rejected")).toEqual([]);
  });

  it("offers every other stage from a live one", () => {
    const options = availableTransitions("screening");
    expect(options).not.toContain("screening");
    expect(options).toContain("recruiter_review");
    expect(options).toContain("rejected");
    expect(options).toHaveLength(APPLICATION_STAGES.length - 1);
  });
});

describe("durationInDays", () => {
  it("floors to whole days", () => {
    expect(durationInDays("2026-08-01T00:00:00Z", "2026-08-04T23:00:00Z")).toBe(3);
  });

  it("returns 0 for a same-day transition", () => {
    expect(durationInDays("2026-08-01T09:00:00Z", "2026-08-01T17:00:00Z")).toBe(0);
  });

  it("returns null rather than a negative for out-of-order timestamps", () => {
    expect(durationInDays("2026-08-04T00:00:00Z", "2026-08-01T00:00:00Z")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(durationInDays("nope", "2026-08-01T00:00:00Z")).toBeNull();
  });
});

describe("buildTimeline", () => {
  const stages: StageHistoryRow[] = [
    {
      id: "s1",
      stage: "new",
      entered_at: "2026-08-01T10:00:00Z",
      exited_at: "2026-08-03T10:00:00Z",
      changed_by_name: "Priya",
    },
    {
      id: "s2",
      stage: "screening",
      entered_at: "2026-08-03T10:00:00Z",
      exited_at: null,
      changed_by_name: "Priya",
    },
  ];

  const notes: NoteRow[] = [
    {
      id: "n1",
      note: "Left a voicemail.",
      created_at: "2026-08-02T09:00:00Z",
      author_name: "Rahul",
    },
  ];

  it("merges stages and notes newest first", () => {
    const events = buildTimeline({ stages, notes });
    expect(events.map((event) => event.id)).toEqual(["stage-s2", "note-n1", "stage-s1"]);
  });

  it("shows how long a completed stage lasted", () => {
    const events = buildTimeline({ stages, notes });
    expect(events.find((event) => event.id === "stage-s1")?.durationDays).toBe(2);
  });

  it("leaves the open stage without a duration", () => {
    // Deriving one from "now" would make a static page appear to change on
    // reload; days-in-stage is a separate, explicit call.
    const events = buildTimeline({ stages, notes });
    expect(events.find((event) => event.id === "stage-s2")?.durationDays).toBeNull();
  });

  it("carries the note body and author", () => {
    const events = buildTimeline({ stages, notes });
    const note = events.find((event) => event.id === "note-n1");
    expect(note?.detail).toBe("Left a voicemail.");
    expect(note?.actor).toBe("Rahul");
    expect(note?.kind).toBe("note");
  });

  it("orders deterministically when timestamps collide", () => {
    const sameTime = "2026-08-05T12:00:00Z";
    const first = buildTimeline({
      stages: [{ id: "s9", stage: "offer", entered_at: sameTime, exited_at: null }],
      notes: [{ id: "n9", note: "Offer sent", created_at: sameTime }],
    });
    const second = buildTimeline({
      notes: [{ id: "n9", note: "Offer sent", created_at: sameTime }],
      stages: [{ id: "s9", stage: "offer", entered_at: sameTime, exited_at: null }],
    });
    expect(first.map((event) => event.id)).toEqual(second.map((event) => event.id));
  });

  it("handles an application with no notes", () => {
    expect(buildTimeline({ stages, notes: [] })).toHaveLength(2);
  });

  it("handles an empty application", () => {
    expect(buildTimeline({ stages: [], notes: [] })).toEqual([]);
  });
});

describe("current stage", () => {
  const stages: StageHistoryRow[] = [
    { id: "s1", stage: "new", entered_at: "2026-08-01T10:00:00Z", exited_at: "2026-08-03T10:00:00Z" },
    { id: "s2", stage: "screening", entered_at: "2026-08-03T10:00:00Z", exited_at: null },
  ];

  it("finds the one open row", () => {
    expect(currentStageRow(stages)?.stage).toBe("screening");
  });

  it("returns null when every row is closed", () => {
    expect(currentStageRow([stages[0]])).toBeNull();
  });

  it("counts days in the current stage", () => {
    expect(daysInCurrentStage(stages, new Date("2026-08-09T10:00:00Z"))).toBe(6);
  });

  it("returns null for days-in-stage when nothing is open", () => {
    expect(daysInCurrentStage([stages[0]], new Date("2026-08-09T10:00:00Z"))).toBeNull();
  });
});
