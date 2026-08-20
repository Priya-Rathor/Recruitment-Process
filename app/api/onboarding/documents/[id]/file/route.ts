// =============================================================================
// The file itself — upload, and a signed link to read it back.
//
// The bucket is PRIVATE and there is no public URL. Identity documents — a PAN
// card, an Aadhaar scan — are the most sensitive files this product stores, and a
// guessable public link to one is a data breach with no attacker required. Every
// read is a 60-second signed URL issued after the caller's tenancy is checked.
//
// WHO UPLOADS. Anyone who may manage the record, including for documents tagged
// Candidate. There is no candidate portal (see the module notes), so the
// recruiter uploads what arrived by email or WhatsApp. The Candidate tag stays on
// the row: it records whose responsibility the document is, which does not stop
// being true because somebody else did the filing.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireMembership, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { dispatch } from "@/lib/automations/engine";
import { notify } from "@/lib/notifications/notify";
import {
  createSignedDocumentUrl,
  getOnboardingDocument,
  ONBOARDING_BUCKET,
} from "@/lib/onboarding/queries";
import { formatDbError } from "@/lib/supabase/errors";

/** 10 MB, matching the bucket's own limit so the two cannot disagree. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Accepted types, matching the bucket's allowed_mime_types.
 *
 * Photos are first-class here, unlike resumes: a candidate photographs their PAN
 * card with a phone, and refusing a JPEG would mean every one of them had to be
 * converted by hand before it could be filed.
 */
const ACCEPTED = new Map<string, string[]>([
  ["application/pdf", [".pdf"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/png", [".png"]],
  ["image/heic", [".heic"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [".docx"]],
  ["application/msword", [".doc"]],
]);

function acceptable(file: File): boolean {
  if (ACCEPTED.has(file.type)) return true;
  // Browsers send an empty or wrong type often enough that extension is a
  // necessary fallback. The bucket's own allowed_mime_types is the real gate.
  const lower = file.name.toLowerCase();
  return [...ACCEPTED.values()].flat().some((extension) => lower.endsWith(extension));
}

/** GET — a short-lived signed URL, then redirect to it. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Any member, including a Viewer: read-only means they can read.
    const membership = await requireMembership();

    const found = await getOnboardingDocument({
      organizationId: membership.organization.id,
      documentId: id,
    });
    if (!found) return jsonError("Document not found.", 404);
    if (!found.document.file_url) return jsonError("Nothing has been uploaded yet.", 404);

    const signed = await createSignedDocumentUrl(found.document.file_url);
    if (!signed) {
      return jsonError(
        "That file could not be opened. It may have been removed from storage.",
        502
      );
    }

    return NextResponse.redirect(signed);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST — upload or replace the file on a document. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const found = await getOnboardingDocument({
      organizationId: membership.organization.id,
      documentId: id,
    });
    if (!found) return jsonError("Document not found.", 404);

    const { document, record } = found;
    const isAdmin = hasRole(membership.role, ["owner", "admin"]);

    if (!isAdmin && record.assigned_to !== null && record.assigned_to !== membership.user_id) {
      return jsonError("This hire's onboarding is assigned to someone else.", 403);
    }

    if (document.status === "verified") {
      // Replacing a checked document in place would undo the check with nobody
      // told. Reset it to pending first — an explicit, logged decision.
      return jsonError(
        "This document is already verified. Reset it to pending before replacing the file.",
        409
      );
    }

    if (record.status === "completed") {
      return jsonError(
        "This onboarding is marked complete. Reopen it before changing a document.",
        409
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Choose a file to upload.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Choose a file to upload.", 400);
    }
    if (file.size > MAX_FILE_BYTES) return jsonError("That file is larger than 10 MB.", 400);
    if (!acceptable(file)) {
      return jsonError("Upload a PDF, an image (JPG, PNG, HEIC), or a Word document.", 400);
    }

    const buffer = await file.arrayBuffer();
    const supabase = await createClient();

    // Path shape is load-bearing: the storage policies authorise on the first
    // segment, so a member of another org can neither read nor write here.
    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(-120);
    const path = `${membership.organization.id}/${record.id}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(ONBOARDING_BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error(`[onboarding] upload failed: ${formatDbError(uploadError)}`);
      return jsonError(
        "Could not store that file. If this keeps happening, check that the " +
          "onboarding-documents storage bucket exists.",
        400
      );
    }

    const actor = await requireCurrentUser();

    const { data, error } = await supabase
      .from("onboarding_documents")
      .update({
        status: "uploaded",
        file_url: path,
        file_name: file.name.slice(-200),
        file_type: file.type || null,
        file_size_bytes: file.size,
        uploaded_by: actor.id,
        uploaded_at: new Date().toISOString(),
        // A fresh upload is not still rejected, and it is not verified either.
        // Clearing the reason is why the row can go rejected -> uploaded without
        // showing "Uploaded" beside last week's complaint about the scan.
        rejection_reason: null,
        verified_by: null,
        verified_at: null,
      })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, status, file_name, uploaded_at")
      .maybeSingle();

    if (error || !data) {
      // Roll the object back so a failed update does not leave an orphan file.
      await supabase.storage.from(ONBOARDING_BUCKET).remove([path]);
      console.error(`[onboarding] document record failed: ${formatDbError(error)}`);
      return jsonError("Could not attach that file.", 400);
    }

    // The previous file, now unreferenced. Removed after the row is safely
    // pointing at the new one.
    if (document.file_url && document.file_url !== path) {
      await supabase.storage.from(ONBOARDING_BUCKET).remove([document.file_url]);
    }

    const applicationId = await applicationIdFor(membership.organization.id, record.id);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: applicationId,
      eventType: "onboarding.document_uploaded",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { onboarding_id: record.id, document_name: document.name },
    });

    // MODULE 15 — tell the assignee something is waiting for review.
    //
    // The spec asks for this on a CANDIDATE-owned document. Kept to that: a
    // recruiter filing the signed offer letter they produced themselves does not
    // need to be told they did it.
    //
    // And never to yourself. "You uploaded this" is not news, and it is the
    // fastest way to teach somebody to ignore the notification centre.
    if (
      document.expected_from === "candidate" &&
      record.assigned_to &&
      record.assigned_to !== actor.id
    ) {
      const { data: candidate } = await supabase
        .from("candidates")
        .select("name")
        .eq("organization_id", membership.organization.id)
        .eq("id", record.candidate_id)
        .maybeSingle();

      await notify({
        organizationId: membership.organization.id,
        userId: record.assigned_to,
        type: "onboarding_document_uploaded",
        values: {
          candidate_name: (candidate as { name: string } | null)?.name ?? null,
          document_name: document.name,
        },
        linkPath: `/hires/${record.id}#document-${id}`,
      });
    }

    /**
     * MODULE 13 — the `onboarding_document_uploaded` trigger.
     *
     * Dispatched for EVERY upload, not only candidate-owned ones. The
     * notification above is deliberately narrower (a recruiter filing their own
     * offer letter does not need telling), but a rule is written by an admin who
     * chose its conditions, and silently withholding events from it would make the
     * trigger mean something different from its name.
     *
     * Wrapped and awaited for the usual reason: a failing rule must never cost
     * somebody the document they just uploaded.
     */
    try {
      await dispatch({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        applicationId,
        trigger: "onboarding_document_uploaded",
        triggeredBy: actor.id,
        webhookUrl: `${request.nextUrl.origin}/api/webhooks/bolna`,
      });
    } catch (automationError) {
      console.error("[onboarding] automations after document upload failed:", automationError);
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function applicationIdFor(organizationId: string, recordId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("onboarding_records")
    .select("application_id")
    .eq("organization_id", organizationId)
    .eq("id", recordId)
    .maybeSingle();

  return (data as { application_id: string } | null)?.application_id ?? recordId;
}
