import { describe, expect, it } from "vitest";
import {
  CUSTOM_PREFIX,
  prefixKey,
  splitAnswers,
  stripPrefix,
  toPublicFields,
  type PublicCustomSource,
} from "@/lib/customFields/publicForm";

function source(overrides: Partial<PublicCustomSource> = {}): PublicCustomSource {
  return {
    field_key: "visa_sponsorship",
    label: "Do you need visa sponsorship?",
    field_type: "yes_no",
    options: [],
    required: true,
    display_order: 0,
    ...overrides,
  };
}

describe("key prefixing", () => {
  it("round-trips", () => {
    expect(stripPrefix(prefixKey("region"))).toBe("region");
  });

  it("does not claim a form's own field", () => {
    expect(stripPrefix("region")).toBeNull();
    // The single-underscore near-miss the double prefix exists to survive: a
    // form field labelled "Custom region" slugifies to exactly this.
    expect(stripPrefix("custom_region")).toBeNull();
  });

  it("cannot be produced by the slugifier", () => {
    // Runs of separators collapse to one "_", so no label yields "custom__".
    expect(CUSTOM_PREFIX).toBe("custom__");
  });
});

describe("toPublicFields", () => {
  it("maps a definition onto the form's field shape", () => {
    expect(toPublicFields([source()])).toEqual([
      {
        fieldKey: "custom__visa_sponsorship",
        label: "Do you need visa sponsorship?",
        helpText: null,
        fieldType: "yes_no",
        options: [],
        required: true,
      },
    ]);
  });

  it("orders by display_order, not by input order", () => {
    const fields = toPublicFields([
      source({ field_key: "second", display_order: 2 }),
      source({ field_key: "first", display_order: 1 }),
    ]);
    expect(fields.map((field) => field.fieldKey)).toEqual([
      "custom__first",
      "custom__second",
    ]);
  });

  it("skips a field whose prefixed key the form already uses", () => {
    // Dropping the custom one is the safe direction: including it would
    // overwrite an answer the form itself owns.
    const fields = toPublicFields([source()], ["custom__visa_sponsorship"]);
    expect(fields).toEqual([]);
  });
});

describe("splitAnswers", () => {
  it("routes each answer to the right destination", () => {
    const { formAnswers, customAnswers } = splitAnswers({
      email: "a@b.com",
      custom__visa_sponsorship: "yes",
      custom__region: "EMEA",
    });

    expect(formAnswers).toEqual({ email: "a@b.com" });
    expect(customAnswers).toEqual({ visa_sponsorship: "yes", region: "EMEA" });
  });

  it("leaves a submission with no custom fields untouched", () => {
    const { formAnswers, customAnswers } = splitAnswers({ email: "a@b.com" });
    expect(formAnswers).toEqual({ email: "a@b.com" });
    expect(customAnswers).toEqual({});
  });
});
