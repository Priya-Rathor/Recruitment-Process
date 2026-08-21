// =============================================================================
// §5 Data retention — what expires, when, and what happens to it.
//
// PURE DECISIONS, SEPARATE FROM THE SWEEP THAT CARRIES THEM OUT.
//
// Everything here is a function from (settings, record, now) to a verdict. No
// database handle, no clock of its own. That split is what makes retention
// testable at all: the interesting cases are "a 30-day period on a call that
// ended 30 days ago exactly", "recording expires but transcript does not", and
// "the period was shortened after the data was captured" — none of which can be
// exercised against a live table without waiting a month.
//
// It also means the irreversible part of this module is inspectable. The sweep
// deletes candidate voice data; a bug here is not a rendering glitch, it is
// evidence destroyed early or personal data kept past its lawful period. So the
// decision is a pure function with tests, and the executor does only what it is
// told.
//
// THE ORGANIZATION'S TIMEZONE, NOT THE SERVER'S. Retention is measured in days,
// and "30 days" has to mean 30 of the organization's days. lib/time.ts owns that
// arithmetic for every "today" in this codebase; retention windows are half-open
// [captured, captured + days) for the same reason ranges are elsewhere.
// =============================================================================

import type { ExpiryAction, PrivacySettings } from "./settings";
import { resolveDataCollection } from "./settings";

/** The artifacts retention applies to, each with its own configurable period. */
export const RETAINABLE_ARTIFACTS = ["audioRecording", "transcript", "aiEvaluation"] as const;
export type RetainableArtifact = (typeof RETAINABLE_ARTIFACTS)[number];

export const ARTIFACT_LABELS: Record<RetainableArtifact, string> = {
  audioRecording: "Audio recording",
  transcript: "Transcript",
  aiEvaluation: "AI evaluation",
};

/**
 * The retention period for one artifact, in days. 0 = keep until manually
 * deleted.
 *
 * Falls back to defaultDays only when the artifact has no period of its own.
 * A configured 0 is a real answer ("keep this forever") and must not be treated
 * as "unset" and overwritten by the default — which is why this checks the key's
 * presence rather than its truthiness.
 */
export function retentionDaysFor(
  settings: PrivacySettings,
  artifact: RetainableArtifact
): number {
  const { retention } = settings;

  switch (artifact) {
    case "audioRecording":
      return retention.audioRecordingDays;
    case "transcript":
      return retention.transcriptDays;
    case "aiEvaluation":
      return retention.aiEvaluationDays;
  }
}

export type RetentionVerdict =
  | { expired: false; reason: "keep_forever" | "within_period"; dueAt: Date | null }
  | { expired: true; action: ExpiryAction; dueAt: Date; overdueDays: number };

/**
 * Has this artifact's period elapsed?
 *
 * `capturedAt` is when the data came into existence — the call's end, not its
 * creation, because a call that rang for a minute and then ran for twenty
 * produced its transcript at the end.
 */
export function evaluateRetention({
  settings,
  artifact,
  capturedAt,
  now,
}: {
  settings: PrivacySettings;
  artifact: RetainableArtifact;
  capturedAt: Date;
  now: Date;
}): RetentionVerdict {
  const days = retentionDaysFor(settings, artifact);

  if (days <= 0) {
    return { expired: false, reason: "keep_forever", dueAt: null };
  }

  const dueAt = new Date(capturedAt.getTime() + days * 24 * 60 * 60 * 1000);

  // Half-open: the artifact is kept THROUGH day N and expires as day N ends, so
  // the boundary instant is not yet expired. Matching lib/time.ts's [start, end)
  // convention means a record captured at 09:00 and a 30-day period expires at
  // 09:00 on day 30, not at some point during day 29.
  if (now.getTime() < dueAt.getTime()) {
    return { expired: false, reason: "within_period", dueAt };
  }

  const overdueMs = now.getTime() - dueAt.getTime();

  return {
    expired: true,
    action: settings.retention.onExpiry,
    dueAt,
    overdueDays: Math.floor(overdueMs / (24 * 60 * 60 * 1000)),
  };
}

/**
 * One screening call, as retention sees it.
 *
 * Deliberately not the full row type. The sweep should not be able to read a
 * candidate's phone number or a transcript's contents in order to decide whether
 * to delete it — it needs timestamps and which artifacts are present, nothing
 * more.
 */
export type RetentionSubject = {
  callId: string;
  /** When the artifacts came into existence. Null if the call never completed. */
  capturedAt: Date | null;
  hasRecording: boolean;
  hasTranscript: boolean;
  hasEvaluation: boolean;
};

export type RetentionAction = {
  callId: string;
  artifact: RetainableArtifact;
  action: ExpiryAction;
  dueAt: Date;
  overdueDays: number;
};

/**
 * The sweep's work list: every artifact whose period has elapsed.
 *
 * WHAT THIS DOES NOT DO. It never proposes deleting something that is not there,
 * and it never proposes anything for a call with no capture time — an in-flight
 * or failed call has no artifacts to expire, and treating a null timestamp as
 * "the epoch" would mark every one of them as decades overdue and delete them on
 * the first run. That is the kind of bug that only shows up as missing data
 * afterwards, so it is guarded here rather than in the executor.
 */
export function planRetentionActions({
  settings,
  subjects,
  now,
}: {
  settings: PrivacySettings;
  subjects: RetentionSubject[];
  now: Date;
}): RetentionAction[] {
  const actions: RetentionAction[] = [];

  for (const subject of subjects) {
    if (!subject.capturedAt) continue;

    const present: Record<RetainableArtifact, boolean> = {
      audioRecording: subject.hasRecording,
      transcript: subject.hasTranscript,
      aiEvaluation: subject.hasEvaluation,
    };

    for (const artifact of RETAINABLE_ARTIFACTS) {
      if (!present[artifact]) continue;

      const verdict = evaluateRetention({
        settings,
        artifact,
        capturedAt: subject.capturedAt,
        now,
      });

      if (!verdict.expired) continue;

      actions.push({
        callId: subject.callId,
        artifact,
        action: verdict.action,
        dueAt: verdict.dueAt,
        overdueDays: verdict.overdueDays,
      });
    }
  }

  return actions;
}

/**
 * Artifacts that should never have been stored under the current settings.
 *
 * SEPARATE FROM EXPIRY, AND NOT THE SAME QUESTION. Retention asks "has this
 * been here too long"; this asks "should this be here at all". They come apart
 * whenever a setting is tightened after the fact — an organization that turns
 * recording off, or unticks "store transcript", has told the product it does not
 * want those artifacts, and the ones already on disk do not become acceptable
 * just because their 90 days have not elapsed.
 *
 * Rule 5 of the brief — "if recording is disabled, do not accidentally create or
 * retain recordings" — has two halves, and *retain* is this one. Without it,
 * switching recording off would stop new captures while leaving every existing
 * recording in place indefinitely, which is not what anybody clicking that
 * toggle believes they are doing.
 *
 * Reported rather than executed. Deleting a customer's data the instant they
 * untick a box, with no confirmation, would be its own kind of accident — so the
 * settings screen surfaces this as a count with an explicit action behind it.
 */
export function findOrphanedArtifacts({
  settings,
  subjects,
}: {
  settings: PrivacySettings;
  subjects: RetentionSubject[];
}): { callId: string; artifact: RetainableArtifact; reason: string }[] {
  const allowed = resolveDataCollection(settings);
  const orphans: { callId: string; artifact: RetainableArtifact; reason: string }[] = [];

  for (const subject of subjects) {
    if (subject.hasRecording && !allowed.audioRecording) {
      orphans.push({
        callId: subject.callId,
        artifact: "audioRecording",
        reason: settings.recording.enabled
          ? "Storing audio recordings is switched off."
          : "Call recording is switched off.",
      });
    }

    if (subject.hasTranscript && !allowed.transcript) {
      orphans.push({
        callId: subject.callId,
        artifact: "transcript",
        reason: "Storing transcripts is switched off.",
      });
    }

    if (subject.hasEvaluation && !allowed.aiEvaluation) {
      orphans.push({
        callId: subject.callId,
        artifact: "aiEvaluation",
        reason: "Storing AI evaluations is switched off.",
      });
    }
  }

  return orphans;
}

/**
 * What a withdrawal of consent removes, as a list of artifacts.
 *
 * §6's radio list, resolved into the same vocabulary the sweep uses so
 * withdrawal and expiry share one executor rather than growing two deletion
 * paths that drift apart.
 *
 * `stop_future_interviews` and `delete_scheduled_interviews` intentionally
 * return NOTHING here: they act on future interviews, not on stored artifacts.
 * Returning an empty list is the correct answer, and the caller is responsible
 * for the scheduling half — which is why this returns a discriminated result
 * rather than a bare array that an empty case would silently no-op.
 */
export function artifactsRemovedByWithdrawal(settings: PrivacySettings): {
  artifacts: RetainableArtifact[];
  stopsFutureInterviews: boolean;
  cancelsScheduledInterviews: boolean;
} {
  switch (settings.dataRights.onWithdrawal) {
    case "stop_future_interviews":
      return { artifacts: [], stopsFutureInterviews: true, cancelsScheduledInterviews: false };
    case "delete_scheduled_interviews":
      return { artifacts: [], stopsFutureInterviews: true, cancelsScheduledInterviews: true };
    case "delete_recordings":
      return {
        artifacts: ["audioRecording"],
        stopsFutureInterviews: true,
        cancelsScheduledInterviews: false,
      };
    case "delete_transcripts":
      return {
        artifacts: ["transcript"],
        stopsFutureInterviews: true,
        cancelsScheduledInterviews: false,
      };
    case "delete_all":
      return {
        artifacts: [...RETAINABLE_ARTIFACTS],
        stopsFutureInterviews: true,
        cancelsScheduledInterviews: true,
      };
  }
}

/**
 * A plain-language summary of the configured policy, for the settings screen.
 *
 * Retention is the setting most often misread — "30 days" next to "90 days" next
 * to "180 days" in three separate dropdowns does not tell an admin what will
 * actually happen to a call they place tomorrow. This says it in a sentence.
 */
export function describeRetention(settings: PrivacySettings): string {
  const { retention } = settings;
  const collection = resolveDataCollection(settings);

  const parts: string[] = [];

  const describe = (label: string, days: number) =>
    days <= 0 ? `${label} are kept until deleted by hand` : `${label} for ${days} days`;

  if (collection.audioRecording) {
    parts.push(describe("recordings", retention.audioRecordingDays));
  }
  if (collection.transcript) {
    parts.push(describe("transcripts", retention.transcriptDays));
  }
  if (collection.aiEvaluation) {
    parts.push(describe("AI evaluations", retention.aiEvaluationDays));
  }

  if (parts.length === 0) {
    return "Nothing beyond interview metadata is being stored, so no retention period applies.";
  }

  const action =
    retention.onExpiry === "delete"
      ? "then deleted automatically"
      : retention.onExpiry === "archive"
        ? "then archived"
        : "then held for manual review";

  return `Keeping ${parts.join(", ")} — ${action}.`;
}
