// =============================================================================
// Module 19 — reads. One tenant-scoped place for pages and routes.
//
// Every function takes organizationId and filters on it, even where RLS would
// already refuse the row. Two reasons: lib/supabase/admin.ts bypasses RLS
// entirely, and a query that reads correctly only because a policy caught it is
// one policy edit away from leaking.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { formatDbError, isSchemaOutOfDate } from "@/lib/supabase/errors";
import {
  checklistProgress,
  isDocumentOwner,
  isDocumentStatus,
  isOnboardingStatus,
  type ChecklistProgress,
  type DocumentOwner,
  type DocumentStatus,
  type OnboardingStatus,
} from "@/lib/onboarding/documents";

export const ONBOARDING_BUCKET = "onboarding-documents";

/** How long a document's signed URL lives. Long enough to open, not to share. */
export const SIGNED_URL_TTL_SECONDS = 60;

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string | null;
  required: boolean;
  expected_from: DocumentOwner;
  display_order: number;
  active: boolean;
  created_at: string;
};

export type OnboardingDocument = {
  id: string;
  onboarding_record_id: string;
  template_id: string | null;
  name: string;
  required: boolean;
  expected_from: DocumentOwner;
  display_order: number;
  status: DocumentStatus;
  file_url: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
};

export type OnboardingListRow = {
  id: string;
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  job_id: string;
  job_title: string;
  status: OnboardingStatus;
  started_at: string;
  completed_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  progress: ChecklistProgress;
};

export type OnboardingDetail = Omit<OnboardingListRow, "progress"> & {
  candidate_email: string | null;
  candidate_phone: string | null;
  documents: OnboardingDocument[];
  progress: ChecklistProgress;
};

const TEMPLATE_COLUMNS =
  "id, name, description, required, expected_from, display_order, active, created_at";

const DOCUMENT_COLUMNS =
  "id, onboarding_record_id, template_id, name, required, expected_from, display_order, " +
  "status, file_url, file_name, file_size_bytes, uploaded_by, uploaded_at, " +
  "verified_by, verified_at, rejection_reason, notes, created_at";

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

/**
 * The organization's checklist.
 *
 * `includeInactive` is for the Settings screen, which must show a switched-off
 * type so it can be switched back on. Every other caller wants active only —
 * generating a hire's checklist from inactive rows would defeat the toggle.
 */
export async function listDocumentTemplates({
  organizationId,
  includeInactive = false,
}: {
  organizationId: string;
  includeInactive?: boolean;
}): Promise<{ templates: DocumentTemplate[]; failed: boolean; schemaOutOfDate: boolean }> {
  const supabase = await createClient();

  let query = supabase
    .from("organization_document_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organization_id", organizationId);

  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[onboarding] template list failed: ${formatDbError(error)}`);
    return { templates: [], failed: true, schemaOutOfDate: isSchemaOutOfDate(error) };
  }

  return {
    templates: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeTemplate),
    failed: false,
    schemaOutOfDate: false,
  };
}

function normalizeTemplate(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    required: row.required === true,
    // A value the enum should make impossible, defaulted rather than thrown on:
    // a settings screen that 500s because one row is odd is worse than one that
    // shows "Candidate" and lets it be corrected.
    expected_from: isDocumentOwner(row.expected_from) ? row.expected_from : "candidate",
    display_order: typeof row.display_order === "number" ? row.display_order : 0,
    active: row.active === true,
    created_at: row.created_at as string,
  };
}

// -----------------------------------------------------------------------------
// Records
// -----------------------------------------------------------------------------

export type OnboardingFilters = {
  status?: OnboardingStatus;
  assignedTo?: string;
  jobId?: string;
};

export function onboardingFiltersFromParams(params: URLSearchParams): OnboardingFilters {
  const status = params.get("status");
  const assignedTo = params.get("assigned_to");
  const jobId = params.get("job_id");

  return {
    status: isOnboardingStatus(status) ? status : undefined,
    assignedTo: assignedTo || undefined,
    jobId: jobId || undefined,
  };
}

/**
 * The list, with each record's document progress.
 *
 * Documents are fetched in ONE query for the whole page and grouped in memory,
 * rather than a count per row. Thirty hires would otherwise be thirty-one round
 * trips before anything rendered.
 *
 * SORT: in-progress first, then oldest-started. The spec's reasoning is that the
 * ones waiting longest should surface, and it is right — a completed record
 * needs nobody's attention, and sorting purely by date would bury a three-week-
 * old stall under this morning's finished one.
 */
export async function listOnboardingRecords({
  organizationId,
  filters = {},
  limit = 100,
}: {
  organizationId: string;
  filters?: OnboardingFilters;
  limit?: number;
}): Promise<{
  records: OnboardingListRow[];
  total: number;
  failed: boolean;
  schemaOutOfDate: boolean;
}> {
  const supabase = await createClient();

  let query = supabase
    .from("onboarding_records")
    .select(
      "id, application_id, candidate_id, job_id, status, started_at, completed_at, assigned_to, " +
        "candidate:candidates(name), job:jobs(title), assignee:users!onboarding_records_assigned_to_fkey(name, email)",
      { count: "exact" }
    )
    .eq("organization_id", organizationId);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.assignedTo === "unassigned") query = query.is("assigned_to", null);
  else if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);

  const { data, error, count } = await query.limit(limit);

  if (error) {
    console.error(`[onboarding] list failed: ${formatDbError(error)}`);
    return { records: [], total: 0, failed: true, schemaOutOfDate: isSchemaOutOfDate(error) };
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const recordIds = rows.map((row) => row.id as string);

  const documentsByRecord = await documentCountsFor({ organizationId, recordIds });

  const records = rows.map((row) => {
    const candidate = row.candidate as { name: string } | null;
    const job = row.job as { title: string } | null;
    const assignee = row.assignee as { name: string | null; email: string } | null;

    return {
      id: row.id as string,
      application_id: row.application_id as string,
      candidate_id: row.candidate_id as string,
      candidate_name: candidate?.name ?? "Unknown candidate",
      job_id: row.job_id as string,
      job_title: job?.title ?? "Unknown job",
      status: isOnboardingStatus(row.status) ? row.status : "in_progress",
      started_at: row.started_at as string,
      completed_at: (row.completed_at as string | null) ?? null,
      assigned_to: (row.assigned_to as string | null) ?? null,
      assigned_to_name: assignee ? assignee.name ?? assignee.email : null,
      progress: checklistProgress(documentsByRecord.get(row.id as string) ?? []),
    } satisfies OnboardingListRow;
  });

  return {
    records: sortOnboardingRecords(records),
    total: count ?? records.length,
    failed: false,
    schemaOutOfDate: false,
  };
}

/**
 * In-progress first, then on hold, then completed; oldest start first inside
 * each group.
 *
 * Sorted here rather than in SQL because the group order is not the enum's
 * alphabetical order and is not a column — encoding it as a CASE in the query
 * would put a UI decision in the database.
 */
export function sortOnboardingRecords<T extends { status: OnboardingStatus; started_at: string }>(
  records: T[]
): T[] {
  const rank: Record<OnboardingStatus, number> = { in_progress: 0, on_hold: 1, completed: 2 };

  return [...records].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
}

async function documentCountsFor({
  organizationId,
  recordIds,
}: {
  organizationId: string;
  recordIds: string[];
}): Promise<Map<string, { id: string; name: string; required: boolean; status: DocumentStatus }[]>> {
  const grouped = new Map<
    string,
    { id: string; name: string; required: boolean; status: DocumentStatus }[]
  >();
  if (recordIds.length === 0) return grouped;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_documents")
    .select("id, onboarding_record_id, name, required, status")
    .eq("organization_id", organizationId)
    .in("onboarding_record_id", recordIds);

  if (error) {
    // Progress is missing, not zero. An empty map yields 0/0 rows, which the
    // list renders as "no checklist" — see the note in the page. Reporting a
    // fabricated 0/7 would be a false statement about someone's paperwork.
    console.error(`[onboarding] document counts failed: ${formatDbError(error)}`);
    return grouped;
  }

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = row.onboarding_record_id as string;
    const list = grouped.get(key) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      required: row.required === true,
      status: isDocumentStatus(row.status) ? row.status : "pending",
    });
    grouped.set(key, list);
  }

  return grouped;
}

/** One hire's record and its full checklist. Null when it is not this org's. */
export async function getOnboardingDetail({
  organizationId,
  recordId,
}: {
  organizationId: string;
  recordId: string;
}): Promise<OnboardingDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("onboarding_records")
    .select(
      "id, application_id, candidate_id, job_id, status, started_at, completed_at, assigned_to, " +
        "candidate:candidates(name, email, phone), job:jobs(title), " +
        "assignee:users!onboarding_records_assigned_to_fkey(name, email)"
    )
    .eq("organization_id", organizationId)
    .eq("id", recordId)
    .maybeSingle();

  if (error) {
    console.error(`[onboarding] detail failed: ${formatDbError(error)}`);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const candidate = row.candidate as { name: string; email: string | null; phone: string | null } | null;
  const job = row.job as { title: string } | null;
  const assignee = row.assignee as { name: string | null; email: string } | null;

  const documents = await listOnboardingDocuments({ organizationId, recordId });

  return {
    id: row.id as string,
    application_id: row.application_id as string,
    candidate_id: row.candidate_id as string,
    candidate_name: candidate?.name ?? "Unknown candidate",
    candidate_email: candidate?.email ?? null,
    candidate_phone: candidate?.phone ?? null,
    job_id: row.job_id as string,
    job_title: job?.title ?? "Unknown job",
    status: isOnboardingStatus(row.status) ? row.status : "in_progress",
    started_at: row.started_at as string,
    completed_at: (row.completed_at as string | null) ?? null,
    assigned_to: (row.assigned_to as string | null) ?? null,
    assigned_to_name: assignee ? assignee.name ?? assignee.email : null,
    documents,
    progress: checklistProgress(documents),
  };
}

export async function listOnboardingDocuments({
  organizationId,
  recordId,
}: {
  organizationId: string;
  recordId: string;
}): Promise<OnboardingDocument[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("onboarding_documents")
    .select(
      `${DOCUMENT_COLUMNS}, ` +
        "uploader:users!onboarding_documents_uploaded_by_fkey(name, email), " +
        "verifier:users!onboarding_documents_verified_by_fkey(name, email)"
    )
    .eq("organization_id", organizationId)
    .eq("onboarding_record_id", recordId)
    .order("required", { ascending: false })
    .order("display_order", { ascending: true });

  if (error) {
    console.error(`[onboarding] documents failed: ${formatDbError(error)}`);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const uploader = row.uploader as { name: string | null; email: string } | null;
    const verifier = row.verifier as { name: string | null; email: string } | null;

    return {
      id: row.id as string,
      onboarding_record_id: row.onboarding_record_id as string,
      template_id: (row.template_id as string | null) ?? null,
      name: row.name as string,
      required: row.required === true,
      expected_from: isDocumentOwner(row.expected_from) ? row.expected_from : "candidate",
      display_order: typeof row.display_order === "number" ? row.display_order : 0,
      status: isDocumentStatus(row.status) ? row.status : "pending",
      file_url: (row.file_url as string | null) ?? null,
      file_name: (row.file_name as string | null) ?? null,
      file_size_bytes: (row.file_size_bytes as number | null) ?? null,
      uploaded_by: (row.uploaded_by as string | null) ?? null,
      uploaded_by_name: uploader ? uploader.name ?? uploader.email : null,
      uploaded_at: (row.uploaded_at as string | null) ?? null,
      verified_by: (row.verified_by as string | null) ?? null,
      verified_by_name: verifier ? verifier.name ?? verifier.email : null,
      verified_at: (row.verified_at as string | null) ?? null,
      rejection_reason: (row.rejection_reason as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      created_at: row.created_at as string,
    } satisfies OnboardingDocument;
  });
}

/**
 * One document plus the record it hangs off, for a route that must check
 * tenancy and assignment before acting.
 */
export async function getOnboardingDocument({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}): Promise<{
  document: OnboardingDocument;
  record: { id: string; assigned_to: string | null; status: OnboardingStatus; candidate_id: string };
} | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("onboarding_documents")
    .select(
      `${DOCUMENT_COLUMNS}, record:onboarding_records!inner(id, assigned_to, status, candidate_id)`
    )
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    console.error(`[onboarding] document fetch failed: ${formatDbError(error)}`);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const record = row.record as {
    id: string;
    assigned_to: string | null;
    status: string;
    candidate_id: string;
  };

  return {
    document: {
      id: row.id as string,
      onboarding_record_id: row.onboarding_record_id as string,
      template_id: (row.template_id as string | null) ?? null,
      name: row.name as string,
      required: row.required === true,
      expected_from: isDocumentOwner(row.expected_from) ? row.expected_from : "candidate",
      display_order: typeof row.display_order === "number" ? row.display_order : 0,
      status: isDocumentStatus(row.status) ? row.status : "pending",
      file_url: (row.file_url as string | null) ?? null,
      file_name: (row.file_name as string | null) ?? null,
      file_size_bytes: (row.file_size_bytes as number | null) ?? null,
      uploaded_by: (row.uploaded_by as string | null) ?? null,
      uploaded_by_name: null,
      uploaded_at: (row.uploaded_at as string | null) ?? null,
      verified_by: (row.verified_by as string | null) ?? null,
      verified_by_name: null,
      verified_at: (row.verified_at as string | null) ?? null,
      rejection_reason: (row.rejection_reason as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      created_at: row.created_at as string,
    },
    record: {
      id: record.id,
      assigned_to: record.assigned_to,
      status: isOnboardingStatus(record.status) ? record.status : "in_progress",
      candidate_id: record.candidate_id,
    },
  };
}

/**
 * A short-lived signed URL for a stored document.
 *
 * The bucket is private — identity documents are the most sensitive files this
 * product holds — so there is no public URL to hand out, and this is issued only
 * after the caller's tenancy has been checked.
 */
export async function createSignedDocumentUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(ONBOARDING_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error(`[onboarding] signing failed: ${formatDbError(error)}`);
    return null;
  }
  return data.signedUrl;
}
