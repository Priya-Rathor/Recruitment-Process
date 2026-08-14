import { describe, expect, it } from "vitest";
import {
  describeMatch,
  findDuplicates,
  formatMatchedOn,
  normalizeEmail,
  normalizePhone,
  type DedupeCandidate,
} from "./dedupe";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Rahul@Example.COM ")).toBe("rahul@example.com");
  });

  it("returns null for blank or non-string input", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("does NOT strip gmail-style dots or plus tags", () => {
    // Deliberate: on many corporate providers these are different mailboxes,
    // so collapsing them would merge two real people.
    expect(normalizeEmail("first.last@corp.com")).toBe("first.last@corp.com");
    expect(normalizeEmail("rahul+jobs@example.com")).toBe("rahul+jobs@example.com");
  });
});

describe("normalizePhone", () => {
  it("reduces the same Indian number written four ways to one key", () => {
    const expected = "9876543210";
    expect(normalizePhone("+91 98765 43210")).toBe(expected);
    expect(normalizePhone("098765 43210")).toBe(expected);
    expect(normalizePhone("9876543210")).toBe(expected);
    expect(normalizePhone("(+91)-98765-43210")).toBe(expected);
  });

  it("handles other country codes by comparing the last 10 digits", () => {
    expect(normalizePhone("+1 (415) 555-0134")).toBe("4155550134");
    expect(normalizePhone("+44 20 7946 0958")).toBe("2079460958");
  });

  it("keeps a short number as-is rather than discarding it", () => {
    expect(normalizePhone("55-0134")).toBe("550134");
  });

  it("returns null when there are no digits at all", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("findDuplicates", () => {
  const existing: DedupeCandidate[] = [
    { id: "a", name: "Rahul Sharma", email_normalized: "rahul@example.com", phone_normalized: "9876543210" },
    { id: "b", name: "Priya Nair", email_normalized: "priya@example.com", phone_normalized: "9123456780" },
    { id: "c", name: "No Contact", email_normalized: null, phone_normalized: null },
  ];

  it("catches the same email arriving from a different source", () => {
    // The spec's headline case: same person, career page vs. referral.
    const matches = findDuplicates({ email: "  RAHUL@example.com ", existing });
    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("a");
    expect(matches[0].matchedOn).toEqual(["email"]);
  });

  it("catches the same phone written in a different format", () => {
    const matches = findDuplicates({ phone: "+91 98765 43210", existing });
    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("a");
    expect(matches[0].matchedOn).toEqual(["phone"]);
  });

  it("reports both fields when both collide", () => {
    const matches = findDuplicates({
      email: "rahul@example.com",
      phone: "09876543210",
      existing,
    });
    expect(matches[0].matchedOn).toEqual(["email", "phone"]);
  });

  it("ranks a two-field match above a one-field match", () => {
    const pool: DedupeCandidate[] = [
      { id: "weak", email_normalized: "shared@example.com", phone_normalized: "1111111111" },
      { id: "strong", email_normalized: "shared@example.com", phone_normalized: "9876543210" },
    ];
    const matches = findDuplicates({ email: "shared@example.com", phone: "9876543210", existing: pool });
    expect(matches.map((match) => match.candidate.id)).toEqual(["strong", "weak"]);
  });

  it("returns nothing when neither contact detail is supplied", () => {
    // A blank form must not flag every record in the database.
    expect(findDuplicates({ existing })).toEqual([]);
    expect(findDuplicates({ email: "", phone: "   ", existing })).toEqual([]);
  });

  it("never matches a candidate that has no contact details stored", () => {
    expect(findDuplicates({ email: "someone@example.com", existing })).toEqual([]);
  });

  it("excludes the record being edited, so a candidate is not its own duplicate", () => {
    const matches = findDuplicates({
      email: "rahul@example.com",
      existing,
      excludeId: "a",
    });
    expect(matches).toEqual([]);
  });

  it("finds no match for a genuinely new person", () => {
    expect(
      findDuplicates({ email: "brand.new@example.com", phone: "9000000001", existing })
    ).toEqual([]);
  });

  it("handles an empty database", () => {
    expect(findDuplicates({ email: "a@b.com", existing: [] })).toEqual([]);
  });
});

describe("match descriptions", () => {
  it("serialises for storage", () => {
    expect(formatMatchedOn(["email"])).toBe("email");
    expect(formatMatchedOn(["email", "phone"])).toBe("email,phone");
  });

  it("explains the match in plain language", () => {
    expect(describeMatch(["email"])).toBe("Same email address");
    expect(describeMatch(["phone"])).toBe("Same phone number");
    expect(describeMatch(["email", "phone"])).toBe("Same email address and phone number");
  });
});
