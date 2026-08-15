import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";

const MAX_NOTE_LENGTH = 5000;

/**
 * POST /api/applications/:id/notes — add a note to the timeline.
 *
 * author_id is taken from the session, never the payload: RLS additionally
 * requires `author_id = current_app_user_id()` on insert, so a note cannot be
 * attributed to someone else even by a direct PostgREST write.
 *
 * Viewer denied — notes are a record of work, not a read-only view.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const note = (body as Record<string, unknown> | null)?.note;
    if (typeof note !== "string" || note.trim().length === 0) {
      return jsonError("Write something before saving the note.", 400);
    }
    if (note.trim().length > MAX_NOTE_LENGTH) {
      return jsonError(`Notes must be ${MAX_NOTE_LENGTH} characters or fewer.`, 400);
    }

    const supabase = await createClient();

    // Confirm the application is in the caller's tenant before writing a child
    // row against it.
    const { data: application } = await supabase
      .from("applications")
      .select("id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!application) return jsonError("Application not found.", 404);

    const { data, error } = await supabase
      .from("application_notes")
      .insert({
        organization_id: membership.organization.id,
        application_id: id,
        author_id: user.id,
        note: note.trim(),
      })
      .select("id, note, created_at")
      .single();

    if (error) {
      console.error("[api] note create failed:", error);
      return jsonError("Could not save the note.", 400);
    }

    // Module 14. That a note was written, never its text. A recruiter's private
    // assessment of a candidate does not belong in a second, append-only table
    // that nobody can redact — the note itself is already stored and deletable.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: id,
      eventType: "application.note_added",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {},
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
