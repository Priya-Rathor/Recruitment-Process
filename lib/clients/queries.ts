// Client persistence, activity aggregation, and the submission flow.
import { createClient } from "@/lib/supabase/server";
import { computeClientStats, type FeedbackEvent } from "@/lib/clients/sla";
import { formatDbError } from "@/lib/supabase/errors";

export type ClientContact = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
};

export type Client = {
  id: string;
  organization_id: string;
  name: string;
  contacts: ClientContact[];
  feedback_sla_days: number;
  account_manager_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  account_manager_name?: string | null;
};

const CLIENT_COLUMNS =
  "id, organization_id, name, contacts, feedback_sla_days, account_manager_id, " +
  "notes, archived_at, created_at";

export async function listClients({
  organizationId,
  includeArchived = false,
}: {
  organizationId: string;
  includeArchived?: boolean;
}): Promise<{ clients: Client[]; failed: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select(`${CLIENT_COLUMNS}, manager:users!clients_account_manager_id_fkey(name, email)`)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (!includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error) {
    console.error(`[clients] list failed: ${formatDbError(error)}`);
    return { clients: [], failed: true };
  }

  const clients = ((data ?? []) as unknown as (Client & {
    manager: { name: string | null; email: string } | null;
  })[]).map((row) => ({
    ...row,
    account_manager_name: row.manager ? row.manager.name ?? row.manager.email : null,
  }));

  return { clients, failed: false };
}

export async function getClient({
  organizationId,
  clientId,
}: {
  organizationId: string;
  clientId: string;
}): Promise<Client | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(`${CLIENT_COLUMNS}, manager:users!clients_account_manager_id_fkey(name, email)`)
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as Client & {
    manager: { name: string | null; email: string } | null;
  };

  return {
    ...row,
    account_manager_name: row.manager ? row.manager.name ?? row.manager.email : null,
  };
}

export type ClientActivity = {
  activeJobs: number;
  submittedCandidates: number;
  interviewsScheduled: number;
  stats: ReturnType<typeof computeClientStats>;
  events: (FeedbackEvent & {
    candidate_name: string;
    job_title: string;
    outcome: string | null;
    application_id: string;
  })[];
};

/**
 * Everything the client detail page and the AI activity summary need.
 *
 * Counted with head-only queries rather than fetching rows: the page needs the
 * numbers, not the records, and a client with hundreds of submissions shouldn't
 * pull them all across the wire.
 */
export async function getClientActivity({
  organizationId,
  clientId,
  now = new Date(),
}: {
  organizationId: string;
  clientId: string;
  now?: Date;
}): Promise<ClientActivity> {
  const supabase = await createClient();

  const client = await getClient({ organizationId, clientId });
  const slaDays = client?.feedback_sla_days ?? 3;

  const [jobsResult, eventsResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null)
      .eq("status", "open"),
    supabase
      .from("client_feedback_events")
      .select(
        "id, requested_at, responded_at, outcome, application_id, " +
          "application:applications(candidate:candidates(name), job:jobs(title))"
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("requested_at", { ascending: false })
      .limit(200),
  ]);

  const rawEvents = (eventsResult.data ?? []) as unknown as {
    id: string;
    requested_at: string;
    responded_at: string | null;
    outcome: string | null;
    application_id: string;
    application: {
      candidate: { name: string } | null;
      job: { title: string } | null;
    } | null;
  }[];

  const events = rawEvents.map((row) => ({
    id: row.id,
    requestedAt: row.requested_at,
    respondedAt: row.responded_at,
    outcome: row.outcome,
    application_id: row.application_id,
    candidate_name: row.application?.candidate?.name ?? "Unknown candidate",
    job_title: row.application?.job?.title ?? "Unknown job",
  }));

  // Interviews scheduled for this client's jobs.
  let interviewsScheduled = 0;
  const { data: jobIdRows } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);

  const jobIds = ((jobIdRows ?? []) as { id: string }[]).map((row) => row.id);

  if (jobIds.length > 0) {
    const { data: applicationRows } = await supabase
      .from("applications")
      .select("id")
      .eq("organization_id", organizationId)
      .in("job_id", jobIds);

    const applicationIds = ((applicationRows ?? []) as { id: string }[]).map((row) => row.id);

    if (applicationIds.length > 0) {
      const { count } = await supabase
        .from("interviews")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("application_id", applicationIds)
        .eq("status", "scheduled");
      interviewsScheduled = count ?? 0;
    }
  }

  return {
    activeJobs: jobsResult.count ?? 0,
    submittedCandidates: events.length,
    interviewsScheduled,
    stats: computeClientStats({ events, slaDays, now }),
    events,
  };
}

/** Whether this application has already been submitted to its client. */
export async function getSubmissionForApplication({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_feedback_events")
    .select("id, client_id, requested_at, responded_at, outcome, submission_text")
    .eq("organization_id", organizationId)
    .eq("application_id", applicationId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as unknown as {
    id: string;
    client_id: string;
    requested_at: string;
    responded_at: string | null;
    outcome: string | null;
    submission_text: string | null;
  } | null) ?? null;
}

/** Validates a client payload. */
export function parseClientPayload(
  value: unknown,
  mode: "create" | "update"
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = value as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if ("name" in raw || mode === "create") {
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      return { ok: false, error: "A client name is required." };
    }
    data.name = raw.name.trim().slice(0, 200);
  }

  if ("feedback_sla_days" in raw) {
    const days = Number(raw.feedback_sla_days);
    if (!Number.isFinite(days) || days < 0 || days > 90) {
      return { ok: false, error: "Feedback SLA must be between 0 and 90 days." };
    }
    data.feedback_sla_days = Math.floor(days);
  }

  if ("contacts" in raw) {
    if (!Array.isArray(raw.contacts)) {
      return { ok: false, error: "Contacts must be a list." };
    }
    const contacts: ClientContact[] = [];
    for (const item of raw.contacts) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (name.length === 0) continue;
      contacts.push({
        name: name.slice(0, 200),
        email: typeof entry.email === "string" ? entry.email.trim().slice(0, 320) : null,
        phone: typeof entry.phone === "string" ? entry.phone.trim().slice(0, 40) : null,
        role: typeof entry.role === "string" ? entry.role.trim().slice(0, 120) : null,
      });
      if (contacts.length >= 20) break;
    }
    data.contacts = contacts;
  }

  if ("notes" in raw) {
    data.notes =
      typeof raw.notes === "string" && raw.notes.trim().length > 0
        ? raw.notes.trim().slice(0, 5000)
        : null;
  }

  if ("account_manager_id" in raw) {
    data.account_manager_id =
      typeof raw.account_manager_id === "string" && raw.account_manager_id.length > 0
        ? raw.account_manager_id
        : null;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "No valid fields provided." };
  }

  return { ok: true, data };
}
