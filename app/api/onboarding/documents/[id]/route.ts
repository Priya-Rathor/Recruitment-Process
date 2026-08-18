// =============================================================================
// One document — verify, reject, annotate, or delete a one-off.
//
// VERIFICATION IS OWNER/ADMIN ONLY. That is the spec's default and it is the
// point of the step: a recruiter who uploaded a file and then marked it verified
// has not had it reviewed. The rule is enforced three times over, deliberately —
// requireRole here for a readable 403, documentActions() for the buttons, and
// onboarding_documents_update_recruiter's WITH CHECK for the PostgREST path a
// route handler cannot see.
// =============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { getOnboardingDocument, ONBOARDING_BUCKET } from "@/lib/onboarding/queries";
import { formatDbError } from "@/lib/supabase/errors";

export const MAX_REJECTION_REASON = 500;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const raw = (body ?? {}) as Record<string, unknown>;

    const found = await getOnboardingDocument({
      organizationId: membership.organization.id,
      documentId: id,
    });
    if (!found) return jsonError("Document not found.", 404);

    const { document, record } = found;
    const isAdmin = hasRole(membership.role, ["owner", "admin"]);
    const canManage =
      isAdmin || record.assigned_to === null || record.assigned_to === membership.user_id;

    if (!canManage) {
      return jsonError("This hire's onboarding is assigned to someone else.", 403);
    }

    const actor = await requireCurrentUser();
    const updates: Record<string, unknown> = {};
    let event: "onboarding.document_verified" | "onboarding.document_rejected" | null = null;

    if ("status" in raw) {
      const next = raw.status;

      if (next === "verified") {
        if (!isAdmin) {
          return jsonError(
            "Only an Owner or Admin can verify a document. Ask one of them to review it.",
            403
          );
        }
        if (document.status === "pending") {
          return jsonError("There is nothing uploaded to verify yet.", 409);
        }

        updates.status = "verified";
        // Recorded, not just implied: the point of the step is that a NAMED
        // person looked at it.
        updates.verified_by = actor.id;
        updates.verified_at = new Date().toISOString();
        // A verified document is not still rejected. Leaving the old reason
        // behind would show "Verified" beside "we couldn't read the scan".
        updates.rejection_reason = null;
        event = "onboarding.document_verified";
      } else if (next === "rejected") {
        if (!isAdmin) {
          return jsonError("Only an Owner or Admin can reject a document.", 403);
        }
        if (document.status !== "uploaded") {
          return jsonError("Only an uploaded document can be rejected.", 409);
        }

        const reason = typeof raw.rejection_reason === "string" ? raw.rejection_reason.trim() : "";
        if (reason.length === 0) {
          // The spec requires a reason, and so does the CHECK constraint. Asked
          // for here so the message is useful rather than a database error.
          return jsonError("Say why it was rejected — whoever uploaded it will see this.", 400);
        }

        updates.status = "rejected";
        updates.rejection_reason = reason.slice(0, MAX_REJECTION_REASON);
        updates.verified_by = null;
        updates.verified_at = null;
        event = "onboarding.document_rejected";
      } else if (next === "pending") {
        // Un-verifying, or clearing a rejection back to nothing. Admin only:
        // undoing a review is itself a review decision.
        if (!isAdmin) return jsonError("Only an Owner or Admin can reset a document.", 403);

        updates.status = "pending";
        updates.verified_by = null;
        updates.verified_at = null;
        updates.rejection_reason = null;
        // The CHECK constraint allows a file only on a non-pending row, so the
        // stored object goes too. Removed AFTER the row updates, below.
        updates.file_url = null;
        updates.file_name = null;
        updates.file_type = null;
        updates.file_size_bytes = null;
        updates.uploaded_at = null;
        updates.uploaded_by = null;
      } else {
        return jsonError("A document can be set to pending, verified or rejected.", 400);
      }
    }

    if ("notes" in raw) {
      const notes = raw.notes;
      if (notes === null) updates.notes = null;
      else if (typeof notes === "string") updates.notes = notes.trim().slice(0, 2000) || null;
      else return jsonError("Notes must be text.", 400);
    }

    if (Object.keys(updates).length === 0) return jsonError("No valid fields provided.", 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("onboarding_documents")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select("id, status, verified_by, verified_at, rejection_reason, notes")
      .maybeSingle();

    if (error) {
      console.error(`[onboarding] document update failed: ${formatDbError(error)}`);
      return jsonError("Could not save that change.", 400);
    }
    if (!data) return jsonError("Document not found.", 404);

    // Only once the row is safely updated. Removing the object first would leave
    // a row pointing at a file that no longer exists if the update then failed.
    if (updates.file_url === null && document.file_url) {
      const { error: removeError } = await supabase.storage
        .from(ONBOARDING_BUCKET)
        .remove([document.file_url]);
      if (removeError) {
        // The row is correct; an orphaned object is untidy, not wrong. Logged so
        // it can be swept, never surfaced as a failed action.
        console.error(`[onboarding] orphaned object ${document.file_url}: ${formatDbError(removeError)}`);
      }
    }

    if (event) {
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "application",
        entityId: await applicationIdFor(membership.organization.id, record.id),
        eventType: event,
        actorId: actor.id,
        actorLabel: actor.name ?? actor.email,
        metadata: { onboarding_id: record.id, document_name: document.name },
      });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE — remove a one-off document.
 *
 * Owner/Admin, and only where template_id is null. RLS enforces the same thing;
 * this is the readable error. A template-generated row is the organization's
 * checklist, and removing one for a single hire would silently reduce what they
 * owe with no record that it happened.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    const found = await getOnboardingDocument({
      organizationId: membership.organization.id,
      documentId: id,
    });
    if (!found) return jsonError("Document not found.", 404);

    if (found.document.template_id !== null) {
      return jsonError(
        "This document comes from your organization's checklist. Remove it in Settings to " +
          "drop it from future hires — it stays on this one.",
        409
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("onboarding_documents")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      console.error(`[onboarding] document delete failed: ${formatDbError(error)}`);
      return jsonError("Could not remove that document.", 400);
    }

    if (found.document.file_url) {
      await supabase.storage.from(ONBOARDING_BUCKET).remove([found.document.file_url]);
    }

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** The application this record belongs to, for the activity entity id. */
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
