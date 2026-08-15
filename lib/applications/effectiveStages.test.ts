import { describe, expect, it } from "vitest";
import {
  acceptsEntries,
  buildStepper,
  effectiveStages,
  flagsFromRows,
  movableStages,
  visibleStages,
} from "@/lib/applications/effectiveStages";
import { STAGE_LABELS } from "@/lib/applications/stages";

const ALL_OFF = {
  ai_screening_call: false,
  phone_interview: false,
  video_interview: false,
  written_assessment: false,
};

const ALL_ON = {
  ai_screening_call: true,
  phone_interview: true,
  video_interview: true,
  written_assessment: true,
};

describe("effectiveStages", () => {
  // The second brief's first named test.
  it("shows only the four structural stages when every toggle is off", () => {
    const stages = visibleStages(effectiveStages({ flags: ALL_OFF }));
    expect(stages).toEqual(["applied", "shortlisted", "director_round", "hired"]);
  });

  // And its second.
  it("shows five stages when only the screening call is on", () => {
    const stages = visibleStages(
      effectiveStages({ flags: { ...ALL_OFF, ai_screening_call: true } })
    );
    expect(stages).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "director_round",
      "hired",
    ]);
  });

  it("shows all eight when everything is on", () => {
    expect(visibleStages(effectiveStages({ flags: ALL_ON }))).toHaveLength(8);
  });

  it("treats a missing flag as off, like a job that never touched the setting", () => {
    // A job configured before hiring stages shipped has no rows at all, and
    // "no row" has to mean the same thing as enabled = false.
    expect(visibleStages(effectiveStages({ flags: {} }))).toEqual([
      "applied",
      "shortlisted",
      "director_round",
      "hired",
    ]);
  });

  it("never hides a structural stage, whatever is passed", () => {
    // Applied / Shortlisted / Director Round / Hired are not toggleable, so a
    // flag naming one must have no effect.
    const stages = visibleStages(
      effectiveStages({
        flags: { ...ALL_OFF, shortlisted: false } as never,
      })
    );
    expect(stages).toContain("shortlisted");
  });

  it("keeps stages in board order regardless of the flags", () => {
    const stages = visibleStages(
      effectiveStages({ flags: { ...ALL_OFF, written_assessment: true, ai_screening_call: true } })
    );
    expect(stages).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "written_assessment",
      "director_round",
      "hired",
    ]);
  });
});

describe("a stage disabled after entries were logged", () => {
  /**
   * The rule that protects data. Someone switching Written Assessment off after
   * ten candidates sat one must not erase those ten records from view.
   */
  it("stays visible, read-only, for an application that has entries", () => {
    const availability = effectiveStages({
      flags: ALL_OFF,
      entryCounts: { written_assessment: 2 },
    });

    expect(visibleStages(availability)).toContain("written_assessment");
    expect(acceptsEntries(availability, "written_assessment")).toBe(false);
  });

  it("disappears entirely for an application with zero entries", () => {
    // Same job, different application — the brief's exact scenario.
    const availability = effectiveStages({ flags: ALL_OFF, entryCounts: {} });

    expect(visibleStages(availability)).not.toContain("written_assessment");
    expect(acceptsEntries(availability, "written_assessment")).toBe(false);
  });

  it("accepts entries again the moment the stage is switched back on", () => {
    const availability = effectiveStages({
      flags: { ...ALL_OFF, written_assessment: true },
      entryCounts: { written_assessment: 2 },
    });
    expect(acceptsEntries(availability, "written_assessment")).toBe(true);
  });

  it("keeps a disabled stage visible while the application is sitting in it", () => {
    // Otherwise the stepper would have no current segment, which reads as a
    // broken page rather than a configuration change — and the application
    // genuinely is there.
    const availability = effectiveStages({
      flags: ALL_OFF,
      currentStage: "phone_interview",
    });
    expect(visibleStages(availability)).toContain("phone_interview");
  });
});

describe("movableStages", () => {
  it("never offers a stage the job switched off", () => {
    const stages = movableStages(effectiveStages({ flags: ALL_OFF }));
    expect(stages).not.toContain("ai_screening_call");
    expect(stages).not.toContain("video_interview");
  });

  it("always offers the terminal exits, whatever the job configured", () => {
    // An application can be rejected from anywhere; that is not a stage a job
    // opts into.
    const stages = movableStages(effectiveStages({ flags: ALL_OFF }));
    expect(stages).toContain("rejected");
    expect(stages).toContain("withdrawn");
  });

  it("does not offer a read-only historical stage as a move target", () => {
    // Visible for its history, but the job no longer runs it — moving someone
    // INTO it would be creating new work in a retired stage.
    const availability = effectiveStages({
      flags: ALL_OFF,
      entryCounts: { written_assessment: 3 },
    });

    expect(visibleStages(availability)).toContain("written_assessment");
    expect(movableStages(availability)).not.toContain("written_assessment");
  });

  it("offers every stage a fully configured job runs", () => {
    const stages = movableStages(effectiveStages({ flags: ALL_ON }));
    expect(stages).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
      "director_round",
      "hired",
      "rejected",
      "withdrawn",
    ]);
  });
});

describe("buildStepper", () => {
  const labels = STAGE_LABELS;

  it("marks completed, current and upcoming segments", () => {
    const segments = buildStepper({
      availability: effectiveStages({ flags: ALL_ON }),
      currentStage: "phone_interview",
      labels,
    });

    expect(segments.map((s) => s.state)).toEqual([
      "complete", // applied
      "complete", // shortlisted
      "complete", // ai_screening_call
      "current", // phone_interview
      "upcoming", // video_interview
      "upcoming", // written_assessment
      "upcoming", // director_round
      "upcoming", // hired
    ]);
  });

  it("renders correctly at every one of the eight stages", () => {
    // The brief's test: the stepper must be right at each stage, not just one.
    for (const stage of [
      "applied",
      "shortlisted",
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
      "director_round",
      "hired",
    ] as const) {
      const segments = buildStepper({
        availability: effectiveStages({ flags: ALL_ON }),
        currentStage: stage,
        labels,
      });

      const current = segments.filter((s) => s.state === "current");
      expect(current, stage).toHaveLength(1);
      expect(current[0].stage, stage).toBe(stage);
      expect(segments, stage).toHaveLength(8);
    }
  });

  it("compresses to the job's stages, without gaps", () => {
    const segments = buildStepper({
      availability: effectiveStages({ flags: { ...ALL_OFF, ai_screening_call: true } }),
      currentStage: "shortlisted",
      labels,
    });

    expect(segments.map((s) => s.stage)).toEqual([
      "applied",
      "shortlisted",
      "ai_screening_call",
      "director_round",
      "hired",
    ]);
  });

  /**
   * A rejected application shows how far it got AND that it ended — not a
   * stepper cut off mid-flow, which answers the first question and leaves the
   * second hanging.
   */
  it("ends a rejected application with a red terminus, not grey upcoming stages", () => {
    const segments = buildStepper({
      availability: effectiveStages({ flags: ALL_ON }),
      currentStage: "rejected",
      rejectedAtStage: "phone_interview",
      labels,
    });

    expect(segments.map((s) => [s.stage, s.state])).toEqual([
      ["applied", "complete"],
      ["shortlisted", "complete"],
      ["ai_screening_call", "complete"],
      ["phone_interview", "complete"],
      ["rejected", "rejected"],
    ]);
    // Nothing after the rejection is shown as still to come.
    expect(segments.some((s) => s.state === "upcoming")).toBe(false);
  });

  it("still shows the terminus when the rejection stage was never recorded", () => {
    // Rejected before rejected_at_stage existed, and the backfill found nothing.
    const segments = buildStepper({
      availability: effectiveStages({ flags: ALL_ON }),
      currentStage: "rejected",
      rejectedAtStage: null,
      labels,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].state).toBe("rejected");
  });

  it("treats withdrawn the same way as rejected", () => {
    const segments = buildStepper({
      availability: effectiveStages({ flags: ALL_ON }),
      currentStage: "withdrawn",
      rejectedAtStage: "shortlisted",
      labels,
    });

    expect(segments.at(-1)?.stage).toBe("withdrawn");
    expect(segments.at(-1)?.state).toBe("rejected");
  });

  it("labels every segment", () => {
    const segments = buildStepper({
      availability: effectiveStages({ flags: ALL_ON }),
      currentStage: "applied",
      labels,
    });
    for (const segment of segments) {
      expect(segment.label, segment.stage).toBeTruthy();
    }
  });
});

describe("flagsFromRows", () => {
  it("reads job_hiring_stages rows", () => {
    expect(
      flagsFromRows([
        { stage_key: "ai_screening_call", enabled: true },
        { stage_key: "video_interview", enabled: false },
      ])
    ).toEqual({ ai_screening_call: true, video_interview: false });
  });

  it("ignores a key that is not a configurable stage", () => {
    // job_hiring_stages and the pipeline share four keys, not ten. A row for
    // anything else is not this module's business.
    expect(flagsFromRows([{ stage_key: "director_round", enabled: true }])).toEqual({});
  });
});
