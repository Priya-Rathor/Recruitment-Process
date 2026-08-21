import { describe, expect, it } from "vitest";
import {
  CAPABILITY_LABELS,
  DEFAULT_PRIVACY_SETTINGS,
  SENSITIVE_CAPABILITIES,
  VIEWER_FORBIDDEN_CAPABILITIES,
  canUseCapability,
  normalizePrivacySettings,
  recordingRequiresDisclosure,
  resolveDataCollection,
  type PrivacySettings,
} from "./settings";
import {
  artifactsRemovedByWithdrawal,
  describeRetention,
  evaluateRetention,
  findOrphanedArtifacts,
  planRetentionActions,
  retentionDaysFor,
  type RetentionSubject,
} from "./retention";
import {
  artifactsKeptOnDecline,
  buildPrivacySegments,
  mayCaptureAudio,
  resolveConsentOutcome,
} from "./consent";
import { PROCESSORS, activeProcessors, describeProcessors } from "./providers";
import { buildCallScript, assertScriptIsCompliant } from "@/lib/screening/script";
import { TERMINAL_STATUSES } from "@/lib/screening/retry";

/** A settings object with targeted overrides, deep enough for these tests. */
function settings(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return { ...DEFAULT_PRIVACY_SETTINGS, ...overrides };
}

const DAY = 24 * 60 * 60 * 1000;

// =============================================================================
// §1 / §4 — the recording invariant
// =============================================================================

describe("recording is gated on disclosure", () => {
  it("always requires disclosure before audio capture", () => {
    // The one setting with no off switch. If this ever returns false, the
    // product can be configured to record a member of the public who was never
    // told — a criminal offence in all-party-consent jurisdictions.
    expect(recordingRequiresDisclosure()).toBe(true);
  });

  it("defaults recording OFF on a fresh organization", () => {
    // A default of true would start recording candidates on a fresh install
    // purely because nobody had opened the privacy page yet.
    expect(DEFAULT_PRIVACY_SETTINGS.recording.enabled).toBe(false);
    expect(DEFAULT_PRIVACY_SETTINGS.dataCollection.audioRecording).toBe(false);
  });

  it("keeps the mandatory disclosure in the script whatever privacy config says", () => {
    // buildCallScript accepts privacy segments; none of them may displace the
    // consent segment, and the pre-dial gate still has the final word.
    const script = buildCallScript({
      candidateName: "Asha",
      jobTitle: "Backend Engineer",
      organizationName: "WebBee",
      questions: ["Tell me about your last role."],
      privacySegments: buildPrivacySegments(
        settings({ aiDisclosure: { enabled: true, message: "AI notice." } })
      ),
    });

    expect(script.segments[0].kind).toBe("consent");
    expect(script.segments[0].text.toLowerCase()).toContain("automated");
    expect(script.segments[0].text.toLowerCase()).toContain("record");
    expect(assertScriptIsCompliant(script)).toEqual({ ok: true });
  });

  it("still opens with the disclosure when every privacy toggle is off", () => {
    const off = settings({
      recording: { enabled: false },
      consent: { requireExplicitConsent: false, declinePolicy: "metadata_only" },
      aiDisclosure: { enabled: false, message: "" },
    });

    const script = buildCallScript({
      candidateName: "Asha",
      jobTitle: "Backend Engineer",
      organizationName: "WebBee",
      questions: ["Tell me about your last role."],
      privacySegments: buildPrivacySegments(off),
    });

    // The point of the whole carve-out: no configuration produces a covert call.
    expect(script.segments[0].kind).toBe("consent");
    expect(assertScriptIsCompliant(script).ok).toBe(true);
  });
});

describe("resolveDataCollection — the stricter answer wins", () => {
  it("refuses to store audio when recording is off, even if the box is ticked", () => {
    // Rule 5. The contradictory state is reachable through the API, so it is
    // resolved here rather than trusted not to occur.
    const contradictory = settings({
      recording: { enabled: false },
      dataCollection: { ...DEFAULT_PRIVACY_SETTINGS.dataCollection, audioRecording: true },
    });

    expect(resolveDataCollection(contradictory).audioRecording).toBe(false);
  });

  it("allows audio when both recording and storage are on", () => {
    const on = settings({
      recording: { enabled: true },
      dataCollection: { ...DEFAULT_PRIVACY_SETTINGS.dataCollection, audioRecording: true },
    });

    expect(resolveDataCollection(on).audioRecording).toBe(true);
  });

  it("always keeps metadata, because it carries consent status", () => {
    const stripped = settings({
      dataCollection: {
        transcript: false,
        aiEvaluation: false,
        audioRecording: false,
        summary: false,
        structuredAnswers: false,
        metadata: false,
      },
    });

    // Without this the product could not prove it honoured a refusal.
    expect(resolveDataCollection(stripped).metadata).toBe(true);
  });
});

// =============================================================================
// §2 — consent
// =============================================================================

describe("resolveConsentOutcome", () => {
  it("treats a refusal as declined in explicit mode", () => {
    const outcome = resolveConsentOutcome({ settings: settings(), answer: "No thanks" });
    expect(outcome.status).toBe("declined");
  });

  it("treats a refusal as declined in continuation mode too", () => {
    // Switching the gate off must not switch off the ability to say no.
    const permissive = settings({
      consent: { requireExplicitConsent: false, declinePolicy: "metadata_only" },
    });
    expect(resolveConsentOutcome({ settings: permissive, answer: "No thanks" }).status).toBe(
      "declined"
    );
  });

  it("waits rather than assuming, when an explicit yes is required and none came", () => {
    const outcome = resolveConsentOutcome({ settings: settings(), answer: "" });
    expect(outcome.status).toBe("pending");
  });

  it("records an explicit yes as explicit", () => {
    const outcome = resolveConsentOutcome({ settings: settings(), answer: "Yes, that's fine" });
    expect(outcome).toMatchObject({ status: "granted", explicit: true });
  });

  it("records continuation as granted but NOT explicit", () => {
    // The distinction rule 4 asks for. Reporting both as "consent given" would
    // overstate the weaker evidence.
    const permissive = settings({
      consent: { requireExplicitConsent: false, declinePolicy: "metadata_only" },
    });
    const outcome = resolveConsentOutcome({ settings: permissive, answer: "Sure, go ahead" });
    expect(outcome).toMatchObject({ status: "granted", explicit: false });
  });

  it("does not treat silence as consent even in continuation mode", () => {
    const permissive = settings({
      consent: { requireExplicitConsent: false, declinePolicy: "metadata_only" },
    });
    expect(resolveConsentOutcome({ settings: permissive, answer: null }).status).toBe("pending");
  });
});

describe("mayCaptureAudio", () => {
  const recordingOn = settings({
    recording: { enabled: true },
    dataCollection: { ...DEFAULT_PRIVACY_SETTINGS.dataCollection, audioRecording: true },
  });

  it("permits capture once consent is granted", () => {
    const consent = resolveConsentOutcome({ settings: recordingOn, answer: "Yes" });
    expect(mayCaptureAudio({ settings: recordingOn, consent })).toBe(true);
  });

  it("REFUSES capture while consent is pending", () => {
    // The important line: pending is the window where the candidate has been
    // told and has not yet had the chance to refuse.
    const consent = resolveConsentOutcome({ settings: recordingOn, answer: "" });
    expect(consent.status).toBe("pending");
    expect(mayCaptureAudio({ settings: recordingOn, consent })).toBe(false);
  });

  it("REFUSES capture after a refusal", () => {
    const consent = resolveConsentOutcome({ settings: recordingOn, answer: "No" });
    expect(mayCaptureAudio({ settings: recordingOn, consent })).toBe(false);
  });

  it("REFUSES capture when recording is off, however enthusiastic the consent", () => {
    const consent = resolveConsentOutcome({ settings: settings(), answer: "Yes please record me" });
    expect(mayCaptureAudio({ settings: settings(), consent })).toBe(false);
  });
});

describe("artifactsKeptOnDecline", () => {
  it("keeps only metadata by default", () => {
    const kept = artifactsKeptOnDecline(settings());
    expect(kept.artifacts).toEqual([]);
    expect(kept.metadata).toBe(true);
  });

  it("keeps the transcript when configured to", () => {
    const kept = artifactsKeptOnDecline(
      settings({ consent: { requireExplicitConsent: true, declinePolicy: "keep_transcript" } })
    );
    expect(kept.artifacts).toEqual(["transcript"]);
  });

  it("cannot keep audio on decline when audio storage is off", () => {
    // "Keep everything" is still intersected with what the org stores at all.
    const kept = artifactsKeptOnDecline(
      settings({
        recording: { enabled: false },
        consent: { requireExplicitConsent: true, declinePolicy: "keep_all" },
      })
    );
    expect(kept.artifacts).not.toContain("audioRecording");
  });
});

describe("a declined call is never re-dialled", () => {
  it("lists consent_declined as terminal", () => {
    // Re-dialling somebody who said no is worse than an uncapped retry of a
    // missed call: silence is not an answer, a refusal is.
    expect(TERMINAL_STATUSES).toContain("consent_declined");
  });
});

// =============================================================================
// §7 — AI disclosure
// =============================================================================

describe("buildPrivacySegments", () => {
  it("adds the AI disclosure when enabled", () => {
    const segments = buildPrivacySegments(
      settings({ aiDisclosure: { enabled: true, message: "Analysed automatically." } })
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Analysed automatically.");
    expect(segments[0].expectsAnswer).toBe(false);
  });

  it("adds nothing when disabled", () => {
    expect(
      buildPrivacySegments(settings({ aiDisclosure: { enabled: false, message: "x" } }))
    ).toEqual([]);
  });

  it("adds nothing when the message was emptied", () => {
    // Enabled with a blank body would push a silent segment into the script.
    expect(
      buildPrivacySegments(settings({ aiDisclosure: { enabled: true, message: "   " } }))
    ).toEqual([]);
  });
});

// =============================================================================
// §5 — retention
// =============================================================================

describe("evaluateRetention", () => {
  const captured = new Date("2026-01-01T09:00:00Z");

  it("keeps forever when the period is 0", () => {
    const verdict = evaluateRetention({
      settings: settings({
        retention: { ...DEFAULT_PRIVACY_SETTINGS.retention, transcriptDays: 0 },
      }),
      artifact: "transcript",
      capturedAt: captured,
      now: new Date("2030-01-01T00:00:00Z"),
    });
    expect(verdict).toMatchObject({ expired: false, reason: "keep_forever" });
  });

  it("IS expired at the exact boundary instant, because the window is half-open", () => {
    // [captured, captured + days), matching lib/time.ts's range convention: the
    // artifact is kept THROUGH the period and expires as it closes. Off by one
    // in the other direction means deleting a full day early, every time.
    const verdict = evaluateRetention({
      settings: settings({
        retention: { ...DEFAULT_PRIVACY_SETTINGS.retention, transcriptDays: 30 },
      }),
      artifact: "transcript",
      capturedAt: captured,
      now: new Date(captured.getTime() + 30 * DAY),
    });
    expect(verdict.expired).toBe(true);
  });

  it("is not expired one millisecond before the boundary", () => {
    const verdict = evaluateRetention({
      settings: settings({
        retention: { ...DEFAULT_PRIVACY_SETTINGS.retention, transcriptDays: 30 },
      }),
      artifact: "transcript",
      capturedAt: captured,
      now: new Date(captured.getTime() + 30 * DAY - 1),
    });
    expect(verdict).toMatchObject({ expired: false, reason: "within_period" });
  });

  it("reports the configured expiry action, not a hardcoded delete", () => {
    const verdict = evaluateRetention({
      settings: settings({
        retention: {
          ...DEFAULT_PRIVACY_SETTINGS.retention,
          transcriptDays: 1,
          onExpiry: "archive",
        },
      }),
      artifact: "transcript",
      capturedAt: captured,
      now: new Date(captured.getTime() + 5 * DAY),
    });
    expect(verdict).toMatchObject({ expired: true, action: "archive", overdueDays: 4 });
  });

  it("defaults the expiry action to manual review, not deletion", () => {
    // Silently deleting a customer's evidence on a default they never chose is
    // the failure this default exists to avoid.
    expect(DEFAULT_PRIVACY_SETTINGS.retention.onExpiry).toBe("manual_review");
  });

  it("reads each artifact's own period", () => {
    const s = settings();
    expect(retentionDaysFor(s, "audioRecording")).toBe(30);
    expect(retentionDaysFor(s, "transcript")).toBe(90);
    expect(retentionDaysFor(s, "aiEvaluation")).toBe(180);
  });
});

describe("planRetentionActions", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("skips calls that never completed", () => {
    // A null capture time treated as the epoch would mark every in-flight call
    // as decades overdue and delete them on the first run.
    const subjects: RetentionSubject[] = [
      { callId: "a", capturedAt: null, hasRecording: true, hasTranscript: true, hasEvaluation: true },
    ];
    expect(planRetentionActions({ settings: settings(), subjects, now })).toEqual([]);
  });

  it("never proposes acting on an artifact that is not there", () => {
    const subjects: RetentionSubject[] = [
      {
        callId: "a",
        capturedAt: new Date("2020-01-01T00:00:00Z"),
        hasRecording: false,
        hasTranscript: true,
        hasEvaluation: false,
      },
    ];
    const actions = planRetentionActions({ settings: settings(), subjects, now });
    expect(actions.map((action) => action.artifact)).toEqual(["transcript"]);
  });

  it("expires artifacts independently, on their own periods", () => {
    // 100 days: past the 90-day transcript period, inside the 180-day evaluation
    // period. The whole point of per-artifact retention.
    const captured = new Date(now.getTime() - 100 * DAY);
    const subjects: RetentionSubject[] = [
      { callId: "a", capturedAt: captured, hasRecording: false, hasTranscript: true, hasEvaluation: true },
    ];
    const actions = planRetentionActions({ settings: settings(), subjects, now });
    expect(actions.map((action) => action.artifact)).toEqual(["transcript"]);
  });
});

describe("findOrphanedArtifacts — the 'retain' half of rule 5", () => {
  it("flags recordings that exist after recording was switched off", () => {
    // Switching recording off must not leave every existing recording in place
    // indefinitely — that is not what anybody clicking the toggle believes.
    const subjects: RetentionSubject[] = [
      {
        callId: "a",
        capturedAt: new Date(),
        hasRecording: true,
        hasTranscript: false,
        hasEvaluation: false,
      },
    ];
    const orphans = findOrphanedArtifacts({ settings: settings(), subjects });
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ artifact: "audioRecording" });
    expect(orphans[0].reason).toMatch(/recording is switched off/i);
  });

  it("flags transcripts after transcript storage is unticked", () => {
    const noTranscripts = settings({
      dataCollection: { ...DEFAULT_PRIVACY_SETTINGS.dataCollection, transcript: false },
    });
    const subjects: RetentionSubject[] = [
      {
        callId: "a",
        capturedAt: new Date(),
        hasRecording: false,
        hasTranscript: true,
        hasEvaluation: false,
      },
    ];
    expect(findOrphanedArtifacts({ settings: noTranscripts, subjects })).toHaveLength(1);
  });

  it("finds nothing when storage matches what is stored", () => {
    const subjects: RetentionSubject[] = [
      {
        callId: "a",
        capturedAt: new Date(),
        hasRecording: false,
        hasTranscript: true,
        hasEvaluation: false,
      },
    ];
    expect(findOrphanedArtifacts({ settings: settings(), subjects })).toEqual([]);
  });
});

describe("describeRetention", () => {
  it("says so plainly when nothing beyond metadata is kept", () => {
    const minimal = settings({
      dataCollection: {
        transcript: false,
        aiEvaluation: false,
        audioRecording: false,
        summary: false,
        structuredAnswers: false,
        metadata: true,
      },
    });
    expect(describeRetention(minimal)).toMatch(/nothing beyond interview metadata/i);
  });

  it("names the configured action", () => {
    const deleting = settings({
      retention: { ...DEFAULT_PRIVACY_SETTINGS.retention, onExpiry: "delete" },
    });
    expect(describeRetention(deleting)).toMatch(/deleted automatically/i);
  });

  it("describes an indefinite period as kept by hand, not as 0 days", () => {
    const forever = settings({
      retention: { ...DEFAULT_PRIVACY_SETTINGS.retention, transcriptDays: 0 },
    });
    expect(describeRetention(forever)).toMatch(/until deleted by hand/i);
    expect(describeRetention(forever)).not.toMatch(/for 0 days/);
  });
});

// =============================================================================
// §6 — data rights
// =============================================================================

describe("artifactsRemovedByWithdrawal", () => {
  it("stops future interviews without deleting anything, by default", () => {
    // Withdrawal is not erasure. Treating it as one would destroy records the
    // organization may need, including the record of the withdrawal.
    const result = artifactsRemovedByWithdrawal(settings());
    expect(result.artifacts).toEqual([]);
    expect(result.stopsFutureInterviews).toBe(true);
  });

  it("always stops future interviews, whatever else it does", () => {
    // Every branch must stop future AI calls — a withdrawal that deleted
    // recordings but kept calling would be absurd.
    for (const action of [
      "stop_future_interviews",
      "delete_scheduled_interviews",
      "delete_recordings",
      "delete_transcripts",
      "delete_all",
    ] as const) {
      const result = artifactsRemovedByWithdrawal(
        settings({ dataRights: { ...DEFAULT_PRIVACY_SETTINGS.dataRights, onWithdrawal: action } })
      );
      expect(result.stopsFutureInterviews, action).toBe(true);
    }
  });

  it("removes everything on delete_all", () => {
    const result = artifactsRemovedByWithdrawal(
      settings({ dataRights: { ...DEFAULT_PRIVACY_SETTINGS.dataRights, onWithdrawal: "delete_all" } })
    );
    expect(result.artifacts).toEqual(["audioRecording", "transcript", "aiEvaluation"]);
    expect(result.cancelsScheduledInterviews).toBe(true);
  });

  it("defaults all three candidate rights ON", () => {
    // These are rights the GDPR grants whether or not a product has a toggle.
    // Shipping them off would ship a product configured to refuse lawful requests.
    expect(DEFAULT_PRIVACY_SETTINGS.dataRights.allowDeletionRequests).toBe(true);
    expect(DEFAULT_PRIVACY_SETTINGS.dataRights.allowExportRequests).toBe(true);
    expect(DEFAULT_PRIVACY_SETTINGS.dataRights.allowConsentWithdrawal).toBe(true);
  });
});

// =============================================================================
// §8 — third-party processors
// =============================================================================

describe("processor disclosure", () => {
  it("lists only providers this codebase actually integrates", () => {
    // The brief's example names Sarvam AI. There is no Sarvam adapter, and
    // listing it would tell an organization it shares candidate voice data with
    // a company it has no relationship with — a false statement in a compliance
    // document.
    const keys = PROCESSORS.map((processor) => processor.key);
    expect(keys).toEqual(["bolna", "llm", "email", "whatsapp"]);
  });

  it("enumerates the data each processor receives", () => {
    // "Call data" is not an answer a data protection officer can file.
    for (const processor of PROCESSORS) {
      expect(processor.dataProcessed.length, processor.name).toBeGreaterThan(1);
      expect(processor.purpose.length).toBeGreaterThan(10);
    }
  });

  it("exposes no credential-shaped field anywhere", () => {
    // Rule 2, asserted structurally rather than trusted.
    const serialised = JSON.stringify(PROCESSORS).toLowerCase();
    for (const forbidden of ["api_key", "apikey", "secret", "token", "password", "credential"]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it("distinguishes connected from merely available", () => {
    const disclosures = describeProcessors({ bolna: true });
    const bolna = disclosures.find((processor) => processor.key === "bolna");
    const llm = disclosures.find((processor) => processor.key === "llm");

    expect(bolna?.connected).toBe(true);
    expect(bolna?.statusLabel).toMatch(/receiving data/i);
    expect(llm?.connected).toBe(false);
    expect(llm?.statusLabel).toMatch(/no data/i);
  });

  it("reports only active processors for a processing register", () => {
    expect(activeProcessors({ bolna: true, llm: true }).map((p) => p.key)).toEqual([
      "bolna",
      "llm",
    ]);
    expect(activeProcessors({})).toEqual([]);
  });
});

// =============================================================================
// §9 — access control
// =============================================================================

describe("canUseCapability", () => {
  it("lets an owner do everything by default", () => {
    // hasRole does no hierarchy: an owner is not implicitly an admin, so
    // omitting owner from a capability would lock the account holder out.
    for (const capability of SENSITIVE_CAPABILITIES) {
      expect(canUseCapability(settings(), "owner", capability), capability).toBe(true);
    }
  });

  it("keeps destructive capabilities away from a recruiter by default", () => {
    expect(canUseCapability(settings(), "recruiter", "deleteInterviewData")).toBe(false);
    expect(canUseCapability(settings(), "recruiter", "exportCandidateData")).toBe(false);
    expect(canUseCapability(settings(), "recruiter", "downloadRecording")).toBe(false);
  });

  it("lets a recruiter view what they need to work the pipeline", () => {
    expect(canUseCapability(settings(), "recruiter", "viewTranscript")).toBe(true);
    expect(canUseCapability(settings(), "recruiter", "viewAiEvaluation")).toBe(true);
  });

  it("REFUSES a Viewer the forbidden capabilities even if configured otherwise", () => {
    // The least-trusted seat must not become the most dangerous one, whatever
    // got written into the JSONB.
    const permissive = settings({
      accessControl: {
        ...DEFAULT_PRIVACY_SETTINGS.accessControl,
        downloadRecording: ["owner", "admin", "recruiter", "viewer"],
        exportCandidateData: ["owner", "admin", "recruiter", "viewer"],
        deleteInterviewData: ["owner", "admin", "recruiter", "viewer"],
      },
    });

    for (const capability of VIEWER_FORBIDDEN_CAPABILITIES) {
      expect(canUseCapability(permissive, "viewer", capability), capability).toBe(false);
    }
  });

  it("has a label for every capability", () => {
    for (const capability of SENSITIVE_CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
    }
  });
});

// =============================================================================
// Normalisation — the boundary that is not the form
// =============================================================================

describe("normalizePrivacySettings", () => {
  it("returns the defaults for junk", () => {
    for (const junk of [null, undefined, 0, "", [], "nonsense"]) {
      expect(normalizePrivacySettings(junk)).toEqual(DEFAULT_PRIVACY_SETTINGS);
    }
  });

  it("does not throw on a half-written object", () => {
    // A privacy screen that 500s is a screen nobody can use to turn recording off.
    expect(() => normalizePrivacySettings({ retention: "wrong", consent: 5 })).not.toThrow();
  });

  it("clamps a retention period to ten years", () => {
    const result = normalizePrivacySettings({ retention: { transcriptDays: 999_999 } });
    expect(result.retention.transcriptDays).toBe(3650);
  });

  it("rejects a negative retention period", () => {
    const result = normalizePrivacySettings({ retention: { transcriptDays: -5 } });
    expect(result.retention.transcriptDays).toBe(90);
  });

  it("preserves a configured 0 as 'keep forever' rather than treating it as unset", () => {
    const result = normalizePrivacySettings({ retention: { transcriptDays: 0 } });
    expect(result.retention.transcriptDays).toBe(0);
  });

  it("cannot be made to store audio with recording off", () => {
    // The invariant applies on the way IN, not only at the point of use — so a
    // direct PostgREST write cannot persist the contradictory state at all.
    const result = normalizePrivacySettings({
      recording: { enabled: false },
      dataCollection: { audioRecording: true },
    });
    expect(result.dataCollection.audioRecording).toBe(false);
  });

  it("cannot be made to drop metadata", () => {
    const result = normalizePrivacySettings({ dataCollection: { metadata: false } });
    expect(result.dataCollection.metadata).toBe(true);
  });

  it("falls back rather than locking everyone out of a capability", () => {
    // An empty role list would brick the capability with no way back through
    // the UI that produced it.
    const result = normalizePrivacySettings({ accessControl: { viewTranscript: [] } });
    expect(result.accessControl.viewTranscript.length).toBeGreaterThan(0);
  });

  it("drops unknown roles instead of storing them", () => {
    const result = normalizePrivacySettings({
      accessControl: { viewTranscript: ["owner", "superuser", "admin"] },
    });
    expect(result.accessControl.viewTranscript).toEqual(["owner", "admin"]);
  });

  it("deduplicates a role list", () => {
    const result = normalizePrivacySettings({
      accessControl: { viewTranscript: ["admin", "admin", "owner"] },
    });
    expect(result.accessControl.viewTranscript).toEqual(["admin", "owner"]);
  });

  it("rejects an unknown expiry action", () => {
    const result = normalizePrivacySettings({ retention: { onExpiry: "incinerate" } });
    expect(result.retention.onExpiry).toBe("manual_review");
  });

  it("rejects an unknown decline policy", () => {
    const result = normalizePrivacySettings({ consent: { declinePolicy: "keep_secretly" } });
    expect(result.consent.declinePolicy).toBe("metadata_only");
  });

  it("truncates an over-long notice rather than rejecting the whole save", () => {
    const result = normalizePrivacySettings({ notice: { content: "x".repeat(99_999) } });
    expect(result.notice.content).toHaveLength(4000);
  });

  it("falls back to the default title when emptied", () => {
    // An empty title would render as a blank heading on the candidate notice.
    const result = normalizePrivacySettings({ notice: { title: "   " } });
    expect(result.notice.title).toBe("Candidate Privacy Notice");
  });

  it("round-trips its own output unchanged", () => {
    // Normalisation must be idempotent, or a save-then-reload would drift.
    const once = normalizePrivacySettings({
      recording: { enabled: true },
      retention: { transcriptDays: 45, onExpiry: "delete" },
    });
    expect(normalizePrivacySettings(once)).toEqual(once);
  });
});
