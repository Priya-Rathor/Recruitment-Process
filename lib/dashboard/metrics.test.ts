import { describe, expect, it } from "vitest";
import {
  availableMetrics,
  buildAttentionItems,
  canViewOrganizationWide,
  isMissingRelation,
  OVERDUE_DAYS,
  scopeForRole,
  type AttentionSourceRow,
  type MetricKey,
  type MetricResult,
} from "./metrics";

const NOW = new Date("2026-08-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("isMissingRelation — decides 'pending' vs. a real failure", () => {
  it("treats Postgres undefined_table as missing", () => {
    expect(isMissingRelation({ code: "42P01", message: 'relation "candidates" does not exist' })).toBe(
      true
    );
  });

  it("treats PostgREST schema-cache misses as missing", () => {
    expect(
      isMissingRelation({
        code: "PGRST205",
        message: "Could not find the table 'public.interviews' in the schema cache",
      })
    ).toBe(true);
    expect(isMissingRelation({ code: "PGRST200", message: "relationship does not exist" })).toBe(true);
  });

  it("matches on message alone when no code is supplied", () => {
    expect(isMissingRelation({ message: 'relation "automation_runs" does not exist' })).toBe(true);
  });

  it("does NOT swallow a permission error as 'not built yet'", () => {
    // Critical: an RLS denial must surface as an error, never as a pending tile —
    // otherwise a tenant-isolation bug would look like an unbuilt module.
    expect(
      isMissingRelation({ code: "42501", message: "permission denied for table applications" })
    ).toBe(false);
  });

  it("does NOT swallow other genuine failures", () => {
    expect(isMissingRelation({ code: "57014", message: "canceling statement due to timeout" })).toBe(
      false
    );
    expect(isMissingRelation({ code: "22P02", message: "invalid input syntax for type uuid" })).toBe(
      false
    );
    expect(isMissingRelation(null)).toBe(false);
  });
});

describe("scopeForRole — spec section 9", () => {
  it("limits a Recruiter to their own workload", () => {
    expect(scopeForRole("recruiter")).toBe("own");
  });

  it("gives Owner, Admin and Viewer the organization-wide view", () => {
    expect(scopeForRole("owner")).toBe("organization");
    expect(scopeForRole("admin")).toBe("organization");
    // Viewer is "Yes (read-only)" for the org-wide dashboard.
    expect(scopeForRole("viewer")).toBe("organization");
  });

  it("agrees with canViewOrganizationWide for every role", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      expect(canViewOrganizationWide(role)).toBe(true);
      expect(scopeForRole(role)).toBe("organization");
    }
    expect(canViewOrganizationWide("recruiter")).toBe(false);
    expect(scopeForRole("recruiter")).toBe("own");
  });
});

describe("buildAttentionItems", () => {
  it("excludes anything below the overdue threshold", () => {
    const rows: AttentionSourceRow[] = [
      { id: "fresh", stage: "New", updated_at: daysAgo(0) },
      { id: "recent", stage: "Screening", updated_at: daysAgo(OVERDUE_DAYS - 1) },
    ];
    expect(buildAttentionItems(rows, NOW)).toEqual([]);
  });

  it("includes an item exactly at the threshold", () => {
    const rows: AttentionSourceRow[] = [
      { id: "a", stage: "Screening", updated_at: daysAgo(OVERDUE_DAYS) },
    ];
    expect(buildAttentionItems(rows, NOW)).toHaveLength(1);
  });

  it("sorts most urgent first regardless of input order", () => {
    const rows: AttentionSourceRow[] = [
      { id: "mid", stage: "Screening", updated_at: daysAgo(5) },
      { id: "worst", stage: "Client Review", updated_at: daysAgo(12) },
      { id: "least", stage: "New", updated_at: daysAgo(3) },
    ];
    expect(buildAttentionItems(rows, NOW).map((item) => item.id)).toEqual([
      "worst",
      "mid",
      "least",
    ]);
  });

  it("escalates severity from warning to error at twice the threshold", () => {
    const rows: AttentionSourceRow[] = [
      { id: "warn", stage: "Screening", updated_at: daysAgo(OVERDUE_DAYS) },
      { id: "err", stage: "Screening", updated_at: daysAgo(OVERDUE_DAYS * 2) },
    ];
    const items = buildAttentionItems(rows, NOW);
    expect(items.find((i) => i.id === "warn")?.severity).toBe("warning");
    expect(items.find((i) => i.id === "err")?.severity).toBe("error");
  });

  it("explains WHY something is overdue, naming the stage's target", () => {
    // More useful than raw age: 4 days is fine in Client Review and late in
    // Recruiter Review, and the recruiter should be able to see which.
    const items = buildAttentionItems(
      [{ id: "b", stage: "shortlisted", updated_at: daysAgo(4) }],
      NOW,
      { shortlisted: 2 }
    );
    expect(items[0].detail).toBe("2 days past the 2-day target for this stage");
  });

  it("falls back for an unrecognised stage rather than dropping the row", () => {
    // A stage we don't know is still work that has been sitting.
    const items = buildAttentionItems(
      [{ id: "b", stage: "SomeOldStage", updated_at: daysAgo(4) }],
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0].detail).toMatch(/past the 3-day target/);
  });

  it("RETROFIT: uses the per-stage SLA, so the same age differs by stage", () => {
    const config = { director_round: 5, shortlisted: 2 };
    const rows = [
      { id: "slow-stage", stage: "director_round", updated_at: daysAgo(4) },
      { id: "fast-stage", stage: "shortlisted", updated_at: daysAgo(4) },
    ];

    const items = buildAttentionItems(rows, NOW, config);

    // 4 days in Client Review is within its 5-day target — not flagged.
    expect(items.map((item) => item.id)).toEqual(["fast-stage"]);
  });

  it("RETROFIT: honours a configured target over the default", () => {
    const rows = [{ id: "a", stage: "ai_screening_call", updated_at: daysAgo(4) }];

    // Default for screening is 3, so 4 days is overdue.
    expect(buildAttentionItems(rows, NOW)).toHaveLength(1);
    // Configured to 10, the same row is fine.
    expect(buildAttentionItems(rows, NOW, { ai_screening_call: 10 })).toEqual([]);
  });

  it("never flags a terminal stage as overdue", () => {
    const rows = [
      { id: "hired", stage: "hired", updated_at: daysAgo(400) },
      { id: "rejected", stage: "rejected", updated_at: daysAgo(400) },
    ];
    expect(buildAttentionItems(rows, NOW)).toEqual([]);
  });

  it("labels a null stage as the first pipeline stage, not 'null'", () => {
    const items = buildAttentionItems([{ id: "a", stage: null, updated_at: daysAgo(4) }], NOW);
    // "Applied" since the stage rename; the point of the test is that a null
    // never reaches the UI as the word "null".
    expect(items[0].title).toBe("Application in Applied");
  });

  it("handles an empty source list", () => {
    expect(buildAttentionItems([], NOW)).toEqual([]);
  });
});

describe("availableMetrics — what the AI brief is allowed to see", () => {
  const metrics: Record<MetricKey, MetricResult> = {
    newCandidates: { status: "ok", value: 42 },
    screeningsCompleted: { status: "ok", value: 0 },
    interviewsToday: { status: "pending", module: 11 },
    overdueApplications: { status: "error" },
    failedCalls: { status: "ok", value: 3 },
    failedAutomations: { status: "pending", module: 13 },
  };

  it("passes through only resolved metrics", () => {
    expect(availableMetrics(metrics)).toEqual({
      newCandidates: 42,
      screeningsCompleted: 0,
      failedCalls: 3,
    });
  });

  it("omits pending and errored metrics entirely rather than sending 0", () => {
    // If these leaked through as 0, the brief could state "0 interviews today"
    // when the truth is "interviews are not visible yet" — a false claim.
    const result = availableMetrics(metrics);
    expect(result).not.toHaveProperty("interviewsToday");
    expect(result).not.toHaveProperty("overdueApplications");
    expect(result).not.toHaveProperty("failedAutomations");
  });

  it("keeps a genuine zero, which is a real and reportable figure", () => {
    expect(availableMetrics(metrics).screeningsCompleted).toBe(0);
  });
});
