// =============================================================================
// Privacy, consent and data settings — the configuration model.
//
// Ten sections of the brief, one typed object, stored as JSONB on
// organization_settings.privacy_settings. Organization-specific by construction:
// it lives on a row keyed by organization_id and governed by that table's RLS,
// so there is no path by which one tenant reads another's privacy policy.
//
// NORMALISED ON READ *AND* ON WRITE.
//
// Every existing settings group in this codebase does this, for a reason worth
// restating: the settings form is not the security boundary. A value edited
// straight into the JSONB — by a migration, a script, a support engineer, or a
// signed-in Admin talking to PostgREST directly — must not be able to put the
// product into a state the UI would refuse to produce. So normalize() clamps,
// and parsePrivacySettingsPayload() runs it again before the write.
//
// WHAT CANNOT BE CONFIGURED, AND WHY.
//
// Recording capture is gated on the candidate being told that the call may be
// recorded. Everything else here is switchable — the explicit consent gate, the
// AI-processing disclosure, what is stored, how long, who may see it — but that
// one line is not, and `recordingRequiresDisclosure()` below is the function
// that enforces it.
//
// The reason is narrow and legal rather than editorial: capturing audio of a
// person who has not been told they are being recorded is a criminal offence in
// all-party-consent jurisdictions (California, Illinois, Massachusetts,
// Pennsylvania, Washington and others; and unlawful processing under the GDPR
// and ePrivacy in the EU). The person exposed is a job candidate who has no
// account here, never agreed to anything, and cannot inspect or challenge the
// configuration. lib/screening/script.ts holds the sentence itself.
//
// Every OTHER control in this file is the organization's to set, and section 10
// of the brief is right that using them lawfully is the organization's
// responsibility.
// =============================================================================

import type { OrgRole } from "@/lib/types";

// -----------------------------------------------------------------------------
// §1 Call recording
// -----------------------------------------------------------------------------

export type RecordingSettings = {
  /**
   * Whether call audio is captured and retained at all.
   *
   * Defaults to FALSE. The brief's own checkbox list has "Store Audio
   * Recording" unticked while the other five are ticked, which is the right
   * instinct: audio is the most sensitive artifact a screening call produces and
   * the one an organization is least likely to actually need. A default of true
   * would start recording members of the public on a fresh install because
   * nobody had visited this page yet.
   */
  enabled: boolean;
};

// -----------------------------------------------------------------------------
// §2 Candidate consent
// -----------------------------------------------------------------------------

/**
 * What is kept when a candidate declines.
 *
 * The brief says "follow the configured policy for recording and transcript
 * storage", so this is that policy. The default discards both: a candidate who
 * said no has not agreed to have the recording of them saying no retained, and
 * keeping it is the exact thing they refused.
 *
 * "metadata_only" still records THAT a call happened and was declined — which
 * is not a loophole but the opposite. Without it the product could not prove it
 * had honoured a refusal, could not stop re-dialling, and could not show the
 * refusal in the privacy log the brief asks for in §10.
 */
export const DECLINE_POLICIES = ["metadata_only", "keep_transcript", "keep_all"] as const;
export type DeclinePolicy = (typeof DECLINE_POLICIES)[number];

export type ConsentSettings = {
  /**
   * Whether the agent stops and waits for an explicit yes.
   *
   * ON: the call halts after the disclosure until the candidate actively agrees;
   * silence or ambiguity is treated as a refusal (see isConsentRefusal, which is
   * deliberately biased towards stopping).
   *
   * OFF: the candidate is still told the call is automated and may be recorded,
   * and continuing the conversation is treated as consent. This is the
   * continuation-as-consent model Module 8 already shipped, and it is lawful in
   * one-party-consent jurisdictions.
   */
  requireExplicitConsent: boolean;
  /** What survives a refusal. */
  declinePolicy: DeclinePolicy;
};

// -----------------------------------------------------------------------------
// §3 Privacy notice
// -----------------------------------------------------------------------------

export type PrivacyNoticeSettings = {
  title: string;
  content: string;
};

export const MAX_NOTICE_TITLE_LENGTH = 120;
export const MAX_NOTICE_CONTENT_LENGTH = 4000;

export const DEFAULT_PRIVACY_NOTICE: PrivacyNoticeSettings = {
  title: "Candidate Privacy Notice",
  content:
    "This conversation may be processed using AI technologies for recruitment and " +
    "interview purposes. Information collected during this interview may include your " +
    "responses, voice data, transcript, and interview evaluation. Your information will " +
    "be handled according to the organization's privacy policy.",
};

// -----------------------------------------------------------------------------
// §4 Data collection
// -----------------------------------------------------------------------------

/**
 * The six artifacts a screening call can produce.
 *
 * `audioRecording` is listed here AND gated by RecordingSettings.enabled. That
 * is not redundancy — they answer different questions. `enabled` is "may this
 * call be recorded at all", which the candidate is told about; this checkbox is
 * "having recorded it, do we keep the file". resolveDataCollection() below
 * reconciles them so the stricter answer always wins, because a UI where
 * recording is off and "store audio" is ticked is a contradiction the product
 * must not resolve in favour of storing.
 */
export type DataCollectionSettings = {
  transcript: boolean;
  aiEvaluation: boolean;
  audioRecording: boolean;
  summary: boolean;
  structuredAnswers: boolean;
  metadata: boolean;
};

/**
 * Metadata is the one artifact with no off switch, and it is worth saying why in
 * code rather than only in a doc.
 *
 * The brief lists interview date/time, duration, agent, status, language and
 * consent status as metadata. Consent status is in that list. An organization
 * that switched metadata off would have no record of who consented and who
 * refused — it could not honour a refusal, could not answer a candidate's
 * "what do you hold on me", and could not produce the §10 privacy log. So the
 * checkbox renders, and it renders disabled with that explanation.
 */
export const METADATA_IS_MANDATORY = true;

// -----------------------------------------------------------------------------
// §5 Data retention
// -----------------------------------------------------------------------------

/**
 * The brief's dropdown, as days. 0 means "keep until manually deleted".
 *
 * Retention is expressed in days rather than as an enum so "Custom" is not a
 * special case in every consumer — it is just a number the dropdown does not
 * happen to list.
 */
export const RETENTION_PRESET_DAYS = [7, 30, 60, 90, 180, 365] as const;
export const RETENTION_KEEP_FOREVER = 0;
/** Ten years. Past this a "retention period" is indistinguishable from forever. */
export const MAX_RETENTION_DAYS = 3650;

export const EXPIRY_ACTIONS = ["delete", "archive", "manual_review"] as const;
export type ExpiryAction = (typeof EXPIRY_ACTIONS)[number];

export type RetentionSettings = {
  /** Fallback for anything without its own period. */
  defaultDays: number;
  /** Per-artifact overrides, from the brief's separate-retention list. */
  audioRecordingDays: number;
  transcriptDays: number;
  aiEvaluationDays: number;
  /** What happens when a period expires. */
  onExpiry: ExpiryAction;
};

/**
 * Defaults follow the brief: 30 / 90 / 180 days for audio, transcripts and
 * evaluations, with a 30-day fallback.
 *
 * The expiry ACTION defaults to manual_review rather than delete, which departs
 * from the brief's ordering, and deliberately. `getOrganizationSettings` already
 * documents the same instinct for the older retention block: "a default that
 * silently deleted transcripts after 90 days would destroy evidence an
 * organization may be legally required to hold, and they would find out only
 * when they needed it." Automatic deletion is a fine choice — it is just not a
 * safe thing to choose on a customer's behalf before they have opened the page.
 */
export const DEFAULT_RETENTION: RetentionSettings = {
  defaultDays: 30,
  audioRecordingDays: 30,
  transcriptDays: 90,
  aiEvaluationDays: 180,
  onExpiry: "manual_review",
};

// -----------------------------------------------------------------------------
// §6 Candidate data rights
// -----------------------------------------------------------------------------

export const WITHDRAWAL_ACTIONS = [
  "stop_future_interviews",
  "delete_scheduled_interviews",
  "delete_recordings",
  "delete_transcripts",
  "delete_all",
] as const;
export type WithdrawalAction = (typeof WITHDRAWAL_ACTIONS)[number];

export type DataRightsSettings = {
  allowDeletionRequests: boolean;
  allowExportRequests: boolean;
  allowConsentWithdrawal: boolean;
  /** What withdrawing consent does. The brief's radio list. */
  onWithdrawal: WithdrawalAction;
};

/**
 * All three rights default ON.
 *
 * These are rights the GDPR grants a data subject whether or not a product has
 * a toggle for them (Art. 15 access, Art. 17 erasure, Art. 7(3) withdrawal).
 * Defaulting them off would ship a product configured to refuse lawful requests,
 * so the default is the compliant one and switching them off is the deliberate
 * act.
 *
 * The withdrawal default stops future AI interviews rather than deleting
 * everything: withdrawal is not the same request as erasure, and silently
 * treating it as one would destroy records the organization may need — including
 * the record of the withdrawal itself.
 */
export const DEFAULT_DATA_RIGHTS: DataRightsSettings = {
  allowDeletionRequests: true,
  allowExportRequests: true,
  allowConsentWithdrawal: true,
  onWithdrawal: "stop_future_interviews",
};

// -----------------------------------------------------------------------------
// §7 AI processing disclosure
// -----------------------------------------------------------------------------

export type AiDisclosureSettings = {
  /**
   * The EXTRA disclosure about automated analysis.
   *
   * Distinct from the mandatory opening line, which states that the call is
   * automated and may be recorded. This one explains that responses are
   * ANALYSED to produce insights and that a human reviews the outcome — a
   * separate fact, and one an organization can choose whether to say aloud.
   * Turning it off does not make the call covert.
   */
  enabled: boolean;
  message: string;
};

export const MAX_AI_DISCLOSURE_LENGTH = 1000;

export const DEFAULT_AI_DISCLOSURE: AiDisclosureSettings = {
  enabled: true,
  message:
    "You are interacting with an AI-powered interview assistant. Your responses may be " +
    "analyzed automatically to generate interview insights and recommendations. Final " +
    "hiring decisions should be reviewed by authorized human recruiters.",
};

// -----------------------------------------------------------------------------
// §9 Access control
// -----------------------------------------------------------------------------

/**
 * The six privacy-sensitive capabilities from the brief.
 *
 * Modelled as capability → roles, not role → capabilities, because every call
 * site asks the question in that direction ("may this role download a
 * recording?"), and because it mirrors MODULE1_PERMISSIONS in lib/tenant.ts.
 */
export const SENSITIVE_CAPABILITIES = [
  "viewRecording",
  "downloadRecording",
  "viewTranscript",
  "viewAiEvaluation",
  "deleteInterviewData",
  "exportCandidateData",
] as const;
export type SensitiveCapability = (typeof SENSITIVE_CAPABILITIES)[number];

export type AccessControlSettings = Record<SensitiveCapability, OrgRole[]>;

/**
 * Defaults, mapped onto this product's four real roles.
 *
 * The brief names Admin / Recruiter / Interviewer / Viewer. This codebase has
 * owner / admin / recruiter / viewer (lib/types.ts ORG_ROLES) — there is no
 * Interviewer role, and inventing one would mean a new membership role, new RLS
 * and a migration across every table, which is a different module. So
 * "Interviewer" maps onto `recruiter`, whose interview access is already scoped
 * to the interviews they are on, and the brief's intent survives.
 *
 * OWNER IS NOT LISTED ON EVERY LINE BY ACCIDENT — it is listed deliberately.
 * `hasRole` does no hierarchy: an owner is not implicitly an admin, so omitting
 * owner from a capability would lock the organization's owner out of it.
 *
 * The two destructive capabilities — deleting interview data and exporting a
 * candidate's file — are owner/admin only. A recruiter working a pipeline has no
 * routine need to permanently destroy a record or extract a person's complete
 * file, and both are irreversible from the candidate's point of view.
 */
export const DEFAULT_ACCESS_CONTROL: AccessControlSettings = {
  viewRecording: ["owner", "admin", "recruiter"],
  downloadRecording: ["owner", "admin"],
  viewTranscript: ["owner", "admin", "recruiter"],
  viewAiEvaluation: ["owner", "admin", "recruiter"],
  deleteInterviewData: ["owner", "admin"],
  exportCandidateData: ["owner", "admin"],
};

/**
 * Capabilities an organization may not hand to a Viewer, whatever the form says.
 *
 * A Viewer is the read-only, lowest-trust role — the one handed to a client
 * contact or a stakeholder who needs to see progress. Letting that role download
 * call audio or export a candidate's complete file would make the least-trusted
 * seat the most dangerous one. The form renders these as locked rather than
 * silently dropping the choice.
 */
export const VIEWER_FORBIDDEN_CAPABILITIES: SensitiveCapability[] = [
  "downloadRecording",
  "deleteInterviewData",
  "exportCandidateData",
];

// -----------------------------------------------------------------------------
// The whole object
// -----------------------------------------------------------------------------

export type PrivacySettings = {
  recording: RecordingSettings;
  consent: ConsentSettings;
  notice: PrivacyNoticeSettings;
  dataCollection: DataCollectionSettings;
  retention: RetentionSettings;
  dataRights: DataRightsSettings;
  aiDisclosure: AiDisclosureSettings;
  accessControl: AccessControlSettings;
};

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  recording: { enabled: false },
  consent: { requireExplicitConsent: true, declinePolicy: "metadata_only" },
  notice: DEFAULT_PRIVACY_NOTICE,
  dataCollection: {
    transcript: true,
    aiEvaluation: true,
    audioRecording: false,
    summary: true,
    structuredAnswers: true,
    metadata: true,
  },
  retention: DEFAULT_RETENTION,
  dataRights: DEFAULT_DATA_RIGHTS,
  aiDisclosure: DEFAULT_AI_DISCLOSURE,
  accessControl: DEFAULT_ACCESS_CONTROL,
};

// -----------------------------------------------------------------------------
// Invariants
// -----------------------------------------------------------------------------

/**
 * THE ONE THING THAT IS NOT CONFIGURABLE.
 *
 * Recording capture requires that the candidate is told the call may be
 * recorded. The mandatory opening line in lib/screening/script.ts always states
 * it, so this returns true — it exists as a named function rather than a comment
 * so that a future change which makes the disclosure optional has to come
 * through here and confront the question, instead of quietly removing a
 * sentence from a template string.
 *
 * See the header of this file for why this specific combination is treated as a
 * build constraint rather than a configuration choice.
 */
export function recordingRequiresDisclosure(): true {
  return true;
}

/**
 * Reconciles §1 against §4 so the stricter answer wins.
 *
 * Rule 5 of the brief: "If recording is disabled, do not accidentally create or
 * retain recordings." The accident it is describing is exactly the state where
 * recording.enabled is false and dataCollection.audioRecording is true — two
 * controls in two sections of one page that disagree. Rather than trusting every
 * future caller to check both, every consumer reads the effective set from here.
 */
export function resolveDataCollection(settings: PrivacySettings): DataCollectionSettings {
  return {
    ...settings.dataCollection,
    // Recording off ⇒ nothing to store, regardless of the checkbox.
    audioRecording: settings.recording.enabled && settings.dataCollection.audioRecording,
    // Metadata carries consent status; see METADATA_IS_MANDATORY.
    metadata: true,
  };
}

/**
 * May this role use this capability?
 *
 * The single source of truth for both the UI (hide/disable) and the API
 * (reject), matching how MODULE1_PERMISSIONS is used. The Viewer restriction is
 * applied here too, so a stored setting that grants a Viewer a forbidden
 * capability — however it got there — still cannot be exercised.
 */
export function canUseCapability(
  settings: PrivacySettings,
  role: OrgRole,
  capability: SensitiveCapability
): boolean {
  if (role === "viewer" && VIEWER_FORBIDDEN_CAPABILITIES.includes(capability)) return false;
  return settings.accessControl[capability].includes(role);
}

// -----------------------------------------------------------------------------
// Normalisation
// -----------------------------------------------------------------------------

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const str = (value: unknown, fallback: string, max: number): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  // An empty string is a real choice for a message body, but not for a title
  // that has to render as a heading — so an empty title falls back.
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, max);
};

const days = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), MAX_RETENTION_DAYS);
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const roles = (value: unknown, fallback: OrgRole[]): OrgRole[] => {
  if (!Array.isArray(value)) return fallback;
  const valid = value.filter((role): role is OrgRole =>
    role === "owner" || role === "admin" || role === "recruiter" || role === "viewer"
  );
  // Deduplicated. A stored ["admin","admin"] is harmless for `includes` but
  // renders as a doubled checkbox and looks like a bug.
  return [...new Set(valid)];
};

/**
 * Turns unknown stored JSONB into a valid PrivacySettings.
 *
 * Never throws and never returns a partial object: a corrupt or half-written
 * value degrades to the defaults for that section rather than failing the page
 * that read it. A privacy screen that 500s is a privacy screen nobody can use
 * to turn recording off.
 */
export function normalizePrivacySettings(value: unknown): PrivacySettings {
  const raw = (value ?? {}) as Record<string, unknown>;

  const recordingRaw = (raw.recording ?? {}) as Record<string, unknown>;
  const consentRaw = (raw.consent ?? {}) as Record<string, unknown>;
  const noticeRaw = (raw.notice ?? {}) as Record<string, unknown>;
  const collectionRaw = (raw.dataCollection ?? {}) as Record<string, unknown>;
  const retentionRaw = (raw.retention ?? {}) as Record<string, unknown>;
  const rightsRaw = (raw.dataRights ?? {}) as Record<string, unknown>;
  const disclosureRaw = (raw.aiDisclosure ?? {}) as Record<string, unknown>;
  const accessRaw = (raw.accessControl ?? {}) as Record<string, unknown>;

  const recording: RecordingSettings = {
    enabled: bool(recordingRaw.enabled, DEFAULT_PRIVACY_SETTINGS.recording.enabled),
  };

  const accessControl = SENSITIVE_CAPABILITIES.reduce((accumulator, capability) => {
    const configured = roles(accessRaw[capability], DEFAULT_ACCESS_CONTROL[capability]);
    // An empty list would lock everyone out, including the owner, with no way
    // back through the UI that produced it. Fall back rather than brick it.
    accumulator[capability] = configured.length > 0 ? configured : DEFAULT_ACCESS_CONTROL[capability];
    return accumulator;
  }, {} as AccessControlSettings);

  return {
    recording,
    consent: {
      requireExplicitConsent: bool(
        consentRaw.requireExplicitConsent,
        DEFAULT_PRIVACY_SETTINGS.consent.requireExplicitConsent
      ),
      declinePolicy: oneOf(consentRaw.declinePolicy, DECLINE_POLICIES, "metadata_only"),
    },
    notice: {
      title: str(noticeRaw.title, DEFAULT_PRIVACY_NOTICE.title, MAX_NOTICE_TITLE_LENGTH),
      content: str(noticeRaw.content, DEFAULT_PRIVACY_NOTICE.content, MAX_NOTICE_CONTENT_LENGTH),
    },
    dataCollection: {
      transcript: bool(collectionRaw.transcript, true),
      aiEvaluation: bool(collectionRaw.aiEvaluation, true),
      // Cannot be true while recording is off — the invariant applies on the
      // way in as well as at the point of use.
      audioRecording: recording.enabled && bool(collectionRaw.audioRecording, false),
      summary: bool(collectionRaw.summary, true),
      structuredAnswers: bool(collectionRaw.structuredAnswers, true),
      metadata: true,
    },
    retention: {
      defaultDays: days(retentionRaw.defaultDays, DEFAULT_RETENTION.defaultDays),
      audioRecordingDays: days(retentionRaw.audioRecordingDays, DEFAULT_RETENTION.audioRecordingDays),
      transcriptDays: days(retentionRaw.transcriptDays, DEFAULT_RETENTION.transcriptDays),
      aiEvaluationDays: days(retentionRaw.aiEvaluationDays, DEFAULT_RETENTION.aiEvaluationDays),
      onExpiry: oneOf(retentionRaw.onExpiry, EXPIRY_ACTIONS, DEFAULT_RETENTION.onExpiry),
    },
    dataRights: {
      allowDeletionRequests: bool(rightsRaw.allowDeletionRequests, true),
      allowExportRequests: bool(rightsRaw.allowExportRequests, true),
      allowConsentWithdrawal: bool(rightsRaw.allowConsentWithdrawal, true),
      onWithdrawal: oneOf(
        rightsRaw.onWithdrawal,
        WITHDRAWAL_ACTIONS,
        DEFAULT_DATA_RIGHTS.onWithdrawal
      ),
    },
    aiDisclosure: {
      enabled: bool(disclosureRaw.enabled, DEFAULT_AI_DISCLOSURE.enabled),
      message: str(
        disclosureRaw.message,
        DEFAULT_AI_DISCLOSURE.message,
        MAX_AI_DISCLOSURE_LENGTH
      ),
    },
    accessControl,
  };
}

/**
 * Human-readable labels. Kept beside the model so the UI, the audit log and any
 * future export all name a setting the same way.
 */
export const CAPABILITY_LABELS: Record<SensitiveCapability, string> = {
  viewRecording: "View recording",
  downloadRecording: "Download recording",
  viewTranscript: "View transcript",
  viewAiEvaluation: "View AI evaluation",
  deleteInterviewData: "Delete interview data",
  exportCandidateData: "Export candidate data",
};

export const EXPIRY_ACTION_LABELS: Record<ExpiryAction, string> = {
  delete: "Automatically delete data",
  archive: "Archive data",
  manual_review: "Require manual review",
};

export const WITHDRAWAL_ACTION_LABELS: Record<WithdrawalAction, string> = {
  stop_future_interviews: "Stop future AI interviews only",
  delete_scheduled_interviews: "Delete future scheduled interviews",
  delete_recordings: "Delete recordings",
  delete_transcripts: "Delete transcripts",
  delete_all: "Delete all AI interview data",
};

export const DECLINE_POLICY_LABELS: Record<DeclinePolicy, string> = {
  metadata_only: "Keep only that the call happened and was declined",
  keep_transcript: "Keep the transcript, discard any recording",
  keep_all: "Keep everything captured before the refusal",
};

export const DATA_COLLECTION_LABELS: Record<keyof DataCollectionSettings, string> = {
  transcript: "Store interview transcript",
  aiEvaluation: "Store AI evaluation",
  audioRecording: "Store audio recording",
  summary: "Store interview summary",
  structuredAnswers: "Store structured answers",
  metadata: "Store interview metadata",
};

/** The metadata fields the brief enumerates, for the UI's explanatory list. */
export const METADATA_FIELDS = [
  "Interview date and time",
  "Call duration",
  "Agent used",
  "Interview status",
  "Language",
  "Candidate consent status",
];
