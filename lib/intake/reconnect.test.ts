// =============================================================================
// The two destructive decisions in manual reconnection.
//
// Everything else in reconnect.ts is plumbing — move a file, update a row.
// These two decide whether a record is DESTROYED, and each has a failure mode
// that costs a recruiter real work:
//
//   deleting an application we did not create  -> a live pipeline disappears
//   deleting a candidate that is not pristine  -> someone else's work goes too
//   archiving instead of deleting a pristine one -> a permanent match conflict
//
// The third is the least obvious and the reason "archive everything" is not the
// safe default it looks like: intake matching includes archived candidates on
// purpose, so an archived orphan collides with the real person forever.
// =============================================================================
import { describe, expect, it } from "vitest";
import { cleanupDecision, shouldRemoveApplication } from "@/lib/intake/reconnect";
import { INTAKE_STATUSES, type IntakeStatus } from "@/lib/intake/status";

describe("shouldRemoveApplication", () => {
  const APP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("removes the application this flow created for a wrongly created candidate", () => {
    expect(
      shouldRemoveApplication({
        status: "candidate_created",
        autoStatus: null,
        applicationId: APP,
      })
    ).toBe(true);
  });

  it("removes the application this flow created for a wrongly matched candidate", () => {
    expect(
      shouldRemoveApplication({
        status: "candidate_matched",
        autoStatus: null,
        applicationId: APP,
      })
    ).toBe(true);
  });

  // The one that matters most.
  it("NEVER removes an application that pre-dated the upload", () => {
    expect(
      shouldRemoveApplication({
        status: "already_applied",
        autoStatus: null,
        applicationId: APP,
      })
    ).toBe(false);
  });

  it("still refuses on a SECOND reconnection of an already-applied file", () => {
    // By now `status` reads 'manually_connected'; only the original decision
    // remembers that the application was never ours.
    expect(
      shouldRemoveApplication({
        status: "manually_connected",
        autoStatus: "already_applied",
        applicationId: APP,
      })
    ).toBe(false);
  });

  it("has nothing to remove when no application was ever recorded", () => {
    for (const status of INTAKE_STATUSES) {
      expect(
        shouldRemoveApplication({ status, autoStatus: null, applicationId: null }),
        status
      ).toBe(false);
    }
  });

  it("removes nothing for a conflict or a failure, which created nothing", () => {
    // Both carry a null application id, so the guard above already covers them;
    // asserted separately because a future change that starts recording an
    // application on these rows must not quietly gain permission to delete it.
    expect(
      shouldRemoveApplication({ status: "match_conflict", autoStatus: null, applicationId: null })
    ).toBe(false);
    expect(
      shouldRemoveApplication({ status: "failed", autoStatus: null, applicationId: null })
    ).toBe(false);
  });
});

describe("cleanupDecision", () => {
  const clean = {
    createdByIntake: true,
    remainingResumes: 0,
    remainingApplications: 0,
    otherIntakeItems: 0,
  };

  it("hard-deletes a candidate this flow created and nothing else touched", () => {
    expect(cleanupDecision(clean)).toBe("deleted");
  });

  it("never touches a candidate that already existed", () => {
    // A wrong MATCH points at a real person with their own history. Correcting
    // the match must not lay a finger on them.
    expect(cleanupDecision({ ...clean, createdByIntake: false })).toBe("kept");
    expect(
      cleanupDecision({
        createdByIntake: false,
        remainingResumes: 0,
        remainingApplications: 0,
        otherIntakeItems: 0,
      })
    ).toBe("kept");
  });

  it("archives rather than deletes once anything else is attached", () => {
    expect(cleanupDecision({ ...clean, remainingResumes: 1 })).toBe("archived");
    expect(cleanupDecision({ ...clean, remainingApplications: 1 })).toBe("archived");
    expect(cleanupDecision({ ...clean, otherIntakeItems: 1 })).toBe("archived");
  });

  it("archives when a second resume arrived for the same person mid-batch", () => {
    // Two files for one person in one drop: the first creates the candidate,
    // the second matches them. Reconnecting the first must not delete a record
    // the second is now relying on.
    expect(cleanupDecision({ ...clean, remainingResumes: 1, otherIntakeItems: 1 })).toBe(
      "archived"
    );
  });

  it("prefers deleting over archiving for a pristine orphan, deliberately", () => {
    // Archiving looks safer and is not: intake matching includes archived
    // candidates, so an archived duplicate keeps colliding with the real person
    // on every future upload — one bad match becomes a permanent conflict.
    expect(cleanupDecision(clean)).not.toBe("archived");
  });

  it("treats an unknown count as attached", () => {
    // The caller passes `count ?? 1` when a count query returns null, so an
    // unreadable count archives instead of deleting. Asserted here because the
    // sentinel only means something if this function reads 1 as "attached".
    expect(cleanupDecision({ ...clean, remainingResumes: 1 })).toBe("archived");
  });
});

describe("the two decisions together", () => {
  /**
   * The spec's two correction scenarios, end to end at the decision level.
   */
  it("wrongly created candidate: delete the record AND its application", () => {
    const status: IntakeStatus = "candidate_created";
    expect(
      shouldRemoveApplication({ status, autoStatus: null, applicationId: "app" })
    ).toBe(true);
    expect(
      cleanupDecision({
        createdByIntake: true,
        remainingResumes: 0,
        remainingApplications: 0,
        otherIntakeItems: 0,
      })
    ).toBe("deleted");
  });

  it("wrongly matched candidate: remove the application, keep the person", () => {
    const status: IntakeStatus = "candidate_matched";
    expect(
      shouldRemoveApplication({ status, autoStatus: null, applicationId: "app" })
    ).toBe(true);
    expect(
      cleanupDecision({
        createdByIntake: false,
        remainingResumes: 2,
        remainingApplications: 3,
        otherIntakeItems: 0,
      })
    ).toBe("kept");
  });
});
