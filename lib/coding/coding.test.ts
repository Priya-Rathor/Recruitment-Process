// =============================================================================
// Module 20 — the rules that decide whether a candidate can work.
//
// These are the tests worth having. The editor, the QR code and the polling are
// all replaceable; the access decision is not, and getting it wrong in either
// direction is expensive — too strict locks somebody out of work they are being
// judged on, too loose lets a finished submission be edited after the fact.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  canStartCodingRound,
  checkSessionAccess,
  CODING_SESSION_STATUSES,
  defaultExpiry,
  describeLastSaved,
  isReusable,
  isTerminalStatus,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/coding/session";
import {
  CODING_LANGUAGES,
  defaultLanguage,
  isCodingLanguage,
  LANGUAGE_LABELS,
  LANGUAGE_STARTERS,
  normalizeLanguages,
} from "@/lib/coding/languages";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const FUTURE = new Date("2026-03-11T12:00:00.000Z").toISOString();
const PAST = new Date("2026-03-09T12:00:00.000Z").toISOString();

describe("checkSessionAccess", () => {
  it("opens an unexpired session that has not finished", () => {
    for (const status of ["created", "in_progress"] as const) {
      const decision = checkSessionAccess({ status, expiresAt: FUTURE, now: NOW });
      expect(decision.open, status).toBe(true);
    }
  });

  it("refuses an expired link even when the status still says created", () => {
    const decision = checkSessionAccess({ status: "created", expiresAt: PAST, now: NOW });
    expect(decision.open).toBe(false);
    if (decision.open) throw new Error("unreachable");
    expect(decision.code).toBe("expired");
    // The status is REPORTED as expired, not echoed back as created — the row
    // may not have been swept yet, and the candidate is told the truth about
    // what is happening to them rather than what a column says.
    expect(decision.status).toBe("expired");
  });

  it("refuses a submitted session so a final answer cannot be edited", () => {
    const decision = checkSessionAccess({ status: "submitted", expiresAt: FUTURE, now: NOW });
    expect(decision.open).toBe(false);
    if (decision.open) throw new Error("unreachable");
    expect(decision.code).toBe("submitted");
  });

  /**
   * The ordering test. A cancelled session that is ALSO past its expiry was
   * cancelled — telling the candidate "this expired" when a person actually
   * called it off is a small lie that makes the next conversation harder.
   */
  it("reports cancellation ahead of expiry when both are true", () => {
    const decision = checkSessionAccess({ status: "cancelled", expiresAt: PAST, now: NOW });
    expect(decision.open).toBe(false);
    if (decision.open) throw new Error("unreachable");
    expect(decision.code).toBe("cancelled");
  });

  it("fails closed on an unparseable expiry rather than opening forever", () => {
    const decision = checkSessionAccess({
      status: "created",
      expiresAt: "not-a-date",
      now: NOW,
    });
    expect(decision.open).toBe(false);
    if (decision.open) throw new Error("unreachable");
    expect(decision.code).toBe("expired");
  });

  it("treats the exact expiry instant as closed", () => {
    const decision = checkSessionAccess({
      status: "created",
      expiresAt: NOW.toISOString(),
      now: NOW,
    });
    expect(decision.open).toBe(false);
  });

  /**
   * Every refusal has to be readable by somebody with no account, no support
   * link and no way to ask this product anything. A blank or cryptic message
   * would leave them stuck on a screen they cannot act from.
   */
  it("gives every refusal a message that says what to do next", () => {
    for (const status of ["submitted", "cancelled", "expired"] as const) {
      const decision = checkSessionAccess({ status, expiresAt: PAST, now: NOW });
      if (decision.open) throw new Error(`${status} should be closed`);
      expect(decision.message.length, status).toBeGreaterThan(40);
      expect(decision.message, status).toMatch(/interviewer|submitted|saved/i);
    }
  });
});

describe("isReusable", () => {
  /**
   * Clicking "Start Coding Round" twice must not mint a second session: the
   * first click's QR code is already on screen in Google Meet, and replacing
   * the session would leave the candidate scanning a dead link.
   */
  it("lets an open session be handed back instead of creating a second", () => {
    expect(isReusable({ status: "created", expiresAt: FUTURE, now: NOW })).toBe(true);
    expect(isReusable({ status: "in_progress", expiresAt: FUTURE, now: NOW })).toBe(true);
  });

  it("does not reuse a finished, cancelled or expired session", () => {
    expect(isReusable({ status: "submitted", expiresAt: FUTURE, now: NOW })).toBe(false);
    expect(isReusable({ status: "cancelled", expiresAt: FUTURE, now: NOW })).toBe(false);
    expect(isReusable({ status: "expired", expiresAt: FUTURE, now: NOW })).toBe(false);
    expect(isReusable({ status: "created", expiresAt: PAST, now: NOW })).toBe(false);
  });
});

describe("status vocabulary", () => {
  it("labels and tones every status", () => {
    for (const status of CODING_SESSION_STATUSES) {
      expect(STATUS_LABELS[status], status).toBeTruthy();
      expect(STATUS_TONE[status], status).toBeTruthy();
    }
  });

  it("counts only the finished states as terminal", () => {
    expect(isTerminalStatus("created")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
    expect(isTerminalStatus("submitted")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });
});

describe("canStartCodingRound", () => {
  it("allows a scheduled or completed interview", () => {
    expect(canStartCodingRound("scheduled").ok).toBe(true);
    expect(canStartCodingRound("completed").ok).toBe(true);
  });

  it("refuses a cancelled interview with a reason", () => {
    const result = canStartCodingRound("cancelled");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("refuses a no-show", () => {
    expect(canStartCodingRound("no_show").ok).toBe(false);
  });
});

describe("defaultExpiry", () => {
  it("gives a full day, so an overrunning interview does not kill the link", () => {
    const expiry = defaultExpiry(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(isReusable({ status: "created", expiresAt: expiry, now: NOW })).toBe(true);
  });
});

describe("describeLastSaved", () => {
  /**
   * "Just now" has to cover more than the polling interval, or a monitor
   * refreshing every five seconds flickers between "just now" and "5 seconds
   * ago" while nothing is actually happening.
   */
  it("says 'just now' for anything inside the polling window", () => {
    expect(describeLastSaved(new Date(NOW.getTime() - 1000), NOW)).toBe("Just now");
    expect(describeLastSaved(new Date(NOW.getTime() - 14_000), NOW)).toBe("Just now");
  });

  it("counts up through seconds, minutes, hours and days", () => {
    expect(describeLastSaved(new Date(NOW.getTime() - 30_000), NOW)).toBe("30 seconds ago");
    expect(describeLastSaved(new Date(NOW.getTime() - 60_000), NOW)).toBe("1 minute ago");
    expect(describeLastSaved(new Date(NOW.getTime() - 300_000), NOW)).toBe("5 minutes ago");
    expect(describeLastSaved(new Date(NOW.getTime() - 3_600_000), NOW)).toBe("1 hour ago");
    expect(describeLastSaved(new Date(NOW.getTime() - 90_000_000), NOW)).toBe("1 day ago");
  });

  it("distinguishes 'nothing saved' from 'saved a moment ago'", () => {
    expect(describeLastSaved(null, NOW)).toBe("Nothing saved yet");
    expect(describeLastSaved("not-a-date", NOW)).toBe("Nothing saved yet");
  });

  /** A clock skew must not produce "-3 seconds ago". */
  it("does not go negative when a timestamp is slightly ahead", () => {
    expect(describeLastSaved(new Date(NOW.getTime() + 5000), NOW)).toBe("Just now");
  });
});

describe("languages", () => {
  it("labels and seeds every offered language", () => {
    for (const language of CODING_LANGUAGES) {
      expect(LANGUAGE_LABELS[language], language).toBeTruthy();
      expect(LANGUAGE_STARTERS[language], language).toBeTruthy();
    }
  });

  it("recognises only the closed list", () => {
    expect(isCodingLanguage("python")).toBe(true);
    expect(isCodingLanguage("pyhton")).toBe(false);
    expect(isCodingLanguage("rust")).toBe(false);
    expect(isCodingLanguage(null)).toBe(false);
  });

  it("drops unknown entries and duplicates while keeping order", () => {
    expect(normalizeLanguages(["python", "rust", "java", "python"])).toEqual(["python", "java"]);
  });

  /**
   * A selector with no options is a dead end the candidate cannot escape, so an
   * empty or corrupt list falls back to the full offer rather than to nothing.
   */
  it("falls back to the full list rather than leaving no options", () => {
    expect(normalizeLanguages([])).toEqual([...CODING_LANGUAGES]);
    expect(normalizeLanguages(["rust", "cobol"])).toEqual([...CODING_LANGUAGES]);
    expect(normalizeLanguages(null)).toEqual([...CODING_LANGUAGES]);
    expect(normalizeLanguages("python")).toEqual([...CODING_LANGUAGES]);
  });

  it("opens on the first offered language", () => {
    expect(defaultLanguage(["java", "python"])).toBe("java");
    expect(defaultLanguage([])).toBe("python");
  });

  /**
   * Every starter is a signature and a hole. One that contained a real answer
   * would be a hint the candidate is then judged for taking.
   */
  it("ships starters that cannot be mistaken for an answer", () => {
    for (const language of CODING_LANGUAGES) {
      const starter = LANGUAGE_STARTERS[language];
      expect(starter.toLowerCase(), language).toMatch(/write|solution/);
      expect(starter.split("\n").length, language).toBeLessThan(8);
    }
  });
});
