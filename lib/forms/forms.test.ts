// =============================================================================
// Module 23 — the rules that decide what reaches the database.
//
// FOUR THINGS ARE TESTED HERE, and each one is tested because getting it wrong
// is silent rather than loud:
//
//   1. parseFieldDefinitions — a form that saves without an email or resume
//      field looks perfect and then produces a new, undedupable candidate on
//      every single submission.
//   2. validateAnswers — the public endpoint is unauthenticated, so this is the
//      only validation an attacker cannot skip. A number outside the candidate
//      column's CHECK range would reach an insert and fail with a constraint
//      name instead of a sentence.
//   3. candidateFields — first + last -> ONE `name` column, and typed answers
//      beating AI-parsed ones. This is the file that decides what a candidate
//      record says about a real person.
//   4. evaluateAttempts — the off-by-one in a rate limiter locks real
//      applicants out, and nobody notices until somebody complains.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  parseFieldDefinitions,
  slugifyFieldKey,
  validateAnswers,
  formatAnswer,
} from "./validation";
import {
  candidateFieldsFromAnswers,
  mergeWithParsedResume,
  nameFromAnswers,
  typedProfileConflicts,
} from "./candidateFields";
import { DEFAULT_APPLICATION_FIELDS, CUSTOM_FIELD_TYPES } from "./fields";
import {
  evaluateAttempts,
  MAX_ATTEMPTS_PER_FORM,
  MAX_ATTEMPTS_PER_SOURCE,
  UNKNOWN_SOURCE,
} from "./rateLimit";
import type { ParsedResume } from "@/lib/ai/parseResume";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
type FieldInput = {
  field_key?: string;
  label: string;
  field_type: string;
  required?: boolean;
  options?: unknown;
  is_standard?: boolean;
};

const DEFAULTS: FieldInput[] = DEFAULT_APPLICATION_FIELDS.map((field) => ({
  field_key: field.field_key,
  label: field.label,
  field_type: field.field_type,
  required: field.required,
  is_standard: true,
}));

function field(overrides: Partial<FieldInput> & { label: string; field_type: string }): FieldInput {
  return { required: false, ...overrides };
}

// =============================================================================
// 1. The form
// =============================================================================
describe("parseFieldDefinitions", () => {
  it("accepts the default job application form unchanged", () => {
    const result = parseFieldDefinitions(DEFAULTS, { purpose: "job_application" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields).toHaveLength(DEFAULT_APPLICATION_FIELDS.length);
    // display_order is assigned from position, so the arrangement in the editor
    // is the arrangement on the public page.
    expect(result.fields.map((f) => f.display_order)).toEqual(
      DEFAULT_APPLICATION_FIELDS.map((_, index) => index)
    );
  });

  it("refuses a job application form with no email field", () => {
    const result = parseFieldDefinitions(
      DEFAULTS.filter((f) => f.field_key !== "email"),
      { purpose: "job_application" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/email/i);
  });

  it("refuses a job application form with no resume field", () => {
    const result = parseFieldDefinitions(
      DEFAULTS.filter((f) => f.field_key !== "resume"),
      { purpose: "job_application" }
    );
    expect(result.ok).toBe(false);
  });

  it("refuses making email or resume optional", () => {
    for (const key of ["email", "resume"]) {
      const result = parseFieldDefinitions(
        DEFAULTS.map((f) => (f.field_key === key ? { ...f, required: false } : f)),
        { purpose: "job_application" }
      );
      expect(result.ok, `${key} must stay required`).toBe(false);
    }
  });

  it("allows renaming email and resume — an organization may use its own words", () => {
    const result = parseFieldDefinitions(
      DEFAULTS.map((f) =>
        f.field_key === "resume" ? { ...f, label: "Attach your CV" } : f
      ),
      { purpose: "job_application" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.find((f) => f.field_key === "resume")?.label).toBe("Attach your CV");
  });

  it("allows a standalone form to have no email and no resume", () => {
    const result = parseFieldDefinitions(
      [field({ label: "Are you still available?", field_type: "yes_no", required: true })],
      { purpose: "general" }
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a file upload anywhere except the resume field", () => {
    const custom = parseFieldDefinitions(
      [...DEFAULTS, field({ label: "Payslip", field_type: "file_upload" })],
      { purpose: "job_application" }
    );
    expect(custom.ok).toBe(false);

    const standalone = parseFieldDefinitions(
      [field({ label: "Aadhaar", field_type: "file_upload" })],
      { purpose: "general" }
    );
    expect(standalone.ok).toBe(false);

    // And the type is not offered to recruiters in the first place.
    expect(CUSTOM_FIELD_TYPES).not.toContain("file_upload");
  });

  it("requires choices for a dropdown, and drops blank and duplicate ones", () => {
    const missing = parseFieldDefinitions(
      [field({ label: "Shift", field_type: "dropdown", options: [] })],
      { purpose: "general" }
    );
    expect(missing.ok).toBe(false);

    const messy = parseFieldDefinitions(
      [field({ label: "Shift", field_type: "dropdown", options: ["Day", " Day ", "", "Night"] })],
      { purpose: "general" }
    );
    expect(messy.ok).toBe(true);
    if (!messy.ok) return;
    expect(messy.fields[0].options).toEqual(["Day", "Night"]);
  });

  it("refuses two questions sharing a key", () => {
    const result = parseFieldDefinitions(
      [
        field({ field_key: "why", label: "Why this role?", field_type: "long_text" }),
        field({ field_key: "why", label: "Why us?", field_type: "long_text" }),
      ],
      { purpose: "general" }
    );
    expect(result.ok).toBe(false);
  });

  it("never lets a payload claim a question is standard", () => {
    const result = parseFieldDefinitions(
      [field({ label: "Sneaky", field_type: "short_text", is_standard: true })],
      { purpose: "general" }
    );
    expect(result.ok).toBe(true);
    // parseFieldDefinitions reports what was asked for; replaceFormFields is
    // what refuses to write it. Pinned here so the two stay a deliberate pair.
    if (!result.ok) return;
    expect(result.fields[0].is_standard).toBe(true);
  });
});

describe("slugifyFieldKey", () => {
  it("produces a key the database CHECK accepts", () => {
    const pattern = /^[a-z][a-z0-9_]{0,58}[a-z0-9]$/;
    for (const label of [
      "Why are you interested in this position?",
      "  Years of Python experience  ",
      "Salary (₹ per annum)",
      "2026 availability",
      "C++",
    ]) {
      expect(pattern.test(slugifyFieldKey(label)), label).toBe(true);
    }
  });

  it("does not collide with a key already in use", () => {
    const first = slugifyFieldKey("Why this role?");
    const second = slugifyFieldKey("Why this role?", [first]);
    expect(second).not.toBe(first);
  });
});

// =============================================================================
// 2. A submission
// =============================================================================
describe("validateAnswers", () => {
  const fields = [
    { field_key: "email", label: "Email", field_type: "email" as const, options: [], required: true },
    { field_key: "phone", label: "Phone", field_type: "phone" as const, options: [], required: true },
    {
      field_key: "total_experience_years",
      label: "Total experience",
      field_type: "number" as const,
      options: [],
      required: false,
    },
    {
      field_key: "notice_period_days",
      label: "Notice period",
      field_type: "number" as const,
      options: [],
      required: false,
    },
    {
      field_key: "expected_salary",
      label: "Expected salary",
      field_type: "number" as const,
      options: [],
      required: false,
    },
    {
      field_key: "linkedin_url",
      label: "LinkedIn",
      field_type: "url" as const,
      options: [],
      required: false,
    },
    {
      field_key: "shift",
      label: "Shift",
      field_type: "dropdown" as const,
      options: ["Day", "Night"],
      required: true,
    },
    {
      field_key: "stacks",
      label: "Stacks",
      field_type: "checkbox" as const,
      options: ["Python", "Go"],
      required: false,
    },
    {
      field_key: "start",
      label: "Start date",
      field_type: "date" as const,
      options: [],
      required: false,
    },
    {
      field_key: "relocate",
      label: "Willing to relocate",
      field_type: "yes_no" as const,
      options: [],
      required: false,
    },
    {
      field_key: "resume",
      label: "Resume",
      field_type: "file_upload" as const,
      options: [],
      required: true,
    },
  ];

  const good = {
    email: " Ananya@Example.COM ",
    phone: "+91 98765 43210",
    shift: "Day",
  };

  it("accepts a valid submission and normalises what it stores", () => {
    const result = validateAnswers({ fields, raw: good, uploadedFileKeys: ["resume"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.email).toBe("ananya@example.com");
    // The phone is stored AS TYPED. Normalisation is for matching, and the
    // profile should show the number the person actually gave.
    expect(result.answers.phone).toBe("+91 98765 43210");
    // An unanswered optional question is recorded as null, not omitted, so the
    // response says it was asked.
    expect(result.answers.start).toBeNull();
  });

  it("reports every problem at once, not just the first", () => {
    const result = validateAnswers({
      fields,
      raw: { email: "not-an-email", phone: "12", shift: "Evening" },
      uploadedFileKeys: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["email", "phone", "resume", "shift"]);
  });

  it("enforces the same numeric ranges as the candidate columns", () => {
    // candidates.total_experience_years: CHECK 0..60
    const experience = validateAnswers({
      fields,
      raw: { ...good, total_experience_years: 61 },
      uploadedFileKeys: ["resume"],
    });
    expect(experience.ok).toBe(false);

    // candidates.notice_period_days: CHECK 0..365
    const notice = validateAnswers({
      fields,
      raw: { ...good, notice_period_days: 400 },
      uploadedFileKeys: ["resume"],
    });
    expect(notice.ok).toBe(false);

    // candidates.expected_salary: CHECK >= 0
    const salary = validateAnswers({
      fields,
      raw: { ...good, expected_salary: -1 },
      uploadedFileKeys: ["resume"],
    });
    expect(salary.ok).toBe(false);

    const fine = validateAnswers({
      fields,
      raw: { ...good, total_experience_years: 6.5, notice_period_days: 0, expected_salary: 0 },
      uploadedFileKeys: ["resume"],
    });
    expect(fine.ok).toBe(true);
  });

  it("refuses a choice that is not on the list", () => {
    const result = validateAnswers({
      fields,
      raw: { ...good, stacks: ["Python", "COBOL"] },
      uploadedFileKeys: ["resume"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a date that matches the pattern but is not a day", () => {
    const result = validateAnswers({
      fields,
      raw: { ...good, start: "2026-02-31" },
      uploadedFileKeys: ["resume"],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a URL typed the way people actually type one", () => {
    const result = validateAnswers({
      fields,
      raw: { ...good, linkedin_url: "linkedin.com/in/ananya" },
      uploadedFileKeys: ["resume"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.linkedin_url).toBe("https://linkedin.com/in/ananya");
  });

  it("reads yes/no from the strings an HTML form actually posts", () => {
    const result = validateAnswers({
      fields,
      raw: { ...good, relocate: "yes" },
      uploadedFileKeys: ["resume"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.relocate).toBe(true);
  });

  it("requires the resume file itself, not a filename in the body", () => {
    const spoofed = validateAnswers({
      fields,
      raw: { ...good, resume: "my-cv.pdf" },
      uploadedFileKeys: [],
    });
    expect(spoofed.ok).toBe(false);
    if (spoofed.ok) return;
    expect(spoofed.errors.resume).toMatch(/required/i);
  });
});

describe("formatAnswer", () => {
  it("renders each answer shape the way a recruiter reads it", () => {
    expect(formatAnswer(null)).toBe("—");
    expect(formatAnswer(true)).toBe("Yes");
    expect(formatAnswer(false)).toBe("No");
    expect(formatAnswer(["Python", "Go"])).toBe("Python, Go");
    expect(formatAnswer([])).toBe("—");
    expect(formatAnswer("  ")).toBe("—");
  });
});

// =============================================================================
// 3. Answers -> candidate
// =============================================================================
describe("nameFromAnswers", () => {
  it("joins first and last into the single `name` column", () => {
    expect(nameFromAnswers({ first_name: "Ananya", last_name: "Sharma" })).toBe("Ananya Sharma");
  });

  it("survives a whitespace-only surname rather than writing a trailing space", () => {
    // candidates has check (length(btrim(name)) > 0), and a name of "Ananya "
    // would also read wrong everywhere it is displayed.
    expect(nameFromAnswers({ first_name: "Ananya", last_name: "   " })).toBe("Ananya");
  });

  it("returns null when there is nothing to name the person by", () => {
    expect(nameFromAnswers({ first_name: "  ", last_name: null })).toBeNull();
  });

  it("accepts a single whole-name field, for a standalone form", () => {
    expect(nameFromAnswers({ full_name: "Ananya Sharma" })).toBe("Ananya Sharma");
  });
});

describe("candidateFieldsFromAnswers", () => {
  it("maps only the keys that have a candidate column", () => {
    const fields = candidateFieldsFromAnswers({
      first_name: "Ananya",
      last_name: "Sharma",
      email: "Ananya@Example.com",
      phone: "+91 98765 43210",
      location: "Gurgaon",
      current_company: "Infosys",
      current_role: "Senior Java Developer",
      total_experience_years: 6,
      expected_salary: 1_800_000,
      notice_period_days: 30,
      // No column exists for either of these — they stay in raw_answers.
      current_ctc: 1_500_000,
      linkedin_url: "https://linkedin.com/in/ananya",
      why_this_role: "I like Java",
    });

    expect(fields).toEqual({
      name: "Ananya Sharma",
      email: "ananya@example.com",
      phone: "+91 98765 43210",
      location: "Gurgaon",
      current_company: "Infosys",
      current_role: "Senior Java Developer",
      total_experience_years: 6,
      expected_salary: 1_800_000,
      notice_period_days: 30,
    });
  });

  it("drops a number outside the column's CHECK range rather than passing it on", () => {
    const fields = candidateFieldsFromAnswers({ total_experience_years: 99 });
    expect(fields.total_experience_years).toBeNull();
  });
});

describe("mergeWithParsedResume", () => {
  const parsed: ParsedResume = {
    name: "A. Sharma",
    email: "different@example.com",
    phone: "9999999999",
    location: "Bengaluru",
    currentCompany: "TCS",
    currentRole: "Java Developer",
    totalExperienceYears: 9,
    skills: ["Java", "Spring"],
    experience: [],
    education: [],
    certifications: [],
    expectedSalary: 2_500_000,
    noticePeriodDays: 60,
    confidence: 0.8,
  };

  it("lets what the applicant TYPED win over what the AI read", () => {
    const typed = candidateFieldsFromAnswers({
      first_name: "Ananya",
      last_name: "Sharma",
      email: "ananya@example.com",
      total_experience_years: 6,
    });

    const merged = mergeWithParsedResume({ typed, parsed });

    expect(merged.name).toBe("Ananya Sharma");
    expect(merged.email).toBe("ananya@example.com");
    expect(merged.total_experience_years).toBe(6);
  });

  it("fills only the gaps from the resume", () => {
    const typed = candidateFieldsFromAnswers({ first_name: "Ananya", last_name: "Sharma" });
    const merged = mergeWithParsedResume({ typed, parsed });

    expect(merged.location).toBe("Bengaluru");
    expect(merged.current_company).toBe("TCS");
    expect(merged.notice_period_days).toBe(60);
    // Skills only ever come from the resume — no default field asks for them.
    expect(merged.skills).toEqual(["Java", "Spring"]);
  });

  it("works with no resume at all", () => {
    const typed = candidateFieldsFromAnswers({ first_name: "Ananya", last_name: "Sharma" });
    const merged = mergeWithParsedResume({ typed, parsed: null });
    expect(merged.name).toBe("Ananya Sharma");
    expect(merged.skills).toEqual([]);
  });

  it("treats a zero as a real answer, not as absent", () => {
    // The trap in every "fill the gaps" merge: `0 || fallback` is the fallback.
    // A notice period of zero means "available immediately", which is the single
    // most useful answer this field ever gets.
    const typed = candidateFieldsFromAnswers({
      first_name: "Ananya",
      last_name: "Sharma",
      notice_period_days: 0,
    });
    const merged = mergeWithParsedResume({ typed, parsed });
    expect(merged.notice_period_days).toBe(0);
  });
});

describe("typedProfileConflicts", () => {
  const typed = candidateFieldsFromAnswers({
    first_name: "Ananya",
    last_name: "Sharma",
    email: "ananya@example.com",
    expected_salary: 3_000_000,
  });

  it("reports a disagreement without touching anything", () => {
    const conflicts = typedProfileConflicts({
      typed,
      existing: {
        name: "Ananya Sharma",
        email: "ananya@example.com",
        expected_salary: 1_800_000,
      },
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("expected_salary");
    expect(conflicts[0].submitted).toBe("3000000");
    expect(conflicts[0].onProfile).toBe("1800000");
  });

  it("does not treat an empty profile field as a disagreement", () => {
    const conflicts = typedProfileConflicts({
      typed,
      existing: { name: "Ananya Sharma", email: "ananya@example.com", expected_salary: null },
    });
    expect(conflicts).toHaveLength(0);
  });

  it("ignores case and padding in text, which are not disagreements", () => {
    const conflicts = typedProfileConflicts({
      typed,
      existing: { name: "  ANANYA SHARMA ", email: "Ananya@Example.com", expected_salary: 3_000_000 },
    });
    expect(conflicts).toHaveLength(0);
  });
});

// =============================================================================
// 4. The rate limiter
// =============================================================================
describe("evaluateAttempts", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();

  it("allows the attempts up to the cap and refuses the one after", () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_SOURCE - 1 }, () => ({
      ip_hash: "abc",
      attempted_at: minutesAgo(5),
    }));

    expect(evaluateAttempts({ attempts, ipHash: "abc", now }).allowed).toBe(true);

    attempts.push({ ip_hash: "abc", attempted_at: minutesAgo(5) });
    const refused = evaluateAttempts({ attempts, ipHash: "abc", now });
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.reason).toBe("source");
    // The message has to be something a real applicant can act on.
    expect(refused.message).toMatch(/contact the recruiter/i);
  });

  it("forgets attempts older than the window", () => {
    const attempts = Array.from({ length: 10 }, () => ({
      ip_hash: "abc",
      attempted_at: minutesAgo(61),
    }));
    expect(evaluateAttempts({ attempts, ipHash: "abc", now }).allowed).toBe(true);
  });

  it("counts each source separately", () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_SOURCE }, () => ({
      ip_hash: "abc",
      attempted_at: minutesAgo(1),
    }));
    expect(evaluateAttempts({ attempts, ipHash: "xyz", now }).allowed).toBe(true);
  });

  it("does not lock out every applicant when no address can be read", () => {
    // The unknown bucket is shared, so capping it at three would refuse real
    // people on any deployment with no proxy headers.
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_SOURCE + 5 }, () => ({
      ip_hash: UNKNOWN_SOURCE,
      attempted_at: minutesAgo(1),
    }));
    expect(evaluateAttempts({ attempts, ipHash: UNKNOWN_SOURCE, now }).allowed).toBe(true);
  });

  it("still has a per-form backstop a forged header cannot dodge", () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS_PER_FORM }, (_, index) => ({
      ip_hash: `source-${index}`,
      attempted_at: minutesAgo(2),
    }));
    const verdict = evaluateAttempts({ attempts, ipHash: "brand-new", now });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe("form");
  });

  it("ignores an unparseable timestamp rather than letting it lock the form", () => {
    const attempts = [{ ip_hash: "abc", attempted_at: "not-a-date" }];
    expect(evaluateAttempts({ attempts, ipHash: "abc", now }).allowed).toBe(true);
  });
});
