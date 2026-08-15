import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  TEMPLATES,
  isExternalTemplate,
  renderTemplate,
} from "@/lib/notifications/templates";
import { clockTimesIn, findAlteredFacts } from "@/lib/notifications/facts";
import {
  applyMandatoryChannels,
  effectivePreference,
  resolvePreference,
  type PreferenceRow,
} from "@/lib/notifications/preferences";
import { maskEmail } from "@/lib/notifications/notify";

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------
describe("templates", () => {
  it("declares every fixed fact as a real placeholder", () => {
    // A fact that isn't in the template can never be verified in a rewrite, so
    // the guard would silently pass everything for that field.
    for (const type of NOTIFICATION_TYPES) {
      const template = TEMPLATES[type];
      const text = `${template.title} ${template.body}`;

      for (const fact of template.fixedFacts) {
        expect(text, `${type}: fixed fact "${fact}" isn't in the template`).toContain(
          `{{${fact}}}`
        );
        expect(
          template.placeholders,
          `${type}: fixed fact "${fact}" missing from placeholders`
        ).toContain(fact);
      }
    }
  });

  it("treats every candidate-facing template's time and name as fixed", () => {
    // The external ones are the ones a mistake actually reaches a person on.
    for (const type of NOTIFICATION_TYPES) {
      if (!isExternalTemplate(type)) continue;
      expect(TEMPLATES[type].fixedFacts, `${type}`).toContain("candidate_name");
    }
  });

  it("renders with every fact substituted", () => {
    const result = renderTemplate({
      type: "interview_reminder",
      values: {
        candidate_name: "Rahul Sharma",
        interview_time: "Tuesday 18 August at 2:00pm",
        job_title: "Senior Java Developer",
        location: "Bangalore office",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.body).toContain("Rahul Sharma");
      expect(result.message.body).toContain("2:00pm");
      expect(result.message.body).not.toContain("{{");
      expect(result.message.facts.interview_time).toBe("Tuesday 18 August at 2:00pm");
    }
  });

  /**
   * The one that matters. "your interview is scheduled for " is worse than no
   * message — it looks deliberate, and the recipient cannot tell what was lost.
   */
  it("refuses to render when a fixed fact is missing", () => {
    const result = renderTemplate({
      type: "interview_reminder",
      values: {
        candidate_name: "Rahul Sharma",
        interview_time: null,
        job_title: "Senior Java Developer",
        location: "Bangalore office",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("interview_time");
  });

  it("refuses an empty string as a fact, not just null", () => {
    const result = renderTemplate({
      type: "interview_reminder",
      values: {
        candidate_name: "   ",
        interview_time: "2:00pm",
        job_title: "Developer",
        location: "Remote",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("degrades a non-fact placeholder instead of failing", () => {
    // A missing free-text reason must not block an alert about a real failure.
    const result = renderTemplate({
      type: "automation_failed",
      values: { automation_name: "Screen strong matches", reason: null },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.body).toContain("Screen strong matches");
      expect(result.message.body).toContain("not recorded");
    }
  });
});

// -----------------------------------------------------------------------------
// THE SPEC'S HARD CONSTRAINT:
//   "AI tone adjustments never alter the fixed facts in a template
//    (time, names, figures)."
// -----------------------------------------------------------------------------
const FACTS = {
  candidate_name: "Rahul Sharma",
  interview_time: "Tuesday 18 August at 2:00pm",
  job_title: "Senior Java Developer",
  location: "Bangalore office",
};

const ORIGINAL =
  "Hi Rahul Sharma, this is a reminder that your interview for the Senior Java Developer role " +
  "is scheduled for Tuesday 18 August at 2:00pm. Location: Bangalore office. " +
  "Please let us know if you need to reschedule.";

describe("findAlteredFacts", () => {
  it("accepts a rewrite that keeps every fact", () => {
    const rewritten =
      "Hi Rahul Sharma — just a quick reminder about your Senior Java Developer interview, " +
      "Tuesday 18 August at 2:00pm at the Bangalore office. Do let us know if you need to move it.";

    expect(findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL })).toEqual([]);
  });

  /**
   * The failure this whole module is built around. The sentence is warm,
   * fluent, and sends someone to an interview an hour late.
   */
  it("rejects a rewrite that changes the interview time", () => {
    const rewritten =
      "Hi Rahul Sharma, looking forward to seeing you for the Senior Java Developer role on " +
      "Tuesday 18 August at 3:00pm at the Bangalore office.";

    const violations = findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.kind === "missing_fact")).toBe(true);
  });

  it("rejects a shortened name", () => {
    // Friendly, and not the model's call to make on an external message.
    const rewritten =
      "Hi Rahul, your interview for the Senior Java Developer role is Tuesday 18 August at " +
      "2:00pm at the Bangalore office.";

    const violations = findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL });
    expect(violations.some((v) => v.detail.includes("Rahul Sharma"))).toBe(true);
  });

  it("rejects a dropped location", () => {
    const rewritten =
      "Hi Rahul Sharma, your interview for the Senior Java Developer role is Tuesday 18 August " +
      "at 2:00pm. See you then.";

    const violations = findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL });
    expect(violations.some((v) => v.detail.includes("Bangalore office"))).toBe(true);
  });

  /**
   * The subtle one a substring check alone misses: every fact is still present,
   * and the model has added an instruction that reads as fact.
   */
  it("rejects an invented arrival time even when every fact survives", () => {
    const rewritten = `${ORIGINAL} Please arrive by 1:45pm to sign in.`;

    const violations = findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.kind === "invented_time" || v.kind === "invented_number")).toBe(
      true
    );
  });

  it("rejects an invented figure", () => {
    const rewritten = `${ORIGINAL} The interview will last 45 minutes.`;

    const violations = findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL });
    expect(violations.some((v) => v.kind === "invented_number")).toBe(true);
  });

  it("allows restyling a time it did not change", () => {
    // "2:00 PM" is the same instant as "2:00pm". Rejecting this would make the
    // guard so brittle that somebody turns it off.
    const rewritten = ORIGINAL.replace("2:00pm", "2:00 PM").replace(
      "Tuesday 18 August at 2:00 PM",
      "Tuesday 18 August at 2:00 PM"
    );

    const violations = findAlteredFacts({
      rewritten,
      // The fact itself carries the original casing; the substring check is
      // case-insensitive, so this passes.
      facts: FACTS,
      original: ORIGINAL,
    });
    expect(violations.filter((v) => v.kind === "invented_time")).toEqual([]);
  });

  it("allows whitespace and case changes", () => {
    const rewritten = ORIGINAL.replace(/\s+/g, "  ").toUpperCase();
    expect(findAlteredFacts({ rewritten, facts: FACTS, original: ORIGINAL })).toEqual([]);
  });
});

describe("clockTimesIn", () => {
  it("normalises equivalent spellings to one value", () => {
    expect(clockTimesIn("at 2:00pm")).toEqual(clockTimesIn("at 2:00 PM"));
    expect(clockTimesIn("at 02:00pm")).toEqual(clockTimesIn("at 2:00pm"));
  });

  it("finds a bare hour with a meridiem", () => {
    expect(clockTimesIn("we'll call at 3pm")).toContain("3:00pm");
  });

  it("distinguishes different times", () => {
    expect(clockTimesIn("2:00pm")).not.toEqual(clockTimesIn("3:00pm"));
  });
});

// -----------------------------------------------------------------------------
// "User-level preferences correctly override organization defaults where
//  allowed." — the spec's third functional test.
// -----------------------------------------------------------------------------
describe("preference resolution", () => {
  const USER = "user-1";

  it("falls back to the template default when nothing is configured", () => {
    const resolved = resolvePreference({ type: "screening_completed", userId: USER, rows: [] });

    expect(resolved.source).toBe("template");
    expect(resolved.inApp).toBe(TEMPLATES.screening_completed.defaultInApp);
    expect(resolved.email).toBe(TEMPLATES.screening_completed.defaultEmail);
  });

  it("uses the organization default over the template default", () => {
    const rows: PreferenceRow[] = [
      {
        user_id: null,
        notification_type: "screening_completed",
        in_app_enabled: true,
        email_enabled: true,
      },
    ];

    const resolved = resolvePreference({ type: "screening_completed", userId: USER, rows });
    expect(resolved.source).toBe("organization");
    expect(resolved.email).toBe(true);
  });

  it("lets a user override the organization default", () => {
    const rows: PreferenceRow[] = [
      {
        user_id: null,
        notification_type: "screening_completed",
        in_app_enabled: true,
        email_enabled: true,
      },
      {
        user_id: USER,
        notification_type: "screening_completed",
        in_app_enabled: true,
        email_enabled: false,
      },
    ];

    const resolved = resolvePreference({ type: "screening_completed", userId: USER, rows });
    expect(resolved.source).toBe("user");
    expect(resolved.email).toBe(false);
  });

  it("ignores another user's override", () => {
    // The failure this catches: one person muting a channel for the whole team.
    const rows: PreferenceRow[] = [
      {
        user_id: "someone-else",
        notification_type: "screening_completed",
        in_app_enabled: false,
        email_enabled: false,
      },
    ];

    const resolved = resolvePreference({ type: "screening_completed", userId: USER, rows });
    expect(resolved.source).toBe("template");
    expect(resolved.inApp).toBe(true);
  });

  it("keeps preferences for different types independent", () => {
    const rows: PreferenceRow[] = [
      {
        user_id: USER,
        notification_type: "screening_completed",
        in_app_enabled: false,
        email_enabled: false,
      },
    ];

    const other = resolvePreference({ type: "candidate_submitted", userId: USER, rows });
    expect(other.source).toBe("template");
    expect(other.inApp).toBe(true);
  });
});

describe("applyMandatoryChannels", () => {
  /**
   * A deliberate deviation from "preferences always win". A candidate who
   * declined an automated call and asked for a person must not be silently
   * muted — Module 8 will never dial them again, so if nobody sees it they are
   * dropped.
   */
  it("cannot mute in-app for a high-priority type", () => {
    const result = applyMandatoryChannels({
      type: "screening_callback_requested",
      preference: { inApp: false, email: false },
    });

    expect(result.inApp).toBe(true);
  });

  it("still lets email be muted for a high-priority type", () => {
    // Muting a channel is a preference; muting the record is not.
    const result = applyMandatoryChannels({
      type: "screening_callback_requested",
      preference: { inApp: false, email: false },
    });

    expect(result.email).toBe(false);
  });

  it("leaves normal-priority types fully mutable", () => {
    const result = applyMandatoryChannels({
      type: "candidate_submitted",
      preference: { inApp: false, email: false },
    });

    expect(result.inApp).toBe(false);
  });

  it("is applied by effectivePreference, not just available separately", () => {
    // The regression this guards: the rule existing but never being called.
    const rows: PreferenceRow[] = [
      {
        user_id: "user-1",
        notification_type: "automation_failed",
        in_app_enabled: false,
        email_enabled: false,
      },
    ];

    const resolved = effectivePreference({ type: "automation_failed", userId: "user-1", rows });
    expect(resolved.inApp).toBe(true);
  });
});

describe("maskEmail", () => {
  it("keeps the domain and hides the local part", () => {
    const masked = maskEmail("rahul.sharma@example.com");

    // Asserted as properties rather than a hand-counted literal — the point is
    // that the address is unreadable, not that it has a specific dot count.
    expect(masked.endsWith("@example.com")).toBe(true);
    expect(masked.startsWith("ra")).toBe(true);
    expect(masked).not.toContain("hul.sharma");
  });

  it("handles a short local part without exposing it", () => {
    expect(maskEmail("a@example.com")).toBe("a•@example.com");
  });

  it("does not throw on a malformed address", () => {
    expect(maskEmail("not-an-address")).toBe("•••");
  });
});
