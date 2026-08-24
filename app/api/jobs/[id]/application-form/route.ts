import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { ensureJobApplicationForm } from "@/lib/forms/write";

/**
 * POST /api/jobs/:id/application-form — create the form for a job that has none.
 *
 * WHY THIS EXISTS SEPARATELY FROM POST /api/jobs.
 *
 * Every job created from now on gets its application form automatically. Two
 * kinds of job will not have one: those created before this module existed, and
 * the rare one whose auto-creation failed (that step is deliberately best-effort
 * so a form problem can never fail a job creation). Both show a card offering to
 * create it, and this is what that button calls.
 *
 * Idempotent: ensureJobApplicationForm returns the existing form's id if one
 * turned up in the meantime, so a double click cannot make two.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const supabase = await createClient();

    // Read the job through the session client, so a job in another organization
    // is simply not found rather than 403'd — the same shape every other job
    // route uses.
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, archived_at")
      .eq("organization_id", membership.organization.id)
      .eq("id", id)
      .maybeSingle();

    if (!job) return jsonError("Job not found.", 404);

    const row = job as { id: string; title: string; archived_at: string | null };
    if (row.archived_at) {
      return jsonError("This job is archived, so it can't take new applications.", 409);
    }

    const formId = await ensureJobApplicationForm({
      organizationId: membership.organization.id,
      jobId: row.id,
      jobTitle: row.title,
      actorId: membership.user_id,
      client: supabase,
    });

    if (!formId) return jsonError("Could not create the application form.", 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "form",
      entityId: formId,
      eventType: "form.created",
      actorId: membership.user_id,
      metadata: { name: row.title, purpose: "job_application", job_id: row.id },
    });

    return NextResponse.json({ data: { id: formId } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
