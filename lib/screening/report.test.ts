import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  checkReportEligibility,
  extractionToReportValues,
  fieldsNeedingAttention,
  isPendingReview,
  parseCorrections,
  type ReportValues,
} from "./report";
import {
  findUngroundedFigures,
  numbersIn,
  type ScreeningExtraction,
} from "@/lib/ai/generateScreeningSummary";

const goodTranscript =
  "Agent: This is an automated call and may be recorded. Is it alright to carry on? " +
  "Candidate: Yes that's fine. " +
  "Agent: What is your expected CTC? Candidate: Around 19 LPA. " +
  "Agent: And your notice period? Candidate: 30 days. " +
  "Agent: Are you comfortable with the Gurgaon hybrid model? Candidate: Yes.";

describe("checkReportEligibility — the consent gate", () => {
  it("REFUSES a call with no recorded consent, even with a perfect transcript", () => {
    // Module 8 promised the candidate the recording was for recruiter review.
    // Without confirmation, the recording is not ours to process.
    const result = checkReportEligibility({
      status: "completed",
      transcript: goodTranscript,
      consentConfirmed: false,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.code).toBe("no_consent");
      expect(result.reason).toMatch(/consent/i);
    }
  });

  it("checks consent BEFORE anything else", () => {
    // A call that fails on several counts should still name consent first —
    // it is the reason that matters legally.
    const result = checkReportEligibility({
      status: "failed",
      transcript: null,
      consentConfirmed: false,
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("no_consent");
  });

  it("refuses a call that did not complete", () => {
    for (const status of ["no_answer", "busy", "failed", "cancelled"]) {
      const result = checkReportEligibility({
        status,
        transcript: goodTranscript,
        consentConfirmed: true,
      });
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.code).toBe("not_completed");
    }
  });

  it("refuses an empty or trivial transcript rather than summarising nothing", () => {
    for (const transcript of [null, "", "   ", "Hello?"]) {
      const result = checkReportEligibility({
        status: "completed",
        transcript,
        consentConfirmed: true,
      });
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.code).toBe("no_transcript");
    }
  });

  it("allows a completed, consented call with a real transcript", () => {
    expect(
      checkReportEligibility({
        status: "completed",
        transcript: goodTranscript,
        consentConfirmed: true,
      })
    ).toEqual({ eligible: true });
  });
});

describe("findUngroundedFigures — the narrative cannot contradict the fields", () => {
  const extraction = { expectedCtc: 1_900_000, noticePeriodDays: 30 };

  it("accepts a summary whose figures came from the call", () => {
    const summary = "Expects 19 LPA and has a 30 day notice period.";
    expect(findUngroundedFigures(summary, goodTranscript, extraction)).toEqual([]);
  });

  it("REJECTS a figure that contradicts the extracted field", () => {
    // The exact failure that would put "45 days" next to a field saying 30.
    const summary = "Has a 45 day notice period.";
    expect(findUngroundedFigures(summary, goodTranscript, extraction)).toContain(45);
  });

  it("accepts the lakh rendering of an annual figure", () => {
    // 1900000 written as "19 LPA" is correct, not invented.
    expect(findUngroundedFigures("Expects 19 LPA.", "", extraction)).toEqual([]);
  });

  it("accepts months where the field is a multiple of 30 days", () => {
    expect(
      findUngroundedFigures("Notice is 1 month.", "", { expectedCtc: null, noticePeriodDays: 30 })
    ).toEqual([]);
  });

  it("accepts any number actually spoken in the transcript", () => {
    const transcript = "Candidate: I have 7 years of experience.";
    expect(
      findUngroundedFigures("Has 7 years of experience.", transcript, {
        expectedCtc: null,
        noticePeriodDays: null,
      })
    ).toEqual([]);
  });

  it("REJECTS an invented figure absent from both sources", () => {
    expect(
      findUngroundedFigures("Interviewed 4 times previously.", goodTranscript, extraction)
    ).toContain(4);
  });

  it("does not split a thousands separator into false offenders", () => {
    expect(
      findUngroundedFigures("Expects 1,900,000 annually.", "", extraction)
    ).toEqual([]);
  });
});

describe("numbersIn", () => {
  it("finds integers and decimals", () => {
    expect([...numbersIn("30 days, 5.5 years")].sort((a, b) => a - b)).toEqual([5.5, 30]);
  });

  it("handles text with no numbers", () => {
    expect([...numbersIn("no figures here")]).toEqual([]);
  });
});

const aiOriginal: ReportValues = {
  summary_text: "Rahul expects 19 LPA with a 30 day notice period and accepts the Gurgaon hybrid model.",
  interest_level: "high",
  expected_ctc: 1_900_000,
  notice_period_days: 30,
  location_accepted: "accepted",
  availability_notes: "Weekdays after 5 PM",
};

describe("applyCorrections — corrections stay distinguishable from AI output", () => {
  it("records a changed field as corrected", () => {
    const result = applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { expected_ctc: 2_000_000 },
    });

    expect(result.updates).toEqual({ expected_ctc: 2_000_000 });
    expect(result.correctedFields).toEqual(["expected_ctc"]);
  });

  it("writes nothing when the correction matches the current value", () => {
    const result = applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { expected_ctc: 1_900_000 },
    });
    expect(result.updates).toEqual({});
    expect(result.correctedFields).toEqual([]);
  });

  it("REMOVES a field from corrected when reverted to the AI value", () => {
    // corrected_fields answers "does this differ from what the model said?",
    // so reverting must un-flag it.
    const corrected: ReportValues = { ...aiOriginal, expected_ctc: 2_000_000 };
    const result = applyCorrections({
      aiOriginal,
      current: corrected,
      corrections: { expected_ctc: 1_900_000 },
    });

    expect(result.updates).toEqual({ expected_ctc: 1_900_000 });
    expect(result.correctedFields).toEqual([]);
  });

  it("keeps earlier corrections listed when a new one is made", () => {
    const corrected: ReportValues = { ...aiOriginal, interest_level: "medium" };
    const result = applyCorrections({
      aiOriginal,
      current: corrected,
      corrections: { notice_period_days: 60 },
    });

    expect(result.correctedFields.sort()).toEqual(["interest_level", "notice_period_days"]);
  });

  it("treats clearing a field as a correction", () => {
    const result = applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { expected_ctc: null },
    });
    expect(result.updates).toEqual({ expected_ctc: null });
    expect(result.correctedFields).toEqual(["expected_ctc"]);
  });

  it("treats 0 notice as a real correction, not a clear", () => {
    const result = applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { notice_period_days: 0 },
    });
    expect(result.updates.notice_period_days).toBe(0);
    expect(result.correctedFields).toEqual(["notice_period_days"]);
  });

  it("ignores whitespace-only text changes", () => {
    const result = applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { availability_notes: "  Weekdays after 5 PM  " },
    });
    expect(result.updates).toEqual({});
  });

  it("does not mutate its inputs", () => {
    applyCorrections({
      aiOriginal,
      current: aiOriginal,
      corrections: { interest_level: "low" },
    });
    expect(aiOriginal.interest_level).toBe("high");
  });
});

describe("parseCorrections", () => {
  it("keeps only recognised fields", () => {
    expect(
      parseCorrections({
        interest_level: "medium",
        organization_id: "sneaky",
        reviewed_by: "someone-else",
        ai_summary_text: "rewritten",
      })
    ).toEqual({ interest_level: "medium" });
  });

  it("rejects an invalid enum value", () => {
    expect(parseCorrections({ interest_level: "very high" })).toEqual({});
    expect(parseCorrections({ location_accepted: "maybe" })).toEqual({});
  });

  it("accepts 0 notice period", () => {
    expect(parseCorrections({ notice_period_days: 0 })).toEqual({ notice_period_days: 0 });
  });

  it("rejects out-of-range and negative numbers", () => {
    expect(parseCorrections({ notice_period_days: 5000 })).toEqual({});
    expect(parseCorrections({ expected_ctc: -1 })).toEqual({});
  });

  it("allows clearing optional fields", () => {
    expect(parseCorrections({ expected_ctc: null })).toEqual({ expected_ctc: null });
    expect(parseCorrections({ availability_notes: "" })).toEqual({ availability_notes: null });
  });

  it("rejects an empty summary rather than blanking it", () => {
    expect(parseCorrections({ summary_text: "   " })).toEqual({});
  });

  it("returns nothing for a malformed body", () => {
    expect(parseCorrections(null)).toEqual({});
    expect(parseCorrections("interest_level=high")).toEqual({});
  });
});

describe("review state", () => {
  it("treats an unreviewed report as pending", () => {
    expect(isPendingReview({ reviewed_at: null })).toBe(true);
    expect(isPendingReview({ reviewed_at: "2026-08-14T10:00:00Z" })).toBe(false);
  });

  it("surfaces uncertain fields the recruiter hasn't addressed yet", () => {
    expect(
      fieldsNeedingAttention({
        uncertain_fields: ["expected_ctc", "notice_period_days"],
        corrected_fields: ["expected_ctc"],
      })
    ).toEqual(["notice_period_days"]);
  });

  it("returns nothing when every uncertain field has been corrected", () => {
    expect(
      fieldsNeedingAttention({
        uncertain_fields: ["expected_ctc"],
        corrected_fields: ["expected_ctc"],
      })
    ).toEqual([]);
  });
});

describe("extractionToReportValues", () => {
  it("maps an extraction onto the row's initial state", () => {
    const extraction: ScreeningExtraction = {
      summaryText: "Summary.",
      interestLevel: "high",
      expectedCtc: 1_900_000,
      noticePeriodDays: 30,
      locationAccepted: "accepted",
      availabilityNotes: "Evenings",
      uncertainFields: [],
    };

    expect(extractionToReportValues(extraction)).toEqual({
      summary_text: "Summary.",
      interest_level: "high",
      expected_ctc: 1_900_000,
      notice_period_days: 30,
      location_accepted: "accepted",
      availability_notes: "Evenings",
    });
  });
});
