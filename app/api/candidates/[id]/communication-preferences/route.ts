import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * PUT /api/candidates/:id/communication-preferences — record or lift an opt-out.
 *
 * Owner/Admin/Recruiter. A candidate saying "please stop emailing me" on a phone
 * call is the common case, and the recruiter on that call is who hears it — so
 * this is not an admin-only setting. A Viewer cannot touch it in either direction:
 * LIFTING somebody's opt-out is the more dangerous half of this permission, and it
 * is the same endpoint.
 *
 * PUT rather than PATCH: both flags are always sent together. A partial update
 * would make "clear the email opt-out" and "leave the email opt-out alone"
 * indistinguishable from an omitted field, and getting that wrong starts emailing
 * somebody who asked us not to.
 *
 * opted_out_at is NOT accepted from the caller — a trigger stamps it. It is the
 * evidence that a candidate asked not to be contacted, and a timestamp a client
 * supplies is a timestamp a client can get wrong.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (raw ?? {}) as Record<string, unknown>;

    if (typeof payload.email_opted_out !== "boolean") {
      return jsonError("email_opted_out must be true or false.", 400);
    }
    if (typeof payload.whatsapp_opted_out !== "boolean") {
      return jsonError("whatsapp_opted_out must be true or false.", 400);
    }

    const emailOptedOut = payload.email_opted_out;
    const whatsappOptedOut = payload.whatsapp_opted_out;

    const reason =
      typeof payload.opted_out_reason === "string" && payload.opted_out_reason.trim().length > 0
        ? payload.opted_out_reason.trim().slice(0, 500)
        : null;

    const supabase = await createClient();

    // Existence is checked against OUR organization, so another tenant's
    // candidate id resolves to 404 rather than writing a row.
    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, name")
      .eq("id", id)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    if (!candidate) return jsonError("Candidate not found.", 404);

    const { data, error } = await supabase
      .from("candidate_communication_preferences")
      .upsert(
        {
          candidate_id: id,
          organization_id: membership.organization.id,
          email_opted_out: emailOptedOut,
          whatsapp_opted_out: whatsappOptedOut,
          opted_out_reason: reason,
        },
        { onConflict: "candidate_id" }
      )
      .select("candidate_id, email_opted_out, whatsapp_opted_out, opted_out_at, opted_out_reason")
      .maybeSingle();

    if (error) {
      console.error(`[api] opt-out write failed: ${formatDbError(error)}`);
      return jsonError("Could not save that preference.", 400);
    }

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "candidate",
      entityId: id,
      eventType: "candidate.communication_preference_changed",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        opted_out_of: [
          emailOptedOut ? "email" : null,
          whatsappOptedOut ? "whatsapp" : null,
        ].filter(Boolean),
        // Distinguishes a recruiter recording what they were told from the
        // candidate clicking unsubscribe themselves — the same fact, but a
        // different provenance, and only one of them is the candidate's own act.
        source: "recruiter",
      },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
