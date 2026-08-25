// =============================================================================
// Module 15 candidate communication — unit tests.
//
// WHAT IS TESTABLE HERE AND WHAT IS NOT.
//
// The spec's checklist is mostly about behaviour that needs a database: an active
// template firing on a real interview booking, RLS, the log aggregating across
// applications. Those are integration checks against a Supabase project, and this
// project's README already says so.
//
// What CAN be verified without one is the decision logic each of those behaviours
// rests on — and it is the decision logic that would be wrong. So each test below
// names the checklist item it covers, and the ones that genuinely need a database
// are listed at the bottom rather than faked with a mock that would only prove the
// mock works.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  COMMUNICATION_EVENTS,
  COMMUNICATION_EVENT_DEFINITIONS,
  EVENT_FOR_INTERVIEW_MODE,
  EVENT_FOR_STAGE,
  MANUAL_ONLY_EVENTS,
  isCommunicationEvent,
} from "@/lib/communications/events";
import {
  bodyFor,
  channelsFor,
  subjectFor,
  validateTemplate,
  type MessageTemplate,
} from "@/lib/communications/templates";
import {
  MESSAGE_PLACEHOLDER_FIELDS,
  buildMessageValues,
  renderMessage,
  splitMessageTokens,
  messageFieldsForEvent,
} from "@/lib/communications/tokens";
import { maskRecipient, optedOutOf, type OptOutState } from "@/lib/communications/send";
import { optOutFooter, withOptOutFooter } from "@/lib/communications/optout";
import { normalizeWhatsAppNumber } from "@/lib/integrations/whatsapp";
import { dialCodeFor } from "@/lib/communications/triggers";
import {
  ACTIONS,
  CANDIDATE_CONTACT_ACTIONS,
  CONSEQUENTIAL_ACTIONS,
  approvalIsMandatory,
  approvalIsRecommended,
  messageChannelsFor,
  requiredIntegrationsFor,
  validateRule,
  type Action,
} from "@/lib/automations/catalog";
import { normalizeCommunicationSettings } from "@/lib/settings/queries";
import { PLACEHOLDER_FIELDS, splitTokens } from "@/lib/hiring-stages/placeholders";

const TEMPLATE_ID = "11111111-2222-3333-4444-555555555555";

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: TEMPLATE_ID,
    organization_id: "org",
    name: "Video interview scheduled",
    event_key: "video_interview_scheduled",
    channel: "both",
    subject: "Your interview for {{job.title}}",
    body: "Hi {{candidate.name}}, your interview is at {{interview.time}}. Link: {{interview.link}}",
    whatsapp_body: "Hi {{candidate.name}}, interview at {{interview.time}}.",
    active: true,
    created_by: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// The event catalogue
// -----------------------------------------------------------------------------
describe("the communication event catalogue", () => {
  it("defines every event the spec lists, and nothing else", () => {
    // The database repeats this list as a CHECK constraint. If the two drift, a
    // template saves in one and is refused by the other.
    expect([...COMMUNICATION_EVENTS]).toEqual([
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
    ]);
  });

  it("gives every event a definition", () => {
    for (const key of COMMUNICATION_EVENTS) {
      expect(COMMUNICATION_EVENT_DEFINITIONS[key], key).toBeDefined();
      expect(COMMUNICATION_EVENT_DEFINITIONS[key].label.length, key).toBeGreaterThan(0);
    }
  });

  it("is honest about the two events with no automatic trigger", () => {
    // The product has no offer stage and no way to tell "unqualified" from
    // "rejected". Claiming a send point for either would mean guessing, and the
    // settings screen says so instead — see the header of events.ts.
    expect(MANUAL_ONLY_EVENTS.sort()).toEqual(["offer_extended", "unqualified"]);
  });

  it("does not map the interview stages to a stage-triggered event", () => {
    // Their messages state a TIME and a stage move has none. They fire from the
    // scheduling action instead. A stage-triggered "your interview is scheduled"
    // with no time in it sends the candidate looking for a message nobody sent.
    expect(EVENT_FOR_STAGE.phone_interview).toBeUndefined();
    expect(EVENT_FOR_STAGE.video_interview).toBeUndefined();

    expect(EVENT_FOR_INTERVIEW_MODE.phone).toBe("phone_interview_scheduled");
    expect(EVENT_FOR_INTERVIEW_MODE.video).toBe("video_interview_scheduled");
  });

  it("never messages a candidate who withdrew", () => {
    // Telling somebody their application ended when they ended it themselves
    // reads as a rejection for a decision they made.
    expect(EVENT_FOR_STAGE.withdrawn).toBeUndefined();
  });

  it("maps every stage event to a real event key", () => {
    for (const [stage, key] of Object.entries(EVENT_FOR_STAGE)) {
      expect(isCommunicationEvent(key), stage).toBe(true);
    }
  });

  it("rejects an unknown event key", () => {
    expect(isCommunicationEvent("offer_accepted")).toBe(false);
    expect(isCommunicationEvent(null)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Placeholders — the SPEC'S FIRST TEST: "placeholders correctly resolved"
// -----------------------------------------------------------------------------
describe("placeholder resolution", () => {
  const values = buildMessageValues({
    job: {
      title: "Senior Java Developer",
      location: "Gurgaon",
      work_mode: "hybrid",
      experience_min: 4,
      experience_max: 7,
      salary_min: null,
      salary_max: null,
      required_skills: ["Java", "Spring Boot"],
      preferred_skills: null,
      client_name: null,
    },
    candidate: {
      name: "Rahul Sharma",
      email: "rahul@example.com",
      current_company: "Infosys",
      current_role: "Java Developer",
      total_experience_years: 6,
      expected_salary: null,
      notice_period_days: 30,
    },
    application: { stage: "video_interview", match_score: 82 },
    interview: {
      scheduled_at: "2026-03-24T08:30:00.000Z",
      mode: "video",
      location: null,
      meeting_url: "https://meet.google.com/abc-defg-hij",
    },
    organizationName: "Webbee Global",
    recruiterName: "Priya Rathor",
    timeZone: "Asia/Kolkata",
  });

  it("resolves the interview time in the ORGANIZATION's timezone", () => {
    // 08:30 UTC is 14:00 in Kolkata. A server in UTC would tell a candidate in
    // Gurgaon to arrive five and a half hours early.
    //
    // Asserted against the project's own formatDateTimeInZone output (24-hour, as
    // every other date in this product renders) rather than a format invented
    // here — a test that expected "2:00pm" would be asserting a second formatter.
    expect(values["interview.time"]).toContain("14:00");
    expect(values["interview.time"]).not.toContain("08:30");
  });

  it("substitutes every token a video-interview template uses", () => {
    const rendered = renderMessage(template().body, values);

    expect(rendered).toBe(
      "Hi Rahul Sharma, your interview is at " +
        `${values["interview.time"]}. Link: https://meet.google.com/abc-defg-hij`
    );
    // The proof that nothing was left behind.
    expect(rendered).not.toContain("{{");
  });

  it("renders a missing value as an em dash rather than deleting it", () => {
    // A written message keeps its sentence structure. "Your interview is at ."
    // reads as a bug the candidate cannot resolve; "at —" reads as a missing
    // detail they can ask about, and the preview shows it before anything sends.
    const withoutInterview = buildMessageValues({
      candidate: {
        name: "Rahul Sharma",
        email: null,
        current_company: null,
        current_role: null,
        total_experience_years: null,
        expected_salary: null,
        notice_period_days: null,
      },
      timeZone: "Asia/Kolkata",
    });

    expect(renderMessage("Interview at {{interview.time}}.", withoutInterview)).toBe(
      "Interview at —."
    );
  });

  it("leaves an unrecognised token exactly as written", () => {
    // Silently deleting {{candidate.naem}} hides the typo and produces a fluent
    // sentence with a hole in it. Left visible, whoever previews it sees why.
    expect(renderMessage("Hi {{candidate.naem}},", values)).toBe("Hi {{candidate.naem}},");
    expect(splitMessageTokens("Hi {{candidate.naem}},").unknown).toEqual(["candidate.naem"]);
  });

  it("keeps the message-only tokens OUT of the stage-script catalogue", () => {
    /*
      The reason lookupFor() takes a field list at all. A screening script cannot
      resolve {{interview.time}} — there is no interview when a screening call
      runs — so offering it in the stage picker would produce a sentence read aloud
      to a candidate with a gap in it.
    */
    const messageTokens = MESSAGE_PLACEHOLDER_FIELDS.map((field) => field.token);
    const scriptTokens = PLACEHOLDER_FIELDS.map((field) => field.token);

    expect(messageTokens).toContain("interview.time");
    expect(scriptTokens).not.toContain("interview.time");
    expect(scriptTokens).not.toContain("organization.name");

    // And a script referencing one is reported as unknown, not silently resolved.
    expect(splitTokens("At {{interview.time}}").unknown).toEqual(["interview.time"]);
    // The same string against the message catalogue resolves.
    expect(splitMessageTokens("At {{interview.time}}").unknown).toEqual([]);
  });

  it("every message field has a sample value, so the preview is never blank", () => {
    for (const field of MESSAGE_PLACEHOLDER_FIELDS) {
      expect(field.sample.length, field.token).toBeGreaterThan(0);
    }
  });
});

// -----------------------------------------------------------------------------
// Template validation and channel resolution
// -----------------------------------------------------------------------------
describe("template validation", () => {
  const valid = {
    name: "Shortlisted",
    event_key: "shortlisted",
    channel: "email",
    subject: "About your application",
    body: "Hi {{candidate.name}}, you have been shortlisted.",
    active: false,
  };

  it("accepts a well-formed template", () => {
    const result = validateTemplate(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it("refuses an email template with no subject", () => {
    // An email with no subject line reads as spam in most clients, and the send
    // would report success.
    const result = validateTemplate({ ...valid, subject: "   " });
    expect(result.ok).toBe(false);
  });

  it("does not ask a WhatsApp-only template for a subject", () => {
    const result = validateTemplate({
      ...valid,
      channel: "whatsapp",
      subject: null,
      body: "Hi {{candidate.name}}, you have been shortlisted.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.subject).toBeNull();
  });

  it("refuses a WhatsApp body over the provider's useful length", () => {
    const result = validateTemplate({
      ...valid,
      channel: "whatsapp",
      subject: null,
      body: "x".repeat(2000),
    });
    expect(result.ok).toBe(false);
  });

  it("warns about an unknown token but still saves", () => {
    // Refusing somebody's work over a typo is worse than showing them the typo.
    const result = validateTemplate({ ...valid, body: "Hi {{candidate.nmae}}," });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("candidate.nmae");
    }
  });

  it("refuses an unknown event key", () => {
    const result = validateTemplate({ ...valid, event_key: "offer_accepted" });
    expect(result.ok).toBe(false);
  });

  it("never activates a template just because a payload said so… by trusting the flag", () => {
    // active IS taken from the payload here — the guard is that the EDITOR never
    // sends it (see TemplateEditor) and the toggle is its own confirmed action.
    // What this asserts is that a missing flag defaults to OFF, so a partial
    // payload cannot switch a template on.
    const result = validateTemplate({ ...valid, active: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.active).toBe(false);
  });
});

describe("channel resolution", () => {
  it("expands `both` into two real channels", () => {
    expect(channelsFor("both")).toEqual(["email", "whatsapp"]);
    expect(channelsFor("email")).toEqual(["email"]);
    expect(channelsFor("whatsapp")).toEqual(["whatsapp"]);
  });

  it("uses the WhatsApp body on WhatsApp and the email body on email", () => {
    const both = template();
    expect(bodyFor(both, "whatsapp")).toBe(both.whatsapp_body);
    expect(bodyFor(both, "email")).toBe(both.body);
  });

  it("falls back to the email body when the WhatsApp half is blank", () => {
    // Long on a phone, but silently sending nothing on a channel the template
    // claims to cover would be a lie about what was configured.
    const both = template({ whatsapp_body: null });
    expect(bodyFor(both, "whatsapp")).toBe(both.body);
  });

  it("never gives WhatsApp a subject line", () => {
    expect(subjectFor(template(), "whatsapp")).toBeNull();
    expect(subjectFor(template(), "email")).toBe(template().subject);
  });
});

// -----------------------------------------------------------------------------
// Opt-out — THE SPEC'S THIRD TEST
// -----------------------------------------------------------------------------
describe("opt-out enforcement", () => {
  const optedOutOfEmail: OptOutState = {
    emailOptedOut: true,
    whatsappOptedOut: false,
    unknown: false,
  };

  it("is per channel", () => {
    // Opting out of email is not opting out of WhatsApp. Treating them as one
    // would silence a channel the candidate never mentioned.
    expect(optedOutOf(optedOutOfEmail, "email")).toBe(true);
    expect(optedOutOf(optedOutOfEmail, "whatsapp")).toBe(false);
  });

  it("puts an unsubscribe link in every automatic email", () => {
    const body = withOptOutFooter({
      body: "Hi Rahul, you have been shortlisted.",
      channel: "email",
      unsubscribeUrl: "https://app.example.com/unsubscribe?token=abc",
    });

    expect(body).toContain("https://app.example.com/unsubscribe?token=abc");
    // Appended AFTER the body, so no template can edit it away.
    expect(body.startsWith("Hi Rahul")).toBe(true);
  });

  it("degrades to a human instruction when the link cannot be signed", () => {
    // A dead unsubscribe link is worse than an instruction: the candidate
    // believes they have opted out and nothing happened.
    const footer = optOutFooter({ channel: "email", unsubscribeUrl: null });
    expect(footer).toContain("reply");
    expect(footer).not.toContain("http");
  });

  it("uses WhatsApp's own convention rather than a link", () => {
    const footer = optOutFooter({ channel: "whatsapp", unsubscribeUrl: null });
    expect(footer).toContain("STOP");
  });
});

describe("recipient masking", () => {
  it("keeps the domain and hides the mailbox", () => {
    expect(maskRecipient("rahul.sharma@example.com", "email")).toBe(
      `ra${"•".repeat("rahul.sharma".length - 2)}@example.com`
    );
  });

  it("keeps only the last four digits of a number", () => {
    // Enough for a recruiter to recognise the number in front of them, not
    // enough for the log to be a phone book.
    expect(maskRecipient("+91 98765 43210", "whatsapp")).toBe("••••••••3210");
  });
});

// -----------------------------------------------------------------------------
// WhatsApp number normalisation
// -----------------------------------------------------------------------------
describe("WhatsApp number normalisation", () => {
  it("trusts a number that carries its own country code", () => {
    expect(normalizeWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
    expect(normalizeWhatsAppNumber("0091-98765-43210")).toBe("919876543210");
  });

  it("REFUSES a local number when the country is unknown", () => {
    /*
      The important one. An Indian ten-digit number sent without a country code is
      either rejected by Meta or delivered to whoever holds that number in the
      United States. A message we cannot address confidently is not sent at all.
    */
    expect(normalizeWhatsAppNumber("98765 43210")).toBeNull();
  });

  it("applies the organization's country code to a local number", () => {
    expect(normalizeWhatsAppNumber("98765 43210", "91")).toBe("919876543210");
  });

  it("does not double the country code on a number that already has it", () => {
    expect(normalizeWhatsAppNumber("919876543210", "91")).toBe("919876543210");
  });

  it("rejects something too short or too long to be a number", () => {
    expect(normalizeWhatsAppNumber("1234")).toBeNull();
    expect(normalizeWhatsAppNumber(`+${"9".repeat(20)}`)).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
  });

  it("only knows dialling codes for countries it can be sure about", () => {
    expect(dialCodeFor("India")).toBe("91");
    expect(dialCodeFor("IN")).toBe("91");
    // Not guessed. A wrong code messages a stranger.
    expect(dialCodeFor("Atlantis")).toBeNull();
    expect(dialCodeFor(null)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Module 13 integration — THE SPEC'S LAST TEST
// -----------------------------------------------------------------------------
describe("the automation action", () => {
  const action: Action = {
    type: "send_templated_message",
    config: { template_id: TEMPLATE_ID, event_key: "shortlisted", channels: ["email"] },
  };

  it("is available in the builder's action list", () => {
    expect(ACTIONS).toContain("send_templated_message");
  });

  it("validates as part of a rule", () => {
    const result = validateRule({
      trigger: "application_stage_changed",
      conditions: [{ match: "all", conditions: [{ field: "stage", operator: "eq", value: "shortlisted" }] }],
      actions: [action],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.actions[0].type).toBe("send_templated_message");
      expect(result.rule.actions[0].config?.template_id).toBe(TEMPLATE_ID);
    }
  });

  it("refuses a rule that names no template", () => {
    // Without one the action would silently do nothing every time it ran.
    const result = validateRule({
      trigger: "application_stage_changed",
      actions: [{ type: "send_templated_message", config: {} }],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a template id that isn't a uuid", () => {
    const result = validateRule({
      trigger: "application_stage_changed",
      actions: [{ type: "send_templated_message", config: { template_id: "'; drop table --" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("can be combined with other actions in one rule", () => {
    // The spec's point: an org should not be limited to the fixed event list.
    const result = validateRule({
      trigger: "evaluations_complete",
      actions: [
        { type: "move_to_stage", config: { stage: "rejected" } },
        action,
        { type: "add_note", config: { text: "Rejection sent." } },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.actions).toHaveLength(3);
  });

  it("requires only the channels its template actually uses", () => {
    expect(requiredIntegrationsFor([action])).toEqual(["email"]);

    expect(
      requiredIntegrationsFor([
        { type: "send_templated_message", config: { template_id: TEMPLATE_ID, channels: ["whatsapp"] } },
      ])
    ).toEqual(["whatsapp"]);
  });

  it("requires NEITHER channel for a `both` template — the spec's fourth test", () => {
    /*
      "WhatsApp being disconnected doesn't block email-only sends."

      Requiring both would stop an organization that has never configured WhatsApp
      — the normal state — from activating a rule whose email half works perfectly.
      The two channels are independent at send time; whichever is connected sends,
      and the other is recorded as skipped.
    */
    expect(
      requiredIntegrationsFor([
        {
          type: "send_templated_message",
          config: { template_id: TEMPLATE_ID, channels: ["email", "whatsapp"] },
        },
      ])
    ).toEqual([]);
  });

  it("reads the stored channel list defensively", () => {
    expect(messageChannelsFor({ type: "send_templated_message", config: {} })).toEqual([]);
    expect(
      messageChannelsFor({
        type: "send_templated_message",
        config: { channels: ["email", "sms", 7] },
      })
    ).toEqual(["email"]);
  });

  it("counts as contacting a candidate, and as chargeable", () => {
    expect(CANDIDATE_CONTACT_ACTIONS).toContain("send_templated_message");
    expect(CONSEQUENTIAL_ACTIONS).toContain("send_templated_message");
  });

  it("recommends approval without forcing it", () => {
    /*
      The distinction: send_candidate_email sends wording from this codebase that
      nobody in the organization ever read, so a person must approve each run.
      send_templated_message sends wording an Owner or Admin wrote AND activated —
      the review happened once, over the words. Forcing per-run approval would also
      make an automation strictly worse than the built-in event trigger, which
      sends the same template with no approval step at all.
    */
    expect(approvalIsRecommended([action])).toBe(true);
    expect(approvalIsMandatory([action])).toBe(false);

    expect(approvalIsMandatory([{ type: "send_candidate_email", config: {} }])).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The reminder configuration
// -----------------------------------------------------------------------------
describe("interview reminder settings", () => {
  it("defaults to 24 hours on email only", () => {
    // Email only because WhatsApp is the least likely to be configured; a default
    // that assumed it would make every reminder record a "not sent" row.
    const settings = normalizeCommunicationSettings(undefined);
    expect(settings.interviewReminderHours).toBe(24);
    expect(settings.interviewReminderChannels).toEqual(["email"]);
  });

  it("treats 0 hours as off", () => {
    expect(normalizeCommunicationSettings({ interviewReminderHours: 0 })
      .interviewReminderHours).toBe(0);
  });

  it("clamps a value edited straight into the database", () => {
    // The form is not the boundary; this is. A reminder a fortnight early is an
    // announcement, and the interview will very likely have moved.
    expect(
      normalizeCommunicationSettings({ interviewReminderHours: 5000 }).interviewReminderHours
    ).toBe(168);
    expect(
      normalizeCommunicationSettings({ interviewReminderHours: -3 }).interviewReminderHours
    ).toBe(24);
  });

  it("drops a channel it cannot send on, and deduplicates", () => {
    expect(
      normalizeCommunicationSettings({ interviewReminderChannels: ["email", "sms", "email"] })
        .interviewReminderChannels
    ).toEqual(["email"]);
  });

  it("allows both channels", () => {
    expect(
      normalizeCommunicationSettings({ interviewReminderChannels: ["email", "whatsapp"] })
        .interviewReminderChannels
    ).toEqual(["email", "whatsapp"]);
  });
});

// =============================================================================
// NOT COVERED HERE — and deliberately not faked.
//
// These need a Supabase project with real rows, and a mock would only prove the
// mock works:
//
//   - an active video_interview_scheduled template firing on a real booking
//     (the wiring is in app/api/interviews/route.ts; the RESOLUTION it depends on
//     is covered above)
//   - deactivating a template stopping future sends while past log rows stay put
//     (findActiveTemplate filters active=true; message_log has no UPDATE policy)
//   - the log aggregating across a candidate's applications (listCandidateMessages
//     keys on candidate_id)
//   - tenant isolation on all three new tables
//   - the append-only guarantee on message_log
//
// The README already records that anything needing real data has to be tested
// against a Supabase project.
// =============================================================================

// -----------------------------------------------------------------------------
// The placeholder catalogue, and narrowing it by trigger event.
// -----------------------------------------------------------------------------
describe("message placeholder catalogue", () => {
  const tokens = MESSAGE_PLACEHOLDER_FIELDS.map((field) => field.token);

  it("covers every group a template can draw on", () => {
    // Candidate, application, job, recruiter, interview — the five the module's
    // brief names. Asserted by token rather than by count, so adding a field
    // never quietly satisfies this.
    for (const token of [
      "candidate.first_name",
      "candidate.name",
      "candidate.email",
      "candidate.phone",
      "candidate.notice_period",
      "application.stage",
      "application.match_score",
      "application.applied_date",
      "job.title",
      "job.client_name",
      "job.salary_range",
      "recruiter.name",
      "recruiter.email",
      "interview.date",
      "interview.time",
      "interview.link",
    ]) {
      expect(tokens, `${token} missing from the template catalogue`).toContain(token);
    }
  });

  it("gives every field a sample, so the preview never renders a blank", () => {
    for (const field of MESSAGE_PLACEHOLDER_FIELDS) {
      expect(field.sample.trim().length, field.token).toBeGreaterThan(0);
    }
  });

  it("lists no token twice", () => {
    expect(tokens).toEqual([...new Set(tokens)]);
  });
});

describe("messageFieldsForEvent", () => {
  const tokensFor = (event: Parameters<typeof messageFieldsForEvent>[0]) =>
    messageFieldsForEvent(event).map((field) => field.token);

  it("withholds interview fields from an event that has no interview", () => {
    /*
      THE POINT OF THE FEATURE. {{interview.time}} in a "Hired" template renders
      as an em dash inside a sentence that reads as finished — "your interview is
      at —." Not offering it is the only reliable prevention.
    */
    const hired = tokensFor("hired");
    expect(hired).not.toContain("interview.time");
    expect(hired).not.toContain("interview.date");
    expect(hired).not.toContain("interview.link");

    // The rest of the catalogue is untouched.
    expect(hired).toContain("candidate.first_name");
    expect(hired).toContain("job.title");
  });

  it("offers them for every event that actually schedules something", () => {
    for (const event of [
      "phone_interview_scheduled",
      "video_interview_scheduled",
      "director_round_scheduled",
      "interview_reminder",
      // A screening call is scheduled the same way and carries a time.
      "ai_screening_call_scheduled",
    ] as const) {
      expect(tokensFor(event), event).toContain("interview.time");
    }
  });

  it("offers everything when no event is chosen yet", () => {
    // A picker that is empty until an unrelated dropdown is set reads as broken.
    expect(tokensFor(null)).toEqual(MESSAGE_PLACEHOLDER_FIELDS.map((f) => f.token));
  });

  it("never offers a field the full catalogue does not have", () => {
    for (const event of COMMUNICATION_EVENTS) {
      for (const token of tokensFor(event)) {
        expect(MESSAGE_PLACEHOLDER_FIELDS.map((f) => f.token)).toContain(token);
      }
    }
  });
});
