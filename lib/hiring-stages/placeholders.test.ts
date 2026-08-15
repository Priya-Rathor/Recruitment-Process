import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_FIELDS,
  extractTokens,
  findPlaceholder,
  insertToken,
  renderPreview,
  renderTemplate,
  sampleValues,
  splitTokens,
  toToken,
} from "@/lib/hiring-stages/placeholders";

describe("the catalogue", () => {
  // The spec lists these by name; if one is dropped, a script referencing it
  // silently stops resolving, so the list is asserted rather than assumed.
  const EXPECTED = [
    "job.title",
    "job.client_name",
    "job.location",
    "job.work_mode",
    "job.experience_range",
    "job.salary_range",
    "job.required_skills",
    "job.preferred_skills",
    "candidate.name",
    "candidate.email",
    "candidate.current_company",
    "candidate.current_role",
    "candidate.total_experience",
    "candidate.expected_salary",
    "candidate.notice_period",
    "application.stage",
    "application.match_score",
  ];

  it("carries every field the spec names, in both groups", () => {
    expect(PLACEHOLDER_FIELDS.map((f) => f.token)).toEqual(EXPECTED);
    expect(PLACEHOLDER_FIELDS.filter((f) => f.group === "job")).toHaveLength(8);
    expect(PLACEHOLDER_FIELDS.filter((f) => f.group === "candidate")).toHaveLength(9);
  });

  it("gives every field a realistic sample, so the preview is never blank", () => {
    for (const field of PLACEHOLDER_FIELDS) {
      expect(field.sample.trim().length, field.token).toBeGreaterThan(0);
    }
  });

  it("has no duplicate tokens", () => {
    const tokens = PLACEHOLDER_FIELDS.map((f) => f.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("extractTokens", () => {
  it("finds tokens in first-appearance order without duplicates", () => {
    expect(
      extractTokens("Hi {{candidate.name}}, about {{job.title}} — yes, {{candidate.name}}.")
    ).toEqual(["candidate.name", "job.title"]);
  });

  it("tolerates inner whitespace, which is what people type by hand", () => {
    expect(extractTokens("{{ job.title }}")).toEqual(["job.title"]);
    expect(extractTokens("{{\tcandidate.name\t}}")).toEqual(["candidate.name"]);
  });

  it("is case-insensitive and normalises to lower case", () => {
    expect(extractTokens("{{Job.Title}}")).toEqual(["job.title"]);
  });

  it("ignores things that are not tokens", () => {
    expect(extractTokens("Use {braces} and {{nodot}} and {{}}")).toEqual([]);
    expect(extractTokens("Plain text with no tokens")).toEqual([]);
  });
});

describe("splitTokens", () => {
  it("separates known fields from typos", () => {
    const { known, unknown } = splitTokens("{{candidate.name}} at {{candidate.naem}}");
    expect(known.map((f) => f.token)).toEqual(["candidate.name"]);
    expect(unknown).toEqual(["candidate.naem"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes every catalogued token from both groups", () => {
    // The spec's test: "the sample-data preview correctly substitutes every
    // placeholder type from both Job and Candidate/Application groups".
    const template = PLACEHOLDER_FIELDS.map((f) => toToken(f.token)).join(" | ");
    const rendered = renderTemplate(template, sampleValues());

    expect(rendered).not.toContain("{{");
    for (const field of PLACEHOLDER_FIELDS) {
      expect(rendered, field.token).toContain(field.sample);
    }
  });

  it("drops a known token that has no value", () => {
    expect(renderTemplate("Notice: {{candidate.notice_period}}.", {})).toBe("Notice: .");
    expect(renderTemplate("Notice: {{candidate.notice_period}}.", { "candidate.notice_period": null }))
      .toBe("Notice: .");
  });

  it("honours a custom fallback for missing values", () => {
    expect(renderTemplate("{{job.location}}", {}, { onMissing: "—" })).toBe("—");
  });

  /**
   * The important one. Deleting an unrecognised token would hide the typo and
   * leave a fluent sentence with a hole in it; leaving it visible means whoever
   * reviews the rendered script sees exactly what went wrong.
   */
  it("leaves an UNKNOWN token exactly as written", () => {
    expect(renderTemplate("Hi {{candidate.naem}}", { "candidate.name": "Rahul" })).toBe(
      "Hi {{candidate.naem}}"
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(
      renderTemplate("{{candidate.name}} and {{candidate.name}}", { "candidate.name": "Rahul" })
    ).toBe("Rahul and Rahul");
  });

  it("does not re-scan substituted values for tokens", () => {
    // A candidate literally named "{{job.title}}" must not cause a second pass.
    expect(renderTemplate("{{candidate.name}}", { "candidate.name": "{{job.title}}" })).toBe(
      "{{job.title}}"
    );
  });
});

describe("renderPreview", () => {
  it("produces the spec's example substitutions", () => {
    const out = renderPreview("{{candidate.name}} for {{job.title}}");
    expect(out).toBe("Rahul Sharma for Senior Java Developer");
  });

  it("leaves nothing unresolved for a script using only catalogued fields", () => {
    const template = PLACEHOLDER_FIELDS.map((f) => toToken(f.token)).join("\n");
    expect(renderPreview(template)).not.toContain("{{");
  });
});

describe("insertToken", () => {
  it("inserts at the caret, not at the end", () => {
    // The spec's test: "inserting a placeholder correctly adds the token at
    // cursor position".
    const result = insertToken({
      text: "Hello  — welcome",
      token: "candidate.name",
      selectionStart: 6,
      selectionEnd: 6,
    });
    expect(result.text).toBe("Hello {{candidate.name}} — welcome");
  });

  it("returns a caret position after the inserted token", () => {
    const result = insertToken({ text: "", token: "job.title", selectionStart: 0, selectionEnd: 0 });
    expect(result.text).toBe("{{job.title}}");
    expect(result.caret).toBe(result.text.length);
  });

  it("replaces a selection rather than inserting beside it", () => {
    const result = insertToken({
      text: "Hello NAME here",
      token: "candidate.name",
      selectionStart: 6,
      selectionEnd: 10,
    });
    expect(result.text).toBe("Hello {{candidate.name}} here");
  });

  it("adds a leading space so the token does not fuse with the previous word", () => {
    const result = insertToken({ text: "Hi,", token: "candidate.name", selectionStart: 3, selectionEnd: 3 });
    expect(result.text).toBe("Hi, {{candidate.name}}");
  });

  it("does not add a space before punctuation", () => {
    const result = insertToken({
      text: "Hi .",
      token: "candidate.name",
      selectionStart: 3,
      selectionEnd: 3,
    });
    expect(result.text).toBe("Hi {{candidate.name}}.");
  });

  it("clamps a caret beyond the text rather than producing undefined", () => {
    const result = insertToken({ text: "abc", token: "job.title", selectionStart: 99, selectionEnd: 99 });
    expect(result.text).toBe("abc {{job.title}}");
  });

  it("round-trips: an inserted token is found by the extractor", () => {
    const { text } = insertToken({ text: "", token: "job.salary_range", selectionStart: 0, selectionEnd: 0 });
    expect(extractTokens(text)).toEqual(["job.salary_range"]);
    expect(findPlaceholder("job.salary_range")).not.toBeNull();
  });
});
