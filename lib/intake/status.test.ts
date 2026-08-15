import { describe, expect, it } from "vitest";
import {
  INTAKE_STATUSES,
  INTAKE_TONE,
  isIntakeStatus,
  isTerminal,
  summarize,
  summaryLine,
  type IntakeStatus,
} from "@/lib/intake/status";

describe("summarize", () => {
  it("counts each outcome and leaves in-flight files pending", () => {
    const summary = summarize([
      "candidate_created",
      "candidate_created",
      "candidate_matched",
      "already_applied",
      "match_conflict",
      "failed",
      "processing",
      "queued",
    ]);

    expect(summary).toEqual({
      processed: 6,
      created: 2,
      matched: 1,
      alreadyApplied: 1,
      conflicts: 1,
      failed: 1,
      pending: 2,
    });
  });

  it("counts nothing for an empty batch", () => {
    expect(summarize([])).toEqual({
      processed: 0,
      created: 0,
      matched: 0,
      alreadyApplied: 0,
      conflicts: 0,
      failed: 0,
      pending: 0,
    });
  });
});

describe("summaryLine", () => {
  // The spec's example sentence, exactly.
  it("produces the spec's sentence", () => {
    const statuses: IntakeStatus[] = [
      ...Array<IntakeStatus>(8).fill("candidate_created"),
      ...Array<IntakeStatus>(3).fill("candidate_matched"),
      "failed",
    ];
    expect(summaryLine(summarize(statuses))).toBe(
      "12 processed — 8 new candidates, 3 matched to existing candidates, 1 failed."
    );
  });

  it("drops zero-valued clauses instead of printing them", () => {
    const line = summaryLine(summarize(["candidate_created", "candidate_created"]));
    expect(line).toBe("2 processed — 2 new candidates.");
    expect(line).not.toContain("0");
  });

  it("returns null while nothing has finished", () => {
    // "0 processed" would be read as a result. It is not one.
    expect(summaryLine(summarize(["queued", "processing"]))).toBeNull();
  });

  it("uses singular forms for one of each", () => {
    expect(summaryLine(summarize(["candidate_created"]))).toBe("1 processed — 1 new candidate.");
    expect(summaryLine(summarize(["candidate_matched"]))).toBe(
      "1 processed — 1 matched to an existing candidate."
    );
    expect(summaryLine(summarize(["match_conflict"]))).toBe("1 processed — 1 needs review.");
  });

  it("reports already-applied separately from matched", () => {
    // These are different facts: one added an application, one did not.
    const line = summaryLine(summarize(["candidate_matched", "already_applied"]));
    expect(line).toContain("1 matched to an existing candidate");
    expect(line).toContain("1 already applied");
  });
});

describe("status vocabulary", () => {
  it("has a tone for every status", () => {
    for (const status of INTAKE_STATUSES) {
      expect(INTAKE_TONE[status], status).toBeDefined();
    }
  });

  it("treats only queued and processing as non-terminal", () => {
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("processing")).toBe(false);
    for (const status of INTAKE_STATUSES) {
      if (status === "queued" || status === "processing") continue;
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it("keeps already_applied neutral rather than a warning", () => {
    // Nothing went wrong: the candidate is already in this pipeline, which is
    // the correct outcome of uploading the same resume twice.
    expect(INTAKE_TONE.already_applied).toBe("neutral");
  });

  it("recognises only known statuses", () => {
    expect(isIntakeStatus("candidate_created")).toBe(true);
    expect(isIntakeStatus("exploded")).toBe(false);
    expect(isIntakeStatus(null)).toBe(false);
  });
});
