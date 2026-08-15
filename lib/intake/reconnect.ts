// =============================================================================
// Manual "connect to existing candidate" — correcting an automatic match.
//
// This is the only destructive path in the intake feature: it can delete a
// candidate and an application that were created seconds earlier. Three rules
// keep that safe, and each is enforced in code rather than trusted:
//
//   1. RE-POINT BEFORE REMOVING. The resume moves to the correct candidate
//      first. candidates.resume_id is ON DELETE CASCADE, so deleting first
//      would take the recruiter's uploaded file with it. Migration 0019 adds a
//      trigger that refuses such a delete outright, so getting the order wrong
//      is a loud error rather than a silent loss.
//
//   2. ONLY DELETE WHAT WE CREATED. An application is removed only when THIS
//      flow created it. If the file's outcome was 'already_applied' the
//      application pre-dates the upload — it carries stage history, notes and
//      interviews, and deleting it would destroy a real pipeline.
//
//   3. ONLY DELETE A PRISTINE CANDIDATE. The auto-created record is hard
//      deleted only when nothing else has attached to it in the meantime.
//      Otherwise it is archived, and the difference is recorded in
//      cleanup_action so the outcome is never a guess after the fact.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { buildFieldComparisons } from "@/lib/resumes/review";
import { RESUME_BUCKET } from "@/lib/resumes/queries";
import { logActivity } from "@/lib/activity/log";
import { ensureApplicationForCandidate } from "@/lib/intake/process";
import type { IntakeStatus } from "@/lib/intake/status";
import type { ParsedResume } from "@/lib/ai/parseResume";
import type { Candidate } from "@/lib/types";
import { describeDbError } from "@/lib/supabase/errors";

export type CleanupAction = "deleted" | "archived" | "kept";

// =============================================================================
// THE TWO DESTRUCTIVE DECISIONS, extracted so they can be tested without a
// database. Everything else in this file is plumbing; these two decide whether
// a row is destroyed, and getting either wrong loses a recruiter's work.
// =============================================================================

/**
 * Whether the application currently on this item was created by THIS flow, and
 * may therefore be removed when the file is re-pointed at someone else.
 *
 * 'already_applied' is the case that matters. There the application pre-dates
 * the upload entirely — it carries stage history, notes, interviews and
 * possibly an offer — and the intake row merely reported that it existed.
 * Deleting it because a resume was filed against the wrong person would destroy
 * a real pipeline the upload never touched.
 *
 * `autoStatus` is checked as well as `status`, so a SECOND reconnection of an
 * already-applied file still refuses: by then `status` reads
 * 'manually_connected' and only the original decision remembers the truth.
 */
export function shouldRemoveApplication({
  status,
  autoStatus,
  applicationId,
}: {
  status: IntakeStatus;
  autoStatus: IntakeStatus | null;
  applicationId: string | null;
}): boolean {
  if (!applicationId) return false;
  if (status === "already_applied" || autoStatus === "already_applied") return false;
  return true;
}

/**
 * What to do with the candidate automatic matching created.
 *
 * HARD DELETE vs ARCHIVE. Deleting wins when the record is provably untouched,
 * because archiving does not actually solve the problem the spec names: intake
 * matching deliberately includes archived candidates (re-creating someone
 * archived last month would be a duplicate in every sense that matters), so an
 * archived orphan would keep colliding with the real person on every future
 * upload — turning one bad match into a permanent conflict.
 *
 * "Provably untouched" is counted AFTER the resume and application have been
 * moved away: no resumes, no applications, no other intake item pointing at it.
 * Anything else means something attached to this record in the seconds since it
 * was created, and destroying it would destroy that too.
 */
export function cleanupDecision({
  createdByIntake,
  remainingResumes,
  remainingApplications,
  otherIntakeItems,
}: {
  createdByIntake: boolean;
  remainingResumes: number;
  remainingApplications: number;
  otherIntakeItems: number;
}): CleanupAction {
  // The auto-match found a real, pre-existing person, or created nobody at all.
  // Not ours to remove under any circumstances.
  if (!createdByIntake) return "kept";

  const pristine =
    remainingResumes === 0 && remainingApplications === 0 && otherIntakeItems === 0;

  return pristine ? "deleted" : "archived";
}

export type ReconnectResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      candidateId: string;
      candidateName: string | null;
      applicationId: string | null;
      resumeId: string | null;
      queuedConflictCount: number;
      cleanupAction: CleanupAction;
      /** Named so the UI can say what happened to the record it removed. */
      removedCandidateName: string | null;
    };

export type IntakeItemRow = {
  id: string;
  job_id: string;
  status: IntakeStatus;
  candidate_id: string | null;
  application_id: string | null;
  resume_id: string | null;
  storage_path: string | null;
  parsed_json: ParsedResume | null;
  file_name: string;
  file_size_bytes: number | null;
  file_hash: string | null;
  auto_candidate_id: string | null;
  auto_status: IntakeStatus | null;
};

/**
 * Points one intake item at a candidate the recruiter chose.
 *
 * Works from ANY prior state — a wrongly created candidate, a wrongly matched
 * one, an ambiguous conflict the matcher refused to decide, an already-applied
 * row, a parse failure, or a previous manual connection. The spec is explicit
 * that this must not be restricted to the conflict case.
 */
export async function reconnectIntakeItem({
  organizationId,
  organizationName,
  item,
  targetCandidateId,
  actorId,
  actorLabel,
  webhookUrl,
}: {
  organizationId: string;
  organizationName: string;
  item: IntakeItemRow;
  targetCandidateId: string;
  actorId: string;
  actorLabel: string;
  webhookUrl: string;
}): Promise<ReconnectResult> {
  const supabase = await createClient();

  const { data: targetRow } = await supabase
    .from("candidates")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", targetCandidateId)
    .maybeSingle();

  if (!targetRow) return { ok: false, error: "That candidate could not be found.", status: 404 };
  const target = targetRow as unknown as Candidate;

  const previousCandidateId = item.candidate_id;

  if (previousCandidateId === targetCandidateId) {
    return {
      ok: false,
      error: `This resume is already connected to ${target.name}.`,
      status: 409,
    };
  }

  // The parsed output. Normally it lives on the resume's parse result; for a
  // match conflict, where no resume row was ever created, it is on the item.
  const parsed = await loadParsedOutput({ organizationId, item });

  // --- 1. Move the resume onto the correct candidate -------------------------
  const resume = await repointResume({
    organizationId,
    item,
    targetCandidateId,
    actorId,
    parsed,
  });

  // --- 2. Remove the application we created against the wrong candidate ------
  //
  // Only ours. 'already_applied' means the application existed before this
  // upload and belongs to someone else's work.
  const weCreatedTheApplication = shouldRemoveApplication({
    status: item.status,
    autoStatus: item.auto_status,
    applicationId: item.application_id,
  });

  if (weCreatedTheApplication && item.application_id) {
    const { error } = await supabase
      .from("applications")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", item.application_id);

    if (error) {
      console.error("[intake] removing the wrong application failed:", describeDbError(error));
      return {
        ok: false,
        error: "Could not remove the application created against the wrong candidate.",
        status: 400,
      };
    }

    await logActivity({
      organizationId,
      entityType: "application",
      entityId: item.application_id,
      eventType: "application.created",
      actorId,
      actorLabel,
      metadata: {
        reverted: true,
        reason: "manual_reconnect",
        candidate_id: previousCandidateId,
        intake_item_id: item.id,
      },
    });
  }

  // --- 3. Clean up an auto-created orphan ------------------------------------
  const cleanup = await cleanUpAutoCandidate({
    organizationId,
    item,
    previousCandidateId,
    actorId,
    actorLabel,
  });

  // --- 4. Queue the profile comparison, exactly as a normal match would ------
  const queuedConflictCount =
    parsed && resume.resumeId
      ? await queueProposal({
          organizationId,
          resumeId: resume.resumeId,
          candidate: target,
          parsed,
        })
      : 0;

  // --- 5. Application for the correct candidate ------------------------------
  const application = await ensureApplicationForCandidate({
    organizationId,
    organizationName,
    candidateId: targetCandidateId,
    jobId: item.job_id,
    actorId,
    webhookUrl,
  });

  // --- 6. Record the correction ---------------------------------------------
  const { error: updateError } = await supabase
    .from("resume_intake_items")
    .update({
      status: "manually_connected",
      candidate_id: targetCandidateId,
      application_id: application.applicationId,
      resume_id: resume.resumeId,
      queued_conflict_count: queuedConflictCount,
      // Resolved: the file is no longer ambiguous and no longer failed.
      conflict_candidate_ids: [],
      parsed_json: null,
      storage_path: resume.storagePath,
      error_message: null,
      // Only stamp the ORIGINAL automatic decision, so a second correction does
      // not overwrite the record of what the matcher actually did.
      auto_candidate_id: item.auto_candidate_id ?? previousCandidateId,
      auto_status: item.auto_status ?? item.status,
      cleanup_action: cleanup.action,
      reconnected_at: new Date().toISOString(),
      reconnected_by: actorId,
    })
    .eq("organization_id", organizationId)
    .eq("id", item.id);

  if (updateError) {
    console.error("[intake] recording the reconnection failed:", describeDbError(updateError));
    return { ok: false, error: "Could not record the reconnection.", status: 400 };
  }

  await logActivity({
    organizationId,
    entityType: "candidate",
    entityId: targetCandidateId,
    eventType: "candidate.updated",
    actorId,
    actorLabel,
    metadata: {
      action: "resume_manually_connected",
      file_name: item.file_name,
      from_candidate_id: previousCandidateId,
      from_status: item.status,
      cleanup: cleanup.action,
      job_id: item.job_id,
    },
  });

  return {
    ok: true,
    candidateId: targetCandidateId,
    candidateName: target.name,
    applicationId: application.applicationId,
    resumeId: resume.resumeId,
    queuedConflictCount,
    cleanupAction: cleanup.action,
    removedCandidateName: cleanup.removedName,
  };
}

// =============================================================================
// Steps
// =============================================================================

/** The AI's output, from wherever this item happens to keep it. */
async function loadParsedOutput({
  organizationId,
  item,
}: {
  organizationId: string;
  item: IntakeItemRow;
}): Promise<ParsedResume | null> {
  if (item.parsed_json) return item.parsed_json;
  if (!item.resume_id) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("resume_parse_results")
    .select("raw_json")
    .eq("organization_id", organizationId)
    .eq("resume_id", item.resume_id)
    .maybeSingle();

  return data ? ((data as { raw_json: ParsedResume }).raw_json ?? null) : null;
}

/**
 * Moves the uploaded file and its `resumes` row onto the correct candidate.
 *
 * Two starting points. Usually there is a resume row to re-point. For a match
 * conflict there is none — the file was parked under <org>/_intake/ precisely
 * because there was no candidate to file it under — so one is created here,
 * which is the moment that file finally becomes part of someone's history.
 *
 * The storage object is MOVED rather than left where it was. The path's first
 * segment is what RLS authorises on and that does not change, so a stale path
 * would still be readable — but a file sitting under the wrong candidate's
 * folder is a trap for anyone reading storage directly later.
 */
async function repointResume({
  organizationId,
  item,
  targetCandidateId,
  actorId,
  parsed,
}: {
  organizationId: string;
  item: IntakeItemRow;
  targetCandidateId: string;
  actorId: string;
  parsed: ParsedResume | null;
}): Promise<{ resumeId: string | null; storagePath: string | null }> {
  const supabase = await createClient();

  const { data: existing } = item.resume_id
    ? await supabase
        .from("resumes")
        .select("id, file_url, file_name, file_type, file_size_bytes, file_hash, extracted_characters")
        .eq("organization_id", organizationId)
        .eq("id", item.resume_id)
        .maybeSingle()
    : { data: null };

  const currentPath =
    (existing as { file_url?: string } | null)?.file_url ?? item.storage_path ?? null;

  if (!currentPath) return { resumeId: null, storagePath: null };

  const baseName = currentPath.split("/").pop() ?? item.file_name;
  const nextPath = `${organizationId}/${targetCandidateId}/${baseName}`;

  if (nextPath !== currentPath) {
    const { error: moveError } = await supabase.storage
      .from(RESUME_BUCKET)
      .move(currentPath, nextPath);

    if (moveError) {
      // Not fatal. The row is what the product reads; a file left at the old
      // path is still readable and still the right tenant's. Failing the whole
      // reconnection over a rename would be worse than a tidy-up debt.
      console.error("[intake] moving the resume object failed:", describeDbError(moveError));
    }
  }

  const movedPath = nextPath;

  if (existing) {
    const row = existing as { id: string };
    const { error } = await supabase
      .from("resumes")
      .update({ candidate_id: targetCandidateId, file_url: movedPath })
      .eq("organization_id", organizationId)
      .eq("id", row.id);

    if (error) {
      console.error("[intake] re-pointing the resume failed:", describeDbError(error));
      return { resumeId: row.id, storagePath: currentPath };
    }
    return { resumeId: row.id, storagePath: movedPath };
  }

  // No resume row yet — the match-conflict case.
  const { data, error } = await supabase
    .from("resumes")
    .insert({
      organization_id: organizationId,
      candidate_id: targetCandidateId,
      file_url: movedPath,
      file_name: item.file_name,
      file_size_bytes: item.file_size_bytes,
      file_hash: item.file_hash,
      parse_status: parsed ? "parsed" : "pending",
      parsed_at: parsed ? new Date().toISOString() : null,
      uploaded_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[intake] creating the resume row failed:", describeDbError(error));
    return { resumeId: null, storagePath: movedPath };
  }

  return { resumeId: (data as { id: string }).id, storagePath: movedPath };
}

/**
 * Writes the field comparison as an UNREVIEWED proposal, and returns the count
 * of genuine disagreements.
 *
 * Identical to what automatic matching does — a manual connection is not a
 * licence to overwrite a profile any more than an automatic one is.
 */
async function queueProposal({
  organizationId,
  resumeId,
  candidate,
  parsed,
}: {
  organizationId: string;
  resumeId: string;
  candidate: Candidate;
  parsed: ParsedResume;
}): Promise<number> {
  const supabase = await createClient();

  const { error } = await supabase.from("resume_parse_results").upsert(
    {
      organization_id: organizationId,
      resume_id: resumeId,
      raw_json: parsed,
      confidence: parsed.confidence,
      applied_fields: [],
      reviewed_by: null,
      // Reset: the previous comparison was against a different person, so any
      // review of it says nothing about this candidate.
      reviewed_at: null,
    },
    { onConflict: "resume_id" }
  );

  if (error) console.error("[intake] queuing the proposal failed:", describeDbError(error));

  return buildFieldComparisons(candidate, parsed).filter(
    (comparison) => comparison.status === "conflict"
  ).length;
}

/**
 * Removes the candidate automatic matching created, when it created one.
 *
 * HARD DELETE vs ARCHIVE. Deleting wins when the record is provably untouched,
 * because archiving does not actually solve the problem the spec names: intake
 * matching deliberately includes archived candidates (re-creating someone
 * archived last month would be a duplicate in every sense that matters), so an
 * archived orphan would keep colliding with the real person on every future
 * upload — turning one bad match into a permanent conflict.
 *
 * "Provably untouched" means, after the resume and application have been moved
 * away: no resumes, no applications, and no other intake item pointing at it.
 * Anything else means something happened to this record in the seconds since it
 * was created, and destroying it would destroy that too — so it is archived and
 * the difference is recorded.
 */
async function cleanUpAutoCandidate({
  organizationId,
  item,
  previousCandidateId,
  actorId,
  actorLabel,
}: {
  organizationId: string;
  item: IntakeItemRow;
  previousCandidateId: string | null;
  actorId: string;
  actorLabel: string;
}): Promise<{ action: CleanupAction; removedName: string | null }> {
  const createdByIntake =
    item.status === "candidate_created" || item.auto_status === "candidate_created";

  if (!createdByIntake || !previousCandidateId) return { action: "kept", removedName: null };

  const supabase = await createClient();

  const { data: orphanRow } = await supabase
    .from("candidates")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("id", previousCandidateId)
    .maybeSingle();

  if (!orphanRow) return { action: "kept", removedName: null };
  const orphan = orphanRow as { id: string; name: string | null };

  const [resumes, applications, otherItems] = await Promise.all([
    supabase
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("candidate_id", previousCandidateId),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("candidate_id", previousCandidateId),
    supabase
      .from("resume_intake_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("candidate_id", previousCandidateId)
      .neq("id", item.id),
  ]);

  // A null count means the query failed to report one. Treated as 1 — "assume
  // something is attached" — so an unreadable count archives rather than
  // deletes. The safe direction when the alternative is destroying a row.
  const action = cleanupDecision({
    createdByIntake: true,
    remainingResumes: resumes.count ?? 1,
    remainingApplications: applications.count ?? 1,
    otherIntakeItems: otherItems.count ?? 1,
  });

  // Logged BEFORE the delete: activity_events has no foreign key to candidates,
  // so the event outlives the row — but only if it is written while the id is
  // still meaningful to anyone reading the two together.
  await logActivity({
    organizationId,
    entityType: "candidate",
    entityId: previousCandidateId,
    eventType: "candidate.archived",
    actorId,
    actorLabel,
    metadata: {
      reason: "manual_reconnect_cleanup",
      name: orphan.name,
      hard_deleted: action === "deleted",
      intake_item_id: item.id,
    },
  });

  if (action === "deleted") {
    const { error } = await supabase
      .from("candidates")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", previousCandidateId);

    if (!error) return { action: "deleted", removedName: orphan.name };

    // The 0019 trigger refuses a delete that would cascade to a resume. Falling
    // through to archive is the right response: something is still attached,
    // which is exactly the case archiving exists for.
    console.error("[intake] deleting the orphan failed, archiving instead:", describeDbError(error));
  }

  const { error: archiveError } = await supabase
    .from("candidates")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", previousCandidateId);

  if (archiveError) {
    console.error("[intake] archiving the orphan failed:", describeDbError(archiveError));
    return { action: "kept", removedName: orphan.name };
  }

  return { action: "archived", removedName: orphan.name };
}
