import { describe, expect, it } from "vitest";
import {
  MAX_LIST_ITEMS,
  buildVerdict,
  isEmptyVerdict,
  normalizeHighlights,
  normalizeThreshold,
  statusFor,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/evaluation/verdict";
import { suggestNextAction, stageAfter } from "@/lib/evaluation/nextAction";
import { PIPELINE_PHASES, PHASE_LABELS, phaseOf, stagesInPhase } from "@/lib/applications/phase";
import { PIPELINE_STAGES, APPLICATION_STAGES } from "@/lib/applications/stages";

describe("statusFor", () => {
  it("passes at or above the threshold", () => {
    // A "passing score" that does not itself pass would be a strange number.
    expect(statusFor({ score: 7, threshold: 7 })).toBe("pass");
    expect(statusFor({ score: 8, threshold: 7 })).toBe("pass");
  });

  it("fails below the threshold", () => {
    expect(statusFor({ score: 6, threshold: 7 })).toBe("fail");
    expect(statusFor({ score: 0, threshold: 1 })).toBe("fail");
  });

  /**
   * Needs Review is what a MISSING input produces, not a third band between
   * pass and fail. A round with no score, or a stage with no threshold, has not
   * been judged — and rejecting a candidate on the strength of a blank field is
   * the failure mode worth engineering against.
   */
  it("reports Needs Review when either input is missing", () => {
    expect(statusFor({ score: null, threshold: 7 })).toBe("needs_review");
    expect(statusFor({ score: 7, threshold: null })).toBe("needs_review");
    expect(statusFor({ score: null, threshold: null })).toBe("needs_review");
    expect(statusFor({ score: undefined, threshold: undefined })).toBe("needs_review");
  });

  it("does not treat a zero threshold as missing", () => {
    // 0 is falsy but is a real gate: everything passes it.
    expect(statusFor({ score: 0, threshold: 0 })).toBe("pass");
  });

  it("refuses to judge on NaN or Infinity", () => {
    expect(statusFor({ score: NaN, threshold: 5 })).toBe("needs_review");
    expect(statusFor({ score: 5, threshold: Infinity })).toBe("needs_review");
  });

  it("labels and tones every status", () => {
    expect(STATUS_LABELS.needs_review).toBe("Needs Review");
    expect(STATUS_TONE.pass).toBe("success");
    expect(STATUS_TONE.fail).toBe("error");
    expect(STATUS_TONE.needs_review).toBe("warning");
  });
});

describe("normalizeHighlights", () => {
  it("keeps a short list of trimmed items", () => {
    expect(normalizeHighlights(["  Strong AWS production experience ", "5+ years"])).toEqual([
      "Strong AWS production experience",
      "5+ years",
    ]);
  });

  it("accepts a newline blob, because a recruiter types into a textarea", () => {
    expect(normalizeHighlights("First point\nSecond point")).toEqual([
      "First point",
      "Second point",
    ]);
  });

  it("strips a bullet the author typed by hand", () => {
    // The UI draws its own; "• • Strong AWS" is the alternative.
    expect(normalizeHighlights(["- Strong AWS", "• Kubernetes gap", "* Notice too long"])).toEqual([
      "Strong AWS",
      "Kubernetes gap",
      "Notice too long",
    ]);
  });

  it("caps the list and drops duplicates case-insensitively", () => {
    expect(normalizeHighlights(["A", "a", "B", "C", "D", "E", "F"])).toEqual(["A", "B", "C", "D"]);
    expect(normalizeHighlights(["x", "y", "z", "w", "v"])).toHaveLength(MAX_LIST_ITEMS);
  });

  it("ignores anything that is not a list of strings", () => {
    expect(normalizeHighlights(null)).toEqual([]);
    expect(normalizeHighlights(42)).toEqual([]);
    expect(normalizeHighlights([1, 2, {}])).toEqual([]);
  });
});

describe("buildVerdict", () => {
  it("assembles all four parts and keeps the narrative", () => {
    // The lists SUPPLEMENT the summary; removing it was explicitly not wanted.
    const verdict = buildVerdict({
      score: 8,
      threshold: 7,
      summary: "Strong backend fit.",
      strengths: ["Spring Boot depth"],
      concerns: ["No Kubernetes"],
    });

    expect(verdict.status).toBe("pass");
    expect(verdict.summary).toBe("Strong backend fit.");
    expect(verdict.strengths).toEqual(["Spring Boot depth"]);
    expect(verdict.concerns).toEqual(["No Kubernetes"]);
  });

  it("recognises a verdict with nothing in it", () => {
    expect(isEmptyVerdict(buildVerdict({}))).toBe(true);
    expect(isEmptyVerdict(buildVerdict({ score: 5 }))).toBe(false);
    expect(isEmptyVerdict(buildVerdict({ concerns: ["x"] }))).toBe(false);
  });
});

describe("normalizeThreshold", () => {
  it("clamps rather than rejecting", () => {
    // 200 on a 1-10 scale means "nothing passes"; refusing the save would lose
    // the rest of the form.
    expect(normalizeThreshold(200, 10)).toBe(10);
    expect(normalizeThreshold(-5, 10)).toBe(0);
    expect(normalizeThreshold("7", 10)).toBe(7);
  });

  it("treats unparseable input as no gate", () => {
    expect(normalizeThreshold("soon", 10)).toBeNull();
    expect(normalizeThreshold(null, 10)).toBeNull();
  });
});

// -----------------------------------------------------------------------------

const ALL_STAGES = [...PIPELINE_STAGES];

describe("suggestNextAction", () => {
  // The brief's first named test.
  it("suggests stopping when the most recent round failed", () => {
    const action = suggestNextAction({
      currentStage: "ai_screening_call",
      visibleStages: ALL_STAGES,
      lastRoundStatus: "fail",
    });

    expect(action.kind).toBe("stop");
    expect(action.label).toBe("Stop process");
    expect(action.targetStage).toBe("rejected");
  });

  // And its second.
  it("suggests the next ENABLED stage when the round passed", () => {
    const action = suggestNextAction({
      currentStage: "ai_screening_call",
      // This job runs no phone or video round.
      visibleStages: ["applied", "shortlisted", "ai_screening_call", "director_round", "hired"],
      lastRoundStatus: "pass",
    });

    expect(action.kind).toBe("proceed");
    expect(action.label).toBe("Proceed to Director Round");
    expect(action.targetStage).toBe("director_round");
  });

  it("suggests hiring when no rounds remain", () => {
    const action = suggestNextAction({
      currentStage: "director_round",
      visibleStages: ALL_STAGES,
      lastRoundStatus: "pass",
    });

    expect(action.kind).toBe("hire");
    expect(action.targetStage).toBe("hired");
  });

  it("awaits the first round when nothing has been judged", () => {
    const action = suggestNextAction({
      currentStage: "applied",
      visibleStages: ALL_STAGES,
      lastRoundStatus: null,
    });

    expect(action.kind).toBe("awaiting");
    expect(action.label).toContain("Applied");
    expect(action.actionLabel).toBeNull();
  });

  /**
   * Needs Review must not become a direction. It means a score or a threshold
   * is missing, and suggesting "proceed" or "stop" from a blank field is
   * exactly the confident wrongness this product avoids.
   */
  it("suggests no direction when the last round could not be judged", () => {
    const action = suggestNextAction({
      currentStage: "phone_interview",
      visibleStages: ALL_STAGES,
      lastRoundStatus: "needs_review",
    });

    expect(action.kind).toBe("awaiting");
    expect(action.targetStage).toBeNull();
    expect(action.reason).toContain("threshold");
  });

  it("suggests nothing once the application has ended", () => {
    for (const stage of ["hired", "rejected", "withdrawn"] as const) {
      const action = suggestNextAction({
        currentStage: stage,
        visibleStages: ALL_STAGES,
        lastRoundStatus: "pass",
      });
      expect(action.kind, stage).toBe("none");
      expect(action.actionLabel, stage).toBeNull();
    }
  });

  it("never suggests a stage this job switched off", () => {
    const visible = ["applied", "shortlisted", "director_round", "hired"] as const;
    const action = suggestNextAction({
      currentStage: "shortlisted",
      visibleStages: [...visible],
      lastRoundStatus: "pass",
    });
    expect(action.targetStage).toBe("director_round");
  });
});

describe("stageAfter", () => {
  it("returns null at the last round rather than naming Hired", () => {
    // "Proceed to Hired" is the hire suggestion, phrased separately.
    expect(stageAfter("director_round", ALL_STAGES)).toBeNull();
  });

  it("returns null for a stage not in the list", () => {
    // Happens when a job switched off the stage an application sits in.
    expect(stageAfter("video_interview", ["applied", "shortlisted", "hired"])).toBeNull();
  });
});

describe("pipeline phase", () => {
  // The brief's named test: every one of the eight granular stages.
  it("groups each stage into its expected phase", () => {
    expect(phaseOf("applied")).toBe("screening");
    expect(phaseOf("shortlisted")).toBe("screening");
    expect(phaseOf("ai_screening_call")).toBe("screening");

    expect(phaseOf("phone_interview")).toBe("interviewing");
    expect(phaseOf("video_interview")).toBe("interviewing");

    expect(phaseOf("written_assessment")).toBe("final");
    expect(phaseOf("director_round")).toBe("final");

    expect(phaseOf("hired")).toBe("closed");
    expect(phaseOf("rejected")).toBe("closed");
  });

  it("puts withdrawn in Closed with the other endings", () => {
    // Anywhere else would show a finished application in an active phase.
    expect(phaseOf("withdrawn")).toBe("closed");
  });

  it("assigns every stage a phase", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(PIPELINE_PHASES).toContain(phaseOf(stage));
      expect(PHASE_LABELS[phaseOf(stage)], stage).toBeTruthy();
    }
  });

  it("round-trips: every stage appears in its own phase's list", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(stagesInPhase(phaseOf(stage)), stage).toContain(stage);
    }
  });

  it("covers all ten stages across the four phases with no overlap", () => {
    const all = PIPELINE_PHASES.flatMap(stagesInPhase);
    expect(new Set(all).size).toBe(APPLICATION_STAGES.length);
    expect(all).toHaveLength(APPLICATION_STAGES.length);
  });
});
