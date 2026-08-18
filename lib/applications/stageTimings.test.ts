import { describe, expect, it } from "vitest";
import { buildStageTimings, stageTimingPhase } from "@/lib/applications/stageTimings";
import type { StageHistoryRow } from "@/lib/applications/timeline";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function row(
  stage: string,
  entered: string,
  exited: string | null = null,
  id = `${stage}-${entered}`
): StageHistoryRow {
  return {
    id,
    stage: stage as StageHistoryRow["stage"],
    entered_at: entered,
    exited_at: exited,
  };
}

describe("buildStageTimings", () => {
  it("returns an entry for every stage, empty when never entered", () => {
    const timings = buildStageTimings([], NOW);

    expect(timings.applied.firstEnteredAt).toBeNull();
    expect(timings.applied.visits).toBe(0);
    expect(timings.applied.days).toBeNull();
    expect(stageTimingPhase(timings.hired)).toBe("not_reached");
  });

  it("records dates and whole days for a closed visit", () => {
    const timings = buildStageTimings(
      [row("applied", "2026-08-01T09:00:00.000Z", "2026-08-04T09:00:00.000Z")],
      NOW
    );

    expect(timings.applied.firstEnteredAt).toBe("2026-08-01T09:00:00.000Z");
    expect(timings.applied.lastExitedAt).toBe("2026-08-04T09:00:00.000Z");
    expect(timings.applied.days).toBe(3);
    expect(timings.applied.open).toBe(false);
    expect(stageTimingPhase(timings.applied)).toBe("completed");
  });

  it("measures the open visit against `now`", () => {
    const timings = buildStageTimings([row("phone_interview", "2026-08-16T12:00:00.000Z")], NOW);

    expect(timings.phone_interview.open).toBe(true);
    expect(timings.phone_interview.lastExitedAt).toBeNull();
    expect(timings.phone_interview.days).toBe(2);
    expect(stageTimingPhase(timings.phone_interview)).toBe("in_progress");
  });

  it("sums every visit when an application is moved back", () => {
    // Two spells in Phone Interview, three days each, with a video round in
    // between. The latest visit alone would understate it by half.
    const timings = buildStageTimings(
      [
        row("phone_interview", "2026-08-01T00:00:00.000Z", "2026-08-04T00:00:00.000Z", "a"),
        row("video_interview", "2026-08-04T00:00:00.000Z", "2026-08-06T00:00:00.000Z", "b"),
        row("phone_interview", "2026-08-06T00:00:00.000Z", "2026-08-09T00:00:00.000Z", "c"),
      ],
      NOW
    );

    expect(timings.phone_interview.visits).toBe(2);
    expect(timings.phone_interview.days).toBe(6);
    expect(timings.phone_interview.firstEnteredAt).toBe("2026-08-01T00:00:00.000Z");
    expect(timings.phone_interview.lastEnteredAt).toBe("2026-08-06T00:00:00.000Z");
    expect(timings.phone_interview.lastExitedAt).toBe("2026-08-09T00:00:00.000Z");
  });

  it("is independent of the order rows arrive in", () => {
    const ascending = [
      row("applied", "2026-08-01T00:00:00.000Z", "2026-08-03T00:00:00.000Z", "a"),
      row("shortlisted", "2026-08-03T00:00:00.000Z", null, "b"),
    ];

    const forwards = buildStageTimings(ascending, NOW);
    // The query returns newest-first, which is what the page actually passes.
    const backwards = buildStageTimings([...ascending].reverse(), NOW);

    expect(backwards).toEqual(forwards);
    expect(forwards.applied.firstEnteredAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("ignores a stage name the enum no longer contains", () => {
    // A legacy row left by a migration must not write an undefined key and
    // take the whole page down.
    const timings = buildStageTimings(
      [
        row("client_review", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", "old"),
        row("applied", "2026-08-02T00:00:00.000Z", null, "new"),
      ],
      NOW
    );

    expect(Object.keys(timings)).not.toContain("client_review");
    expect(timings.applied.open).toBe(true);
  });

  it("survives an unparseable timestamp without losing the visit", () => {
    const timings = buildStageTimings([row("applied", "not-a-date", null)], NOW);

    expect(timings.applied.visits).toBe(1);
    expect(timings.applied.days).toBeNull();
  });

  it("counts terminal exits like any other stage", () => {
    const timings = buildStageTimings([row("rejected", "2026-08-17T12:00:00.000Z")], NOW);

    expect(timings.rejected.open).toBe(true);
    expect(timings.rejected.days).toBe(1);
  });
});
