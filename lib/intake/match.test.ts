import { describe, expect, it } from "vitest";
import {
  candidateNameFrom,
  describeIntakeConflict,
  hasIdentifyingDetails,
  resolveCandidateMatch,
} from "@/lib/intake/match";
import { normalizeEmail, normalizePhone } from "@/lib/candidates/dedupe";

const ANANYA = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Ananya Sharma",
  email_normalized: "ananya@example.com",
  phone_normalized: "9876543210",
};

const RAHUL = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Rahul Verma",
  email_normalized: "rahul@example.com",
  phone_normalized: "9000000001",
};

describe("resolveCandidateMatch", () => {
  it("creates when nothing matches", () => {
    const match = resolveCandidateMatch({
      email: "new@example.com",
      phone: "+91 90000 99999",
      existing: [],
    });
    expect(match.kind).toBe("create");
  });

  // The spec's first test: same email uploaded twice.
  it("matches on email alone, case-insensitively", () => {
    const match = resolveCandidateMatch({
      email: "  ANANYA@Example.COM ",
      phone: null,
      existing: [ANANYA, RAHUL],
    });
    expect(match).toEqual({
      kind: "match",
      candidateId: ANANYA.id,
      matchedOn: ["email"],
    });
  });

  // The spec's second test: same phone, different email.
  it("matches on phone alone across country-code and spacing differences", () => {
    for (const phone of ["+91 98765 43210", "098765-43210", "9876543210", "(+91) 98765 43210"]) {
      const match = resolveCandidateMatch({
        email: "different.address@example.com",
        phone,
        existing: [ANANYA, RAHUL],
      });
      expect(match, phone).toEqual({
        kind: "match",
        candidateId: ANANYA.id,
        matchedOn: ["phone"],
      });
    }
  });

  it("reports both fields when both match the same person", () => {
    const match = resolveCandidateMatch({
      email: "ananya@example.com",
      phone: "+91 98765 43210",
      existing: [ANANYA],
    });
    expect(match).toEqual({
      kind: "match",
      candidateId: ANANYA.id,
      matchedOn: ["email", "phone"],
    });
  });

  // The spec's ambiguous case, and the one thing the feature must never guess.
  it("flags a conflict when email and phone point at DIFFERENT candidates", () => {
    const match = resolveCandidateMatch({
      email: "ananya@example.com",
      phone: "9000000001", // Rahul's
      existing: [ANANYA, RAHUL],
    });

    expect(match.kind).toBe("conflict");
    if (match.kind !== "conflict") throw new Error("unreachable");
    expect(match.reason).toBe("email_phone_disagree");
    expect(match.candidateIds).toEqual([ANANYA.id, RAHUL.id].sort());
  });

  it("does not auto-merge in EITHER direction", () => {
    const forward = resolveCandidateMatch({
      email: "ananya@example.com",
      phone: "9000000001",
      existing: [ANANYA, RAHUL],
    });
    const reverse = resolveCandidateMatch({
      email: "rahul@example.com",
      phone: "9876543210",
      existing: [ANANYA, RAHUL],
    });

    expect(forward.kind).toBe("conflict");
    expect(reverse.kind).toBe("conflict");
    // Same pair, same order — the stored evidence is stable whichever way the
    // resume happened to be written.
    if (forward.kind !== "conflict" || reverse.kind !== "conflict") throw new Error("unreachable");
    expect(forward.candidateIds).toEqual(reverse.candidateIds);
  });

  /**
   * There is no unique index on candidates.email_normalized, so this state is
   * reachable today — two records for one person, created before dedupe caught
   * them. It is exactly as ambiguous as the spec's named case.
   */
  it("flags a conflict when one email already belongs to two candidates", () => {
    const twin = { ...RAHUL, email_normalized: ANANYA.email_normalized };
    const match = resolveCandidateMatch({
      email: "ananya@example.com",
      phone: null,
      existing: [ANANYA, twin],
    });

    expect(match.kind).toBe("conflict");
    if (match.kind !== "conflict") throw new Error("unreachable");
    expect(match.reason).toBe("email_ambiguous");
  });

  it("flags a conflict when one phone already belongs to two candidates", () => {
    const twin = { ...RAHUL, phone_normalized: ANANYA.phone_normalized };
    const match = resolveCandidateMatch({
      email: null,
      phone: "9876543210",
      existing: [ANANYA, twin],
    });

    expect(match.kind).toBe("conflict");
    if (match.kind !== "conflict") throw new Error("unreachable");
    expect(match.reason).toBe("phone_ambiguous");
  });

  it("creates when the resume has no contact details at all", () => {
    expect(
      resolveCandidateMatch({ email: null, phone: null, existing: [ANANYA, RAHUL] }).kind
    ).toBe("create");
    expect(resolveCandidateMatch({ email: "   ", phone: "", existing: [ANANYA] }).kind).toBe(
      "create"
    );
  });

  /**
   * Sequential matching — "check email, else check phone" — passes every test
   * above except this one. It is the whole reason the implementation takes a
   * union instead.
   */
  it("does not silently prefer the email's owner over the phone's", () => {
    const match = resolveCandidateMatch({
      email: "ananya@example.com",
      phone: "9000000001",
      existing: [ANANYA, RAHUL],
    });
    expect(match.kind).not.toBe("match");
  });

  it("ignores a candidate whose normalised fields are both null", () => {
    const blank = { id: "33333333-3333-3333-3333-333333333333", email_normalized: null, phone_normalized: null };
    const match = resolveCandidateMatch({
      email: null,
      phone: "9876543210",
      existing: [blank, ANANYA],
    });
    expect(match).toEqual({ kind: "match", candidateId: ANANYA.id, matchedOn: ["phone"] });
  });
});

describe("normalization used by matching", () => {
  // These are the rules the matcher inherits; asserted here so a change in
  // lib/candidates/dedupe.ts that would alter matching fails a matching test.
  it("compares emails lowercased and trimmed", () => {
    expect(normalizeEmail(" Ananya@Example.com ")).toBe("ananya@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("compares phones as the last 10 digits", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("098765-43210")).toBe("9876543210");
    expect(normalizePhone("+1 (415) 555-0134")).toBe("4155550134");
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("abc")).toBeNull();
  });

  it("does NOT treat gmail dot/plus variants as the same address", () => {
    // Deliberate: two corporate addresses that differ by a dot are two people
    // on most providers, and merging them is unrecoverable.
    expect(normalizeEmail("a.n.anya@example.com")).not.toBe(normalizeEmail("ananya@example.com"));
  });
});

describe("hasIdentifyingDetails", () => {
  it("accepts a resume with any one of name, email or phone", () => {
    expect(hasIdentifyingDetails({ name: "Meera", email: null, phone: null })).toBe(true);
    expect(hasIdentifyingDetails({ name: null, email: "m@example.com", phone: null })).toBe(true);
    expect(hasIdentifyingDetails({ name: null, email: null, phone: "9876543210" })).toBe(true);
  });

  it("rejects a resume with none of them", () => {
    expect(hasIdentifyingDetails({ name: null, email: null, phone: null })).toBe(false);
    expect(hasIdentifyingDetails({ name: "  ", email: "", phone: "---" })).toBe(false);
  });
});

describe("candidateNameFrom", () => {
  it("prefers the parsed name", () => {
    expect(candidateNameFrom({ name: "Meera Nair", email: "m@example.com", phone: null })).toBe(
      "Meera Nair"
    );
  });

  it("falls back to the email's local part rather than refusing the file", () => {
    expect(candidateNameFrom({ name: null, email: "meera.nair@example.com", phone: null })).toBe(
      "meera nair"
    );
  });

  it("falls back to the last four phone digits when there is no email", () => {
    expect(candidateNameFrom({ name: null, email: null, phone: "+91 98765 43210" })).toBe(
      "Candidate 3210"
    );
  });

  it("returns null when there is nothing at all", () => {
    expect(candidateNameFrom({ name: null, email: null, phone: null })).toBeNull();
  });
});

describe("describeIntakeConflict", () => {
  it("names what to go and check, for each reason", () => {
    expect(describeIntakeConflict("email_phone_disagree")).toContain("phone number to another");
    expect(describeIntakeConflict("email_ambiguous")).toContain("email address");
    expect(describeIntakeConflict("phone_ambiguous")).toContain("phone number");
  });
});
