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
  it("has exactly the stages the spec names, in order", () => {
    // Resume Score leads: it happens to a candidate before any of the four
    // steps below it, and it is not one of them — see `kind`.
    expect(STAGE_KEYS).toEqual([
      "resume_score",
      "ai_screening_call",
      "phone_interview",
      "video_interview",
      "written_assessment",
    ]);
    expect(STAGES.map((s) => s.label)).toEqual([
      "Resume Score",
      "AI Screening Call",
      "Phone Interview",
      "Video Interview",
      "Written Assessment",
    ]);
  });

  /**
   * The distinction the UI copy rests on. A `scoring` row's switch chooses
   * WHOSE RULES apply, not whether anything happens — if this ever flipped to
   * "pipeline", the row would start telling recruiters that switching it off
   * stops resumes being scored, which is false.
   */
  it("marks resume scoring as scoring, and every real step as pipeline", () => {
    expect(STAGES.filter((s) => s.kind === "scoring").map((s) => s.key)).toEqual(["resume_score"]);
    for (const stage of STAGES.filter((s) => s.key !== "resume_score")) {
      expect(stage.kind, stage.key).toBe("pipeline");
    }
  });

  /**
   * The honesty check. Three stages are wired to something that really runs —
   * resume scoring to the matcher, the screening call to Bolna, and the written
   * assessment to Module 20's live coding rounds — and the other two are
   * configuration-only. The UI reads THIS to decide whether to show "Not yet
   * active", so marking a stage live without wiring an engine fails here rather
   * than quietly promising something the product cannot do.
   */
  it("only calls a stage live when it names the engine behind it", () => {
    const live = STAGES.filter((s) => s.execution === "live");
    expect(live.map((s) => s.key)).toEqual([
      "resume_score",
      "ai_screening_call",
      "written_assessment",
    ]);
    for (const stage of live) {
      expect(stage.engine, stage.key).toBeTruthy();
    }

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

describe("the resume score config", () => {
  it("treats the pass mark as a percentage, not a 1-10 round score", () => {
    // 70 is a legitimate match percentage; on the other four stages the same
    // number would be clamped to 10, which is exactly why they are separate.
    expect(normalizeStageConfig("resume_score", { passingScore: 70 }).passingScore).toBe(70);
    expect(normalizeStageConfig("resume_score", { passingScore: 250 }).passingScore).toBe(100);
    expect(normalizeStageConfig("phone_interview", { passingScore: 70 }).passingScore).toBe(10);
  });

  it("starts every value null, so an untouched row scores as the platform default", () => {
    expect(emptyStageConfig("resume_score")).toEqual({
      passingScore: null,
      weights: null,
      semanticWeightPercent: null,
    });
  });

  it("accepts a full set of weights and clamps each one", () => {
    const config = normalizeStageConfig("resume_score", {
      weights: { skills: 60, experience: 20, salary: 10, location: 5, notice: 500 },
    });
    expect(config.weights).toEqual({
      skills: 60,
      experience: 20,
      salary: 10,
      location: 5,
      notice: 100,
    });
  });

  it("rejects a PARTIAL set of weights rather than inventing the rest", () => {
    // The four unnamed components have no honest value here: keeping their
    // defaults beside one changed number silently rebalances the score.
    expect(normalizeStageConfig("resume_score", { weights: { skills: 60 } }).weights).toBeNull();
    expect(
      normalizeStageConfig("resume_score", { weights: { skills: -1, experience: 1, salary: 1, location: 1, notice: 1 } })
        .weights
    ).toBeNull();
  });

  it("falls back to defaults when every weight is zero", () => {
    // Otherwise the deterministic half would divide by a total weight of zero.
    const config = normalizeStageConfig("resume_score", {
      weights: { skills: 0, experience: 0, salary: 0, location: 0, notice: 0 },
    });
    expect(config.weights).toBeNull();
  });

  it("keeps a deliberate zero AI share, which is not the same as blank", () => {
    // 0 means "score on facts alone"; null means "use the platform default".
    expect(
      normalizeStageConfig("resume_score", { semanticWeightPercent: 0 }).semanticWeightPercent
    ).toBe(0);
    expect(
      normalizeStageConfig("resume_score", { semanticWeightPercent: "nonsense" })
        .semanticWeightPercent
    ).toBeNull();
    expect(
      normalizeStageConfig("resume_score", { semanticWeightPercent: 900 }).semanticWeightPercent
    ).toBe(100);
  });

  it("accepts all five stages in one payload now that there are five", () => {
    const result = parseStagesPayload({
      stages: STAGE_KEYS.map((key) => ({ stage_key: key, enabled: false, config: {} })),
    });
    expect(result.ok).toBe(true);
  });
});
