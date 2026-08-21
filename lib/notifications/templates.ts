// =============================================================================
// Approved notification templates.
//
// A closed set, like Module 13's rule catalogue and Module 14's event
// catalogue. Nothing sends a message this file does not define.
//
// THE IMPORTANT IDEA HERE IS `fixedFacts`.
//
// Each template declares which of its substituted values are FACTS: times,
// names, places, figures. That declaration is what makes the spec's constraint
// — "AI tone adjustments never alter the fixed facts in a template (time,
// names, figures)" — checkable at all. Without it, "don't change the facts" has
// no referent and can only be a sentence in a prompt.
//
// With it, a rewritten message can be verified mechanically: every declared
// fact must still appear, and no new figure may have appeared.
//
// The failure being prevented is specific and serious: a candidate is told
// 3:00pm instead of 2:00pm and misses the interview. Nobody reviewing a fluent,
// friendly message would catch the digit.
// =============================================================================

export const NOTIFICATION_TYPES = [
  "interview_reminder",
  "interview_cancelled",
  "feedback_overdue",
  "client_feedback_overdue",
  "automation_failed",
  "screening_completed",
  "screening_callback_requested",
  "candidate_submitted",
  "assigned_to_application",
  // Module 19.
  "onboarding_document_uploaded",
  "onboarding_document_pending",
  // Module 13 upgrade — the automation engine's oversight queue, and the one
  // candidate-facing message an automation may send.
  "automation_needs_approval",
  "candidate_stage_update",
  // Module 20 — live coding.
  "coding_round_submitted",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Where a template is allowed to be sent. */
export type Audience =
  /** A colleague. Internal wording, no review step. */
  | "internal"
  /** A candidate or client. Recruiter review before anything leaves. */
  | "external";

export type TemplateDefinition = {
  audience: Audience;
  label: string;
  /** Shown in the preferences screen so a choice means something. */
  description: string;
  /**
   * Placeholders whose substituted values are FACTS and must survive any
   * rewrite verbatim. Everything else in the template is prose the AI may
   * reword freely.
   */
  fixedFacts: string[];
  /** All placeholders, so a missing one is caught before rendering. */
  placeholders: string[];
  title: string;
  body: string;
  /** Default when no organization or user preference exists. */
  defaultInApp: boolean;
  defaultEmail: boolean;
  /** high sorts to the top of the centre. */
  priority?: "low" | "normal" | "high";
};

export const TEMPLATES: Record<NotificationType, TemplateDefinition> = {
  interview_reminder: {
    audience: "external",
    label: "Interview reminder",
    description: "Sent before a scheduled interview.",
    // Every one of these, wrong, causes a missed interview.
    fixedFacts: ["candidate_name", "interview_time", "job_title", "location"],
    placeholders: ["candidate_name", "interview_time", "job_title", "location"],
    title: "Interview reminder: {{candidate_name}}",
    body:
      "Hi {{candidate_name}}, this is a reminder that your interview for the {{job_title}} role " +
      "is scheduled for {{interview_time}}. Location: {{location}}. " +
      "Please let us know if you need to reschedule.",
    defaultInApp: true,
    defaultEmail: true,
    priority: "high",
  },

  interview_cancelled: {
    audience: "external",
    label: "Interview cancelled",
    description: "Sent when a scheduled interview is cancelled.",
    fixedFacts: ["candidate_name", "interview_time", "job_title"],
    placeholders: ["candidate_name", "interview_time", "job_title"],
    title: "Interview cancelled: {{candidate_name}}",
    body:
      "Hi {{candidate_name}}, unfortunately the interview for the {{job_title}} role scheduled " +
      "for {{interview_time}} has been cancelled. We will be in touch to arrange a new time.",
    defaultInApp: true,
    defaultEmail: true,
    priority: "high",
  },

  feedback_overdue: {
    audience: "internal",
    label: "Interview feedback overdue",
    description: "Reminds an interviewer that their feedback is still outstanding.",
    fixedFacts: ["candidate_name", "hours_overdue"],
    placeholders: ["candidate_name", "hours_overdue"],
    title: "Feedback outstanding for {{candidate_name}}",
    body:
      "Your interview with {{candidate_name}} finished {{hours_overdue}} hours ago and feedback " +
      "hasn't been submitted yet. The pipeline can't move until it is.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  client_feedback_overdue: {
    audience: "internal",
    label: "Client feedback overdue",
    description: "Flags a client who hasn't responded to a submission within their SLA.",
    fixedFacts: ["client_name", "candidate_name", "days_waiting"],
    placeholders: ["client_name", "candidate_name", "days_waiting"],
    title: "{{client_name}} hasn't responded",
    body:
      "{{client_name}} has had {{candidate_name}}'s submission for {{days_waiting}} days with no " +
      "response, which is past their agreed turnaround. A chase may be needed.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  automation_failed: {
    audience: "internal",
    label: "Automation failed",
    description: "Alerts admins when an automation run fails.",
    fixedFacts: ["automation_name"],
    placeholders: ["automation_name", "reason"],
    title: "Automation failed: {{automation_name}}",
    body:
      "The automation \"{{automation_name}}\" failed to complete. Reason: {{reason}}. " +
      "It will not retry on its own.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "high",
  },

  screening_completed: {
    audience: "internal",
    label: "Screening call completed",
    description: "Tells the assigned recruiter a screening call has finished.",
    fixedFacts: ["candidate_name"],
    placeholders: ["candidate_name", "job_title"],
    title: "Screening finished: {{candidate_name}}",
    body:
      "The AI screening call with {{candidate_name}} for the {{job_title}} role has finished. " +
      "The transcript is ready for review.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  screening_callback_requested: {
    audience: "internal",
    label: "Candidate asked for a callback",
    description: "Raised when a candidate declines the automated call and asks for a person.",
    fixedFacts: ["candidate_name"],
    placeholders: ["candidate_name"],
    // The spec's own example of AI suggesting a recruiter action.
    title: "{{candidate_name}} asked to speak to someone",
    body:
      "{{candidate_name}} declined the automated screening call and asked for a person to call " +
      "them instead. They should not be dialled again automatically.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "high",
  },

  candidate_submitted: {
    audience: "internal",
    label: "Candidate submitted to a client",
    description: "Confirms a submission was recorded.",
    fixedFacts: ["candidate_name", "client_name"],
    placeholders: ["candidate_name", "client_name"],
    title: "{{candidate_name}} submitted to {{client_name}}",
    body: "{{candidate_name}} has been submitted to {{client_name}}. The response clock starts now.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  assigned_to_application: {
    audience: "internal",
    label: "Assigned to an application",
    description: "Tells a recruiter when work is assigned to them.",
    fixedFacts: ["candidate_name", "job_title"],
    placeholders: ["candidate_name", "job_title"],
    title: "You've been assigned {{candidate_name}}",
    body: "{{candidate_name}}'s application for the {{job_title}} role is now assigned to you.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  // ---------------------------------------------------------------------------
  // MODULE 19 — onboarding documents
  //
  // Both are INTERNAL. Nothing here emails the new hire: chasing someone for a
  // copy of their PAN card is a conversation a human is already having on
  // WhatsApp, and an automated nag sent in a recruiter's name without their
  // knowledge is exactly what Module 12's client reminders deliberately avoid.
  // ---------------------------------------------------------------------------
  onboarding_document_uploaded: {
    audience: "internal",
    label: "Onboarding document uploaded",
    description: "Tells the assignee when a document is waiting to be verified.",
    // The document name is the fact. "A document was uploaded" would send the
    // reader to the page to find out which one.
    fixedFacts: ["candidate_name", "document_name"],
    placeholders: ["candidate_name", "document_name"],
    title: "{{document_name}} uploaded for {{candidate_name}}",
    body:
      "{{document_name}} has been uploaded for {{candidate_name}}'s onboarding and is " +
      "waiting to be verified.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  onboarding_document_pending: {
    audience: "internal",
    label: "Onboarding document overdue",
    description: "Reminds the assignee when a required document has sat unfilled too long.",
    fixedFacts: ["candidate_name", "document_name", "days_waiting"],
    placeholders: ["candidate_name", "document_name", "days_waiting"],
    title: "{{document_name}} still missing for {{candidate_name}}",
    body:
      "{{document_name}} has been outstanding for {{days_waiting}} days on " +
      "{{candidate_name}}'s onboarding. It is required, so their onboarding cannot be " +
      "completed until it is verified.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "normal",
  },

  // ---------------------------------------------------------------------------
  // MODULE 13 UPGRADE — human oversight.
  //
  // HIGH priority and email on by default, which is unusual here. The reason: a
  // proposal that nobody reads is not oversight, and automation_approvals rows
  // expire after seven days. An unnoticed proposal becomes a candidate who was
  // never contacted, with the system reporting that it asked.
  // ---------------------------------------------------------------------------
  automation_needs_approval: {
    audience: "internal",
    label: "Automation waiting for approval",
    description:
      "Tells Owners and Admins when a rule has proposed actions and is waiting for a decision.",
    fixedFacts: ["automation_name"],
    placeholders: ["automation_name"],
    title: "{{automation_name}} needs your approval",
    body:
      "The automation \"{{automation_name}}\" matched an application and is waiting for " +
      "someone to approve its actions. Nothing has run yet, and the request expires in " +
      "seven days.",
    defaultInApp: true,
    defaultEmail: true,
    priority: "high",
  },

  /**
   * THE ONLY EXTERNAL TEMPLATE AN AUTOMATION CAN SEND.
   *
   * Every substituted value is a FIXED FACT, so there is nothing in this message
   * an AI rewrite may reword and nothing a rule's config may fill. A rule cannot
   * compose a sentence to a candidate; it can only choose to send this one.
   *
   * It also deliberately promises nothing. "You have moved to <stage>" is true
   * and useful; "we will be in touch shortly" is a commitment made on a
   * recruiter's behalf by a rule, and nobody in the loop agreed to it.
   */
  candidate_stage_update: {
    audience: "external",
    label: "Candidate stage update",
    description:
      "Tells a candidate their application has moved to a new stage. Sent only by an approved automation.",
    fixedFacts: ["candidate_name", "job_title", "stage_name", "organization_name"],
    placeholders: ["candidate_name", "job_title", "stage_name", "organization_name"],
    title: "Update on your application for {{job_title}}",
    body:
      "Hi {{candidate_name}}, your application for the {{job_title}} role at " +
      "{{organization_name}} has moved to the {{stage_name}} stage. " +
      "You do not need to do anything right now — we will contact you if we need " +
      "something from you.",
    defaultInApp: true,
    defaultEmail: true,
    priority: "normal",
  },

  /**
   * Module 20. INTERNAL — this tells the interviewer, not the candidate.
   *
   * The candidate already knows they submitted; they clicked the button and read
   * the confirmation. The person who needs telling is the interviewer, who may
   * be mid-call and watching a monitor that has just stopped changing.
   *
   * `high` priority, unlike most internal notifications: a coding round is
   * submitted during a live interview, and a notification a recruiter reads
   * tomorrow is a notification that arrived after the decision was made.
   */
  coding_round_submitted: {
    audience: "internal",
    label: "Coding round submitted",
    description:
      "Tells the interviewer the moment a candidate submits their live coding round.",
    fixedFacts: ["candidate_name", "job_title"],
    placeholders: ["candidate_name", "job_title", "language"],
    title: "{{candidate_name}} submitted their coding round",
    body:
      "{{candidate_name}} has submitted their coding round for the {{job_title}} role " +
      "({{language}}). You can read the submission from the interview.",
    defaultInApp: true,
    defaultEmail: false,
    priority: "high",
  },
};

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && value in TEMPLATES;
}

export type RenderedMessage = {
  title: string;
  body: string;
  /** placeholder -> the value substituted in. The tone guard's reference. */
  facts: Record<string, string>;
};

export type RenderResult =
  | { ok: true; message: RenderedMessage }
  | { ok: false; error: string };

/**
 * Renders a template.
 *
 * A MISSING FACT IS A HARD FAILURE, not an empty string. "your interview is
 * scheduled for " is worse than no message: it looks deliberate, and the
 * recipient has no way to know what was lost.
 *
 * Non-fact placeholders may be omitted — they degrade to a neutral phrase,
 * because a missing free-text reason should not block an alert about a real
 * failure.
 */
export function renderTemplate({
  type,
  values,
}: {
  type: NotificationType;
  values: Record<string, string | number | null | undefined>;
}): RenderResult {
  const template = TEMPLATES[type];
  if (!template) return { ok: false, error: `Unknown notification type: ${type}` };

  const facts: Record<string, string> = {};

  for (const key of template.fixedFacts) {
    const value = values[key];
    if (value === null || value === undefined || String(value).trim().length === 0) {
      return {
        ok: false,
        error: `"${key}" is required for a ${template.label} and wasn't supplied.`,
      };
    }
    facts[key] = String(value).trim();
  }

  const substitute = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      if (key in facts) return facts[key];
      const value = values[key];
      if (value === null || value === undefined || String(value).trim().length === 0) {
        return "not recorded";
      }
      return String(value).trim();
    });

  return {
    ok: true,
    message: {
      title: substitute(template.title),
      body: substitute(template.body),
      facts,
    },
  };
}

/** Templates addressed to a candidate or client — these need review before sending. */
export function isExternalTemplate(type: NotificationType): boolean {
  return TEMPLATES[type]?.audience === "external";
}
