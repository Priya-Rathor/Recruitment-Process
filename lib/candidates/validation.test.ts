import { describe, expect, it } from "vitest";
import { parseCandidatePayload } from "./validation";
import { describeFilters, filtersFromSearchParams, isEmptyFilters } from "./filters";

function parsed(body: unknown, mode: "create" | "update" = "create") {
  const result = parseCandidatePayload(body, mode);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.data;
}

function errorFrom(body: unknown, mode: "create" | "update" = "create") {
  const result = parseCandidatePayload(body, mode);
  return result.ok ? null : result.error;
}

const minimal = { name: "Rahul Sharma", email: "rahul@example.com" };

describe("required fields", () => {
  it("requires a name on create", () => {
    expect(errorFrom({ email: "a@b.com" })).toBe("A candidate name is required.");
    expect(errorFrom({ name: "  ", email: "a@b.com" })).toBe("A candidate name is required.");
  });

  it("requires at least one contact detail on create", () => {
    // A record with neither is not actionable; the DB enforces this too.
    expect(errorFrom({ name: "Rahul Sharma" })).toBe("Add an email address or a phone number.");
  });

  it("accepts phone-only intake", () => {
    expect(parsed({ name: "Rahul Sharma", phone: "9876543210" }).phone).toBe("9876543210");
  });

  it("allows a partial update without a name", () => {
    expect(parsed({ location: "Pune" }, "update")).toEqual({ location: "Pune" });
  });

  it("blocks an update that would clear both contact details at once", () => {
    expect(errorFrom({ email: null, phone: null }, "update")).toBe(
      "A candidate needs an email address or a phone number."
    );
  });

  it("allows clearing just one contact detail", () => {
    expect(parsed({ email: null }, "update").email).toBeNull();
  });
});

describe("tenant safety", () => {
  it("ignores a client-supplied organization_id", () => {
    const data = parsed({ ...minimal, organization_id: "11111111-1111-1111-1111-111111111111" });
    expect(data).not.toHaveProperty("organization_id");
  });

  it("ignores id, timestamps and the normalised columns", () => {
    // Normalisation is the database trigger's job — accepting it from a client
    // would let someone plant a record that escapes duplicate detection.
    const data = parsed({
      ...minimal,
      id: "x",
      created_at: "2020-01-01",
      email_normalized: "spoofed@example.com",
      phone_normalized: "0000000000",
    });
    expect(Object.keys(data).sort()).toEqual(["email", "name"]);
  });
});

describe("contact validation", () => {
  it("lowercases and trims the email", () => {
    expect(parsed({ name: "R", email: "  Rahul@Example.COM " }).email).toBe("rahul@example.com");
  });

  it("rejects a malformed email", () => {
    expect(errorFrom({ name: "R", email: "not-an-email" })).toBe("Enter a valid email address.");
    expect(errorFrom({ name: "R", email: "a@b" })).toBe("Enter a valid email address.");
  });

  it("rejects a phone with too few digits", () => {
    expect(errorFrom({ name: "R", phone: "123" })).toBe("Enter a valid phone number.");
  });

  it("keeps the phone exactly as typed, leaving normalisation to the database", () => {
    expect(parsed({ name: "R", phone: "+91 98765 43210" }).phone).toBe("+91 98765 43210");
  });
});

describe("numbers", () => {
  it("accepts valid values including zero notice", () => {
    const data = parsed({ ...minimal, notice_period_days: 0, total_experience_years: 5.5 });
    expect(data.notice_period_days).toBe(0);
    expect(data.total_experience_years).toBe(5.5);
  });

  it("rejects negatives and absurd values", () => {
    expect(errorFrom({ ...minimal, total_experience_years: -1 })).toBe(
      "Total experience cannot be negative."
    );
    expect(errorFrom({ ...minimal, total_experience_years: 200 })).toMatch(/unrealistically large/);
    expect(errorFrom({ ...minimal, notice_period_days: 500 })).toMatch(/unrealistically large/);
  });

  it("treats null and empty string as cleared", () => {
    expect(parsed({ ...minimal, expected_salary: null }).expected_salary).toBeNull();
    expect(parsed({ ...minimal, notice_period_days: "" }).notice_period_days).toBeNull();
  });

  it("accepts numeric strings from HTML inputs", () => {
    expect(parsed({ ...minimal, expected_salary: "1900000" }).expected_salary).toBe(1_900_000);
  });
});

describe("skills", () => {
  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(parsed({ ...minimal, skills: [" Java ", "", "java", "AWS"] }).skills).toEqual([
      "Java",
      "AWS",
    ]);
  });

  it("rejects a non-list and non-string entries", () => {
    expect(errorFrom({ ...minimal, skills: "Java" })).toBe("Skills must be a list.");
    expect(errorFrom({ ...minimal, skills: ["Java", 7] })).toBe(
      "Skills must contain only text entries."
    );
  });

  it("caps the number of skills", () => {
    const many = Array.from({ length: 41 }, (_, i) => `skill-${i}`);
    expect(errorFrom({ ...minimal, skills: many })).toMatch(/more than 40 entries/);
  });
});

describe("source", () => {
  it("accepts every documented intake source", () => {
    for (const source of [
      "career_page",
      "resume_upload",
      "email",
      "referral",
      "job_board",
      "agency_database",
      "manual",
    ]) {
      expect(parsed({ ...minimal, source }).source).toBe(source);
    }
  });

  it("rejects an unknown source", () => {
    expect(errorFrom({ ...minimal, source: "linkedin" })).toBe("Select a valid intake source.");
  });
});

describe("malformed bodies", () => {
  it("rejects non-objects", () => {
    expect(errorFrom(null)).toBe("Invalid request body.");
    expect(errorFrom("nope")).toBe("Invalid request body.");
  });

  it("rejects an update with nothing recognisable", () => {
    expect(errorFrom({ junk: 1 }, "update")).toBe("No valid fields provided.");
  });
});

describe("filtersFromSearchParams", () => {
  it("parses a full filter set from the URL", () => {
    const params = new URLSearchParams({
      q: " Rahul ",
      skills: "Java, Spring Boot ,",
      location: "Gurgaon",
      exp_min: "4",
      exp_max: "7",
      notice_max: "45",
      salary_max: "2000000",
      source: "referral",
    });

    expect(filtersFromSearchParams(params)).toEqual({
      text: "Rahul",
      skills: ["Java", "Spring Boot"],
      location: "Gurgaon",
      experienceMin: 4,
      experienceMax: 7,
      noticePeriodMaxDays: 45,
      expectedSalaryMax: 2_000_000,
      source: "referral",
      includeArchived: false,
    });
  });

  it("drops negative and non-numeric values rather than trusting the URL", () => {
    const params = new URLSearchParams({ exp_min: "-5", notice_max: "soon" });
    const filters = filtersFromSearchParams(params);
    expect(filters.experienceMin).toBeNull();
    expect(filters.noticePeriodMaxDays).toBeNull();
  });

  it("keeps 0 as a real constraint", () => {
    expect(filtersFromSearchParams(new URLSearchParams({ notice_max: "0" })).noticePeriodMaxDays).toBe(0);
  });

  it("yields empty filters for an empty query string", () => {
    expect(isEmptyFilters(filtersFromSearchParams(new URLSearchParams()))).toBe(true);
  });
});

describe("describeFilters", () => {
  it("explains an empty filter set as nothing", () => {
    expect(describeFilters({})).toEqual([]);
  });

  it("describes one-sided ranges correctly", () => {
    expect(describeFilters({ experienceMin: 5 })).toEqual(["5+ years experience"]);
    expect(describeFilters({ experienceMax: 3 })).toEqual(["up to 3 years experience"]);
  });

  it("describes an immediate-joiner constraint", () => {
    expect(describeFilters({ noticePeriodMaxDays: 0 })).toEqual([
      "notice period 0 days or less",
    ]);
  });
});
