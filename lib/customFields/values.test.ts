import { describe, expect, it } from "vitest";
import { coerceValue, formatValue, isBlank, validateValue } from "@/lib/customFields/values";

describe("isBlank", () => {
  it("treats empty string, whitespace, empty array, null and undefined as blank", () => {
    for (const value of ["", "   ", [], null, undefined]) {
      expect(isBlank(value)).toBe(true);
    }
  });

  it("does not treat false or 0 as blank", () => {
    // A yes_no answered "No" is an ANSWER. Treating it as blank would make a
    // required no-answer impossible to submit.
    expect(isBlank(false)).toBe(false);
    expect(isBlank(0)).toBe(false);
  });
});

describe("coerceValue", () => {
  it("stores a blank answer as null for every type", () => {
    for (const type of ["short_text", "number", "date", "yes_no", "checkbox"] as const) {
      expect(coerceValue(type, [], "")).toEqual({ ok: true, value: null });
    }
  });

  it("trims text", () => {
    expect(coerceValue("short_text", [], "  hello  ")).toEqual({ ok: true, value: "hello" });
  });

  it("rejects over-long text", () => {
    expect(coerceValue("short_text", [], "x".repeat(501)).ok).toBe(false);
  });

  it("accepts a number as a string, the way a form submits it", () => {
    expect(coerceValue("number", [], "42")).toEqual({ ok: true, value: 42 });
  });

  it("rejects a non-numeric number", () => {
    expect(coerceValue("number", [], "abc").ok).toBe(false);
  });

  it("keeps a date as a plain YYYY-MM-DD string", () => {
    // Never a Date and never a timestamp: converting here shifts the day for
    // anyone in a zone away from the server.
    expect(coerceValue("date", [], "2026-03-01")).toEqual({ ok: true, value: "2026-03-01" });
  });

  it("rejects a date in any other shape", () => {
    expect(coerceValue("date", [], "01/03/2026").ok).toBe(false);
    expect(coerceValue("date", [], "2026-13-45").ok).toBe(false);
  });

  it("understands the several ways yes/no arrives", () => {
    expect(coerceValue("yes_no", [], true)).toEqual({ ok: true, value: true });
    expect(coerceValue("yes_no", [], "Yes")).toEqual({ ok: true, value: true });
    expect(coerceValue("yes_no", [], "false")).toEqual({ ok: true, value: false });
    expect(coerceValue("yes_no", [], "maybe").ok).toBe(false);
  });

  it("checks dropdown membership rather than trusting the submission", () => {
    const options = ["Yes", "No"];
    expect(coerceValue("dropdown", options, "Yes")).toEqual({ ok: true, value: "Yes" });
    // A direct POST can carry anything; the <select> is cosmetic.
    expect(coerceValue("dropdown", options, "Maybe").ok).toBe(false);
  });

  it("de-duplicates checkbox selections and validates each", () => {
    const options = ["A", "B", "C"];
    expect(coerceValue("checkbox", options, ["A", "B", "A"])).toEqual({
      ok: true,
      value: ["A", "B"],
    });
    expect(coerceValue("checkbox", options, ["A", "Z"]).ok).toBe(false);
  });

  it("wraps a single checkbox value into an array", () => {
    expect(coerceValue("checkbox", ["A"], "A")).toEqual({ ok: true, value: ["A"] });
  });

  it("accepts an http(s) url and refuses other schemes", () => {
    expect(coerceValue("url", [], "https://example.com/x")).toEqual({
      ok: true,
      value: "https://example.com/x",
    });
    // Would be rendered as a link on an internal page.
    expect(coerceValue("url", [], "javascript:alert(1)").ok).toBe(false);
    expect(coerceValue("url", [], "example.com").ok).toBe(false);
  });

  it("refuses a nested object where a scalar belongs", () => {
    expect(coerceValue("short_text", [], { a: 1 }).ok).toBe(false);
    expect(coerceValue("number", [], { a: 1 }).ok).toBe(false);
  });
});

describe("validateValue", () => {
  const required = {
    field_key: "visa",
    label: "Visa Sponsorship",
    field_type: "yes_no" as const,
    options: [] as string[],
    required: true,
  };

  it("rejects a blank required answer", () => {
    const result = validateValue(required, "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.label).toBe("Visa Sponsorship");
  });

  it("accepts a required answer of false", () => {
    // The regression this guards: `if (!value)` would reject a legitimate "No".
    expect(validateValue(required, false)).toEqual({ ok: true, value: false });
  });

  it("accepts a blank optional answer", () => {
    expect(validateValue({ ...required, required: false }, "")).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("formatValue", () => {
  it("renders each type the same way everywhere it is read", () => {
    expect(formatValue("yes_no", true)).toBe("Yes");
    expect(formatValue("yes_no", false)).toBe("No");
    expect(formatValue("checkbox", ["A", "B"])).toBe("A, B");
    expect(formatValue("number", 42)).toBe("42");
    expect(formatValue("short_text", "hi")).toBe("hi");
  });

  it("renders a missing value as empty, never as 'null'", () => {
    // A {{custom.*}} token with no value must vanish, not print the word null
    // into a message sent to a candidate.
    expect(formatValue("short_text", null)).toBe("");
    expect(formatValue("yes_no", null)).toBe("");
  });
});
