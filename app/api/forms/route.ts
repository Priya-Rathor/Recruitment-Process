import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";
import { logActivity } from "@/lib/activity/log";
import { listForms } from "@/lib/forms/queries";
import { isFormPurpose } from "@/lib/forms/types";

/**
 * GET /api/forms — every form in the organization.
 *
 * Viewable by every role including Viewer: a form's configuration is not
 * sensitive, and a hiring manager who cannot see what candidates were asked
 * cannot read their answers properly either.
 */
export async function GET() {
  try {
    const membership = await requireMembership();
    const forms = await listForms({ organizationId: membership.organization.id });

    return NextResponse.json({ data: forms, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/forms — create a standalone form. Owner/Admin/Recruiter.
 *
 * STANDALONE ONLY. A job's application form is created by POST /api/jobs (and
 * by /api/jobs/:id/application-form for a job that predates this module),
 * because it must be the one row the unique index allows and it arrives with
 * the default questions. Letting this route accept a job_id would be a second
 * way to make one, with different defaults.
 *
 * Starts with NO fields, unlike a job form: a pre-interview questionnaire has
 * no obvious default question, and a form pre-filled with somebody else's idea
 * of one is a form whose author has to delete things first.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const raw = (body ?? {}) as Record<string, unknown>;

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (name.length === 0) return jsonError("Give the form a name.", 400);
    if (name.length > 200) return jsonError("That name is too long.", 400);

    const description =
      typeof raw.description === "string" && raw.description.trim().length > 0
        ? raw.description.trim().slice(0, 2000)
        : null;

    // 'job_application' is refused here, not silently converted: a caller asking
    // for one wants a job link, and quietly making a general form instead would
    // look like it worked.
    const purpose = isFormPurpose(raw.purpose) ? raw.purpose : "general";
    if (purpose === "job_application") {
      return jsonError(
        "A job application form is created from the job itself, so it arrives with the standard questions.",
        400
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("forms")
      .insert({
        organization_id: membership.organization.id,
        name,
        description,
        purpose,
        job_id: null,
        status: "draft",
        created_by: membership.user_id,
      })
      .select("id, name, purpose, status")
      .single();

    if (error) {
      console.error(`[forms] create failed: ${formatDbError(error)}`);
      return jsonError("Could not create the form.", 400);
    }

    const form = data as { id: string; name: string; purpose: string; status: string };

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "form",
      entityId: form.id,
      eventType: "form.created",
      actorId: membership.user_id,
      metadata: { name: form.name, purpose: form.purpose },
    });

    return NextResponse.json({ data: form }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
