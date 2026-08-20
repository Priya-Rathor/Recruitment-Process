// =============================================================================
// Reads for the template library, the communication log, and opt-out state.
//
// Writes do not live here. A message is sent through lib/communications/send.ts
// and nothing else, so there is exactly one code path that can put a row in
// message_log — which is what makes the log trustworthy as a record.
//
// Every read is session-bound (lib/supabase/server.ts), so RLS is the tenant
// boundary and organization_id is a filter for index selectivity rather than for
// safety. The service-role paths are in send.ts and triggers.ts, where the
// explicit organization_id filter IS the boundary.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import {
  COMMUNICATION_EVENTS,
  type CommunicationEventKey,
} from "@/lib/communications/events";
import type { MessageTemplate } from "@/lib/communications/templates";
import type { MessageStatus } from "@/lib/communications/send";
import { formatDbError } from "@/lib/supabase/errors";

const TEMPLATE_COLUMNS =
  "id, organization_id, name, event_key, channel, subject, body, whatsapp_body, active, " +
  "created_by, created_at, updated_at";

export async function listMessageTemplates(
  organizationId: string
): Promise<{ templates: MessageTemplate[]; failed: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    console.error(`[comms] template list failed: ${formatDbError(error)}`);
    return { templates: [], failed: true };
  }

  return { templates: (data ?? []) as unknown as MessageTemplate[], failed: false };
}

export type TemplateGroup = {
  eventKey: CommunicationEventKey;
  templates: MessageTemplate[];
};

/**
 * Grouped by event, in the catalogue's order, INCLUDING events with no template.
 *
 * An empty group is the useful one: it is how an admin sees that "Offer extended"
 * has nothing behind it. Listing only what exists would make a gap invisible.
 */
export function groupByEvent(templates: MessageTemplate[]): TemplateGroup[] {
  return COMMUNICATION_EVENTS.map((eventKey) => ({
    eventKey,
    templates: templates.filter((template) => template.event_key === eventKey),
  }));
}

export type MessageLogEntry = {
  id: string;
  application_id: string | null;
  candidate_id: string;
  channel: "email" | "whatsapp";
  template_id: string | null;
  event_key: string | null;
  subject: string | null;
  body_sent: string;
  status: MessageStatus;
  error_message: string | null;
  recipient_hint: string | null;
  sent_by: string | null;
  sent_at: string | null;
  created_at: string;
  /** Resolved for display. Null means an automation sent it. */
  sender_name: string | null;
  /** Only set on the candidate-level rollup, where several jobs are in one list. */
  job_title: string | null;
};

const LOG_COLUMNS =
  "id, application_id, candidate_id, channel, template_id, event_key, subject, body_sent, " +
  "status, error_message, recipient_hint, sent_by, sent_at, created_at";

type LogRow = Omit<MessageLogEntry, "sender_name" | "job_title"> & {
  sender: { name: string | null; email: string } | null;
  application: { job: { title: string | null } | null } | null;
};

function flattenLog(row: LogRow): MessageLogEntry {
  return {
    id: row.id,
    application_id: row.application_id,
    candidate_id: row.candidate_id,
    channel: row.channel,
    template_id: row.template_id,
    event_key: row.event_key,
    subject: row.subject,
    body_sent: row.body_sent,
    status: row.status,
    error_message: row.error_message,
    recipient_hint: row.recipient_hint,
    sent_by: row.sent_by,
    sent_at: row.sent_at,
    created_at: row.created_at,
    // sent_by null is not "unknown sender" — it is the defined way this schema
    // records an automatic send, and the UI says "Automatic" rather than "—".
    sender_name: row.sender ? row.sender.name ?? row.sender.email : null,
    job_title: row.application?.job?.title ?? null,
  };
}

/**
 * Every message sent about one application, newest first.
 *
 * `failed` is returned rather than an empty list, because "nothing has been sent
 * to this candidate" and "we could not read the log" must never look the same on
 * a page a recruiter uses to decide whether to send something.
 */
export async function listApplicationMessages({
  organizationId,
  applicationId,
  limit = 50,
}: {
  organizationId: string;
  applicationId: string;
  limit?: number;
}): Promise<{ messages: MessageLogEntry[]; failed: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_log")
    .select(`${LOG_COLUMNS}, sender:users!message_log_sent_by_fkey(name, email)`)
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[comms] application log read failed: ${formatDbError(error)}`);
    return { messages: [], failed: true };
  }

  return {
    messages: ((data ?? []) as unknown as LogRow[]).map(flattenLog),
    failed: false,
  };
}

/**
 * Every message sent to one candidate, across all their applications.
 *
 * Keyed on candidate_id rather than assembled from the candidate's application
 * ids, which is why send.ts stores candidate_id separately: an archived
 * application, or one whose row is gone, must not take the record of what we told
 * that person with it.
 */
export async function listCandidateMessages({
  organizationId,
  candidateId,
  limit = 100,
}: {
  organizationId: string;
  candidateId: string;
  limit?: number;
}): Promise<{ messages: MessageLogEntry[]; failed: boolean }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("message_log")
    .select(
      `${LOG_COLUMNS}, sender:users!message_log_sent_by_fkey(name, email), ` +
        "application:applications(job:jobs(title))"
    )
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[comms] candidate log read failed: ${formatDbError(error)}`);
    return { messages: [], failed: true };
  }

  return {
    messages: ((data ?? []) as unknown as LogRow[]).map(flattenLog),
    failed: false,
  };
}

export type CommunicationPreferences = {
  candidate_id: string;
  email_opted_out: boolean;
  whatsapp_opted_out: boolean;
  opted_out_at: string | null;
  opted_out_reason: string | null;
  /** True when the read failed — never rendered as "not opted out". */
  unknown: boolean;
};

export const NO_PREFERENCES = (candidateId: string): CommunicationPreferences => ({
  candidate_id: candidateId,
  email_opted_out: false,
  whatsapp_opted_out: false,
  opted_out_at: null,
  opted_out_reason: null,
  unknown: false,
});

/**
 * A candidate's opt-out state, for the chips on their page.
 *
 * A failed read reports `unknown` so the page can say "we couldn't check" — the
 * absence of a chip must mean "they have not opted out", never "we do not know".
 */
export async function getCommunicationPreferences({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<CommunicationPreferences> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("candidate_communication_preferences")
    .select("candidate_id, email_opted_out, whatsapp_opted_out, opted_out_at, opted_out_reason")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (error) {
    console.error(`[comms] preference read failed: ${formatDbError(error)}`);
    return { ...NO_PREFERENCES(candidateId), unknown: true };
  }

  if (!data) return NO_PREFERENCES(candidateId);

  return { ...(data as unknown as CommunicationPreferences), unknown: false };
}
