// =============================================================================
// The candidate-communication event catalogue.
//
// A closed set, like Module 13's rule vocabulary and Module 14's event
// catalogue. A template can only answer an event named here, and the database
// repeats the list as a CHECK constraint — a typo'd event_key would otherwise
// store cleanly and then never fire, which is the silent failure this codebase
// keeps designing out.
//
// EACH ENTRY DECLARES WHERE IT FIRES FROM, IN PROSE.
//
// `firesWhen` is null for two of the twelve, and that is a fact about the
// product rather than an omission:
//
//   - offer_extended: there is no offer stage. lib/applications/stages.ts runs
//     Director Round straight to Hired, and Module 19 files the signed offer as
//     an onboarding document AFTER the hire. Inventing a send point would mean
//     guessing which stage move means "an offer went out", and guessing wrong
//     emails an offer to somebody who has not been offered anything.
//
//   - unqualified: nothing in the schema distinguishes "rejected because they
//     did not meet the requirements" from "rejected because somebody else was
//     better". `rejected` covers the move; splitting it would require the
//     product to decide, per rejection, which of the two it was, and it does not
//     know.
//
// Both remain fully usable — a recruiter can send them by hand, and a Module 13
// automation can send them on any trigger the org chooses. What they do not have
// is an automatic send point, and the settings screen says so rather than
// showing a switch that does nothing.
// =============================================================================
import type { ApplicationStage } from "@/lib/applications/stages";
import type { InterviewMode } from "@/lib/interviews/feedback";

export const COMMUNICATION_EVENTS = [
  "application_received",
  "shortlisted",
  "ai_screening_call_scheduled",
  "phone_interview_scheduled",
  "video_interview_scheduled",
  "interview_reminder",
  "assessment_assigned",
  "director_round_scheduled",
  "offer_extended",
  "hired",
  "rejected",
  "unqualified",
] as const;

export type CommunicationEventKey = (typeof COMMUNICATION_EVENTS)[number];

export function isCommunicationEvent(value: unknown): value is CommunicationEventKey {
  return typeof value === "string" && (COMMUNICATION_EVENTS as readonly string[]).includes(value);
}

export type CommunicationEventDefinition = {
  label: string;
  /** Shown in the library, so activating a template is an informed choice. */
  description: string;
  /** Where the automatic send happens. Null means there is no built-in trigger. */
  firesWhen: string | null;
  /**
   * Tokens that only carry a value for this event.
   *
   * Used by the editor to warn when a template references a field its own event
   * cannot supply — "{{interview.time}}" in the rejection email would render as
   * a blank, and nobody would notice until a candidate read it.
   */
  eventTokens?: string[];
};

export const COMMUNICATION_EVENT_DEFINITIONS: Record<
  CommunicationEventKey,
  CommunicationEventDefinition
> = {
  application_received: {
    label: "Application received",
    description: "The candidate has just applied, or been added to a job's pipeline.",
    firesWhen: "when an application is created, including by bulk resume intake",
  },
  shortlisted: {
    label: "Shortlisted",
    description: "The application has been moved to the Shortlisted stage.",
    firesWhen: "the moment an application enters Shortlisted",
  },
  ai_screening_call_scheduled: {
    label: "AI screening call scheduled",
    description:
      "An automated screening call is coming. More of an FYI than a scheduling message — " +
      "the call chooses its own moment.",
    firesWhen: "the moment an application enters AI Screening Call",
  },
  phone_interview_scheduled: {
    label: "Phone interview scheduled",
    description: "A phone interview has been booked, with a real time to state.",
    // Fired from the SCHEDULING action, not from the stage move, because the
    // message contains a time and a stage move has none.
    firesWhen: "the moment a phone interview is scheduled",
    eventTokens: ["interview.time", "interview.mode", "interview.location", "interview.link"],
  },
  video_interview_scheduled: {
    label: "Video interview scheduled",
    description: "A video interview has been booked, with its time and joining link.",
    firesWhen: "the moment a video interview is scheduled",
    eventTokens: ["interview.time", "interview.mode", "interview.location", "interview.link"],
  },
  interview_reminder: {
    label: "Interview reminder",
    description:
      "Sent a configurable number of hours before a scheduled interview. Timing and channel " +
      "are set under Settings → Recruitment.",
    firesWhen: "by the reminder dispatcher, once an interview is inside the reminder window",
    eventTokens: ["interview.time", "interview.mode", "interview.location", "interview.link"],
  },
  assessment_assigned: {
    label: "Assessment assigned",
    description: "The application has reached the Written Assessment stage.",
    firesWhen: "the moment an application enters Written Assessment",
  },
  director_round_scheduled: {
    label: "Final round reached",
    description: "The application has reached the Director Round stage.",
    firesWhen: "the moment an application enters Director Round",
  },
  offer_extended: {
    label: "Offer extended",
    description: "An offer has gone out to the candidate.",
    // See the header.
    firesWhen: null,
  },
  hired: {
    label: "Hired",
    description: "The application has been marked Hired.",
    firesWhen: "the moment an application enters Hired",
  },
  rejected: {
    label: "Not proceeding",
    description: "The application has been rejected.",
    firesWhen: "the moment an application is moved to Rejected",
  },
  unqualified: {
    label: "Requirements not met",
    description:
      "The candidate does not meet the role's requirements. A separate, gentler wording from " +
      "a rejection after interview.",
    // See the header.
    firesWhen: null,
  },
};

/**
 * Which event a stage MOVE fires.
 *
 * Phone and video interview are deliberately absent. Their messages state a
 * time, and a stage move does not have one — those two fire from
 * `scheduleInterview()` instead, where a time exists. A stage-triggered
 * "your interview is scheduled" with no time in it would be worse than silence:
 * the candidate would go looking for a message that was never sent.
 *
 * `withdrawn` is absent too. The candidate withdrew; telling them so is at best
 * redundant and at worst reads as a rejection for a decision they made.
 */
export const EVENT_FOR_STAGE: Partial<Record<ApplicationStage, CommunicationEventKey>> = {
  shortlisted: "shortlisted",
  ai_screening_call: "ai_screening_call_scheduled",
  written_assessment: "assessment_assigned",
  director_round: "director_round_scheduled",
  hired: "hired",
  rejected: "rejected",
};

/** Which event an interview booking fires, by mode. */
export const EVENT_FOR_INTERVIEW_MODE: Partial<Record<InterviewMode, CommunicationEventKey>> = {
  phone: "phone_interview_scheduled",
  video: "video_interview_scheduled",
  // An onsite round has no equivalent event in the spec's list, and the closest
  // — director_round_scheduled — is a STAGE, not an interview mode. Left unmapped
  // rather than mapped to something that would send the wrong words.
};

/** Events with no automatic send point, for the copy that has to say so. */
export const MANUAL_ONLY_EVENTS: CommunicationEventKey[] = COMMUNICATION_EVENTS.filter(
  (key) => COMMUNICATION_EVENT_DEFINITIONS[key].firesWhen === null
);
