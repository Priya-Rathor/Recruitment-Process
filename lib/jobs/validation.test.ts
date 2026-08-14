import { describe, expect, it } from "vitest";
import { MAX_SKILLS, parseJobPayload } from "./validation";

/** Unwraps a successful parse, failing loudly if it wasn't. */
function parsed(body: unknown, mode: "create" | "update" = "create") {
  const result = parseJobPayload(body, mode);
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.data;
}

function errorFrom(body: unknown, mode: "create" | "update" = "create") {
  const result = parseJobPayload(body, mode);
  return result.ok ? null : result.error;
}

describe("title", () => {
  it("is required on create", () => {
    expect(errorFrom({})).toBe("A job title is required.");
    expect(errorFrom({ title: "   " })).toBe("A job title is required.");
  });

  it("is optional on update, so a PATCH can't blank it by omission", () => {
    expect(parsed({ location: "Pune" }, "update")).toEqual({ location: "Pune" });
  });

  it("is still validated on update when present", () => {
    expect(errorFrom({ title: "" }, "update")).toBe("A job title is required.");
  });

  it("trims surrounding whitespace", () => {
    expect(parsed({ title: "  Senior Java Developer  " }).title).toBe("Senior Java Developer");
  });

  it("rejects an over-long title", () => {
    expect(errorFrom({ title: "x".repeat(201) })).toMatch(/200 characters or fewer/);
  });
});

describe("tenant safety", () => {
  it("IGNORES a client-supplied organization_id rather than trusting it", () => {
    // The tenant always comes from the session; anything in the body is noise.
    const data = parsed({ title: "Dev", organization_id: "11111111-1111-1111-1111-111111111111" });
    expect(data).not.toHaveProperty("organization_id");
  });

  it("ignores other unknown keys, including id and created_at", () => {
    const data = parsed({ title: "Dev", id: "abc", created_at: "2020-01-01", archived_at: "x" });
    expect(Object.keys(data)).toEqual(["title"]);
  });
});

describe("numeric ranges", () => {
  it("accepts a valid experience range", () => {
    const data = parsed({ title: "Dev", experience_min: 4, experience_max: 7 });
    expect(data.experience_min).toBe(4);
    expect(data.experience_max).toBe(7);
  });

  it("rejects an inverted experience range", () => {
    expect(errorFrom({ title: "Dev", experience_min: 7, experience_max: 4 })).toBe(
      "Minimum experience cannot be greater than maximum experience."
    );
  });

  it("rejects an inverted salary range", () => {
    expect(errorFrom({ title: "Dev", salary_min: 2_000_000, salary_max: 1_000_000 })).toBe(
      "Minimum salary cannot be greater than maximum salary."
    );
  });

  it("allows equal bounds", () => {
    expect(parsed({ title: "Dev", experience_min: 5, experience_max: 5 }).experience_max).toBe(5);
  });

  it("does NOT cross-check when only one bound is in the payload", () => {
    // A PATCH sending only the min can't see the stored max, so the database
    // CHECK constraint is the backstop rather than a false rejection here.
    expect(parsed({ experience_min: 9 }, "update").experience_min).toBe(9);
  });

  it("rejects negative and non-numeric values", () => {
    expect(errorFrom({ title: "Dev", experience_min: -1 })).toBe(
      "Minimum experience cannot be negative."
    );
    expect(errorFrom({ title: "Dev", salary_min: "lots" })).toBe("Minimum salary must be a number.");
  });

  it("rejects an absurd experience value", () => {
    expect(errorFrom({ title: "Dev", experience_min: 500 })).toMatch(/unrealistically large/);
  });

  it("treats null and empty string as 'not specified'", () => {
    expect(parsed({ title: "Dev", experience_min: null, salary_max: "" })).toEqual({
      title: "Dev",
      experience_min: null,
      salary_max: null,
    });
  });

  it("accepts a numeric string, since HTML inputs submit strings", () => {
    expect(parsed({ title: "Dev", experience_min: "4.5" }).experience_min).toBe(4.5);
  });
});

describe("skills", () => {
  it("trims, drops blanks, and preserves order", () => {
    const data = parsed({ title: "Dev", required_skills: ["  Java ", "", "  ", "AWS"] });
    expect(data.required_skills).toEqual(["Java", "AWS"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    const data = parsed({ title: "Dev", required_skills: ["AWS", "aws", "Aws"] });
    expect(data.required_skills).toEqual(["AWS"]);
  });

  it("removes a skill from preferred when it is also required", () => {
    // Otherwise Module 7's matching would count the same skill twice.
    const data = parsed({
      title: "Dev",
      required_skills: ["Java", "AWS"],
      preferred_skills: ["aws", "Kubernetes"],
    });
    expect(data.preferred_skills).toEqual(["Kubernetes"]);
  });

  it("rejects a non-list and non-string entries", () => {
    expect(errorFrom({ title: "Dev", required_skills: "Java" })).toBe(
      "Required skills must be a list."
    );
    expect(errorFrom({ title: "Dev", required_skills: ["Java", 42] })).toBe(
      "Required skills must contain only text entries."
    );
  });

  it("rejects more than the maximum number of skills", () => {
    const many = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `skill-${i}`);
    expect(errorFrom({ title: "Dev", required_skills: many })).toMatch(/more than 25 entries/);
  });

  it("treats null as an empty list", () => {
    expect(parsed({ title: "Dev", required_skills: null }).required_skills).toEqual([]);
  });
});

describe("enums", () => {
  it("accepts the valid work modes", () => {
    for (const mode of ["onsite", "hybrid", "remote"]) {
      expect(parsed({ title: "Dev", work_mode: mode }).work_mode).toBe(mode);
    }
  });

  it("rejects an invalid work mode", () => {
    expect(errorFrom({ title: "Dev", work_mode: "hybrid-ish" })).toBe(
      "Work mode must be onsite, hybrid, or remote."
    );
  });

  it("treats null and empty string as cleared", () => {
    expect(parsed({ title: "Dev", work_mode: null }).work_mode).toBeNull();
    expect(parsed({ title: "Dev", work_mode: "" }).work_mode).toBeNull();
  });

  it("accepts the valid statuses and rejects anything else", () => {
    expect(parsed({ title: "Dev", status: "on_hold" }).status).toBe("on_hold");
    expect(errorFrom({ title: "Dev", status: "archived" })).toMatch(/draft, open, on_hold, or closed/);
  });
});

describe("ids", () => {
  it("accepts a well-formed uuid", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(parsed({ title: "Dev", owner_recruiter_id: id }).owner_recruiter_id).toBe(id);
  });

  it("rejects a malformed id", () => {
    expect(errorFrom({ title: "Dev", owner_recruiter_id: "not-a-uuid" })).toBe(
      "Owner recruiter is not a valid id."
    );
  });

  it("allows clearing an id", () => {
    expect(parsed({ title: "Dev", owner_recruiter_id: null }).owner_recruiter_id).toBeNull();
    expect(parsed({ title: "Dev", client_id: "" }).client_id).toBeNull();
  });
});

describe("malformed bodies", () => {
  it("rejects non-objects", () => {
    expect(errorFrom(null)).toBe("Invalid request body.");
    expect(errorFrom("a string")).toBe("Invalid request body.");
    expect(errorFrom(42)).toBe("Invalid request body.");
  });

  it("rejects an update with no recognised fields", () => {
    expect(errorFrom({ nonsense: true }, "update")).toBe("No valid fields provided.");
  });
});
