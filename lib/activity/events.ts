// =============================================================================
// The event catalogue.
//
// A closed vocabulary, for the same reason Module 13's rule catalogue is closed:
// it is what lets the timeline render a human sentence for every row, and what
// lets the AI narrative be checked against the log rather than trusted.
//
// Each entry declares:
//   - the entity it belongs to (which timeline it appears on)
//   - whether it is SECURITY-SENSITIVE (Owner/Admin only, enforced in RLS)
//   - a describe() that turns a row into a sentence
//
// Adding an event means adding it here. An event_type not in this map still
// stores and still renders — as its raw slug — because losing an audit row to a
// missing case statement would be worse than an ugly label.
// =============================================================================
import type { ActivityEntityType } from "@/lib/activity/types";

export type EventDefinition = {
  entity: ActivityEntityType;
  /** Restricted to Owner/Admin. Mirrored onto the row's is_sensitive column. */
  sensitive?: boolean;
  label: string;
  describe: (metadata: Record<string, unknown>) => string;
};

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const EVENT_CATALOGUE = {
  // ---------------------------------------------------------------------------
  // Module 1 — organization, membership, access.
  //
  // Every one of these is sensitive: they change who can do what.
  // ---------------------------------------------------------------------------
  "organization.created": {
    entity: "organization",
    sensitive: true,
    label: "Organization created",
    describe: (m) => `Created the organization ${text(m.name, "")}`.trim(),
  },
  "organization.updated": {
    entity: "organization",
    sensitive: true,
    label: "Organization settings changed",
    describe: (m) => {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      return fields.length > 0
        ? `Changed organization settings: ${fields.join(", ")}`
        : "Changed organization settings";
    },
  },
  "member.invited": {
    entity: "member",
    sensitive: true,
    label: "Member invited",
    describe: (m) => `Invited ${text(m.email, "someone")} as ${text(m.role, "a member")}`,
  },
  "member.invite_accepted": {
    entity: "member",
    sensitive: true,
    label: "Invite accepted",
    describe: (m) => `${text(m.email, "A new member")} joined as ${text(m.role, "a member")}`,
  },
  "member.invite_revoked": {
    entity: "member",
    sensitive: true,
    label: "Invite revoked",
    describe: (m) => `Revoked the invite for ${text(m.email, "a pending member")}`,
  },
  "member.role_changed": {
    entity: "member",
    sensitive: true,
    label: "Role changed",
    describe: (m) =>
      `Changed ${text(m.member_name, "a member")}'s role from ${text(m.from, "?")} to ${text(m.to, "?")}`,
  },
  "member.removed": {
    entity: "member",
    sensitive: true,
    label: "Member removed",
    describe: (m) => `Removed ${text(m.member_name, "a member")} from the team`,
  },

  // ---------------------------------------------------------------------------
  // Module 3 — jobs.
  // ---------------------------------------------------------------------------
  "job.created": {
    entity: "job",
    label: "Job created",
    describe: (m) => `Created the job ${text(m.title, "")}`.trim(),
  },
  "job.updated": {
    entity: "job",
    label: "Job updated",
    describe: (m) => {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      return fields.length > 0 ? `Updated the job: ${fields.join(", ")}` : "Updated the job";
    },
  },
  "job.status_changed": {
    entity: "job",
    label: "Job status changed",
    describe: (m) => `Moved the job from ${text(m.from, "?")} to ${text(m.to, "?")}`,
  },
  "job.archived": {
    entity: "job",
    label: "Job archived",
    describe: () => "Archived the job",
  },

  // ---------------------------------------------------------------------------
  // Module 4 — candidates.
  // ---------------------------------------------------------------------------
  "candidate.created": {
    entity: "candidate",
    label: "Candidate added",
    describe: (m) => `Added ${text(m.name, "a candidate")} to the database`,
  },
  "candidate.updated": {
    entity: "candidate",
    label: "Candidate updated",
    describe: (m) => {
      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      return fields.length > 0 ? `Updated ${fields.join(", ")}` : "Updated the candidate record";
    },
  },
  "candidate.archived": {
    entity: "candidate",
    label: "Candidate archived",
    describe: () => "Archived the candidate",
  },
  "candidate.duplicate_flagged": {
    entity: "candidate",
    label: "Possible duplicate flagged",
    describe: (m) => {
      const count = num(m.duplicate_count);
      return count && count > 1
        ? `Flagged as a possible duplicate of ${count} existing records`
        : "Flagged as a possible duplicate of an existing record";
    },
  },
  /**
   * Wired only once Module 4's merge UI exists — see
   * docs/modules/04-candidates-notes.md. Defined now so the event name is fixed
   * before anything starts writing it.
   */
  "candidate.duplicate_resolved": {
    entity: "candidate",
    label: "Duplicate resolved",
    describe: (m) =>
      text(m.status) === "merged"
        ? `Merged a duplicate record into this candidate`
        : `Marked a suspected duplicate as ${text(m.status, "resolved")}`,
  },

  // ---------------------------------------------------------------------------
  // Module 5 — applications.
  // ---------------------------------------------------------------------------
  "application.created": {
    entity: "application",
    label: "Applied",
    describe: (m) => `Added to the pipeline for ${text(m.job_title, "a job")}`,
  },
  "application.stage_changed": {
    entity: "application",
    label: "Stage changed",
    describe: (m) => `Moved from ${text(m.from, "?")} to ${text(m.to, "?")}`,
  },
  "application.recruiter_assigned": {
    entity: "application",
    label: "Recruiter assigned",
    describe: (m) => `Assigned to ${text(m.recruiter_name, "a recruiter")}`,
  },
  "application.archived": {
    entity: "application",
    label: "Application archived",
    describe: () => "Archived the application",
  },
  // ---------------------------------------------------------------------------
  // Module 19 — onboarding documents.
  //
  // Filed under the APPLICATION rather than a new entity type, so a hire's
  // timeline reads straight through from "moved to Hired" into the paperwork
  // that followed. Splitting them would put the cause and the consequence on
  // two different screens.
  //
  // None are marked sensitive. They record that a document CHANGED STATE, never
  // its contents — the audit log must not become a second copy of somebody's
  // identity papers.
  // ---------------------------------------------------------------------------
  "onboarding.updated": {
    entity: "application",
    label: "Onboarding updated",
    describe: (m) => {
      const status = text(m.status);
      const labels: Record<string, string> = {
        in_progress: "Reopened onboarding",
        completed: "Marked onboarding complete",
        on_hold: "Put onboarding on hold",
      };
      if (status && labels[status]) return labels[status];
      return "assigned_to" in m ? "Reassigned onboarding" : "Updated onboarding";
    },
  },
  "onboarding.document_uploaded": {
    entity: "application",
    label: "Onboarding document uploaded",
    describe: (m) => `Uploaded ${text(m.document_name, "a document")}`,
  },
  "onboarding.document_verified": {
    entity: "application",
    label: "Onboarding document verified",
    describe: (m) => `Verified ${text(m.document_name, "a document")}`,
  },
  "onboarding.document_rejected": {
    entity: "application",
    label: "Onboarding document rejected",
    // The reason is stored on the document and shown to whoever uploaded it.
    // Not repeated here: the audit log is read by people who do not need it.
    describe: (m) => `Rejected ${text(m.document_name, "a document")}`,
  },
  "onboarding.document_added": {
    entity: "application",
    label: "Onboarding document added",
    describe: (m) => `Added ${text(m.document_name, "a one-off document")} to the checklist`,
  },
  "application.note_added": {
    entity: "application",
    label: "Note added",
    describe: () => "Added a note",
  },

  // ---------------------------------------------------------------------------
  // Module 6 — resumes.
  // ---------------------------------------------------------------------------
  "resume.uploaded": {
    entity: "resume",
    label: "Resume uploaded",
    describe: (m) => `Uploaded ${text(m.file_name, "a resume")}`,
  },
  "resume.parsed": {
    entity: "resume",
    label: "Resume parsed",
    describe: (m) => {
      const fields = num(m.field_count);
      return fields === null
        ? "AI parsed the resume"
        : `AI parsed the resume and proposed ${fields} field${fields === 1 ? "" : "s"}`;
    },
  },
  "resume.review_applied": {
    entity: "resume",
    label: "Parsed fields reviewed",
    describe: (m) => {
      const accepted = num(m.accepted_count);
      const rejected = num(m.rejected_count);
      if (accepted === null) return "Reviewed the parsed fields";
      return `Accepted ${accepted} parsed field${accepted === 1 ? "" : "s"}${
        rejected ? ` and rejected ${rejected}` : ""
      }`;
    },
  },

  // ---------------------------------------------------------------------------
  // Module 7 — matching.
  // ---------------------------------------------------------------------------
  "match.calculated": {
    entity: "application",
    label: "Match calculated",
    describe: (m) => {
      const score = num(m.score);
      return score === null
        ? "Calculated the match score"
        : `Match score calculated: ${score}%`;
    },
  },

  // ---------------------------------------------------------------------------
  // Module 8 — screening calls.
  // ---------------------------------------------------------------------------
  "screening_call.started": {
    entity: "screening_call",
    label: "Screening call started",
    describe: (m) => {
      const attempt = num(m.attempt_number);
      return attempt && attempt > 1
        ? `AI screening call started (attempt ${attempt})`
        : "AI screening call started";
    },
  },
  "screening_call.completed": {
    entity: "screening_call",
    label: "Screening call finished",
    describe: (m) => {
      const status = text(m.status, "finished");
      const consent = m.consent_confirmed === true;
      if (status === "completed") {
        return consent
          ? "AI screening call completed with the candidate's consent"
          : "AI screening call completed, but consent was not confirmed";
      }
      if (status === "cancelled") return "The candidate declined the automated call";
      return `AI screening call ended: ${status}`;
    },
  },

  // ---------------------------------------------------------------------------
  // Module 9 — screening reports.
  // ---------------------------------------------------------------------------
  "screening_report.generated": {
    entity: "screening_report",
    label: "Screening report generated",
    describe: () => "AI generated the screening report, pending review",
  },
  "screening_report.reviewed": {
    entity: "screening_report",
    label: "Screening report reviewed",
    describe: (m) => {
      const corrected = Array.isArray(m.corrected_fields) ? (m.corrected_fields as string[]) : [];
      return corrected.length > 0
        ? `Reviewed the screening report and corrected ${corrected.join(", ")}`
        : "Reviewed the screening report and confirmed it";
    },
  },

  // ---------------------------------------------------------------------------
  // Module 11 — interviews.
  // ---------------------------------------------------------------------------
  "interview.scheduled": {
    entity: "interview",
    label: "Interview scheduled",
    describe: (m) => `Interview scheduled for ${text(m.scheduled_at, "a later date")}`,
  },
  "interview.cancelled": {
    entity: "interview",
    label: "Interview cancelled",
    describe: () => "Cancelled the interview",
  },
  "interview.feedback_submitted": {
    entity: "interview",
    label: "Interview feedback submitted",
    describe: (m) => {
      const recommendation = text(m.recommendation);
      return recommendation
        ? `Submitted interview feedback: ${recommendation.replace(/_/g, " ")}`
        : "Submitted interview feedback";
    },
  },

  // ---------------------------------------------------------------------------
  // Module 12 — clients.
  // ---------------------------------------------------------------------------
  "client.created": {
    entity: "client",
    label: "Client added",
    describe: (m) => `Added the client ${text(m.name, "")}`.trim(),
  },
  "client.updated": {
    entity: "client",
    label: "Client updated",
    describe: () => "Updated the client record",
  },
  "client.submission_sent": {
    entity: "application",
    label: "Submitted to client",
    describe: (m) => `Submitted to ${text(m.client_name, "the client")}`,
  },

  // ---------------------------------------------------------------------------
  // Module 13 — automations.
  //
  // Creating and activating a rule that acts on candidates on its own is a
  // settings-sensitive act, so those are Owner/Admin-visible. Individual RUNS
  // are not: the recruiter whose candidate was called needs to see that.
  // ---------------------------------------------------------------------------
  "automation.created": {
    entity: "automation",
    sensitive: true,
    label: "Automation created",
    describe: (m) =>
      `Created the automation "${text(m.name, "untitled")}"${
        m.drafted_by_ai === true ? " from an AI draft" : ""
      }`,
  },
  "automation.activated": {
    entity: "automation",
    sensitive: true,
    label: "Automation activated",
    describe: (m) => `Activated the automation "${text(m.name, "untitled")}"`,
  },
  "automation.paused": {
    entity: "automation",
    sensitive: true,
    label: "Automation paused",
    describe: (m) => `Paused the automation "${text(m.name, "untitled")}"`,
  },
  "automation.deleted": {
    entity: "automation",
    sensitive: true,
    label: "Automation deleted",
    describe: (m) => `Deleted the automation "${text(m.name, "untitled")}"`,
  },
  /**
   * The oversight decisions. Sensitive, like activation, and for the same
   * reason: this is a person choosing that the system acts on a candidate.
   *
   * Both are kept even though a rejection changes nothing — "we considered this
   * and declined" is the record that makes human oversight auditable, and it is
   * the half that would otherwise leave no trace at all.
   */
  "automation.approved": {
    entity: "automation",
    sensitive: true,
    label: "Automation actions approved",
    describe: (m) =>
      `Approved ${num(m.action_count) ?? "the"} proposed action${
        num(m.action_count) === 1 ? "" : "s"
      } from "${text(m.name, "an automation")}"`,
  },
  "automation.rejected": {
    entity: "automation",
    sensitive: true,
    label: "Automation actions rejected",
    describe: (m) => `Declined the actions proposed by "${text(m.name, "an automation")}"`,
  },
  "automation.run": {
    entity: "application",
    label: "Automation ran",
    describe: (m) => {
      const name = text(m.name, "An automation");
      const status = text(m.status, "ran");
      if (status === "success") return `${name} ran successfully`;
      if (status === "skipped") return `${name} was skipped: ${text(m.reason, "conditions not met")}`;
      if (status === "blocked") return `${name} was blocked: ${text(m.reason, "integration unavailable")}`;
      if (status === "awaiting_approval") return `${name} is waiting for someone to approve its actions`;
      return `${name} failed: ${text(m.reason, "see the run history")}`;
    },
  },

  // ---------------------------------------------------------------------------
  // Integrations — always sensitive; these hold credentials.
  // ---------------------------------------------------------------------------
  "integration.connected": {
    entity: "integration",
    sensitive: true,
    label: "Integration connected",
    describe: (m) => `Connected ${text(m.provider, "an integration")}`,
  },
  "integration.disconnected": {
    entity: "integration",
    sensitive: true,
    label: "Integration disconnected",
    describe: (m) => `Disconnected ${text(m.provider, "an integration")}`,
  },
  "integration.tested": {
    entity: "integration",
    sensitive: true,
    label: "Integration tested",
    describe: (m) =>
      `Tested ${text(m.provider, "an integration")}: ${text(m.result, "no result recorded")}`,
  },

  // ---------------------------------------------------------------------------
  // Module 15 — candidate communication.
  //
  // A message to a candidate is filed against the APPLICATION, so it lands on the
  // timeline a recruiter is already reading rather than in a separate place they
  // have to remember to check. The Communications section shows the same events in
  // full; this is the one-line audit record beside the stage change that caused it.
  //
  // NEVER THE MESSAGE BODY. The full resolved text lives in message_log, which has
  // its own append-only policy; copying it here would put candidate-facing prose
  // into a table whose whole purpose is that it is read broadly.
  // ---------------------------------------------------------------------------
  "message.sent": {
    entity: "application",
    label: "Message sent to candidate",
    describe: (m) => {
      const channel = text(m.channel) === "whatsapp" ? "WhatsApp" : "email";
      const template = text(m.template);
      const status = text(m.status, "sent");

      // "Not sent" is the more important half of this event: it is how a team
      // discovers that the candidate never heard, and why.
      if (status !== "sent") {
        return template
          ? `"${template}" was not sent by ${channel}: ${text(m.detail, "no reason recorded")}`
          : `A ${channel} message was not sent: ${text(m.detail, "no reason recorded")}`;
      }

      return template ? `Sent "${template}" by ${channel}` : `Sent a ${channel} message`;
    },
  },
  "message_template.created": {
    entity: "message_template",
    label: "Message template created",
    describe: (m) => `Created the message template ${text(m.name, "")}`.trim(),
  },
  "message_template.updated": {
    entity: "message_template",
    label: "Message template changed",
    describe: (m) => {
      const name = text(m.name, "a message template");
      // Activation is called out separately from an edit: switching a template on
      // is the moment it starts messaging candidates by itself, which is a
      // different kind of change from fixing a typo in it.
      if (m.active === true) return `Activated "${name}" — it now sends automatically`;
      if (m.active === false) return `Deactivated "${name}" — it no longer sends automatically`;

      const fields = Array.isArray(m.fields) ? (m.fields as string[]) : [];
      return fields.length > 0
        ? `Edited "${name}" (${fields.join(", ")})`
        : `Edited "${name}"`;
    },
  },
  "message_template.deleted": {
    entity: "message_template",
    label: "Message template deleted",
    describe: (m) => `Deleted the message template ${text(m.name, "")}`.trim(),
  },
  "candidate.communication_preference_changed": {
    entity: "candidate",
    label: "Candidate contact preference changed",
    describe: (m) => {
      const channels = Array.isArray(m.opted_out_of) ? (m.opted_out_of as string[]) : [];
      const label = (channel: string) => (channel === "whatsapp" ? "WhatsApp" : "email");

      if (channels.length === 0) return "Cleared this candidate's opt-outs";

      const source = text(m.source) === "candidate" ? "The candidate opted out of" : "Recorded an opt-out from";
      return `${source} ${channels.map(label).join(" and ")}`;
    },
  },

  // ---------------------------------------------------------------------------
  // Module 16 — analytics.
  //
  // Sensitive: an export takes organizational data out of the product in a form
  // that can be forwarded anywhere, so who took what is an access question, not
  // a recruitment one.
  // ---------------------------------------------------------------------------
  "analytics.exported": {
    entity: "organization",
    sensitive: true,
    label: "Analytics exported",
    describe: (m) => {
      const range = text(m.range, "a period");
      return `Exported an analytics report for ${range}`;
    },
  },

  // ---------------------------------------------------------------------------
  // AI calls.
  //
  // Section 10 requires every AI call logged "at a summary level ... without
  // storing secrets or full raw provider payloads". So: which function, whether
  // it succeeded, and nothing else. Never the prompt, never the completion.
  // ---------------------------------------------------------------------------
  "ai.invoked": {
    entity: "application",
    label: "AI used",
    describe: (m) => {
      const feature = text(m.feature, "An AI feature");
      return m.ok === false
        ? `${feature} was attempted but failed (${text(m.error_code, "error")})`
        : `${feature} ran`;
    },
  },
} as const satisfies Record<string, EventDefinition>;

export type EventType = keyof typeof EVENT_CATALOGUE;

export const EVENT_TYPES = Object.keys(EVENT_CATALOGUE) as EventType[];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && value in EVENT_CATALOGUE;
}

/** Whether an event belongs in the Owner/Admin-only audit log. */
export function isSensitiveEvent(eventType: string): boolean {
  const definition = EVENT_CATALOGUE[eventType as EventType] as EventDefinition | undefined;
  return definition?.sensitive === true;
}

/**
 * Renders a row as a sentence.
 *
 * Falls back to the raw slug for an unknown event rather than throwing or
 * hiding the row. An audit entry we cannot label is still an audit entry, and
 * dropping it would be the one unrecoverable failure mode here.
 */
export function describeEvent(eventType: string, metadata: Record<string, unknown>): string {
  const definition = EVENT_CATALOGUE[eventType as EventType] as EventDefinition | undefined;
  if (!definition) return eventType.replace(/[._]/g, " ");

  try {
    return definition.describe(metadata ?? {});
  } catch {
    return definition.label;
  }
}

export function eventLabel(eventType: string): string {
  const definition = EVENT_CATALOGUE[eventType as EventType] as EventDefinition | undefined;
  return definition?.label ?? eventType.replace(/[._]/g, " ");
}

/** Every event type recorded against a given entity kind, for filter menus. */
export function eventTypesForEntity(entity: ActivityEntityType): EventType[] {
  return EVENT_TYPES.filter((type) => EVENT_CATALOGUE[type].entity === entity);
}

/** The sensitive slice — what /audit-log shows. */
export const SENSITIVE_EVENT_TYPES: EventType[] = EVENT_TYPES.filter((type) =>
  isSensitiveEvent(type)
);
