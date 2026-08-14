import { describe, expect, it } from "vitest";
import {
  computeClientStats,
  computeTurnaround,
  describeTurnaround,
  overdueFeedbackRequests,
  type FeedbackEvent,
} from "./sla";
import {
  allowedSubmissionNumbers,
  findUnsupportedSkills,
  generateClientSubmission,
  summarizeClientActivity,
  type SubmissionFacts,
} from "@/lib/ai/generateClientSubmission";

const NOW = new Date("2026-08-14T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("computeTurnaround — 'matches requested_at/responded_at exactly'", () => {
  it("computes a closed event from the two timestamps alone", () => {
    // No dependence on `now`: the answer must be reproducible and auditable.
    const event: FeedbackEvent = {
      id: "e1",
      requestedAt: "2026-08-01T09:00:00Z",
      respondedAt: "2026-08-03T09:00:00Z",
    };

    const early = computeTurnaround({ event, slaDays: 3, now: new Date("2026-08-04T00:00:00Z") });
    const late = computeTurnaround({ event, slaDays: 3, now: new Date("2027-01-01T00:00:00Z") });

    expect(early).toEqual(late);
    expect(early.days).toBe(2);
    expect(early.hours).toBe(48);
  });

  it("marks a same-day response as on time", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: "2026-08-01T09:00:00Z", respondedAt: "2026-08-01T17:00:00Z" },
      slaDays: 3,
    });
    expect(result.status).toBe("responded_on_time");
    expect(result.days).toBe(0);
  });

  it("is on time exactly at the SLA", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: daysAgo(6), respondedAt: daysAgo(3) },
      slaDays: 3,
      now: NOW,
    });
    expect(result.status).toBe("responded_on_time");
    expect(result.overdueDays).toBe(0);
  });

  it("marks a response one day past the SLA as late", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: daysAgo(8), respondedAt: daysAgo(4) },
      slaDays: 3,
      now: NOW,
    });
    expect(result.status).toBe("responded_late");
    expect(result.overdueDays).toBe(1);
  });

  it("reports an unanswered request within SLA as waiting", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: daysAgo(2), respondedAt: null },
      slaDays: 3,
      now: NOW,
    });
    expect(result.status).toBe("waiting");
  });

  it("reports an unanswered request past SLA as overdue", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: daysAgo(9), respondedAt: null },
      slaDays: 3,
      now: NOW,
    });
    expect(result.status).toBe("overdue");
    expect(result.overdueDays).toBe(6);
  });

  it("clamps bad data rather than reporting negative time", () => {
    const result = computeTurnaround({
      event: { id: "e", requestedAt: daysAgo(2), respondedAt: daysAgo(5) },
      slaDays: 3,
      now: NOW,
    });
    expect(result.hours).toBe(0);
  });

  it("tolerates an unparseable timestamp", () => {
    expect(
      computeTurnaround({ event: { id: "e", requestedAt: "nope", respondedAt: null }, slaDays: 3 })
        .status
    ).toBe("waiting");
  });
});

describe("computeClientStats", () => {
  const events: FeedbackEvent[] = [
    { id: "a", requestedAt: daysAgo(20), respondedAt: daysAgo(18) }, // 2 days, on time
    { id: "b", requestedAt: daysAgo(15), respondedAt: daysAgo(9) }, // 6 days, late
    { id: "c", requestedAt: daysAgo(2), respondedAt: null }, // waiting
    { id: "d", requestedAt: daysAgo(10), respondedAt: null }, // overdue
  ];

  const stats = computeClientStats({ events, slaDays: 3, now: NOW });

  it("counts each category", () => {
    expect(stats.totalSubmissions).toBe(4);
    expect(stats.responded).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.overdue).toBe(1);
  });

  it("averages over RESPONDED events only", () => {
    // Mixing "took 2 days" with "hasn't answered yet" is not an average of
    // anything.
    expect(stats.averageResponseDays).toBe(4);
  });

  it("reports a median as well, which one slow client cannot distort", () => {
    expect(stats.medianResponseDays).toBe(4);
  });

  it("computes an on-time rate over responded events", () => {
    expect(stats.onTimeRate).toBe(50);
  });

  it("returns null rather than 0 when nothing has been responded to", () => {
    // 0% and "no data" mean very different things to an account manager.
    const empty = computeClientStats({
      events: [{ id: "x", requestedAt: daysAgo(1), respondedAt: null }],
      slaDays: 3,
      now: NOW,
    });
    expect(empty.averageResponseDays).toBeNull();
    expect(empty.medianResponseDays).toBeNull();
    expect(empty.onTimeRate).toBeNull();
  });

  it("handles a client with no submissions at all", () => {
    const empty = computeClientStats({ events: [], slaDays: 3, now: NOW });
    expect(empty.totalSubmissions).toBe(0);
    expect(empty.onTimeRate).toBeNull();
  });
});

describe("overdueFeedbackRequests", () => {
  it("returns only overdue open requests, most overdue first", () => {
    const result = overdueFeedbackRequests({
      events: [
        { id: "recent", requestedAt: daysAgo(1), respondedAt: null },
        { id: "old", requestedAt: daysAgo(20), respondedAt: null },
        { id: "middling", requestedAt: daysAgo(8), respondedAt: null },
        { id: "answered", requestedAt: daysAgo(30), respondedAt: daysAgo(29) },
      ],
      slaDays: 3,
      now: NOW,
    });

    expect(result.map((entry) => entry.event.id)).toEqual(["old", "middling"]);
  });
});

describe("describeTurnaround", () => {
  it("reads naturally in each state", () => {
    expect(describeTurnaround({ status: "responded_on_time", hours: 4, days: 0, overdueDays: 0 })).toBe(
      "Responded same day"
    );
    expect(describeTurnaround({ status: "responded_on_time", hours: 48, days: 2, overdueDays: 0 })).toBe(
      "Responded in 2 days"
    );
    expect(describeTurnaround({ status: "responded_late", hours: 120, days: 5, overdueDays: 2 })).toBe(
      "Responded in 5 days — 2 days over"
    );
    expect(describeTurnaround({ status: "overdue", hours: 240, days: 10, overdueDays: 7 })).toBe(
      "Waiting 10 days — 7 days over"
    );
  });
});

const facts: SubmissionFacts = {
  candidateName: "Rahul Sharma",
  jobTitle: "Senior Java Developer",
  clientName: "ABC Tech",
  currentRole: "Software Engineer",
  currentCompany: "Infosys",
  totalExperienceYears: 5.4,
  skills: ["Java", "Spring Boot", "AWS"],
  location: "Gurgaon",
  workMode: "hybrid",
  expectedSalary: 1_900_000,
  noticePeriodDays: 30,
  screeningSummary: "Comfortable with the Gurgaon hybrid model.",
  strengths: ["Production AWS exposure"],
};

describe("findUnsupportedSkills — the claim that would embarrass a client", () => {
  it("accepts skills the candidate actually has", () => {
    const text = "Rahul has production experience with Java, Spring Boot and AWS.";
    expect(findUnsupportedSkills(text, facts.skills)).toEqual([]);
  });

  it("CATCHES a technology the record does not contain", () => {
    // The candidate would be asked about Kubernetes in an interview they were
    // set up to fail.
    expect(findUnsupportedSkills("Strong Kubernetes and Terraform background.", facts.skills)).toEqual(
      expect.arrayContaining(["Kubernetes", "Terraform"])
    );
  });

  it("licenses the parts of a multi-word skill", () => {
    // "Spring Boot" on the record should permit "Spring" in prose.
    expect(findUnsupportedSkills("Deep Spring experience.", ["Spring Boot"])).toEqual([]);
  });

  it("is case-insensitive about matching the record", () => {
    expect(findUnsupportedSkills("Uses AWS daily.", ["aws"])).toEqual([]);
  });

  it("does not police ordinary prose", () => {
    const text =
      "Rahul is a backend engineer based in Gurgaon who can work hybrid and has a 30-day notice period.";
    expect(findUnsupportedSkills(text, facts.skills)).toEqual([]);
  });

  it("catches a skill named only in a highlight", () => {
    expect(findUnsupportedSkills("Built pipelines in Kafka", facts.skills)).toEqual(["Kafka"]);
  });
});

describe("allowedSubmissionNumbers", () => {
  it("permits the supplied figures and their normal renderings", () => {
    const allowed = allowedSubmissionNumbers(facts);
    expect(allowed.has(5.4)).toBe(true);
    expect(allowed.has(5)).toBe(true); // "5 years"
    expect(allowed.has(30)).toBe(true);
    expect(allowed.has(1)).toBe(true); // "1 month"
    expect(allowed.has(19)).toBe(true); // "19 LPA"
  });

  it("does NOT permit a rounded-up experience figure", () => {
    // Rounding 5.4 up to 8 is the invention that matters; 6 is also not ours
    // to claim.
    const allowed = allowedSubmissionNumbers(facts);
    expect(allowed.has(8)).toBe(false);
    expect(allowed.has(6)).toBe(false);
  });
});

describe("generateClientSubmission", () => {
  it("refuses when the record is too thin to describe someone", async () => {
    const result = await generateClientSubmission({
      ...facts,
      skills: [],
      totalExperienceYears: null,
      screeningSummary: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't enough on this candidate's record/i);
  });

  it("degrades rather than throwing when AI is unavailable", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await generateClientSubmission(facts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");

    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
});

describe("summarizeClientActivity", () => {
  it("answers a quiet client without calling the provider", async () => {
    const result = await summarizeClientActivity({
      clientName: "ABC Tech",
      activeJobs: 0,
      submittedCandidates: 0,
      awaitingFeedback: 0,
      overdueFeedback: 0,
      interviewsScheduled: 0,
      averageResponseDays: null,
      feedbackSlaDays: 3,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.summary).toMatch(/no activity recorded/i);
  });
});
