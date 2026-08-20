import { describe, expect, it } from "vitest";
import { evaluationsComplete } from "@/lib/applications/evaluations";
import type { ConfigurableStage } from "@/lib/applications/stages";

// =============================================================================
// Module 13's `evaluations_complete` trigger rests entirely on this function, and
// the trigger can ADVANCE somebody's application. So the tests here are mostly
// about the ways "complete" could be wrong in a candidate's favour or against it.
// =============================================================================

const ENABLED: ConfigurableStage[] = ["phone_interview", "video_interview"];

const entry = (stage: string, outcome: "pass" | "fail" | "pending") =>
  ({ stage, outcome }) as Parameters<typeof evaluationsComplete>[0]["entries"][number];

describe("evaluationsComplete", () => {
  it("is not complete when nothing has been logged", () => {
    // Vacuous truth here would advance every fresh application on the first sweep.
    const result = evaluationsComplete({
      entries: [],
      enabledStages: ENABLED,
      currentStage: "video_interview",
    });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain("No evaluations");
  });

  it("is not complete while any outcome is still pending", () => {
    // `pending` means the interview happened but nobody reached a verdict.
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "pass"), entry("video_interview", "pending")],
      enabledStages: ENABLED,
      currentStage: "director_round",
    });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain("pending");
  });

  it("is not complete when an earlier enabled stage has no entry at all", () => {
    // The subtle one: an application at Director Round with only a phone-interview
    // write-up would otherwise read as complete, because nothing is pending.
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "pass")],
      enabledStages: ENABLED,
      currentStage: "director_round",
    });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain("video_interview");
  });

  it("is complete once every earlier enabled stage has a decided entry", () => {
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "pass"), entry("video_interview", "fail")],
      enabledStages: ENABLED,
      currentStage: "director_round",
    });

    expect(result.complete).toBe(true);
  });

  it("does not wait for a stage the application has not reached yet", () => {
    // A candidate who has just arrived at Video Interview has not had it. Requiring
    // it would mean the trigger never fires.
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "pass")],
      enabledStages: ENABLED,
      currentStage: "video_interview",
    });

    expect(result.complete).toBe(true);
  });

  it("does not wait for a stage this job has switched off", () => {
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "pass")],
      enabledStages: ["phone_interview"],
      currentStage: "director_round",
    });

    expect(result.complete).toBe(true);
  });

  it("treats a terminal stage as complete on whatever was logged", () => {
    // Nothing further is expected of an application that has left the pipeline, and
    // holding the trigger open on a rejected candidate would keep a rule armed
    // against somebody who is no longer in process.
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "fail")],
      enabledStages: ENABLED,
      currentStage: "rejected",
    });

    expect(result.complete).toBe(true);
  });

  it("counts a fail as decided, not as incomplete", () => {
    // A rule may well want to act on a fail. Treating it as "not yet complete"
    // would make failure invisible to automation.
    const result = evaluationsComplete({
      entries: [entry("phone_interview", "fail")],
      enabledStages: ["phone_interview"],
      currentStage: "phone_interview",
    });

    expect(result.complete).toBe(true);
  });
});
