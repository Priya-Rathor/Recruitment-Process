import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseResume, validateParsedResume } from "./parseResume";

const wellFormed = {
  name: "Rahul Sharma",
  email: "Rahul@Example.COM",
  phone: "+91 98765 43210",
  location: "Gurgaon",
  currentCompany: "Infosys",
  currentRole: "Software Engineer",
  totalExperienceYears: 5.5,
  skills: ["Java", "Spring Boot", "AWS"],
  experience: [
    { company: "Infosys", role: "Software Engineer", period: "Jan 2021 - Present" },
    { company: "TCS", role: "Junior Developer", period: "2019 - 2021" },
  ],
  education: [
    { institution: "Delhi Technological University", qualification: "B.Tech", year: "2019" },
  ],
  certifications: ["AWS Solutions Architect"],
  expectedSalary: 2_000_000,
  noticePeriodDays: 30,
  confidence: 0.9,
};

describe("validateParsedResume — rejects malformed output BEFORE the review screen", () => {
  it("accepts a well-formed extraction", () => {
    const parsed = validateParsedResume(wellFormed);
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("Rahul Sharma");
    expect(parsed?.skills).toEqual(["Java", "Spring Boot", "AWS"]);
    expect(parsed?.experience).toHaveLength(2);
  });

  it("lowercases the email so dedup and comparison behave", () => {
    expect(validateParsedResume(wellFormed)?.email).toBe("rahul@example.com");
  });

  it("REJECTS a non-object", () => {
    expect(validateParsedResume(null)).toBeNull();
    expect(validateParsedResume("Rahul Sharma, 5 years Java")).toBeNull();
    expect(validateParsedResume(42)).toBeNull();
    expect(validateParsedResume([])).toBeNull();
  });

  it("REJECTS output with nothing identifying in it", () => {
    // Rendering this would give the recruiter an empty review screen that looks
    // like the resume contained nothing.
    expect(validateParsedResume({})).toBeNull();
    expect(
      validateParsedResume({ location: "Gurgaon", expectedSalary: 2_000_000 })
    ).toBeNull();
  });

  it("ACCEPTS partial output, per 'graceful partial results'", () => {
    // A real resume legitimately omits salary and notice period.
    const parsed = validateParsedResume({ name: "Rahul Sharma", skills: ["Java"] });
    expect(parsed).not.toBeNull();
    expect(parsed?.expectedSalary).toBeNull();
    expect(parsed?.noticePeriodDays).toBeNull();
    expect(parsed?.experience).toEqual([]);
  });

  it("survives a single usable signal", () => {
    expect(validateParsedResume({ phone: "9876543210" })).not.toBeNull();
    expect(validateParsedResume({ experience: [{ company: "Infosys", role: "Engineer" }] }))
      .not.toBeNull();
  });

  it("drops out-of-range numbers rather than storing nonsense", () => {
    const parsed = validateParsedResume({
      ...wellFormed,
      totalExperienceYears: 250,
      noticePeriodDays: 5000,
      confidence: 7,
    });
    expect(parsed?.totalExperienceYears).toBeNull();
    expect(parsed?.noticePeriodDays).toBeNull();
    expect(parsed?.confidence).toBeNull();
  });

  it("keeps 0 notice period, which is a real value", () => {
    expect(validateParsedResume({ ...wellFormed, noticePeriodDays: 0 })?.noticePeriodDays).toBe(0);
  });

  it("de-duplicates skills case-insensitively", () => {
    expect(
      validateParsedResume({ ...wellFormed, skills: ["Java", "JAVA", "java", "AWS"] })?.skills
    ).toEqual(["Java", "AWS"]);
  });

  it("discards experience entries carrying no information", () => {
    const parsed = validateParsedResume({
      ...wellFormed,
      experience: [
        { company: "Infosys", role: "Engineer", period: null },
        { period: "2019 - 2021" },
        {},
        null,
        "TCS",
      ],
    });
    expect(parsed?.experience).toHaveLength(1);
  });

  it("fills a missing half of an experience entry rather than dropping it", () => {
    // A company with no role is still useful history.
    const parsed = validateParsedResume({
      ...wellFormed,
      experience: [{ company: "Infosys" }],
    });
    expect(parsed?.experience[0]).toEqual({
      company: "Infosys",
      role: "Unknown role",
      period: null,
    });
  });

  it("requires an institution for an education entry", () => {
    const parsed = validateParsedResume({
      ...wellFormed,
      education: [{ qualification: "B.Tech", year: "2019" }, { institution: "DTU" }],
    });
    expect(parsed?.education).toHaveLength(1);
    expect(parsed?.education[0].institution).toBe("DTU");
  });

  it("ignores non-array skills and lists", () => {
    const parsed = validateParsedResume({
      ...wellFormed,
      skills: "Java, Spring Boot",
      certifications: null,
    });
    expect(parsed?.skills).toEqual([]);
    expect(parsed?.certifications).toEqual([]);
  });

  it("caps runaway lists", () => {
    const parsed = validateParsedResume({
      ...wellFormed,
      skills: Array.from({ length: 200 }, (_, i) => `skill-${i}`),
      experience: Array.from({ length: 100 }, (_, i) => ({ company: `C${i}`, role: "Dev" })),
    });
    expect(parsed!.skills.length).toBeLessThanOrEqual(40);
    expect(parsed!.experience.length).toBeLessThanOrEqual(25);
  });
});

describe("parseResume", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it("refuses text too short to be a resume before spending a token", async () => {
    const result = await parseResume("Rahul Sharma, Java developer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_output");
  });

  it("degrades to not_configured rather than throwing", async () => {
    const result = await parseResume("x".repeat(500));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_configured");
  });
});
