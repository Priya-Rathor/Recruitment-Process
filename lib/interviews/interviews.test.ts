import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DUE_HOURS,
  feedbackReminderState,
  overdueFeedback,
  parseFeedback,
  parseSchedulePayload,
  type InterviewForReminder,
} from "./feedback";
import {
  allowedBriefNumbers,
  findVerdictLanguage,
  generateInterviewBrief,
  type InterviewBriefInput,
} from "@/lib/ai/generateInterviewBrief";

const NOW = new Date("2026-08-14T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const base: InterviewForReminder = {
  id: "i1",
  scheduledAt: hoursAgo(30),
  durationMinutes: 60,
  status: "scheduled",
  hasFeedback: false,
};

describe("feedbackReminderState — 'only when feedback is missing'", () => {
  it("is due once the delay has passed with no feedback", () => {
    const state = feedbackReminderState({ interview: base, now: NOW });
    expect(state.due).toBe(true);
    // Ended 29h ago, due after 24h.
    if (state.due) expect(state.hoursOverdue).toBe(5);
  });

  it("is NOT due when feedback has been submitted", () => {
    const state = feedbackReminderState({
      interview: { ...base, hasFeedback: true },
      now: NOW,
    });
    expect(state.due).toBe(false);
    if (!state.due) expect(state.reason).toBe("feedback_submitted");
  });

  it("is NOT due for a cancelled interview", () => {
    // Chasing feedback on a cancelled interview is worse than not chasing.
    const state = feedbackReminderState({
      interview: { ...base, status: "cancelled" },
      now: NOW,
    });
    expect(state.due).toBe(false);
    if (!state.due) expect(state.reason).toBe("cancelled");
  });

  it("is NOT due for a no-show — there is nothing to give feedback on", () => {
    const state = feedbackReminderState({
      interview: { ...base, status: "no_show" },
      now: NOW,
    });
    expect(state.due).toBe(false);
  });

  it("is NOT due before the interview has finished", () => {
    const state = feedbackReminderState({
      interview: { ...base, scheduledAt: new Date(NOW.getTime() + 3_600_000).toISOString() },
      now: NOW,
    });
    expect(state.due).toBe(false);
    if (!state.due) expect(state.reason).toBe("not_finished");
  });

  it("accounts for duration when deciding if it has finished", () => {
    // Started 30 minutes ago, runs for 60 — still in progress.
    const state = feedbackReminderState({
      interview: { ...base, scheduledAt: hoursAgo(0.5), durationMinutes: 60 },
      now: NOW,
    });
    expect(state.due).toBe(false);
    if (!state.due) expect(state.reason).toBe("not_finished");
  });

  it("is NOT due one hour before the delay elapses", () => {
    const state = feedbackReminderState({
      interview: { ...base, scheduledAt: hoursAgo(24) },
      now: NOW,
    });
    // Ended 23h ago; the delay is 24h.
    expect(state.due).toBe(false);
    if (!state.due) expect(state.reason).toBe("too_soon");
  });

  it("fires exactly at the configured delay", () => {
    const state = feedbackReminderState({
      interview: { ...base, scheduledAt: hoursAgo(25) },
      now: NOW,
    });
    expect(state.due).toBe(true);
  });

  it("honours a custom delay", () => {
    const interview = { ...base, scheduledAt: hoursAgo(5) };
    expect(feedbackReminderState({ interview, now: NOW, dueHours: 2 }).due).toBe(true);
    expect(feedbackReminderState({ interview, now: NOW, dueHours: 48 }).due).toBe(false);
  });

  it("tolerates an unparseable date rather than throwing", () => {
    const state = feedbackReminderState({
      interview: { ...base, scheduledAt: "not a date" },
      now: NOW,
    });
    expect(state.due).toBe(false);
  });

  it("uses a short default delay", () => {
    // Recollection decays fast; feedback three days later is measurably worse.
    expect(FEEDBACK_DUE_HOURS).toBeLessThanOrEqual(24);
  });
});

describe("overdueFeedback", () => {
  it("returns only genuinely overdue interviews, most overdue first", () => {
    const result = overdueFeedback({
      interviews: [
        { ...base, id: "recent", scheduledAt: hoursAgo(26) },
        { ...base, id: "ancient", scheduledAt: hoursAgo(200) },
        { ...base, id: "done", hasFeedback: true },
        { ...base, id: "upcoming", scheduledAt: new Date(NOW.getTime() + 7_200_000).toISOString() },
      ],
      now: NOW,
    });

    expect(result.map((entry) => entry.interview.id)).toEqual(["ancient", "recent"]);
  });

  it("returns nothing when everything has feedback", () => {
    expect(
      overdueFeedback({ interviews: [{ ...base, hasFeedback: true }], now: NOW })
    ).toEqual([]);
  });
});

describe("parseFeedback", () => {
  it("accepts a valid submission", () => {
    const result = parseFeedback({ rating: 4, recommendation: "yes", notes: "Solid on Spring." });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rating).toBe(4);
  });

  it("requires a rating in range", () => {
    for (const rating of [0, 6, -1, 2.5, "four"]) {
      const result = parseFeedback({ rating, recommendation: "yes" });
      expect(result.ok).toBe(false);
    }
  });

  it("requires a recommendation", () => {
    const result = parseFeedback({ rating: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/recommendation/i);
  });

  it("rejects an unknown recommendation", () => {
    expect(parseFeedback({ rating: 4, recommendation: "maybe" }).ok).toBe(false);
  });

  it("treats blank notes as absent", () => {
    const result = parseFeedback({ rating: 3, recommendation: "no", notes: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.notes).toBeNull();
  });

  it("ignores fields it does not own", () => {
    const result = parseFeedback({
      rating: 4,
      recommendation: "yes",
      submitted_by: "someone-else",
      organization_id: "sneaky",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data).sort()).toEqual([
      "notes",
      "rating",
      "recommendation",
    ]);
  });
});

describe("parseSchedulePayload", () => {
  it("accepts a valid schedule", () => {
    const result = parseSchedulePayload({
      scheduled_at: "2026-08-20T10:00:00Z",
      duration_minutes: 45,
      mode: "video",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.durationMinutes).toBe(45);
      expect(result.data.mode).toBe("video");
    }
  });

  it("defaults duration and mode sensibly", () => {
    const result = parseSchedulePayload({ scheduled_at: "2026-08-20T10:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.durationMinutes).toBe(60);
      expect(result.data.mode).toBe("video");
    }
  });

  it("rejects a missing or invalid date", () => {
    expect(parseSchedulePayload({}).ok).toBe(false);
    expect(parseSchedulePayload({ scheduled_at: "soon" }).ok).toBe(false);
  });

  it("rejects an implausible duration", () => {
    expect(parseSchedulePayload({ scheduled_at: "2026-08-20T10:00:00Z", duration_minutes: 0 }).ok).toBe(false);
    expect(parseSchedulePayload({ scheduled_at: "2026-08-20T10:00:00Z", duration_minutes: 900 }).ok).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(
      parseSchedulePayload({ scheduled_at: "2026-08-20T10:00:00Z", mode: "telepathy" }).ok
    ).toBe(false);
  });

  it("allows scheduling in the past, for recording an interview that happened", () => {
    expect(parseSchedulePayload({ scheduled_at: "2020-01-01T10:00:00Z" }).ok).toBe(true);
  });
});

describe("findVerdictLanguage — 'AI prepares, it does not evaluate'", () => {
  it("passes a genuine preparation brief", () => {
    const text =
      "Rahul has five years of Java and Spring Boot experience. Verify Kubernetes depth and " +
      "whether he has owned a production system end to end.";
    expect(findVerdictLanguage(text)).toEqual([]);
  });

  it("CATCHES a hire verdict", () => {
    expect(findVerdictLanguage("This is a strong hire.").length).toBeGreaterThan(0);
    expect(findVerdictLanguage("I would recommend to hire.").length).toBeGreaterThan(0);
    expect(findVerdictLanguage("Do not hire.").length).toBeGreaterThan(0);
  });

  it("CATCHES a fit judgement", () => {
    expect(findVerdictLanguage("Not a good fit for this role.").length).toBeGreaterThan(0);
    expect(findVerdictLanguage("A perfect candidate.").length).toBeGreaterThan(0);
  });

  it("CATCHES an overall score", () => {
    expect(findVerdictLanguage("Overall assessment: promising.").length).toBeGreaterThan(0);
    expect(findVerdictLanguage("Overall rating is high.").length).toBeGreaterThan(0);
  });

  it("does not flag ordinary preparation wording", () => {
    // The brief must be able to talk about strengths without being a verdict.
    for (const text of [
      "Strong areas: Java, Spring Boot, AWS.",
      "Ask how he approached scaling a Spring Boot service.",
      "Verify depth of Kubernetes experience.",
      "He rates his own SQL as intermediate.",
    ]) {
      expect(findVerdictLanguage(text)).toEqual([]);
    }
  });
});

describe("allowedBriefNumbers", () => {
  const input: InterviewBriefInput = {
    candidateName: "Rahul Sharma",
    jobTitle: "Senior Java Developer",
    strengths: ["Java", "Spring Boot"],
    toVerify: ["Kubernetes depth"],
    currentRole: "Software Engineer",
    currentCompany: "Infosys",
    totalExperienceYears: 5,
    expectedCtc: 1_900_000,
    noticePeriodDays: 30,
    screeningSummary: "Comfortable with the Gurgaon hybrid model.",
    existingQuestions: [],
  };

  it("permits the supplied figures", () => {
    const allowed = allowedBriefNumbers(input);
    expect(allowed.has(5)).toBe(true);
    expect(allowed.has(30)).toBe(true);
    expect(allowed.has(1_900_000)).toBe(true);
  });

  it("permits the lakh and month renderings", () => {
    const allowed = allowedBriefNumbers(input);
    expect(allowed.has(19)).toBe(true); // 19 LPA
    expect(allowed.has(1)).toBe(true); // 1 month
  });

  it("permits figures already stated in the supplied text", () => {
    const allowed = allowedBriefNumbers({
      ...input,
      toVerify: ["Has 7 years of team leadership"],
    });
    expect(allowed.has(7)).toBe(true);
  });

  it("does not permit a figure that was never supplied", () => {
    expect(allowedBriefNumbers(input).has(42)).toBe(false);
  });
});

describe("generateInterviewBrief", () => {
  it("refuses when there is nothing to brief from", async () => {
    // Better than producing a generic template that looks informed.
    const result = await generateInterviewBrief({
      candidateName: "Rahul Sharma",
      jobTitle: "Senior Java Developer",
      strengths: [],
      toVerify: [],
      currentRole: null,
      currentCompany: null,
      totalExperienceYears: null,
      expectedCtc: null,
      noticePeriodDays: null,
      screeningSummary: null,
      existingQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/nothing to brief from/i);
  });

  it("degrades rather than throwing when AI is unavailable", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await generateInterviewBrief({
      candidateName: "Rahul Sharma",
      jobTitle: "Senior Java Developer",
      strengths: ["Java"],
      toVerify: ["Kubernetes"],
      currentRole: null,
      currentCompany: null,
      totalExperienceYears: null,
      expectedCtc: null,
      noticePeriodDays: null,
      screeningSummary: null,
      existingQuestions: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");

    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
});
