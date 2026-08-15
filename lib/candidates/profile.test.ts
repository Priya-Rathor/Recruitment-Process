import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  describeEducation,
  describeEmployment,
  normalizeEducation,
  normalizeEmploymentHistory,
} from "@/lib/candidates/profile";
import { outcomeOf, OUTCOME_LABELS, OUTCOME_TONE } from "@/lib/candidates/applicationHistoryView";

describe("normalizeEducation", () => {
  it("keeps a complete entry", () => {
    expect(
      normalizeEducation([
        { degree: "B.Tech Computer Science", institution: "Delhi Technological University", year: "2019" },
      ])
    ).toEqual([
      { degree: "B.Tech Computer Science", institution: "Delhi Technological University", year: "2019" },
    ]);
  });

  /**
   * Forgiving on purpose. The caller is a form someone has been typing into: a
   * qualification with no year is still worth keeping, and rejecting the save
   * would lose the other six rows they filled in.
   */
  it("keeps a partial entry, filling the gaps with null", () => {
    expect(normalizeEducation([{ institution: "IIT Delhi" }])).toEqual([
      { degree: null, institution: "IIT Delhi", year: null },
    ]);
  });

  it("drops an entirely blank row", () => {
    // A blank row is an accidental Add, not a record.
    expect(normalizeEducation([{ degree: "", institution: "   ", year: null }])).toEqual([]);
    expect(normalizeEducation([{}])).toEqual([]);
  });

  it("trims and ignores unknown keys", () => {
    expect(normalizeEducation([{ degree: "  MSc  ", nonsense: "x", __proto__: { bad: 1 } }])).toEqual([
      { degree: "MSc", institution: null, year: null },
    ]);
  });

  it("ignores non-string values rather than stringifying them", () => {
    // `42` becoming "42" would silently invent a year nobody typed.
    expect(normalizeEducation([{ degree: "BA", year: 2019 }])).toEqual([
      { degree: "BA", institution: null, year: null },
    ]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ degree: `Degree ${i}` }));
    expect(normalizeEducation(many)).toHaveLength(MAX_ENTRIES);
  });

  it("returns an empty array for anything that is not a list", () => {
    for (const junk of [null, undefined, "text", 42, {}]) {
      expect(normalizeEducation(junk), String(junk)).toEqual([]);
    }
  });
});

describe("normalizeEmploymentHistory", () => {
  it("keeps company, role and duration", () => {
    expect(
      normalizeEmploymentHistory([
        { company: "Infosys", role: "Senior Java Developer", duration: "2022 – present" },
      ])
    ).toEqual([{ company: "Infosys", role: "Senior Java Developer", duration: "2022 – present" }]);
  });

  it("drops blank rows and keeps partial ones", () => {
    expect(
      normalizeEmploymentHistory([{ company: "Wipro" }, { company: "", role: "", duration: "" }])
    ).toEqual([{ company: "Wipro", role: null, duration: null }]);
  });
});

describe("descriptions", () => {
  it("reads as a sentence when everything is present", () => {
    expect(
      describeEducation({ degree: "B.Tech", institution: "DTU", year: "2019" })
    ).toBe("B.Tech — DTU (2019)");
    expect(
      describeEmployment({ company: "Infosys", role: "Developer", duration: "3 years" })
    ).toBe("Developer at Infosys · 3 years");
  });

  it("degrades without inventing punctuation around missing parts", () => {
    expect(describeEducation({ degree: "B.Tech", institution: null, year: null })).toBe("B.Tech");
    expect(describeEmployment({ company: "Infosys", role: null, duration: null })).toBe("Infosys");
    expect(describeEmployment({ company: null, role: "Developer", duration: null })).toBe("Developer");
  });

  it("never renders an empty string", () => {
    expect(describeEducation({ degree: null, institution: null, year: null })).toBe(
      "Untitled qualification"
    );
    expect(describeEmployment({ company: null, role: null, duration: null })).toBe("Untitled role");
  });
});

describe("application outcome", () => {
  it("reports in-progress for a live stage", () => {
    expect(outcomeOf("phone_interview", null)).toEqual({ kind: "in_progress" });
  });

  it("reports a hire", () => {
    expect(outcomeOf("hired", null)).toEqual({ kind: "hired", at: null });
  });

  /**
   * The reason rejected_at_stage exists: someone turned down on their CV and
   * someone turned down after a director round are not the same story about a
   * candidate, and "Rejected" alone cannot tell them apart.
   */
  it("carries the stage a rejection came from", () => {
    expect(outcomeOf("rejected", "director_round")).toEqual({
      kind: "rejected",
      fromStage: "director_round",
    });
  });

  it("copes with a rejection whose stage was never recorded", () => {
    expect(outcomeOf("rejected", null)).toEqual({ kind: "rejected", fromStage: null });
  });

  it("labels and tones every outcome", () => {
    for (const kind of ["in_progress", "hired", "rejected", "withdrawn"] as const) {
      expect(OUTCOME_LABELS[kind], kind).toBeTruthy();
      expect(OUTCOME_TONE[kind], kind).toBeTruthy();
    }
    expect(OUTCOME_TONE.hired).toBe("success");
    expect(OUTCOME_TONE.rejected).toBe("error");
  });
});
