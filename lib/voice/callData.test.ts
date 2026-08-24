import { describe, expect, it } from "vitest";
import {
  CALL_DATA_LIMITS,
  callDataToRecord,
  normalizeCallDataKey,
  normalizeDefaultCallData,
  resolveCallDataPrecedence,
  resolveEffectiveCallData,
  resolveEffectiveQuestions,
  type JobScreeningOverrides,
  type OrgCallDataContext,
} from "@/lib/voice/callData";

// -----------------------------------------------------------------------------
// Fixtures. Written out rather than generated, so a test that changes behaviour
// changes visibly.
// -----------------------------------------------------------------------------

const org: OrgCallDataContext = {
  callData: {
    fields: [
      { key: "company_name", value: "Webbee Global" },
      { key: "recruiter_signoff_name", value: "Priya" },
    ],
    fallbackQuestions: ["What is your notice period?", "Are you open to hybrid work?"],
  },
  orgLanguage: "en",
  orgMaxAttempts: 3,
  agentSystemPrompt: "Ask the configured questions in order.",
  agentCompanyName: "Webbee Global",
};

const bareJob: JobScreeningOverrides = {
  jobId: "job-1",
  jobTitle: "Senior Java Developer",
  screeningEnabled: true,
  questions: [],
  language: null,
  maxAttempts: null,
  promptTemplate: null,
  clientName: null,
};

const rowFor = (rows: ReturnType<typeof resolveCallDataPrecedence>, key: string) => {
  const row = rows.find((entry) => entry.key === key);
  if (!row) throw new Error(`no precedence row for ${key}`);
  return row;
};

describe("call data keys", () => {
  it("normalises to snake_case so one field cannot arrive three ways", () => {
    expect(normalizeCallDataKey("Company Name")).toBe("company_name");
    expect(normalizeCallDataKey("companyName")).toBe("companyname");
    expect(normalizeCallDataKey("  recruiter-signoff name  ")).toBe("recruiter_signoff_name");
  });

  it("rejects a key that normalises to nothing", () => {
    expect(normalizeCallDataKey("   ")).toBeNull();
    expect(normalizeCallDataKey("!!!")).toBeNull();
    expect(normalizeCallDataKey(42)).toBeNull();
  });
});

describe("normalizeDefaultCallData", () => {
  it("survives anything, because a browser can write this column directly", () => {
    expect(normalizeDefaultCallData(null)).toEqual({ fields: [], fallbackQuestions: [] });
    expect(normalizeDefaultCallData("nonsense")).toEqual({ fields: [], fallbackQuestions: [] });
    expect(normalizeDefaultCallData({ fields: "not a list" })).toEqual({
      fields: [],
      fallbackQuestions: [],
    });
  });

  it("keeps the FIRST of two duplicate keys, so the visible one wins", () => {
    const result = normalizeDefaultCallData({
      fields: [
        { key: "company_name", value: "First" },
        { key: "Company Name", value: "Second" },
      ],
    });

    expect(result.fields).toEqual([{ key: "company_name", value: "First" }]);
  });

  it("caps both lists rather than storing a syllabus", () => {
    const result = normalizeDefaultCallData({
      fields: Array.from({ length: 60 }, (_, i) => ({ key: `field_${i}`, value: "x" })),
      fallbackQuestions: Array.from({ length: 40 }, (_, i) => `Question ${i}?`),
    });

    expect(result.fields).toHaveLength(CALL_DATA_LIMITS.fieldCount);
    expect(result.fallbackQuestions).toHaveLength(CALL_DATA_LIMITS.questionCount);
  });

  it("drops blank questions instead of asking a candidate nothing", () => {
    const result = normalizeDefaultCallData({
      fallbackQuestions: ["Real question?", "   ", ""],
    });
    expect(result.fallbackQuestions).toEqual(["Real question?"]);
  });
});

// -----------------------------------------------------------------------------
// THE RULE THIS MODULE EXISTS FOR.
// -----------------------------------------------------------------------------
describe("precedence — a job's own settings always win", () => {
  it("uses the org fallback questions when the job has none", () => {
    const rows = resolveCallDataPrecedence({ org, job: bareJob });
    const questions = rowFor(rows, "screening_questions");

    expect(questions.source).toBe("organization");
    expect(questions.jobOverride).toBeNull();
    expect(questions.effective).toContain("2 questions");
  });

  it("uses the job's own questions when it has any, and does NOT merge", () => {
    const rows = resolveCallDataPrecedence({
      org,
      job: { ...bareJob, questions: ["Tell me about your Spring Boot work."] },
    });
    const questions = rowFor(rows, "screening_questions");

    expect(questions.source).toBe("job");
    expect(questions.effective).toContain("1 question");
    // The org's two questions are still SHOWN as the default — the admin needs to
    // see what was overridden — but they are not the effective value.
    expect(questions.orgDefault).toContain("2 questions");
    expect(questions.effective).not.toContain("2 questions");
  });

  it("lets a job's language and attempt count override the organization's", () => {
    const rows = resolveCallDataPrecedence({
      org,
      job: { ...bareJob, language: "hi", maxAttempts: 5 },
    });

    expect(rowFor(rows, "language").effective).toBe("hi");
    expect(rowFor(rows, "language").source).toBe("job");
    expect(rowFor(rows, "max_call_attempts").effective).toBe("5");
    expect(rowFor(rows, "max_call_attempts").source).toBe("job");
  });

  it("falls back to the organization when the job set neither", () => {
    const rows = resolveCallDataPrecedence({ org, job: bareJob });

    expect(rowFor(rows, "language").effective).toBe("en");
    expect(rowFor(rows, "language").source).toBe("organization");
    expect(rowFor(rows, "max_call_attempts").effective).toBe("3");
  });

  it("prefers the job's client name for company_name — an Acme role says Acme", () => {
    const rows = resolveCallDataPrecedence({
      org,
      job: { ...bareJob, clientName: "Acme Financial" },
    });
    const company = rowFor(rows, "company_name");

    expect(company.effective).toBe("Acme Financial");
    expect(company.source).toBe("job");
    expect(company.orgDefault).toBe("Webbee Global");
  });

  it("falls back to the agent's company name when no call-data field sets one", () => {
    const rows = resolveCallDataPrecedence({
      org: { ...org, callData: { fields: [], fallbackQuestions: [] } },
      job: bareJob,
    });

    expect(rowFor(rows, "company_name").effective).toBe("Webbee Global");
    expect(rowFor(rows, "company_name").source).toBe("organization");
  });

  it("marks a value nothing has set as unset rather than as an empty default", () => {
    const rows = resolveCallDataPrecedence({
      org: {
        ...org,
        callData: { fields: [], fallbackQuestions: [] },
        agentCompanyName: null,
        agentSystemPrompt: "",
      },
      job: bareJob,
    });

    expect(rowFor(rows, "company_name").source).toBe("unset");
    expect(rowFor(rows, "company_name").effective).toBeNull();
    expect(rowFor(rows, "call_briefing").source).toBe("unset");
  });

  it("shows a custom org field as organization-only, with no phantom override", () => {
    const rows = resolveCallDataPrecedence({ org, job: bareJob });
    const signoff = rowFor(rows, "recruiter_signoff_name");

    expect(signoff.orgDefault).toBe("Priya");
    expect(signoff.jobOverride).toBeNull();
    expect(signoff.source).toBe("organization");
    expect(signoff.note).toContain("no per-job equivalent");
  });

  it("does not duplicate a reserved key into the custom-field rows", () => {
    const rows = resolveCallDataPrecedence({ org, job: bareJob });
    const companyRows = rows.filter((row) => row.key === "company_name");
    expect(companyRows).toHaveLength(1);
  });
});

describe("resolveEffectiveQuestions", () => {
  it("returns the job's list and says so", () => {
    expect(
      resolveEffectiveQuestions({ jobQuestions: ["A?"], fallbackQuestions: ["B?", "C?"] })
    ).toEqual({ questions: ["A?"], source: "job" });
  });

  it("falls back to the org list only when the job has none", () => {
    expect(
      resolveEffectiveQuestions({ jobQuestions: [], fallbackQuestions: ["B?"] })
    ).toEqual({ questions: ["B?"], source: "organization" });
  });

  it("treats a list of blanks as no list at all", () => {
    // Otherwise a job with one empty question would beat a real org fallback and
    // the call would open, disclose, and end.
    expect(
      resolveEffectiveQuestions({ jobQuestions: ["  ", ""], fallbackQuestions: ["B?"] })
    ).toEqual({ questions: ["B?"], source: "organization" });
  });

  it("reports unset when neither side has anything — the caller must refuse", () => {
    expect(resolveEffectiveQuestions({ jobQuestions: [], fallbackQuestions: [] })).toEqual({
      questions: [],
      source: "unset",
    });
  });
});

describe("resolveEffectiveCallData", () => {
  it("carries the effective values, not the org defaults they replaced", () => {
    const context = resolveEffectiveCallData({
      org,
      job: { ...bareJob, clientName: "Acme Financial", language: "hi" },
    });

    expect(context.company_name).toBe("Acme Financial");
    expect(context.language).toBe("hi");
    expect(context.recruiter_signoff_name).toBe("Priya");
  });

  it("omits the structured fields, which travel on the payload proper", () => {
    const context = resolveEffectiveCallData({ org, job: bareJob });
    expect(context).not.toHaveProperty("screening_questions");
    expect(context).not.toHaveProperty("call_briefing");
  });

  it("omits an unset value rather than sending an empty string", () => {
    // An agent told `company_name: ""` says the empty string out loud.
    const context = resolveEffectiveCallData({
      org: {
        ...org,
        callData: { fields: [], fallbackQuestions: [] },
        agentCompanyName: null,
      },
      job: bareJob,
    });

    expect(context).not.toHaveProperty("company_name");
  });
});

describe("callDataToRecord", () => {
  it("flattens the pairs", () => {
    expect(callDataToRecord(org.callData)).toEqual({
      company_name: "Webbee Global",
      recruiter_signoff_name: "Priya",
    });
  });
});
