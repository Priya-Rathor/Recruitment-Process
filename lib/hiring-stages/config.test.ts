import { describe, expect, it } from "vitest";
import {
  MAX_CALL_ATTEMPTS,
  MAX_DURATION_MINUTES,
  MAX_PROMPT_LENGTH,
  MIN_CALL_ATTEMPTS,
  emptyStageConfig,
  normalizePromptTemplate,
  normalizeStageConfig,
  parseStagesPayload,
} from "@/lib/hiring-stages/config";
import { STAGES, STAGE_KEYS, isStageKey, stageDefinition } from "@/lib/hiring-stages/catalog";

describe("the stage catalogue", () => {
  it("has exactly the four stages the spec names, in order", () => {
    expect(STAGE_KEYS).toEqual([
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
    ]);
    expect(STAGES.map((s) => s.label)).toEqual([
      "AI Screening Call",
      "Phone Interview",
      "Video Interview",
      "Written Assessment",
    ]);
  });

  /**
   * The honesty check. Only the screening call has an engine; the other three
   * are configuration-only, and the UI reads THIS to decide whether to show
   * "Not yet active". If someone marks one live without wiring an engine, this
   * fails rather than the product quietly promising something it cannot do.
   */
  it("marks exactly one stage as live, and names its engine", () => {
    const live = STAGES.filter((s) => s.execution === "live");
    expect(live.map((s) => s.key)).toEqual(["ai_screening_call"]);
    expect(live[0].engine).toContain("Bolna");

    for (const stage of STAGES.filter((s) => s.execution === "configuration_only")) {
      expect(stage.engine, stage.key).toBeNull();
    }
  });

  it("gives every stage a one-line description", () => {
    for (const stage of STAGES) {
      expect(stage.description.length, stage.key).toBeGreaterThan(10);
      expect(stageDefinition(stage.key)).toBe(stage);
    }
  });

  it("rejects a key that is not a stage", () => {
    expect(isStageKey("ai_screening_call")).toBe(true);
    expect(isStageKey("coffee_chat")).toBe(false);
    expect(isStageKey(null)).toBe(false);
  });
});

describe("normalizeStageConfig", () => {
  it("gives each stage only its own fields", () => {
    expect(normalizeStageConfig("ai_screening_call", {})).toEqual({
      maxAttempts: null,
      language: null,
      passingScore: null,
    });
    expect(normalizeStageConfig("phone_interview", {})).toEqual({
      durationMinutes: null,
      questions: [],
      passingScore: null,
    });
    expect(normalizeStageConfig("video_interview", {})).toEqual({
      durationMinutes: null,
      questions: [],
      whatToEvaluate: null,
      passingScore: null,
    });
    expect(normalizeStageConfig("written_assessment", {})).toEqual({
      questions: [],
      timeLimitMinutes: null,
      passingScore: null,
    });
  });

  /**
   * The screening stage must NOT carry its own question list — the spec forbids
   * a second one, and a copy here would be a source of truth Module 8 never
   * reads, so the call would ask one set while the screen displayed another.
   */
  it("drops a questions list smuggled into the screening config", () => {
    const config = normalizeStageConfig("ai_screening_call", {
      questions: ["this should not be stored here"],
      maxAttempts: 2,
    });
    expect(config).not.toHaveProperty("questions");
    expect(config).toEqual({ maxAttempts: 2, language: null, passingScore: null });
  });

  it("drops unknown keys rather than storing them", () => {
    const config = normalizeStageConfig("written_assessment", {
      questions: ["Q1"],
      timeLimitMinutes: 60,
      evilFlag: true,
      __proto__: { polluted: true },
    });
    expect(config).toEqual({ questions: ["Q1"], timeLimitMinutes: 60, passingScore: null });
  });

  it("clamps numbers instead of rejecting the whole save", () => {
    // A recruiter typing 600 means "a long time". Refusing would lose the rest
    // of the form they just filled in.
    expect(normalizeStageConfig("written_assessment", { timeLimitMinutes: 9999 })).toEqual({
      questions: [],
      timeLimitMinutes: MAX_DURATION_MINUTES,
      passingScore: null,
    });
    expect(normalizeStageConfig("ai_screening_call", { maxAttempts: 99 }).maxAttempts).toBe(
      MAX_CALL_ATTEMPTS
    );
    expect(normalizeStageConfig("ai_screening_call", { maxAttempts: 0 }).maxAttempts).toBe(
      MIN_CALL_ATTEMPTS
    );
  });

  it("accepts numeric strings, which is what an <input type=number> yields", () => {
    expect(normalizeStageConfig("phone_interview", { durationMinutes: "45" }).durationMinutes).toBe(45);
  });

  it("treats unparseable numbers as unset rather than zero", () => {
    // Zero would mean "no time limit at all" — a different claim entirely.
    expect(normalizeStageConfig("phone_interview", { durationMinutes: "soon" }).durationMinutes).toBeNull();
    expect(normalizeStageConfig("phone_interview", { durationMinutes: null }).durationMinutes).toBeNull();
  });

  it("trims and drops blank list items", () => {
    const config = normalizeStageConfig("written_assessment", {
      questions: ["  Real question  ", "", "   ", 42, null, "Another"],
    });
    expect(config).toEqual({
      questions: ["Real question", "Another"],
      timeLimitMinutes: null,
      passingScore: null,
    });
  });

  it("caps list length", () => {
    const config = normalizeStageConfig("phone_interview", {
      questions: Array.from({ length: 100 }, (_, i) => `Q${i}`),
    });
    expect((config as { questions: string[] }).questions).toHaveLength(25);
  });

  it("carries a passing threshold on every stage", () => {
    // The brief described this as an existing "passing_score pattern built for
    // Written Assessment". No stage had one — it is added to all four here, so
    // the four-part verdict means the same thing everywhere.
    for (const key of STAGE_KEYS) {
      expect(normalizeStageConfig(key, { passingScore: 7 }), key).toMatchObject({
        passingScore: 7,
      });
      expect(normalizeStageConfig(key, {}), key).toMatchObject({ passingScore: null });
    }
  });

  it("clamps a threshold to the round score scale", () => {
    expect(normalizeStageConfig("phone_interview", { passingScore: 99 }).passingScore).toBe(10);
    expect(normalizeStageConfig("phone_interview", { passingScore: -3 }).passingScore).toBe(0);
  });

  it("survives rubbish input without throwing", () => {
    for (const junk of [null, undefined, "a string", 42, []]) {
      expect(() => normalizeStageConfig("video_interview", junk)).not.toThrow();
    }
  });

  it("emptyStageConfig matches what the normaliser produces for {}", () => {
    for (const key of STAGE_KEYS) {
      expect(emptyStageConfig(key), key).toEqual(normalizeStageConfig(key, {}));
    }
  });
});

describe("normalizePromptTemplate", () => {
  it("trims, and treats blank as unset", () => {
    expect(normalizePromptTemplate("  hello  ")).toBe("hello");
    expect(normalizePromptTemplate("   ")).toBeNull();
    expect(normalizePromptTemplate("")).toBeNull();
    expect(normalizePromptTemplate(null)).toBeNull();
    expect(normalizePromptTemplate(42)).toBeNull();
  });

  it("caps a runaway script", () => {
    expect(normalizePromptTemplate("x".repeat(20_000))).toHaveLength(MAX_PROMPT_LENGTH);
  });
});

describe("parseStagesPayload", () => {
  it("accepts a partial list, so one stage can be saved alone", () => {
    const result = parseStagesPayload({
      stages: [{ stage_key: "phone_interview", enabled: true, prompt_template: "Call them." }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toEqual({
      stageKey: "phone_interview",
      enabled: true,
      promptTemplate: "Call them.",
      config: { durationMinutes: null, questions: [], passingScore: null },
    });
  });

  it("treats anything other than true as disabled", () => {
    const result = parseStagesPayload({
      stages: [{ stage_key: "video_interview", enabled: "yes" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages[0].enabled).toBe(false);
  });

  it("refuses a duplicated stage", () => {
    // Two entries for one stage would make the result depend on which the
    // database happened to apply last.
    const result = parseStagesPayload({
      stages: [
        { stage_key: "phone_interview", enabled: true },
        { stage_key: "phone_interview", enabled: false },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown stage key", () => {
    expect(parseStagesPayload({ stages: [{ stage_key: "coffee_chat" }] }).ok).toBe(false);
  });

  it("refuses a malformed body", () => {
    expect(parseStagesPayload(null).ok).toBe(false);
    expect(parseStagesPayload({}).ok).toBe(false);
    expect(parseStagesPayload({ stages: "all of them" }).ok).toBe(false);
    expect(parseStagesPayload({ stages: [null] }).ok).toBe(false);
  });

  it("refuses more entries than there are stages", () => {
    const result = parseStagesPayload({
      stages: Array.from({ length: 9 }, () => ({ stage_key: "phone_interview" })),
    });
    expect(result.ok).toBe(false);
  });

  it("preserves a script on a DISABLED stage", () => {
    // The spec: toggling off must not discard the configuration, so a disabled
    // stage still carries its prompt through the parser to the database.
    const result = parseStagesPayload({
      stages: [
        {
          stage_key: "written_assessment",
          enabled: false,
          prompt_template: "Keep me.",
          config: { timeLimitMinutes: 90 },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages[0].promptTemplate).toBe("Keep me.");
    expect(result.stages[0].config).toEqual({
      questions: [],
      timeLimitMinutes: 90,
      passingScore: null,
    });
  });
});
