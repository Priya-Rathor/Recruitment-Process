// =============================================================================
// The boundary between an application and the person it is about.
//
// One candidate can hold five applications. If any of them could edit the
// person's phone number, five screens would race to own one fact and the
// loser's copy would be silently wrong. So the Application API refuses those
// fields outright — and because the UI is a convenience rather than a boundary
// (this endpoint is reachable by curl, and the browser holds a PostgREST
// client), the refusal is what these tests pin down.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  APPLICATION_PRIORITIES,
  CANDIDATE_ONLY_FIELDS,
  PRIORITY_LABELS,
  PRIORITY_TONE,
  isApplicationPriority,
  rejectCandidateFields,
} from "@/lib/applications/validation";

describe("rejectCandidateFields", () => {
  it("allows a payload of application-level fields", () => {
    expect(
      rejectCandidateFields({
        stage: "shortlisted",
        assigned_recruiter_id: "u1",
        source: "referral",
        priority: "high",
        match_score: 82,
      })
    ).toEqual({ ok: true });
  });

  it("refuses each identity field, and names it", () => {
    for (const field of ["name", "email", "phone"] as const) {
      const result = rejectCandidateFields({ stage: "shortlisted", [field]: "x" });
      expect(result.ok, field).toBe(false);
      if (result.ok) continue;
      expect(result.field).toBe(field);
      expect(result.message).toContain("candidate");
    }
  });

  /**
   * The case a naive `if (payload.email)` check would let through. Sending
   * `{"email": null}` is an attempt to ERASE an address — an intent, not an
   * absence of one — and erasing a candidate's email from an application screen
   * is exactly what this guard exists to stop.
   */
  it("refuses a field that is present but null or empty", () => {
    expect(rejectCandidateFields({ email: null }).ok).toBe(false);
    expect(rejectCandidateFields({ email: "" }).ok).toBe(false);
    expect(rejectCandidateFields({ phone: undefined }).ok).toBe(false);
    expect(rejectCandidateFields({ name: 0 }).ok).toBe(false);
    expect(rejectCandidateFields({ name: false }).ok).toBe(false);
  });

  it("refuses the normalised forms, which a trigger owns", () => {
    // Accepting these would let a caller desynchronise dedupe matching from the
    // real values — the same person would stop matching themselves.
    expect(rejectCandidateFields({ email_normalized: "a@b.com" }).ok).toBe(false);
    expect(rejectCandidateFields({ phone_normalized: "9876543210" }).ok).toBe(false);
  });

  it("refuses the nested shapes a well-meaning client might send", () => {
    expect(rejectCandidateFields({ candidate: { name: "New" } }).ok).toBe(false);
    expect(rejectCandidateFields({ candidate_email: "new@example.com" }).ok).toBe(false);
    expect(rejectCandidateFields({ candidate_name: "New" }).ok).toBe(false);
    expect(rejectCandidateFields({ candidate_phone: "123" }).ok).toBe(false);
  });

  it("refuses as soon as ONE identity field appears among valid ones", () => {
    // The realistic attack: a mostly-legitimate payload with one extra key.
    const result = rejectCandidateFields({
      stage: "hired",
      priority: "high",
      email: "attacker@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("email");
  });

  it("ignores a body that is not an object", () => {
    // Malformed bodies are the JSON parser's problem, not this guard's.
    for (const body of [null, undefined, "string", 42, []]) {
      expect(rejectCandidateFields(body).ok, String(body)).toBe(true);
    }
  });

  it("covers every field the list claims to", () => {
    for (const field of CANDIDATE_ONLY_FIELDS) {
      expect(rejectCandidateFields({ [field]: "anything" }).ok, field).toBe(false);
    }
  });
});

describe("application priority", () => {
  it("has exactly three levels", () => {
    expect([...APPLICATION_PRIORITIES]).toEqual(["low", "normal", "high"]);
  });

  it("validates the value", () => {
    expect(isApplicationPriority("high")).toBe(true);
    expect(isApplicationPriority("urgent")).toBe(false);
    expect(isApplicationPriority(null)).toBe(false);
  });

  it("labels every level", () => {
    for (const value of APPLICATION_PRIORITIES) {
      expect(PRIORITY_LABELS[value], value).toBeTruthy();
    }
  });

  it("keeps the default level visually silent", () => {
    // A board where every card wears a coloured badge communicates nothing.
    expect(PRIORITY_TONE.normal).toBe("neutral");
    expect(PRIORITY_TONE.high).toBe("warning");
  });
});
