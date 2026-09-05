// =============================================================================
// The Default Recruitment Flow.
//
// A DEFINITION, not an implementation. Everything below is data: seven message
// templates, two forms, and a list of stage/branch action lists. Applying it
// writes ordinary rows through the paths that already exist —
// saveStageWorkflow() for the automations, the message_templates table for the
// copy, the forms tables for the questions.
//
// -----------------------------------------------------------------------------
// THIS IS A STARTING POINT, NOT A MODE.
//
// The brief's section 6 is the load-bearing requirement: "a recruiter should be
// able to apply 'Default Recruitment Flow' to a job and then immediately tweak
// the 30-minute wait to 2 hours, or swap a template's wording, without needing a
// developer."
//
// So nothing here is referenced at runtime. The engine has no idea this file
// exists; it reads automations rows. Once applied, the flow is indistinguishable
// from one somebody built by hand in the Stage Workflow Builder — same rows,
// same editor, same run history — which is what makes every number in it
// editable. There is no `is_default_flow` flag anywhere, deliberately: a flag
// would invite code that treats those rows as special, and the first such branch
// would make "fully editable" false.
//
// -----------------------------------------------------------------------------
// THE TEMPLATES SHIP INACTIVE, AND THAT IS NOT A DETAIL.
//
// message_templates.active defaults to false and this file does not override it.
// The brief asks for it, and the reason is that these are words this codebase
// wrote which will be sent to real people over an organisation's name. Somebody
// there has to read them first. The applied flow therefore does nothing visible
// until a human reviews the wording — sendForEvent() skips an inactive template
// and says so in the run log.
//
// -----------------------------------------------------------------------------
// WHY THE AVAILABILITY FORMS USE RADIO BUTTONS AND NOT A CALENDAR.
//
// Checked before assuming: lib/forms/fields.ts supports short_text, long_text,
// email, phone, number, dropdown, radio, checkbox, date, url, yes_no and
// file_upload. There is no time picker and no slot widget — `date` is a date
// with no time on it.
//
// The brief anticipated this ("or a short list of options if the existing Forms
// engine doesn't support native scheduling widgets"). A `radio` of named windows
// is the honest fit: it collects a real preference, it renders on a phone, and
// it needs no engine work. A `date` field would collect a day and lose the time,
// which is the part a call needs.
// =============================================================================

import type { Action } from "@/lib/automations/catalog";
import type { ApplicationStage } from "@/lib/applications/stages";
import type { WorkflowBranch } from "@/lib/workflow/stages";
import type { CommunicationEventKey } from "@/lib/communications/events";
import type { TemplateChannel } from "@/lib/communications/templates";

export const DEFAULT_FLOW_KEY = "default_recruitment_flow";

export const DEFAULT_FLOW_LABEL = "Default Recruitment Flow";

export const DEFAULT_FLOW_DESCRIPTION =
  "Screens every resume against this job's passing mark, keeps the candidate " +
  "informed at each step, and collects their availability before the screening " +
  "call and the video interview.";

// =============================================================================
// The message templates.
//
// Written to be read by a person who is nervous about a job application, which
// is why none of them open with "We regret to inform you". Every one uses the
// candidate's name and the job title, because a message that could have been
// sent to anybody reads as one that was.
//
// The WhatsApp bodies are separate and much shorter — a phone message that
// scrolls is one nobody finishes. That is the whole reason `channel: "both"`
// carries two bodies.
// =============================================================================

export type FlowTemplate = {
  /** Internal key, so applying twice finds the existing row rather than duplicating. */
  key: string;
  name: string;
  eventKey: CommunicationEventKey;
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  whatsappBody: string | null;
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "cv_shortlisted",
    name: "CV Shortlisted",
    eventKey: "shortlisted",
    channel: "both",
    subject: "Good news about your {{job.title}} application",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Thanks for applying for the {{job.title}} role. We've had a proper look at your CV " +
      "and we'd like to take things further.\n\n" +
      "The next step is a short screening call — nothing formal, just a chance for us to " +
      "hear about what you're looking for and to answer your questions about the role.\n\n" +
      "We'll send you a link in a moment to pick a time that suits you.\n\n" +
      "Speak soon,\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Hi {{candidate.first_name}} — good news on your {{job.title}} application at " +
      "{{organization.name}}. We'd like to set up a short screening call. " +
      "We'll send a link shortly so you can pick a time that works for you.",
  },
  {
    key: "screening_call_reminder",
    name: "Screening Call Reminder",
    eventKey: "ai_screening_call_scheduled",
    channel: "both",
    subject: "Your call about the {{job.title}} role is coming up",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Just a quick note that we'll be calling you shortly about the {{job.title}} role.\n\n" +
      "It should take about ten minutes. If now turns out to be a bad time, don't worry — " +
      "just let the call go and reply to this email, and we'll find another slot.\n\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Hi {{candidate.first_name}} — we'll be calling you shortly about the {{job.title}} " +
      "role. Around ten minutes. If it's a bad time, just reply here and we'll rearrange.",
  },
  {
    key: "screening_call_thank_you",
    name: "Screening Call Thank You",
    eventKey: "application_received",
    channel: "both",
    subject: "Thanks for your time today",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Thanks for taking the time to speak with us about the {{job.title}} role — it was " +
      "good to hear more about your background.\n\n" +
      "We're reviewing the conversation now and you'll hear from us shortly, either way.\n\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Thanks for your time today, {{candidate.first_name}}. We're reviewing the call now " +
      "and will be back in touch shortly about the {{job.title}} role — either way.",
  },
  {
    key: "screening_call_passed",
    name: "Screening Call Passed",
    eventKey: "video_interview_scheduled",
    channel: "both",
    subject: "You're through to the next round for {{job.title}}",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Good news — the team enjoyed your screening call and we'd like to move you " +
      "forward to a video interview for the {{job.title}} role.\n\n" +
      "This one goes deeper into your experience and gives you a proper chance to ask " +
      "about the team and the work. Allow around an hour.\n\n" +
      "We'll send a link shortly so you can pick a time that suits you.\n\n" +
      "Congratulations, and speak soon.\n\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Congratulations {{candidate.first_name}} — you're through to a video interview for " +
      "the {{job.title}} role. Around an hour. We'll send a link shortly so you can pick " +
      "a time.",
  },
  {
    key: "screening_call_not_successful",
    name: "Screening Call Not Successful",
    eventKey: "rejected",
    channel: "both",
    subject: "About your {{job.title}} application",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Thank you for speaking with us about the {{job.title}} role, and for the time you " +
      "put into the conversation.\n\n" +
      "On this occasion we've decided to move forward with other candidates whose " +
      "experience lined up more closely with what the team needs right now. That's a " +
      "judgement about this particular role rather than about your work.\n\n" +
      "We'd genuinely welcome an application from you for future openings, and we'll keep " +
      "your details on file if you're happy for us to.\n\n" +
      "With best wishes,\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Hi {{candidate.first_name}} — thank you for speaking with us about the " +
      "{{job.title}} role. We've decided to go forward with other candidates this time. " +
      "We'd welcome an application from you for future openings. Best wishes, " +
      "{{organization.name}}.",
  },
  {
    key: "video_interview_passed",
    name: "Video Interview Passed — Director Round Invite",
    eventKey: "director_round_scheduled",
    channel: "both",
    subject: "You're invited to the final round for {{job.title}}",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "The team were impressed by your video interview, and we'd like to invite you to " +
      "the final round for the {{job.title}} role — a conversation with our director.\n\n" +
      "This one is in person. Please come to our office at:\n\n" +
      "{{organization.office_address}}\n\n" +
      "We'll confirm the date and time with you separately. If getting to the office is " +
      "difficult for any reason, tell us and we'll work something out.\n\n" +
      "Congratulations on getting this far.\n\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Congratulations {{candidate.first_name}} — you're through to the final round for " +
      "the {{job.title}} role, in person with our director at " +
      "{{organization.office_address}}. We'll confirm the date and time separately.",
  },
  {
    key: "video_interview_not_successful",
    name: "Video Interview Not Successful",
    eventKey: "unqualified",
    channel: "both",
    subject: "About your {{job.title}} interview",
    body:
      "Hi {{candidate.first_name}},\n\n" +
      "Thank you for the time you gave us for your video interview for the {{job.title}} " +
      "role, and for the thought you clearly put into it.\n\n" +
      "After talking it through, the team have decided to go forward with another " +
      "candidate for this position. It was a close call and not a reflection of your " +
      "ability — it came down to specifics of what this particular role needs.\n\n" +
      "If you'd like feedback on the interview, reply to this and we'll gladly share it. " +
      "And we'd be pleased to hear from you about future roles.\n\n" +
      "With best wishes,\n" +
      "{{recruiter.name}}\n" +
      "{{organization.name}}",
    whatsappBody:
      "Hi {{candidate.first_name}} — thank you for your video interview for the " +
      "{{job.title}} role. The team have decided to go forward with another candidate " +
      "this time. Happy to share feedback if it would help — just reply. " +
      "{{organization.name}}.",
  },
];

// =============================================================================
// The forms.
//
// One radio question each. See the header for why not a calendar.
//
// The slot options are deliberately WINDOWS, not timestamps: "Tomorrow morning
// (9am–12pm)" survives being read three days later, where "Tue 2 Sep, 10:00"
// would be a stale option nobody can take. A recruiter who wants exact times
// edits the options — the form is an ordinary Module 18 form afterwards.
// =============================================================================

export type FlowForm = {
  key: string;
  name: string;
  description: string;
  fieldKey: string;
  fieldLabel: string;
  helpText: string;
  options: string[];
  /** What the chosen answer is called on the application detail page. */
  surfaceLabel: string;
};

const SLOT_OPTIONS = [
  "Weekday mornings (9am – 12pm)",
  "Weekday afternoons (12pm – 4pm)",
  "Weekday evenings (4pm – 7pm)",
  "Weekends",
  "Any time — whatever suits you",
];

export const FLOW_FORMS: FlowForm[] = [
  {
    key: "screening_call_availability",
    name: "Screening Call Availability",
    description:
      "Tell us when suits you for a short screening call, and we'll do our best to fit " +
      "around it.",
    fieldKey: "preferred_call_time",
    fieldLabel: "When would you prefer us to call?",
    helpText: "Pick the window that usually works best. We'll confirm the exact time.",
    options: SLOT_OPTIONS,
    surfaceLabel: "Preferred Call Time",
  },
  {
    key: "video_interview_availability",
    name: "Video Interview Availability",
    description:
      "Let us know when you're free for your video interview and we'll send an invitation.",
    fieldKey: "preferred_interview_time",
    fieldLabel: "When would you prefer your video interview?",
    helpText: "Allow around an hour. We'll confirm the exact time with you.",
    options: SLOT_OPTIONS,
    surfaceLabel: "Preferred Interview Time",
  },
];

// =============================================================================
// The flow.
//
// Template and form ids are not known until the flow is applied, so they are
// referenced by KEY here and resolved at apply time. That indirection is why
// this file can be a plain constant rather than a function of the database.
// =============================================================================

/** A placeholder replaced with a real id when the flow is applied. */
export type FlowRef = { templateKey?: string; formKey?: string };

export type FlowAction = Omit<Action, "config"> & {
  config: Record<string, unknown>;
  /** Resolved into config.template_id / config.form_id at apply time. */
  ref?: FlowRef;
  /** Nested, for `wait_then`. */
  nested?: FlowAction[];
};

export type FlowList = {
  stage: ApplicationStage;
  branch: WorkflowBranch;
  /** Shown in the confirmation dialog, so applying is an informed choice. */
  summary: string;
  actions: FlowAction[];
};

/** Every message in this flow goes to the candidate. */
const TO_CANDIDATE = [{ kind: "candidate" as const }];

export const DEFAULT_FLOW: FlowList[] = [
  // ---------------------------------------------------------------------------
  // APPLIED — the automatic resume screen.
  // ---------------------------------------------------------------------------
  {
    stage: "applied",
    branch: "always",
    summary: "Score every new application's resume and shortlist automatically.",
    actions: [
      {
        type: "ai_resume_shortlist",
        config: {
          // NULL, not a number. The passing mark lives on this job's Resume Score
          // row, where it is already configured and displayed. Baking a number in
          // here would create a second mark that silently stops agreeing with the
          // one the job page shows.
          passing_score: null,
          advance_on_pass: true,
          manual: false,
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // SHORTLISTED — On Pass (the resume cleared the mark).
  // ---------------------------------------------------------------------------
  {
    stage: "shortlisted",
    branch: "pass",
    summary: "Tell the candidate they're shortlisted, and ask when they're free for a call.",
    actions: [
      {
        type: "send_templated_message",
        config: { recipients: TO_CANDIDATE, manual: false },
        ref: { templateKey: "cv_shortlisted" },
      },
      {
        type: "request_form",
        config: {
          recipients: TO_CANDIDATE,
          manual: false,
          // PRIMITIVE #2. The chosen slot appears on the application as
          // "Preferred Call Time", read from form_responses by reference.
          surface_field_key: "preferred_call_time",
          surface_label: "Preferred Call Time",
        },
        ref: { formKey: "screening_call_availability", templateKey: "cv_shortlisted" },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // SHORTLISTED — On Fail (the resume did not clear the mark).
  //
  // The application is flagged Not Shortlisted and STAYS in Applied — it is not
  // rejected, and a recruiter can reverse it. The email is the courtesy that
  // makes the automatic screen defensible: a candidate who hears nothing assumes
  // nothing was read.
  // ---------------------------------------------------------------------------
  {
    stage: "shortlisted",
    branch: "fail",
    summary: "Send a warm decline when a resume doesn't reach the passing mark.",
    actions: [
      {
        type: "send_templated_message",
        config: { recipients: TO_CANDIDATE, manual: false },
        ref: { templateKey: "screening_call_not_successful" },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // AI SCREENING CALL — on entry.
  //
  // The pre-call reminder uses PRIMITIVE #1 with a `before_scheduled_call`
  // basis: fifteen minutes before whatever time the call is actually booked for,
  // not fifteen minutes after this rule ran and not a fixed hour of the day.
  // ---------------------------------------------------------------------------
  {
    stage: "ai_screening_call",
    branch: "always",
    summary: "Warn the candidate 15 minutes before the call, and thank them 30 minutes after.",
    actions: [
      {
        type: "wait_then",
        config: { delay_minutes: 15, delay_basis: "before_scheduled_call", manual: false },
        nested: [
          {
            type: "send_templated_message",
            config: { recipients: TO_CANDIDATE, manual: false },
            ref: { templateKey: "screening_call_reminder" },
          },
        ],
      },
      {
        type: "wait_then",
        config: { delay_minutes: 30, delay_basis: "after", manual: false },
        nested: [
          {
            type: "send_templated_message",
            config: { recipients: TO_CANDIDATE, manual: false },
            ref: { templateKey: "screening_call_thank_you" },
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // AI SCREENING CALL — On Pass.
  // ---------------------------------------------------------------------------
  {
    stage: "ai_screening_call",
    branch: "pass",
    summary:
      "Congratulate the candidate, collect interview availability, and move them to Video Interview.",
    actions: [
      {
        type: "send_templated_message",
        config: { recipients: TO_CANDIDATE, manual: false },
        ref: { templateKey: "screening_call_passed" },
      },
      {
        type: "request_form",
        config: {
          recipients: TO_CANDIDATE,
          manual: false,
          surface_field_key: "preferred_interview_time",
          surface_label: "Preferred Interview Time",
        },
        ref: { formKey: "video_interview_availability", templateKey: "screening_call_passed" },
      },
      {
        type: "move_to_stage",
        // LAST in the list, deliberately. Moving the stage cancels any pending
        // wait that started in this one (migration 0038's trigger), so an earlier
        // position would cancel this stage's own thank-you before it fired.
        config: { stage: "video_interview", manual: false },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // AI SCREENING CALL — On Fail.
  // ---------------------------------------------------------------------------
  {
    stage: "ai_screening_call",
    branch: "fail",
    summary: "Send a polite decline after an unsuccessful screening call.",
    actions: [
      {
        type: "send_templated_message",
        config: { recipients: TO_CANDIDATE, manual: false },
        ref: { templateKey: "screening_call_not_successful" },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // VIDEO INTERVIEW — scheduling, and the two outcomes.
  //
  // Scheduling is MANUAL. Module 11 owns booking, and the "Preferred Interview
  // Time" surfaced on the application is what the recruiter reads when they open
  // it. An automatic booking would have to invent a precise time from a window
  // like "weekday mornings", which is the kind of guess every recruiter would
  // then have to check.
  // ---------------------------------------------------------------------------
  {
    stage: "video_interview",
    branch: "always",
    summary: "Put a Schedule Interview button on the application, using the collected preference.",
    actions: [
      {
        type: "schedule_interview",
        config: { manual: true, mode: "video" },
      },
    ],
  },
];

/**
 * The Video Interview outcome messages.
 *
 * THE BRIEF ASKS FOR PASS/FAIL BRANCHES ON VIDEO INTERVIEW, AND THAT STAGE DOES
 * NOT HAVE THEM. This is the one place the flow could not be built exactly as
 * written, so it is worth being precise about why.
 *
 * A branch needs a verdict, and a verdict needs a score compared against a
 * threshold. Video Interview records a recruiter's written impression — there is
 * no number, so `stageBranches("video_interview")` is false and an On Pass list
 * there would be a list that can never fire. Adding a fake score to make the
 * branch expressible would mean inventing a number for a human judgement.
 *
 * So the PASS half is attached where it genuinely fires: entering Director
 * Round IS passing the video interview, and the invitation belongs on that
 * entry. The FAIL half has no automatic moment — a recruiter decides it — so its
 * template is created, activated and sent from the application's compose screen
 * like any other rejection. Both templates exist and are editable either way;
 * only the automatic trigger for the second one is absent, and the apply route
 * says so in its response rather than leaving it to be discovered.
 */
export const VIDEO_OUTCOME_LISTS: FlowList[] = [
  {
    stage: "director_round",
    branch: "always",
    summary: "Invite the candidate to the office when they reach the Director Round.",
    actions: [
      {
        type: "send_templated_message",
        config: { recipients: TO_CANDIDATE, manual: false },
        ref: { templateKey: "video_interview_passed" },
      },
    ],
  },
];

/** Everything the apply route writes. */
export function defaultFlowLists(): FlowList[] {
  return [...DEFAULT_FLOW.filter((list) => list.actions.length > 0), ...VIDEO_OUTCOME_LISTS];
}
