import { describe, expect, it } from "vitest";
import { renderTemplate, splitTokens } from "@/lib/hiring-stages/placeholders";
import {
  buildCustomValues,
  customPlaceholderFields,
  customToken,
} from "@/lib/customFields/placeholders";
import type { CustomFieldDefinition } from "@/lib/customFields/definitions";

function definition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: "def-1",
    organization_id: "org-1",
    entity_type: "job",
    field_key: "visa_sponsorship",
    label: "Visa sponsorship",
    field_type: "yes_no",
    options: [],
    required: false,
    show_on_public_form: false,
    display_order: 0,
    active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("customPlaceholderFields", () => {
  it("produces a three-part token carrying the entity", () => {
    const [field] = customPlaceholderFields([definition()]);
    expect(field.token).toBe("custom.job.visa_sponsorship");
    expect(field.group).toBe("custom");
  });

  it("distinguishes the same field key on two entities", () => {
    const fields = customPlaceholderFields([
      definition({ id: "a", entity_type: "job", field_key: "region", label: "Region" }),
      definition({ id: "b", entity_type: "candidate", field_key: "region", label: "Region" }),
    ]);

    expect(fields.map((field) => field.token)).toEqual([
      "custom.job.region",
      "custom.candidate.region",
    ]);
    // Two rows both labelled "Region" would be unchoosable in the picker.
    expect(new Set(fields.map((field) => field.label)).size).toBe(2);
  });

  it("omits inactive definitions", () => {
    // A template written around a retired field would render a hole in a
    // sentence sent to a candidate.
    expect(customPlaceholderFields([definition({ active: false })])).toEqual([]);
  });
});

describe("the widened token pattern recognises custom tokens", () => {
  const fields = customPlaceholderFields([
    definition(),
    definition({ id: "d2", field_key: "region_2", label: "Region", entity_type: "candidate" }),
  ]);

  it("treats a three-part token as known", () => {
    const { known, unknown } = splitTokens("{{custom.job.visa_sponsorship}}", fields);
    expect(known.map((field) => field.token)).toEqual(["custom.job.visa_sponsorship"]);
    expect(unknown).toEqual([]);
  });

  it("recognises a key containing a digit", () => {
    // uniqueFieldKey() appends _2 when two labels slugify the same; the old
    // pattern allowed no digits at all.
    const { known } = splitTokens("{{custom.candidate.region_2}}", fields);
    expect(known.map((field) => field.token)).toEqual(["custom.candidate.region_2"]);
  });

  it("still leaves an unrecognised token in the output verbatim", () => {
    expect(renderTemplate("{{custom.job.nope}}", {}, { fields })).toBe("{{custom.job.nope}}");
  });
});

describe("buildCustomValues", () => {
  it("formats by type", () => {
    const values = buildCustomValues([definition()], {
      job: new Map([["def-1", true]]),
    });
    expect(values[customToken("job", "visa_sponsorship")]).toBe("Yes");
  });

  it("renders a missing value as empty, not as 'null'", () => {
    const values = buildCustomValues([definition()], {});
    expect(values["custom.job.visa_sponsorship"]).toBe("");
  });

  /**
   * The one genuinely subtle rule in this module.
   */
  describe("a public-form job field prefers the applicant's own answer", () => {
    const publicField = definition({ show_on_public_form: true });

    it("uses the application's value when there is one", () => {
      const values = buildCustomValues([publicField], {
        job: new Map([["def-1", false]]),
        application: new Map([["def-1", true]]),
      });
      // The message is written TO the candidate: "you told us Yes", not what the
      // job happens to require.
      expect(values["custom.job.visa_sponsorship"]).toBe("Yes");
    });

    it("falls back to the job's value when the applicant has none", () => {
      const values = buildCustomValues([publicField], {
        job: new Map([["def-1", true]]),
      });
      expect(values["custom.job.visa_sponsorship"]).toBe("Yes");
    });

    it("does not consult the application for a field not on the public form", () => {
      const values = buildCustomValues([definition({ show_on_public_form: false })], {
        job: new Map([["def-1", false]]),
        application: new Map([["def-1", true]]),
      });
      expect(values["custom.job.visa_sponsorship"]).toBe("No");
    });
  });
});
