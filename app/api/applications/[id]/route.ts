import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { APPLICATION_COLUMNS, getApplicationDetail } from "@/lib/applications/queries";
import {
  canTransition,
  isApplicationStage,
  type ApplicationStage,
} from "@/lib/applications/stages";
import type { Application } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/applications/:id — with stage history and notes. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getApplicationDetail({
      organizationId: membership.organization.id,
      applicationId: id,
    });
    if (!detail) return jsonError("Application not found.", 404);

    return NextResponse.json({ data: detail, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/applications/:id — stage moves, recruiter assignment, match score.
 *
 * Stage history is NOT written here: a database trigger records the transition,
 * so it is captured even when the update arrives directly via PostgREST. This
 * handler only enforces the human-facing transition rules and gives a readable
 * error.
 */
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

    const payload = (body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("applications")
      .select("id, stage, assigned_recruiter_id")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!existing) return jsonError("Application not found.", 404);

    const current = existing as unknown as {
      stage: ApplicationStage;
      assigned_recruiter_id: string | null;
    };

    if ("stage" in payload) {
      if (!isApplicationStage(payload.stage)) return jsonError("Invalid stage.", 400);

      // Blocks reopening a finished application; a re-application is a new row.
      const transition = canTransition(current.stage, payload.stage);
      if (!transition.allowed) return jsonError(transition.reason, 409);

      updates.stage = payload.stage;
    }

    if ("assigned_recruiter_id" in payload) {
      const recruiterId = payload.assigned_recruiter_id;
      if (recruiterId === null) {
        updates.assigned_recruiter_id = null;
      } else if (typeof recruiterId === "string" && UUID_PATTERN.test(recruiterId)) {
        const { data: member } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", membership.organization.id)
          .eq("user_id", recruiterId)
          .eq("status", "active")
          .maybeSingle();
        if (!member) return jsonError("That recruiter is not a member of this team.", 400);
        updates.assigned_recruiter_id = recruiterId;
      } else {
        return jsonError("Invalid recruiter.", 400);
      }
    }

    // Accepted so Module 7 can write scores through the same endpoint. Bounded
    // here as well as by the database CHECK.
    if ("match_score" in payload) {
      const score = payload.match_score;
      if (score === null) {
        updates.match_score = null;
      } else {
        const numeric = typeof score === "number" ? score : Number(score);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
          return jsonError("Match score must be between 0 and 100.", 400);
        }
        updates.match_score = numeric;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("No valid fields provided.", 400);
    }

    const { data, error } = await supabase
      .from("applications")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .select(APPLICATION_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error("[api] application update failed:", error);
      return jsonError("Could not update the application.", 400);
    }
    if (!data) return jsonError("Application not found.", 404);

    return NextResponse.json({ data: data as unknown as Application });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/applications/:id — ARCHIVES.
 *
 * Never a hard delete: this is the row Modules 6-16 hang their data off, and
 * destroying one would orphan screening calls, interviews and analytics history.
 * Owner/Admin only.
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
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .is("archived_at", null)
      .select("id, archived_at")
      .maybeSingle();

    if (error) {
      console.error("[api] application archive failed:", error);
      return jsonError("Could not archive the application.", 400);
    }
    if (!data) return jsonError("Application not found, or already archived.", 404);

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
