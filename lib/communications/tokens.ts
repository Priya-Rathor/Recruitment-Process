// =============================================================================
// Placeholder tokens for candidate messages.
//
// REUSES lib/hiring-stages/placeholders.ts RATHER THAN REDEFINING IT — the same
// {{group.field}} vocabulary, the same TOKEN_PATTERN, the same insertToken()
// caret handling, the same renderTemplate(). The spec is explicit about this
// ("reuse that exact component, don't rebuild it"), and there is a stronger
// reason than instruction-following: a second renderer would mean {{job.title}}
// could resolve differently in a message than in a screening script, and the
// difference would surface as a candidate being told something the call did not
// say.
//
// What this file adds is four tokens a screening script has no use for. They are
// added HERE rather than to the shared catalogue so the stage-script picker never
// offers a field it cannot fill — see the note above lookupFor() in
// placeholders.ts.
// =============================================================================
import {
  PLACEHOLDER_FIELDS,
  renderTemplate,
  splitTokens,
  type PlaceholderField,
  type PlaceholderValues,
} from "@/lib/hiring-stages/placeholders";
import { buildPlaceholderValues } from "@/lib/hiring-stages/values";
import type {
  ApplicationValueSource,
  CandidateValueSource,
  JobValueSource,
} from "@/lib/hiring-stages/values";
import { MODE_LABELS, type InterviewMode } from "@/lib/interviews/feedback";
import { formatDateTimeInZone } from "@/lib/time";

/** Message-only fields. Interview details, and who is writing. */
export const MESSAGE_ONLY_FIELDS: PlaceholderField[] = [
  {
    token: "interview.time",
    label: "Interview Time",
    group: "interview",
    sample: "Tue 24 Mar 2026, 2:00 pm",
  },
  { token: "interview.mode", label: "Interview Mode", group: "interview", sample: "Video" },
  {
    token: "interview.location",
    label: "Interview Location / Joining Details",
    group: "interview",
    sample: "Google Meet — link below",
  },
  {
    token: "interview.link",
    label: "Interview Joining Link",
    group: "interview",
    sample: "https://meet.google.com/abc-defg-hij",
  },
  {
    token: "organization.name",
    label: "Your Organization",
    group: "organization",
    sample: "Webbee Global",
  },
  {
    token: "recruiter.name",
    label: "Assigned Recruiter",
    group: "organization",
    sample: "Priya Rathor",
  },
];

/** The catalogue a message template may draw on. */
export const MESSAGE_PLACEHOLDER_FIELDS: PlaceholderField[] = [
  ...PLACEHOLDER_FIELDS,
  ...MESSAGE_ONLY_FIELDS,
];

/** Splits a message body's tokens into resolvable and not. */
export function splitMessageTokens(body: string) {
  return splitTokens(body, MESSAGE_PLACEHOLDER_FIELDS);
}

/** Renders a message body against real values. */
export function renderMessage(body: string, values: PlaceholderValues): string {
  return renderTemplate(body, values, {
    fields: MESSAGE_PLACEHOLDER_FIELDS,
    // A missing value renders as an em dash rather than vanishing.
    //
    // Deliberately different from a screening script, which drops it: a script
    // is read aloud by an agent that can improvise around a gap, but a written
    // message keeps its sentence structure. "Your interview is at ." reads as a
    // bug the candidate cannot resolve; "Your interview is at —." reads as a
    // missing detail they can ask about, and it is visible in the preview before
    // anything is sent.
    onMissing: "—",
  });
}

export type InterviewValueSource = {
  scheduled_at: string;
  mode: InterviewMode;
  location: string | null;
  meeting_url: string | null;
};

/**
 * Builds the substitution map for a message.
 *
 * Delegates the job/candidate/application half to Module 3's
 * buildPlaceholderValues() — the one mapping from columns to tokens — and adds
 * the message-only fields on top. Nothing here re-derives a value that function
 * already knows how to produce.
 *
 * `timeZone` is the ORGANIZATION's, never the server's: this string is the time a
 * candidate will turn up at, and a server in UTC would tell somebody in Gurgaon
 * to arrive five and a half hours early.
 */
export function buildMessageValues({
  job,
  candidate,
  application,
  interview,
  organizationName,
  recruiterName,
  timeZone,
}: {
  job?: JobValueSource | null;
  candidate?: CandidateValueSource | null;
  application?: ApplicationValueSource | null;
  interview?: InterviewValueSource | null;
  organizationName?: string | null;
  recruiterName?: string | null;
  timeZone: string;
}): PlaceholderValues {
  const values: PlaceholderValues = buildPlaceholderValues({ job, candidate, application });

  values["organization.name"] = organizationName ?? null;
  values["recruiter.name"] = recruiterName ?? null;

  if (interview) {
    values["interview.time"] = formatDateTimeInZone(interview.scheduled_at, timeZone);
    values["interview.mode"] = MODE_LABELS[interview.mode] ?? interview.mode;
    // A video interview's "location" is its joining link; an onsite one's is an
    // address. One token, so a single template covers both rather than needing
    // one per mode.
    values["interview.location"] =
      interview.location ?? interview.meeting_url ?? null;
    values["interview.link"] = interview.meeting_url ?? null;
  } else {
    values["interview.time"] = null;
    values["interview.mode"] = null;
    values["interview.location"] = null;
    values["interview.link"] = null;
  }

  return values;
}
