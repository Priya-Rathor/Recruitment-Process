import { describe, expect, it } from "vitest";
import {
  assessSla,
  AT_RISK_THRESHOLD,
  DEFAULT_SLA_DAYS,
  editableSlaRows,
  parseSlaPayload,
  slaColor,
  targetDaysFor,
  toSlaConfig,
} from "./sla";
import {
  MAX_ITEMS_SENT,
  prioritizePipeline,
  validatePriorities,
  type PipelineItem,
} from "@/lib/ai/prioritizePipeline";
import { isTerminalStage, PIPELINE_STAGES } from "@/lib/applications/stages";

describe("targetDaysFor", () => {
  it("uses the configured value when present", () => {
    expect(targetDaysFor("ai_screening_call", { ai_screening_call: 7 })).toBe(7);
  });

  it("falls back to the default when unconfigured", () => {
    // An absent row means "use the default", never "no SLA" — a board with no
    // aging at all would defeat the module.
    expect(targetDaysFor("ai_screening_call", {})).toBe(DEFAULT_SLA_DAYS.ai_screening_call);
  });

  it("accepts a configured 0 as same-day", () => {
    expect(targetDaysFor("ai_screening_call", { ai_screening_call: 0 })).toBe(0);
  });

  it("returns null for terminal stages", () => {
    for (const stage of ["hired", "rejected", "withdrawn"] as const) {
      expect(targetDaysFor(stage, {})).toBeNull();
    }
  });

  it("has a default for every board stage that is actually aged", () => {
    // `hired` is a board column but terminal — reaching it is the goal, so it
    // has no target and is never aged.
    for (const stage of PIPELINE_STAGES) {
      if (isTerminalStage(stage)) {
        expect(targetDaysFor(stage, {})).toBeNull();
      } else {
        expect(DEFAULT_SLA_DAYS[stage]).toBeGreaterThan(0);
      }
    }
  });
});

describe("assessSla — 'matches the configured target_days per stage'", () => {
  const config = { ai_screening_call: 4 };

  it("is ok well within the target", () => {
    const result = assessSla({ stage: "ai_screening_call", daysInStage: 1, config });
    expect(result.status).toBe("ok");
    expect(result.targetDays).toBe(4);
    expect(result.overdueDays).toBe(0);
  });

  it("becomes at-risk at the threshold", () => {
    // 75% of 4 days is 3.
    const result = assessSla({ stage: "ai_screening_call", daysInStage: 3, config });
    expect(result.status).toBe("at_risk");
    expect(result.label).toMatch(/Due in 1 day/);
  });

  it("is still ok one day before the threshold", () => {
    expect(assessSla({ stage: "ai_screening_call", daysInStage: 2, config }).status).toBe("ok");
  });

  it("is NOT breached exactly at the target", () => {
    // Day 4 of a 4-day target is the last day, not a breach.
    expect(assessSla({ stage: "ai_screening_call", daysInStage: 4, config }).status).toBe("at_risk");
  });

  it("breaches one day past the target", () => {
    const result = assessSla({ stage: "ai_screening_call", daysInStage: 5, config });
    expect(result.status).toBe("breached");
    expect(result.overdueDays).toBe(1);
    expect(result.label).toBe("1 day over");
  });

  it("counts overdue days accurately", () => {
    const result = assessSla({ stage: "ai_screening_call", daysInStage: 12, config });
    expect(result.overdueDays).toBe(8);
    expect(result.label).toBe("8 days over");
  });

  it("honours a same-day target", () => {
    expect(assessSla({ stage: "ai_screening_call", daysInStage: 0, config: { ai_screening_call: 0 } }).status).toBe(
      "ok"
    );
    expect(assessSla({ stage: "ai_screening_call", daysInStage: 1, config: { ai_screening_call: 0 } }).status).toBe(
      "breached"
    );
  });

  it("does NOT age terminal stages", () => {
    // Showing a hired application as "12 days overdue" is noise that trains
    // people to ignore the indicator.
    for (const stage of ["hired", "rejected", "withdrawn"] as const) {
      const result = assessSla({ stage, daysInStage: 500, config: {} });
      expect(result.status).toBe("not_tracked");
      expect(result.overdueDays).toBe(0);
    }
  });

  it("uses only design-token colours, and none when healthy", () => {
    expect(slaColor("breached")).toBe("var(--color-error)");
    expect(slaColor("at_risk")).toBe("var(--color-warning)");
    expect(slaColor("ok")).toBeUndefined();
    expect(slaColor("not_tracked")).toBeUndefined();
  });

  it("respects the documented at-risk threshold", () => {
    expect(AT_RISK_THRESHOLD).toBe(0.75);
  });
});

describe("SLA config parsing", () => {
  it("reads stored rows, ignoring unknown stages", () => {
    expect(
      toSlaConfig([
        { stage: "ai_screening_call", target_days: 5 },
        { stage: "not_a_stage", target_days: 9 },
      ])
    ).toEqual({ ai_screening_call: 5 });
  });

  it("lists every board stage for editing, flagging defaults", () => {
    const rows = editableSlaRows({ ai_screening_call: 9 });
    expect(rows).toHaveLength(PIPELINE_STAGES.length);

    const screening = rows.find((row) => row.stage === "ai_screening_call");
    expect(screening?.targetDays).toBe(9);
    expect(screening?.isDefault).toBe(false);

    const newStage = rows.find((row) => row.stage === "applied");
    expect(newStage?.isDefault).toBe(true);
  });

  it("accepts a valid payload", () => {
    const result = parseSlaPayload({ ai_screening_call: 5, director_round: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual({ ai_screening_call: 5, director_round: 10 });
  });

  it("rejects out-of-range values with a readable message", () => {
    const result = parseSlaPayload({ ai_screening_call: 900 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/AI Screening Call must be between 0 and 365/);
  });

  it("rejects negatives and non-numbers", () => {
    expect(parseSlaPayload({ ai_screening_call: -1 }).ok).toBe(false);
    expect(parseSlaPayload({ ai_screening_call: "soon" }).ok).toBe(false);
  });

  it("ignores keys that are not stages", () => {
    const result = parseSlaPayload({ ai_screening_call: 5, organization_id: "sneaky" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual({ ai_screening_call: 5 });
  });

  it("rejects a payload with nothing usable", () => {
    expect(parseSlaPayload({}).ok).toBe(false);
    expect(parseSlaPayload(null).ok).toBe(false);
  });
});

const items: PipelineItem[] = [
  {
    id: "app-1",
    candidateName: "Rahul Sharma",
    jobTitle: "Senior Java Developer",
    stage: "director_round",
    daysInStage: 9,
    slaStatus: "breached",
    overdueDays: 4,
    matchScore: 89,
    awaitingScreeningReview: false,
  },
  {
    id: "app-2",
    candidateName: "Priya Nair",
    jobTitle: "Data Engineer",
    stage: "shortlisted",
    daysInStage: 1,
    slaStatus: "ok",
    overdueDays: 0,
    matchScore: 72,
    awaitingScreeningReview: true,
  },
];

describe("validatePriorities — the permission-scope gate", () => {
  const allowed = new Set(["app-1", "app-2"]);

  it("accepts priorities drawn from the supplied ids", () => {
    const result = validatePriorities(
      {
        attentionSummary: "Two applications need attention.",
        priorities: [
          { applicationId: "app-1", reason: "Overdue in client review." },
          { applicationId: "app-2", reason: "Screening report awaiting review." },
        ],
      },
      allowed
    );

    expect(result?.priorities).toHaveLength(2);
    expect(result?.priorities[0].rank).toBe(1);
    expect(result?.priorities[1].rank).toBe(2);
  });

  it("DISCARDS an id the caller was never shown", () => {
    // The spec's test: never suggest an action outside the recruiter's scope.
    // An id we didn't supply is either a hallucination or someone else's work.
    const result = validatePriorities(
      {
        attentionSummary: "Summary.",
        priorities: [
          { applicationId: "app-1", reason: "Overdue." },
          { applicationId: "someone-elses-application", reason: "Also overdue." },
        ],
      },
      allowed
    );

    expect(result?.priorities).toHaveLength(1);
    expect(result?.priorities[0].applicationId).toBe("app-1");
  });

  it("discards every id when none were supplied", () => {
    const result = validatePriorities(
      {
        attentionSummary: "Summary.",
        priorities: [{ applicationId: "app-1", reason: "Overdue." }],
      },
      new Set()
    );
    expect(result?.priorities).toEqual([]);
  });

  it("de-duplicates, so one item cannot be inflated", () => {
    const result = validatePriorities(
      {
        attentionSummary: "Summary.",
        priorities: [
          { applicationId: "app-1", reason: "Overdue." },
          { applicationId: "app-1", reason: "Still overdue." },
        ],
      },
      allowed
    );
    expect(result?.priorities).toHaveLength(1);
  });

  it("renumbers ranks after dropping entries", () => {
    const result = validatePriorities(
      {
        attentionSummary: "Summary.",
        priorities: [
          { applicationId: "not-mine", reason: "x" },
          { applicationId: "app-2", reason: "Pending review." },
        ],
      },
      allowed
    );
    expect(result?.priorities[0]).toMatchObject({ applicationId: "app-2", rank: 1 });
  });

  it("drops entries missing a reason", () => {
    const result = validatePriorities(
      {
        attentionSummary: "Summary.",
        priorities: [{ applicationId: "app-1" }, { applicationId: "app-2", reason: "" }],
      },
      allowed
    );
    expect(result?.priorities).toEqual([]);
  });

  it("REJECTS output with no attention summary", () => {
    expect(validatePriorities({ priorities: [] }, allowed)).toBeNull();
    expect(validatePriorities(null, allowed)).toBeNull();
  });

  it("accepts an empty priority list as a real answer", () => {
    const result = validatePriorities(
      { attentionSummary: "Nothing needs attention.", priorities: [] },
      allowed
    );
    expect(result?.priorities).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      applicationId: i % 2 === 0 ? "app-1" : "app-2",
      reason: "x",
    }));
    const result = validatePriorities({ attentionSummary: "s", priorities: many }, allowed);
    // Deduplication leaves at most the two real ids.
    expect(result!.priorities.length).toBeLessThanOrEqual(8);
  });
});

describe("prioritizePipeline", () => {
  it("answers an empty board without calling the provider", async () => {
    const result = await prioritizePipeline([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.priorities).toEqual([]);
      expect(result.data.attentionSummary).toMatch(/empty/i);
    }
  });

  it("caps how much of the board it sends", () => {
    // The question is "what first?", so the most-stalled items answer it.
    // Sending everything would be a database dump, not a question.
    expect(MAX_ITEMS_SENT).toBeLessThanOrEqual(60);
  });

  it("degrades rather than throwing when AI is unavailable", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await prioritizePipeline(items);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");

    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
});
