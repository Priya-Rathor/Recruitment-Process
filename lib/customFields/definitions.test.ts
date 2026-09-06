import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORM_FIELD_TYPES } from "@/lib/forms/fields";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  FIELD_KEY_MAX,
  RESERVED_KEYS,
  fieldKeyFromLabel,
  uniqueFieldKey,
  validateDefinition,
  type CustomFieldEntity,
  type DefinitionInput,
} from "@/lib/customFields/definitions";

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/0039_module27_custom_fields.sql"
);

function input(overrides: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    entity_type: "job",
    label: "Visa Sponsorship",
    field_type: "yes_no",
    options: [],
    required: false,
    show_on_public_form: false,
    ...overrides,
  };
}

describe("the field-type taxonomy is Module 23's, not a second one", () => {
  it("is a strict subset of FORM_FIELD_TYPES", () => {
    for (const type of CUSTOM_FIELD_TYPES) {
      expect(FORM_FIELD_TYPES).toContain(type);
    }
  });

  it("excludes exactly email, phone and file_upload", () => {
    const missing = FORM_FIELD_TYPES.filter((type) => !CUSTOM_FIELD_TYPES.includes(type));
    expect([...missing].sort()).toEqual(["email", "file_upload", "phone"]);
  });

  it("covers the nine types the brief asks for", () => {
    expect([...CUSTOM_FIELD_TYPES].sort()).toEqual(
      [
        "checkbox", "date", "dropdown", "long_text", "number",
        "radio", "short_text", "url", "yes_no",
      ].sort()
    );
  });
});

describe("fieldKeyFromLabel", () => {
  it("slugifies the way the brief's example does", () => {
    expect(fieldKeyFromLabel("Visa Sponsorship")).toBe("visa_sponsorship");
  });

  it("drops punctuation and collapses separators", () => {
    expect(fieldKeyFromLabel("Notice period (in weeks)?")).toBe("notice_period_in_weeks");
  });

  it("strips accents rather than turning them into separators", () => {
    // "Región" must not become "regi_n" — two visually identical labels would
    // otherwise produce two different keys.
    expect(fieldKeyFromLabel("Región")).toBe("region");
  });

  it("prefixes a key that would start with a digit", () => {
    // The database CHECK requires a leading letter; failing here rather than at
    // insert time is the difference between a hint and a 400.
    expect(fieldKeyFromLabel("2nd interview note")).toBe("f_2nd_interview_note");
  });

  it("returns empty for a label with nothing usable", () => {
    expect(fieldKeyFromLabel("!!!")).toBe("");
  });

  it("never exceeds the column's length limit", () => {
    expect(fieldKeyFromLabel("x".repeat(200)).length).toBeLessThanOrEqual(FIELD_KEY_MAX);
  });
});

describe("uniqueFieldKey", () => {
  it("leaves a free key alone", () => {
    expect(uniqueFieldKey("region", ["other"])).toBe("region");
  });

  it("suffixes a taken key", () => {
    expect(uniqueFieldKey("region", ["region"])).toBe("region_2");
    expect(uniqueFieldKey("region", ["region", "region_2"])).toBe("region_3");
  });

  it("keeps the suffixed key within the length limit", () => {
    const long = "a".repeat(FIELD_KEY_MAX);
    expect(uniqueFieldKey(long, [long]).length).toBeLessThanOrEqual(FIELD_KEY_MAX);
  });
});

describe("validateDefinition", () => {
  it("accepts a plain field and returns its key", () => {
    const result = validateDefinition(input());
    expect(result).toEqual({ ok: true, field_key: "visa_sponsorship" });
  });

  it("rejects a blank label", () => {
    const result = validateDefinition(input({ label: "   " }));
    expect(result.ok).toBe(false);
  });

  it("requires options for choice types", () => {
    const result = validateDefinition(input({ field_type: "dropdown", options: [] }));
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate options", () => {
    const result = validateDefinition(
      input({ field_type: "dropdown", options: ["A", "A"] })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an excluded field type", () => {
    // Cast: the point of the test is that a value outside the union is refused
    // at runtime, which is exactly what an API caller can send.
    const result = validateDefinition(input({ field_type: "email" as never }));
    expect(result.ok).toBe(false);
  });

  it("refuses show_on_public_form on a non-job field", () => {
    const result = validateDefinition(
      input({ entity_type: "candidate", show_on_public_form: true })
    );
    expect(result.ok).toBe(false);
  });

  it("de-duplicates against keys already in use", () => {
    const result = validateDefinition(input(), ["visa_sponsorship"]);
    expect(result).toEqual({ ok: true, field_key: "visa_sponsorship_2" });
  });
});

describe("the collision rule (brief §7)", () => {
  it('rejects "email" as a candidate field key', () => {
    const result = validateDefinition(
      input({ entity_type: "candidate", label: "Email", field_type: "short_text" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("built-in");
  });

  it("rejects a fixed field on every entity", () => {
    const cases: Array<[CustomFieldEntity, string]> = [
      ["job", "Location"],
      ["job", "Salary"],
      ["candidate", "Phone"],
      ["candidate", "Skills"],
      ["application", "Stage"],
      ["application", "Priority"],
    ];

    for (const [entity_type, label] of cases) {
      const result = validateDefinition(
        input({ entity_type, label, field_type: "short_text" })
      );
      expect(result.ok, `${entity_type}.${label} should be reserved`).toBe(false);
    }
  });

  it("still allows a name that merely contains a reserved word", () => {
    // "Salary band" is not "salary". Refusing it would make the rule feel
    // arbitrary and push people towards worse names.
    const result = validateDefinition(input({ label: "Salary band", field_type: "short_text" }));
    expect(result).toEqual({ ok: true, field_key: "salary_band" });
  });
});

/**
 * THE LIST IS IN TWO PLACES AND THIS IS WHAT KEEPS THEM HONEST.
 *
 * The database needs it (a signed-in user can write through PostgREST and skip
 * the API entirely) and the UI needs it (to say "reserved" while somebody is
 * still typing). Two copies drift; a test that reads the real SQL does not.
 */
describe("reserved keys match migration 0039", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  for (const entity of CUSTOM_FIELD_ENTITIES) {
    it(`${entity}: SQL and TypeScript agree`, () => {
      const block = new RegExp(
        `when '${entity}' then field_key <> all \\(array\\[([^\\]]*)\\]`,
        "m"
      ).exec(sql);

      expect(block, `no reserved-key array for '${entity}' in the migration`).toBeTruthy();

      const fromSql = [...block![1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

      expect([...fromSql].sort()).toEqual([...RESERVED_KEYS[entity]].sort());
    });
  }
});
