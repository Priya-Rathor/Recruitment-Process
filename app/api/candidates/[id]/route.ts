import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { parseCandidatePayload } from "@/lib/candidates/validation";
import { CANDIDATE_COLUMNS, getCandidate, getCandidateDuplicates } from "@/lib/candidates/queries";
import type { Candidate } from "@/lib/types";
import { logActivity } from "@/lib/activity/log";

/** GET /api/candidates/:id — any member may view. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const candidate = await getCandidate({
      organizationId: membership.organization.id,
      candidateId: id,
    });
    // Another organization's record is reported as not found — a guessed id
    // must never confirm that someone else's candidate exists.
    if (!candidate) return jsonError("Candidate not found.", 404);

    const duplicates = await getCandidateDuplicates({
      organizationId: membership.organization.id,
      candidateId: id,
    });

    return NextResponse.json({
      data: { ...candidate, duplicates },
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH /api/candidates/:id — partial update. Viewer denied. */
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

    const parsed = parseCandidatePayload(body, "update");
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("candidates")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select(CANDIDATE_COLUMNS)
      .maybeSingle();

    if (error) {
      // The candidates_contactable CHECK fires if an update would clear both
      // contact details; translate it rather than leaking the constraint name.
      if (error.message?.includes("candidates_contactable")) {
        return jsonError("A candidate needs an email address or a phone number.", 400);
      }
      console.error("[api] candidate update failed:", error);
      return jsonError("Could not update the candidate.", 400);
    }
    if (!data) return jsonError("Candidate not found.", 404);

    // Module 14. Field names only — the values are the candidate's personal
    // data, and the audit log must not become a permanent second copy of it.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "candidate",
      entityId: id,
      eventType: "candidate.updated",
      actorId: membership.user_id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json({ data: data as unknown as Candidate });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/candidates/:id — ARCHIVES the record.
 *
 * Never a hard delete: Applications (5), Screening (8) and Analytics (16) will
 * reference candidates, and destroying one would corrupt historical reporting.
 * True erasure of personal data is a separate, audited operation belonging to
 * the Privacy & Compliance retrofit, which must also clear resumes, call
 * transcripts and notes.
 *
 * Owner/Admin only — more consequential than editing.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("candidates")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .is("archived_at", null)
      .select("id, archived_at")
      .maybeSingle();

    if (error) {
      console.error("[api] candidate archive failed:", error);
      return jsonError("Could not archive the candidate.", 400);
    }
    if (!data) return jsonError("Candidate not found, or already archived.", 404);

    // Module 14.
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "candidate",
      entityId: id,
      eventType: "candidate.archived",
      actorId: membership.user_id,
      metadata: {},
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
