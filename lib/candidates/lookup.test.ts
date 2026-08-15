import { describe, expect, it } from "vitest";
import { LOOKUP_MIN_LENGTH, describeCandidate, escapeLookupText } from "@/lib/candidates/lookup";

describe("escapeLookupText", () => {
  /**
   * PostgREST's `or()` takes a comma-separated filter STRING, so a comma in
   * user input does not become a value — it becomes another filter. This is the
   * injection surface of the typeahead, and it is why the characters are
   * stripped rather than escaped.
   */
  it("strips the characters that would change the query's structure", () => {
    expect(escapeLookupText("a,b")).toBe("a b");
    expect(escapeLookupText("name.eq.x,id.eq.y")).toBe("name.eq.x id.eq.y");
    expect(escapeLookupText("a(b)c")).toBe("a b c");
    expect(escapeLookupText("back\\slash")).toBe("back slash");
  });

  it("strips a bare percent, which would match every row", () => {
    expect(escapeLookupText("%")).toBe("");
    expect(escapeLookupText("%%%")).toBe("");
  });

  it("leaves ordinary names, emails and phone numbers alone", () => {
    expect(escapeLookupText("Ananya Sharma")).toBe("Ananya Sharma");
    expect(escapeLookupText("ananya@example.com")).toBe("ananya@example.com");
    expect(escapeLookupText("+91 98765 43210")).toBe("+91 98765 43210");
    expect(escapeLookupText("O'Brien")).toBe("O'Brien");
  });

  it("collapses the whitespace it creates", () => {
    expect(escapeLookupText("a , , b")).toBe("a b");
    expect(escapeLookupText("   padded   ")).toBe("padded");
  });

  it("keeps the minimum length meaningful", () => {
    // A one-character query matches most of a candidate table, so the caller
    // refuses it. Anything that reduces to nothing must fall below the bar.
    expect(escapeLookupText(",,,").length).toBeLessThan(LOOKUP_MIN_LENGTH);
  });
});

describe("describeCandidate", () => {
  const base = {
    id: "1",
    name: "Ananya Sharma",
    email: null,
    phone: null,
    current_role: null,
    current_company: null,
    archived_at: null,
  };

  it("leads with role and company, then contact details", () => {
    expect(
      describeCandidate({
        ...base,
        current_role: "Senior Java Developer",
        current_company: "Infosys",
        email: "ananya@example.com",
      })
    ).toBe("Senior Java Developer · Infosys — ananya@example.com");
  });

  it("omits the parts that are missing rather than printing gaps", () => {
    expect(describeCandidate({ ...base, phone: "+91 98765 43210" })).toBe("+91 98765 43210");
    expect(describeCandidate({ ...base, current_role: "Engineer" })).toBe("Engineer");
  });

  it("says so plainly when there is nothing to show", () => {
    // Never an empty string: a blank line under a name reads as a rendering bug.
    expect(describeCandidate(base)).toBe("No other details on file");
  });
});
