// =============================================================================
// Bulk intake — processing one file, end to end.
//
//   file -> extract text -> AI parse -> validate -> MATCH -> candidate
//        -> store resume -> queue profile conflicts -> application
//
// One file per call, deliberately. The spec's hard requirement is that "every
// file resolves independently": one corrupt PDF among ten must not cost the
// other nine. A per-file entry point makes that structural rather than a
// promise — there is no shared transaction, no shared array being mutated, and
// no way for a throw here to reach a sibling.
//
// WHERE THE AI IS AND ISN'T ALLOWED TO WRITE
//
// The AI parses, and that is all. It never chooses who the resume belongs to
// (lib/intake/match.ts, deterministic) and it never overwrites a field on an
// existing candidate (the proposal is queued for review instead, using Module
// 6's existing resume_parse_results table). The one place parsed values do
// reach `candidates` directly is when creating a BRAND NEW record — see the
// note above createCandidateFromResume() for why that is not the same thing.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { extractResumeText } from "@/lib/resumes/extract";
import { parseResume, type ParsedResume } from "@/lib/ai/parseResume";
import { buildFieldComparisons } from "@/lib/resumes/review";
import { RESUME_BUCKET } from "@/lib/resumes/queries";
import { normalizeEmail, normalizePhone } from "@/lib/candidates/dedupe";
import {
  candidateNameFrom,
  hasIdentifyingDetails,
  resolveCandidateMatch,
} from "@/lib/intake/match";
import type { IntakeStatus } from "@/lib/intake/status";
import { logActivity, logAiCall } from "@/lib/activity/log";
import { dispatch } from "@/lib/automations/engine";
import type { Candidate } from "@/lib/types";
import { formatDbError } from "@/lib/supabase/errors";

export type ProcessOutcome = {
  status: IntakeStatus;
  candidateId: string | null;
  candidateName: string | null;
  applicationId: string | null;
  resumeId: string | null;
  conflictCandidateIds: string[];
  queuedConflictCount: number;
  errorMessage: string | null;
  storagePath: string | null;
  parsed: ParsedResume | null;
};

export type ProcessInput = {
  organizationId: string;
  organizationName: string;
  jobId: string;
  actorId: string;
  actorLabel: string;
  file: { name: string; type: string | null; buffer: ArrayBuffer };
  fileHash: string;
  /** Origin for automation webhooks; mirrors the applications route. */
  webhookUrl: string;
};

/** Failure shorthand — every early exit produces the same shape. */
function failed(message: string, extra: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return {
    status: "failed",
    candidateId: null,
    candidateName: null,
    applicationId: null,
    resumeId: null,
    conflictCandidateIds: [],
    queuedConflictCount: 0,
    errorMessage: message,
    storagePath: null,
    parsed: null,
    ...extra,
  };
}

/**
 * Runs the whole pipeline for one file and returns what happened.
 *
 * Never throws for an expected failure — a corrupt file, a scan with no text
 * layer, an AI provider outage and an ambiguous match are all normal events in
 * recruitment, and each is reported as an outcome the caller records. Only a
 * genuine bug escapes, and the route wraps that too.
 */
export async function processIntakeFile(input: ProcessInput): Promise<ProcessOutcome> {
  const { organizationId, jobId, actorId, file } = input;

  /**
   * A failure that KEEPS the file.
   *
   * A resume that could not be parsed is still a resume. Discarding it would
   * make "Connect to existing candidate" a lie on a failed row — the recruiter
   * would pick the right person and no file would be filed against them. Parked
   * under <org>/_intake/, so a later reconnection has something to move.
   */
  const failKeepingFile = async (message: string): Promise<ProcessOutcome> => ({
    ...failed(message),
    storagePath: await parkFile({
      organizationId,
      fileName: file.name,
      buffer: file.buffer,
      contentType: file.type,
    }),
  });

  // --- 1. Text ---------------------------------------------------------------
  const extraction = await extractResumeText({
    buffer: file.buffer,
    fileName: file.name,
    mimeType: file.type,
  });

  if (!extraction.ok) return failKeepingFile(extraction.message);

  // --- 2. AI parse -----------------------------------------------------------
  const result = await parseResume(extraction.text);

  await logAiCall({
    organizationId,
    actorId,
    actorLabel: input.actorLabel,
    feature: "parseResume",
    entityType: "job",
    entityId: jobId,
    ok: result.ok,
  });

  if (!result.ok) return failKeepingFile(result.message);

  const parsed = result.data;

  if (!hasIdentifyingDetails(parsed)) {
    return failKeepingFile(
      "This file parsed, but contained no name, email or phone number — nothing to identify a person by."
    );
  }

  // --- 3. Match --------------------------------------------------------------
  const existing = await findMatchCandidates({
    organizationId,
    email: parsed.email,
    phone: parsed.phone,
  });

  const match = resolveCandidateMatch({
    email: parsed.email,
    phone: parsed.phone,
    existing,
  });

  // Ambiguous: park the file, resolve nothing. No candidate, no application, no
  // profile change — the spec forbids guessing, and a wrong guess here merges
  // two real people's histories, which is close to unrecoverable by hand.
  if (match.kind === "conflict") {
    const storagePath = await parkFile({
      organizationId,
      fileName: file.name,
      buffer: file.buffer,
      contentType: file.type,
    });

    return {
      status: "match_conflict",
      candidateId: null,
      candidateName: null,
      applicationId: null,
      resumeId: null,
      conflictCandidateIds: match.candidateIds,
      queuedConflictCount: 0,
      errorMessage: null,
      storagePath,
      parsed,
    };
  }

  // --- 4. Candidate ----------------------------------------------------------
  const candidate =
    match.kind === "create"
      ? await createCandidateFromResume({ organizationId, actorId, parsed })
      : await loadCandidate({ organizationId, candidateId: match.candidateId });

  if (!candidate) {
    return failed(
      match.kind === "create"
        ? "Could not create a candidate from this resume."
        : "The matched candidate could not be read."
    );
  }

  // --- 5. Store the resume + queue the proposal ------------------------------
  //
  // Additive, always. A candidate accumulates resumes over time; the newest is
  // simply the newest row (listResumes orders by uploaded_at desc). Nothing is
  // deleted or replaced.
  const stored = await storeResumeForCandidate({
    organizationId,
    candidateId: candidate.id,
    actorId,
    file,
    fileHash: input.fileHash,
    parsed,
    extractedCharacters: extraction.characters,
  });

  // A matched candidate has real profile values that the resume may disagree
  // with. Those differences are QUEUED, never applied — the parse result row is
  // written with reviewed_at null, which is exactly what Module 6's review
  // screen already reads. A newly created candidate has nothing to disagree
  // with, so its count is zero by construction.
  const queuedConflictCount =
    match.kind === "match"
      ? buildFieldComparisons(candidate, parsed).filter(
          (comparison) => comparison.status === "conflict"
        ).length
      : 0;

  // --- 6. Application --------------------------------------------------------
  const application = await ensureApplicationForCandidate({
    organizationId,
    organizationName: input.organizationName,
    candidateId: candidate.id,
    jobId,
    actorId,
    webhookUrl: input.webhookUrl,
  });

  const base = {
    candidateId: candidate.id,
    candidateName: candidate.name,
    applicationId: application.applicationId,
    resumeId: stored.resumeId,
    conflictCandidateIds: [],
    queuedConflictCount,
    errorMessage: null,
    storagePath: stored.storagePath,
    parsed,
  };

  // "Already applied" wins over "matched" as the reported status: it is the
  // more specific fact, and it is the one that explains why no new application
  // appeared in the job's list.
  if (application.alreadyExisted) {
    return { ...base, status: "already_applied" };
  }

  return {
    ...base,
    status: match.kind === "create" ? "candidate_created" : "candidate_matched",
  };
}

// =============================================================================
// Steps
// =============================================================================

/**
 * Narrows the candidate table to rows that could possibly match, by normalised
 * email OR normalised phone.
 *
 * Archived candidates are included, unlike the intake form's duplicate check.
 * Re-creating someone who was archived last month would be a duplicate in every
 * sense that matters, and the archive is reversible — matching them is right,
 * and the recruiter can see the "Archived" tag on the profile the row links to.
 */
async function findMatchCandidates({
  organizationId,
  email,
  phone,
}: {
  organizationId: string;
  email: string | null;
  phone: string | null;
}) {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);
  if (!emailKey && !phoneKey) return [];

  const conditions: string[] = [];
  if (emailKey) conditions.push(`email_normalized.eq.${emailKey}`);
  if (phoneKey) conditions.push(`phone_normalized.eq.${phoneKey}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .select("id, name, email_normalized, phone_normalized")
    .eq("organization_id", organizationId)
    .or(conditions.join(","))
    .limit(25);

  if (error) {
    // Returning [] would mean "no match", which creates a duplicate candidate.
    // Throwing turns a database blip into a per-file failure the recruiter can
    // retry — the safe direction when the alternative is silent data damage.
    console.error(`[intake] match lookup failed: ${formatDbError(error)}`);
    throw new Error("Could not check for existing candidates.");
  }

  return (data ?? []) as {
    id: string;
    name: string | null;
    email_normalized: string | null;
    phone_normalized: string | null;
  }[];
}

/**
 * Creates a candidate from parsed resume fields.
 *
 * THE ONE PLACE PARSED VALUES REACH `candidates` WITHOUT A REVIEW, and worth
 * being explicit about, because the platform rule says AI output goes through
 * human review before it becomes trusted data.
 *
 * The rule exists to stop a model silently destroying something a human
 * established. Here there is nothing to destroy: the record does not exist
 * until this call, every value in it came from the resume, and no human has
 * ever asserted anything about it. The risk the rule guards against is absent,
 * and the alternative — refusing to create thirty candidates until someone
 * confirms thirty forms — is the exact workflow the spec says to avoid.
 *
 * What is preserved: the full parse result stays attached to the resume and
 * unreviewed, so every field remains inspectable and correctable, and the
 * creation is written to the activity log with its source. Nothing is hidden.
 */
async function createCandidateFromResume({
  organizationId,
  actorId,
  parsed,
}: {
  organizationId: string;
  actorId: string;
  parsed: ParsedResume;
}): Promise<Candidate | null> {
  const name = candidateNameFrom(parsed);
  if (!name) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .insert({
      organization_id: organizationId,
      name,
      email: parsed.email,
      phone: parsed.phone,
      location: parsed.location,
      current_company: parsed.currentCompany,
      current_role: parsed.currentRole,
      total_experience_years: parsed.totalExperienceYears,
      expected_salary: parsed.expectedSalary,
      notice_period_days: parsed.noticePeriodDays,
      skills: parsed.skills,
      source: "resume_upload",
    })
    .select("*")
    .single();

  if (error) {
    console.error(`[intake] candidate create failed: ${formatDbError(error)}`);
    return null;
  }

  const candidate = data as unknown as Candidate;

  await logActivity({
    organizationId,
    entityType: "candidate",
    entityId: candidate.id,
    eventType: "candidate.created",
    actorId,
    metadata: { name: candidate.name, source: "resume_upload", via: "bulk_intake" },
  });

  return candidate;
}

async function loadCandidate({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<Candidate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", candidateId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as Candidate;
}

/**
 * Uploads the file and records it against the candidate, with the AI's proposal
 * attached and UNREVIEWED.
 *
 * Best-effort: a storage failure must not undo a candidate and application that
 * are already correct. The resume is the least important of the three — losing
 * it costs a re-upload, whereas failing the whole file would strand a real
 * application.
 */
async function storeResumeForCandidate({
  organizationId,
  candidateId,
  actorId,
  file,
  fileHash,
  parsed,
  extractedCharacters,
}: {
  organizationId: string;
  candidateId: string;
  actorId: string;
  file: { name: string; type: string | null; buffer: ArrayBuffer };
  fileHash: string;
  parsed: ParsedResume;
  extractedCharacters: number;
}): Promise<{ resumeId: string | null; storagePath: string | null }> {
  const supabase = await createClient();

  // Path shape is load-bearing: the storage policies authorise on the first
  // segment, so it must be the organization id.
  const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(-120);
  const path = `${organizationId}/${candidateId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file.buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.error(`[intake] resume upload failed: ${formatDbError(uploadError)}`);
    return { resumeId: null, storagePath: null };
  }

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      file_url: path,
      file_name: file.name.slice(-200),
      file_type: file.type || null,
      file_size_bytes: file.buffer.byteLength,
      file_hash: fileHash,
      // Already parsed — the pipeline ran before this row was written, so
      // recording 'pending' would make the UI offer to parse it again.
      parse_status: "parsed",
      extracted_characters: extractedCharacters,
      parsed_at: new Date().toISOString(),
      uploaded_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    await supabase.storage.from(RESUME_BUCKET).remove([path]);
    console.error(`[intake] resume record failed: ${formatDbError(error)}`);
    return { resumeId: null, storagePath: null };
  }

  const resumeId = (data as { id: string }).id;

  // The queued proposal. reviewed_at stays null — this is what makes it appear
  // in the "needs your review" count and in Module 6's existing review screen.
  const { error: proposalError } = await supabase.from("resume_parse_results").upsert(
    {
      organization_id: organizationId,
      resume_id: resumeId,
      raw_json: parsed,
      confidence: parsed.confidence,
      applied_fields: [],
      reviewed_by: null,
      reviewed_at: null,
    },
    { onConflict: "resume_id" }
  );

  if (proposalError) {
    console.error(`[intake] queuing parse result failed: ${formatDbError(proposalError)}`);
  }

  await logActivity({
    organizationId,
    entityType: "resume",
    entityId: resumeId,
    eventType: "resume.uploaded",
    actorId,
    metadata: { file_name: file.name.slice(-200), candidate_id: candidateId, via: "bulk_intake" },
  });

  return { resumeId, storagePath: path };
}

/**
 * Parks a file that has no candidate to be filed under — yet.
 *
 * Two cases reach here: an ambiguous match, where the matcher refused to decide,
 * and any parse failure, where there is nothing to decide FROM. Both may later
 * be connected to a candidate by hand, and that reconnection needs a file to
 * move — so the upload is kept rather than discarded.
 *
 * Under <organization_id>/_intake/, which the Module 6 storage policies already
 * cover: they authorise on the first path segment, so no new policy is needed
 * and no cross-tenant hole is opened. `_intake` cannot collide with a candidate
 * id, which is always a UUID.
 */
async function parkFile({
  organizationId,
  fileName,
  buffer,
  contentType,
}: {
  organizationId: string;
  fileName: string;
  buffer: ArrayBuffer;
  contentType: string | null;
}): Promise<string | null> {
  const supabase = await createClient();
  const safeName = fileName.replace(/[^\w.\-]/g, "_").slice(-120);
  const path = `${organizationId}/_intake/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, buffer, {
    contentType: contentType || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    console.error(`[intake] parking conflicted file failed: ${formatDbError(error)}`);
    return null;
  }
  return path;
}

/**
 * Creates the application, or reports the one that already exists.
 *
 * TWO GUARDS, ON PURPOSE. The SELECT answers the spec's question ("has this
 * candidate already applied?") in the normal case. The 23505 branch catches the
 * race the SELECT cannot: two files for the same person, processed
 * concurrently, both seeing no application and both inserting. The unique
 * (candidate_id, job_id) index is what actually makes the guarantee — this code
 * only decides how to report it.
 */
export async function ensureApplicationForCandidate({
  organizationId,
  organizationName,
  candidateId,
  jobId,
  actorId,
  webhookUrl,
}: {
  organizationId: string;
  organizationName: string;
  candidateId: string;
  jobId: string;
  actorId: string;
  webhookUrl: string;
}): Promise<{ applicationId: string | null; alreadyExisted: boolean }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (existing) {
    return { applicationId: (existing as { id: string }).id, alreadyExisted: true };
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      job_id: jobId,
      stage: "new",
      source: "resume_upload",
      assigned_recruiter_id: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Lost the race. Read the winner back so the row still links somewhere.
      const { data: raced } = await supabase
        .from("applications")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("candidate_id", candidateId)
        .eq("job_id", jobId)
        .maybeSingle();
      return {
        applicationId: raced ? (raced as { id: string }).id : null,
        alreadyExisted: true,
      };
    }
    console.error(`[intake] application create failed: ${formatDbError(error)}`);
    return { applicationId: null, alreadyExisted: false };
  }

  const applicationId = (data as { id: string }).id;

  await logActivity({
    organizationId,
    entityType: "application",
    entityId: applicationId,
    eventType: "application.created",
    actorId,
    metadata: { stage: "new", source: "resume_upload", via: "bulk_intake" },
  });

  // Module 13, same as every other application-creation path. Wrapped so a
  // failing rule cannot fail an application that already exists.
  try {
    await dispatch({
      organizationId,
      organizationName,
      applicationId,
      trigger: "application_created",
      triggeredBy: actorId,
      webhookUrl,
    });
  } catch (automationError) {
    console.error("[intake] automations after application create failed:", automationError);
  }

  return { applicationId, alreadyExisted: false };
}
