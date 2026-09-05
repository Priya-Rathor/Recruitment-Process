// =============================================================================
// Automatic sends — the pipeline-event path.
//
// sendForEvent() is called at the exact moment an event happens: inside the
// stage-change handler, inside scheduleInterview()'s caller, inside application
// creation, inside the reminder dispatcher, and inside Module 13's
// "Send templated message" action. It is the only thing that decides whether an
// automatic message goes out.
//
// WHY THIS IS A FUNCTION CALLED AT THE EVENT SITE RATHER THAN A SWEEP.
//
// The spec: "sending happens automatically at the moment that event occurs (e.g.
// the exact stage-move action, or the exact interview-scheduling action)". This
// product has no scheduler — see the bottom of lib/notifications/reminders.ts —
// so a message that waited for a sweep would wait until somebody clicked a
// button, and "your interview is tomorrow at 2pm" delivered two days late is
// worse than not sending it. Every event with a real moment sends in that
// moment. `interview_reminder` is the one exception, because its moment is a
// clock reading, and it rides the existing reminder dispatcher rather than a
// second one.
//
// FIVE THINGS IT REFUSES TO DO.
//
//   - It never throws. Every call site wraps a user's real action.
//   - It never sends without an ACTIVE template. Deactivating a template stops
//     future sends immediately, which is the spec's second test.
//   - It never sends the same event twice for one application (alreadySentForEvent).
//   - It never sends to a channel the candidate opted out of (the send pipeline).
//   - It never invents a value. A template that says {{interview.time}} on an
//     event with no interview renders an em dash, visible in the preview, rather
//     than a plausible-looking wrong time.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  alreadySentForEvent,
  loadOptOut,
  sendOnChannel,
  type CommsClient,
  type SendOutcome,
  type SendTarget,
} from "@/lib/communications/send";
import {
  bodyFor,
  channelsFor,
  subjectFor,
  type MessageTemplate,
} from "@/lib/communications/templates";
import { buildMessageValues, renderMessage } from "@/lib/communications/tokens";
import { isCommunicationEvent, type CommunicationEventKey } from "@/lib/communications/events";
import { resolveTimeZone } from "@/lib/time";
import { formatDbError } from "@/lib/supabase/errors";
import { resolveRecipients, type ResolvedRecipient } from "@/lib/workflow/resolveRecipients";
import type { Recipient } from "@/lib/workflow/recipients";
import type { WorkMode } from "@/lib/types";

/**
 * The recipient every caller written before Module 25 means.
 *
 * A constant rather than an `if` at each use: "no recipients configured" and
 * "recipients: [candidate]" have to behave identically, and the surest way to
 * guarantee that is for the first to become the second before anything reads it.
 * The address fields are null because sendOnChannel() reads the candidate's
 * address from `target` in that case — this row only says WHICH branch to take.
 */
const CANDIDATE_ONLY: ResolvedRecipient = {
  kind: "candidate",
  userId: null,
  name: null,
  email: null,
  phone: null,
  internal: false,
};

const TEMPLATE_COLUMNS =
  "id, organization_id, name, event_key, channel, subject, body, whatsapp_body, active, " +
  "created_by, created_at, updated_at";

/**
 * The one active template for an event, or null.
 *
 * A partial unique index guarantees at most one, so this cannot silently pick
 * between two — see migration 0030's decision 2.
 */
export async function findActiveTemplate({
  client,
  organizationId,
  eventKey,
}: {
  client: CommsClient;
  organizationId: string;
  eventKey: CommunicationEventKey;
}): Promise<MessageTemplate | null> {
  const { data, error } = await client
    .from("message_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("event_key", eventKey)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error(`[comms] active template lookup failed: ${formatDbError(error)}`);
    return null;
  }

  return (data as unknown as MessageTemplate) ?? null;
}

export type MessageContext = {
  organizationId: string;
  organizationName: string;
  timeZone: string;
  countryCode: string | null;
  applicationId: string;
  candidateId: string;
  candidateName: string | null;
  candidateEmail: string | null;
  candidatePhone: string | null;
  recruiterName: string | null;
  /** The substitution map, ready for renderMessage(). */
  values: ReturnType<typeof buildMessageValues>;
};

export type InterviewContext = {
  scheduled_at: string;
  mode: "video" | "phone" | "onsite";
  location: string | null;
  meeting_url: string | null;
};

/**
 * Loads everything a message about one application needs.
 *
 * ONE QUERY SHAPE, USED BY EVERY SENDER — automatic, manual and the preview the
 * recruiter reads before sending. A preview built from a different query than the
 * send is a preview that can lie, and it would be believed.
 */
export async function loadMessageContext({
  client,
  organizationId,
  applicationId,
  interview,
}: {
  client: CommsClient;
  organizationId: string;
  applicationId: string;
  interview?: InterviewContext | null;
}): Promise<MessageContext | null> {
  const { data, error } = await client
    .from("applications")
    .select(
      "id, stage, match_score, candidate_id, " +
        "candidate:candidates(id, name, email, phone, current_company, current_role, " +
        "total_experience_years, expected_salary, notice_period_days), " +
        "job:jobs(title, location, work_mode, experience_min, experience_max, salary_min, " +
        "salary_max, required_skills, preferred_skills, client:clients(name)), " +
        "recruiter:users!applications_assigned_recruiter_id_fkey(name, email), " +
        "organization:organizations(name, timezone, country)"
    )
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[comms] context load failed: ${formatDbError(error)}`);
    return null;
  }

  const row = data as unknown as {
    stage: string | null;
    match_score: number | null;
    candidate_id: string;
    candidate: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      current_company: string | null;
      current_role: string | null;
      total_experience_years: number | null;
      expected_salary: number | null;
      notice_period_days: number | null;
    } | null;
    job: {
      title: string | null;
      location: string | null;
      work_mode: WorkMode | null;
      experience_min: number | null;
      experience_max: number | null;
      salary_min: number | null;
      salary_max: number | null;
      required_skills: string[] | null;
      preferred_skills: string[] | null;
      client: { name: string } | null;
    } | null;
    recruiter: { name: string | null; email: string } | null;
    organization: { name: string; timezone: string | null; country: string | null } | null;
  };

  const timeZone = resolveTimeZone(row.organization?.timezone ?? null);
  const organizationName = row.organization?.name ?? "our team";

  /**
   * MODULE 26 — the office address, for {{organization.office_address}}.
   *
   * A SEPARATE QUERY, not an embed on the organizations join above.
   *
   * organization_settings holds Module 8's screening credentials context and
   * Module 21's privacy configuration alongside this column, and widening the
   * existing embed would pull that row into every message render. One narrow
   * select of one column is cheaper than the alternative and cannot accidentally
   * start carrying something sensitive when a later module adds a column.
   *
   * A failed read leaves the token null, which renders as an em dash. Blocking
   * a rejection email because an address could not be read would be a far worse
   * trade than a dash in a sentence that does not mention the office.
   */
  const { data: settingsRow } = await client
    .from("organization_settings")
    .select("office_address")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const officeAddress =
    (settingsRow as { office_address: string | null } | null)?.office_address ?? null;
  const recruiterName = row.recruiter ? row.recruiter.name ?? row.recruiter.email : null;

  return {
    organizationId,
    organizationName,
    timeZone,
    countryCode: dialCodeFor(row.organization?.country ?? null),
    applicationId,
    candidateId: row.candidate_id,
    candidateName: row.candidate?.name ?? null,
    candidateEmail: row.candidate?.email ?? null,
    candidatePhone: row.candidate?.phone ?? null,
    recruiterName,
    values: buildMessageValues({
      job: row.job
        ? { ...row.job, client_name: row.job.client?.name ?? null }
        : null,
      candidate: row.candidate,
      application: { stage: row.stage, match_score: row.match_score },
      interview: interview ?? null,
      organizationName,
      officeAddress,
      recruiterName,
      timeZone,
    }),
  };
}

/**
 * The organization's dialling code, for normalising a local phone number.
 *
 * A SHORT, EXPLICIT LIST rather than a library. Only the countries this product
 * is actually sold into are here; anything else returns null, and a number
 * without a country code is then not messaged at all rather than guessed at.
 * Guessing wrong sends a candidate's interview details to a stranger who happens
 * to hold that number in another country.
 */
export function dialCodeFor(country: string | null): string | null {
  if (!country) return null;
  const codes: Record<string, string> = {
    IN: "91",
    India: "91",
    US: "1",
    "United States": "1",
    GB: "44",
    "United Kingdom": "44",
    AE: "971",
    "United Arab Emirates": "971",
    SG: "65",
    Singapore: "65",
    AU: "61",
    Australia: "61",
    CA: "1",
    Canada: "1",
  };
  return codes[country.trim()] ?? null;
}

export type EventSendStatus =
  /** At least one channel reached the provider. */
  | "sent"
  /** Every channel was skipped or failed. */
  | "not_sent"
  /** No active template for this event. The normal state, not a problem. */
  | "no_template"
  /** This event already sent for this application. */
  | "duplicate"
  /** The application or its context could not be read. */
  | "failed";

export type EventSendResult = {
  eventKey: CommunicationEventKey;
  templateId: string | null;
  templateName: string | null;
  status: EventSendStatus;
  outcomes: SendOutcome[];
  /** Human-readable, safe to surface, and always set when nothing was sent. */
  detail: string | null;
};

export type SendForEventInput = {
  organizationId: string;
  applicationId: string;
  eventKey: CommunicationEventKey;
  /** Interview details, for the four events whose message states a time. */
  interview?: InterviewContext | null;
  /** Request origin, so the unsubscribe link is absolute. */
  origin?: string | null;
  /**
   * Service-role client. Only for contexts with no session — the Bolna webhook,
   * a scheduled sweep. It BYPASSES RLS, so organizationId must already have been
   * resolved from our own data and never from a payload.
   */
  useAdminClient?: boolean;
  /** Reuses a client the caller already has (the automation engine does). */
  client?: CommsClient;
  /**
   * Pins the template instead of looking up the active one for the event.
   *
   * Module 13's action passes this: an automation names a specific template, and
   * an admin who wired one into a rule should not have it silently swapped when
   * somebody activates a different template for the same event. Still required to
   * be ACTIVE — a paused template is paused for every path.
   */
  templateId?: string | null;
  /**
   * Bypasses the once-per-application guard within this window instead of
   * forever. Only `interview_reminder` uses it: a rescheduled interview needs a
   * second reminder, an interview two months out does not need sixty.
   */
  dedupeSinceIso?: string;
  /**
   * MODULE 25 — who this goes to. Absent means the candidate, which is what
   * every caller written before the Stage Workflow Builder means.
   *
   * The list is resolved against the application HERE rather than by the caller,
   * so "assigned recruiter" means whoever it is at send time. See
   * lib/workflow/resolveRecipients.ts.
   */
  recipients?: Recipient[] | null;
  /**
   * MODULE 25 — extra placeholder values merged over the resolved context.
   *
   * The only current user is `request_form`, which needs `{{form.link}}` and
   * `{{form.name}}` — values that exist for one action rather than for every
   * message, and that cannot be read from the application because the form is
   * named by the RULE.
   *
   * Merged OVER the context deliberately: a caller supplying a value for a token
   * the context also resolves is stating something more specific than the
   * general lookup, and silently preferring the general one would make the
   * override look broken.
   */
  extraValues?: Record<string, string> | null;
};

/** Sends the active template for an event, if there is one. Never throws. */
export async function sendForEvent(input: SendForEventInput): Promise<EventSendResult> {
  const base: EventSendResult = {
    eventKey: input.eventKey,
    templateId: null,
    templateName: null,
    status: "no_template",
    outcomes: [],
    detail: null,
  };

  try {
    const client = input.client ?? (input.useAdminClient ? createAdminClient() : await createClient());
    if (!client) {
      return {
        ...base,
        status: "failed",
        detail: "No database client was available, so nothing was sent.",
      };
    }

    // --- The template -------------------------------------------------------
    let template: MessageTemplate | null;

    if (input.templateId) {
      const { data, error } = await client
        .from("message_templates")
        .select(TEMPLATE_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("id", input.templateId)
        .maybeSingle();

      if (error) console.error(`[comms] template lookup failed: ${formatDbError(error)}`);
      template = (data as unknown as MessageTemplate) ?? null;

      if (template && !template.active) {
        return {
          ...base,
          templateId: template.id,
          templateName: template.name,
          detail: `"${template.name}" is switched off, so nothing was sent.`,
        };
      }
    } else {
      template = await findActiveTemplate({
        client,
        organizationId: input.organizationId,
        eventKey: input.eventKey,
      });
    }

    if (!template) {
      return {
        ...base,
        detail: "No active template for this event, so nothing was sent.",
      };
    }

    // --- The duplicate guard ------------------------------------------------
    const duplicate = await alreadySentForEvent({
      client,
      organizationId: input.organizationId,
      applicationId: input.applicationId,
      eventKey: input.eventKey,
      sinceIso: input.dedupeSinceIso,
    });

    if (duplicate) {
      return {
        ...base,
        templateId: template.id,
        templateName: template.name,
        status: "duplicate",
        detail: "This message has already been sent for this application.",
      };
    }

    // --- The context --------------------------------------------------------
    const context = await loadMessageContext({
      client,
      organizationId: input.organizationId,
      applicationId: input.applicationId,
      interview: input.interview ?? null,
    });

    if (!context) {
      return {
        ...base,
        templateId: template.id,
        templateName: template.name,
        status: "failed",
        detail: "The application could not be read, so nothing was sent.",
      };
    }

    const target: SendTarget = {
      organizationId: context.organizationId,
      candidateId: context.candidateId,
      applicationId: context.applicationId,
      candidateEmail: context.candidateEmail,
      candidatePhone: context.candidatePhone,
      countryCode: context.countryCode,
    };

    // Read ONCE for both channels, so a `both` template makes one query and both
    // halves agree about the candidate's wishes.
    const optOut = await loadOptOut({
      client,
      organizationId: context.organizationId,
      candidateId: context.candidateId,
    });

    const outcomes: SendOutcome[] = [];

    /**
     * MODULE 25 — resolve the recipient list, once, before any channel loop.
     *
     * THE RENDER CONTEXT DOES NOT VARY BY RECIPIENT. An internal notification is
     * about a candidate and resolves candidate placeholders exactly as a
     * candidate-facing message does; that is the entire feature. Only the
     * ADDRESS changes, which is why the values are computed above the loop and
     * only `internalRecipient` moves inside it.
     */
    const resolution = input.recipients?.length
      ? await resolveRecipients({
          client,
          organizationId: input.organizationId,
          applicationId: input.applicationId,
          recipients: input.recipients,
        })
      : { resolved: [CANDIDATE_ONLY], unresolved: [] };

    if (resolution.resolved.length === 0) {
      return {
        ...base,
        templateId: template.id,
        templateName: template.name,
        status: "failed",
        outcomes: [],
        // Named, not generic. "No recipient could be resolved" sends whoever
        // reads the run log hunting; "this application has no assigned
        // recruiter" tells them what to fix.
        detail:
          resolution.unresolved.map((entry) => entry.reason).join(" ") ||
          "Nobody could be resolved to send this to.",
      };
    }

    const values = { ...context.values, ...(input.extraValues ?? {}) };

    // Sequential, and email first. A `both` template's two channels are
    // independent (a WhatsApp failure must not cost the email), and firing them
    // concurrently is how a provider rate-limit lands on whichever one lost the
    // race rather than on a predictable one. The recipient loop is outside for
    // the same reason: one slow mailbox must not reorder the rest.
    for (const recipient of resolution.resolved) {
      for (const channel of channelsFor(template.channel)) {
        outcomes.push(
          await sendOnChannel({
            client,
            target,
            channel,
            subject: subjectFor(template, channel)
              ? renderMessage(subjectFor(template, channel) as string, values)
              : null,
            body: renderMessage(bodyFor(template, channel), values),
            templateId: template.id,
            eventKey: input.eventKey,
            // NULL — this is an automatic send. The log shows "Automatic", the
            // opt-out is binding, and the footer is attached.
            sentBy: null,
            origin: input.origin,
            optOut,
            internalRecipient: recipient.internal
              ? {
                  email: recipient.email ?? "",
                  name: recipient.name,
                  userId: recipient.userId,
                }
              : null,
          })
        );
      }
    }

    const anyDelivered = outcomes.some((outcome) => outcome.delivered);

    return {
      eventKey: input.eventKey,
      templateId: template.id,
      templateName: template.name,
      status: anyDelivered ? "sent" : "not_sent",
      outcomes,
      detail: anyDelivered
        ? null
        : (outcomes.find((outcome) => outcome.detail)?.detail ?? "Nothing was sent."),
    };
  } catch (error) {
    console.error(`[comms] sendForEvent(${input.eventKey}) failed: ${formatDbError(error)}`);
    return { ...base, status: "failed", detail: "Something went wrong sending that message." };
  }
}

/**
 * Fire-and-remember wrapper for a route handler.
 *
 * AWAITED, NOT DETACHED. A serverless function can be frozen the moment it
 * responds, so a detached promise would leave a half-sent message with no log
 * row — the same reasoning the automation dispatch call-sites already carry. What
 * this adds is the try/catch, so a caller can drop it into an existing handler
 * without changing that handler's error contract.
 */
export async function trySendForEvent(input: SendForEventInput): Promise<EventSendResult | null> {
  try {
    return await sendForEvent(input);
  } catch (error) {
    console.error(`[comms] automatic send for ${input.eventKey} failed:`, error);
    return null;
  }
}

/**
 * Module 13's "Send templated message" action.
 *
 * A thin wrapper over sendForEvent(), and thin on purpose: the action must behave
 * identically to a built-in trigger — same opt-out rule, same footer, same log,
 * same dedupe — because a message a candidate receives should not depend on which
 * part of the product decided to send it.
 *
 * The one thing it adds is resolving the event key. A rule stores it in config so
 * the engine does not need a query, but a rule saved before that field existed —
 * or one hand-written into the database — falls back to reading the template.
 * Without an event key there would be no dedupe key and no "why was this sent?"
 * in the log.
 */
export async function sendTemplatedMessage({
  client,
  organizationId,
  applicationId,
  templateId,
  eventKey,
  origin,
  recipients,
  extraValues,
}: {
  client: CommsClient;
  organizationId: string;
  applicationId: string;
  templateId: string;
  eventKey: CommunicationEventKey | null;
  origin?: string | null;
  /** Module 25. Absent means the candidate. */
  recipients?: Recipient[] | null;
  /** Module 25. Extra tokens for one action — see SendForEventInput. */
  extraValues?: Record<string, string> | null;
}): Promise<EventSendResult> {
  let resolvedEvent = eventKey;

  if (!resolvedEvent) {
    const { data } = await client
      .from("message_templates")
      .select("event_key")
      .eq("organization_id", organizationId)
      .eq("id", templateId)
      .maybeSingle();

    const stored = (data as { event_key: string } | null)?.event_key;
    if (isCommunicationEvent(stored)) resolvedEvent = stored;
  }

  if (!resolvedEvent) {
    return {
      eventKey: "application_received",
      templateId,
      templateName: null,
      status: "failed",
      outcomes: [],
      detail: "That message template no longer exists, so nothing was sent.",
    };
  }

  return await sendForEvent({
    organizationId,
    applicationId,
    eventKey: resolvedEvent,
    templateId,
    client,
    origin,
    recipients,
    extraValues,
  });
}
