import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole, hasRole } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";
import { logActivity } from "@/lib/activity/log";
import { getFormDetail } from "@/lib/forms/queries";
import { buildApplyUrl, isFormTokenSigningConfigured, SIGNING_UNAVAILABLE_MESSAGE } from "@/lib/forms/token";
import { isFormStatus, type FormStatus } from "@/lib/forms/types";

/** GET /api/forms/:id — the form, its questions and its submission count. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const detail = await getFormDetail({ organizationId: membership.organization.id, formId: id });
    if (!detail) return jsonError("Form not found.", 404);

    const publicUrl =
      detail.form.status === "published"
        ? await buildApplyUrl({
            formId: detail.form.id,
            tokenVersion: detail.form.token_version,
            origin: request.nextUrl.origin,
          })
        : null;

    return NextResponse.json({ data: { ...detail, publicUrl }, caller_role: membership.role });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/forms/:id — rename, publish, disable, or regenerate the link.
 *
 * FOUR DIFFERENT ACTS BEHIND ONE VERB, and they do not carry the same weight:
 *
 *   name/description  — ordinary editing. Owner/Admin/Recruiter.
 *   status            — publishing puts a URL on the public internet.
 *                       Owner/Admin/Recruiter, and refused outright when the
 *                       server cannot sign a link.
 *   regenerate_link   — breaks every link and QR code already shared.
 *                       Owner/Admin only.
 *
 * Each role check is also a policy in migration 0033, because the browser holds
 * an authenticated PostgREST client: without the policy, a Viewer could publish
 * a form from a console and this handler would never see it.
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
    const raw = (body ?? {}) as Record<string, unknown>;

    const detail = await getFormDetail({ organizationId: membership.organization.id, formId: id });
    if (!detail) return jsonError("Form not found.", 404);

    const updates: Record<string, unknown> = {};

    if ("name" in raw) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (name.length === 0) return jsonError("Give the form a name.", 400);
      if (name.length > 200) return jsonError("That name is too long.", 400);
      updates.name = name;
    }

    if ("description" in raw) {
      updates.description =
        typeof raw.description === "string" && raw.description.trim().length > 0
          ? raw.description.trim().slice(0, 2000)
          : null;
    }

    let nextStatus: FormStatus | null = null;
    if ("status" in raw) {
      if (!isFormStatus(raw.status)) return jsonError("Unknown form status.", 400);
      nextStatus = raw.status;

      if (nextStatus === "published") {
        /*
          THREE THINGS MUST BE TRUE BEFORE A FORM GOES LIVE.
        */

        // 1. A link has to be signable. Without the key there is no token, and
        //    publishing would produce a page nobody can open.
        if (!isFormTokenSigningConfigured()) {
          return jsonError(SIGNING_UNAVAILABLE_MESSAGE, 503);
        }

        // 2. There has to be something to fill in. A published form with no
        //    questions is a page with a submit button and nothing above it.
        if (detail.fields.length === 0) {
          return jsonError("Add at least one question before publishing.", 422);
        }

        // 3. A job application form needs a LIVE job. An archived requisition
        //    is a closed role: its public page already refuses submissions, so
        //    publishing one would put a link on the internet that collects
        //    nothing, or worse, that somebody believes they applied through.
        if (detail.form.purpose === "job_application") {
          if (!detail.form.job_id) {
            return jsonError("This form is no longer linked to a job.", 422);
          }

          const supabaseCheck = await createClient();
          const { data: job } = await supabaseCheck
            .from("jobs")
            .select("archived_at")
            .eq("organization_id", membership.organization.id)
            .eq("id", detail.form.job_id)
            .maybeSingle();

          if (!job) return jsonError("This form's job no longer exists.", 422);
          if ((job as { archived_at: string | null }).archived_at) {
            return jsonError(
              "This job is archived, so its application form can't be published. Reopen the job first.",
              409
            );
          }
        }
      }

      updates.status = nextStatus;
    }

    let regenerated = false;
    if (raw.regenerate_link === true) {
      if (!hasRole(membership.role, ["owner", "admin"])) {
        return jsonError(
          "Only an Owner or Admin can regenerate a public link, because it breaks every link already shared.",
          403
        );
      }
      updates.token_version = detail.form.token_version + 1;
      regenerated = true;
    }

    if (Object.keys(updates).length === 0) return jsonError("Nothing to update.", 400);

    const supabase = await createClient();
    const { error } = await supabase
      .from("forms")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      console.error(`[forms] update failed: ${formatDbError(error)}`);
      return jsonError("Could not update the form.", 400);
    }

    // Audit: the two acts somebody will come looking for an explanation of.
    if (nextStatus === "published" || nextStatus === "disabled") {
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "form",
        entityId: id,
        eventType: nextStatus === "published" ? "form.published" : "form.disabled",
        actorId: membership.user_id,
        metadata: { name: detail.form.name, job_id: detail.form.job_id },
      });
    }

    if (regenerated) {
      await logActivity({
        organizationId: membership.organization.id,
        entityType: "form",
        entityId: id,
        eventType: "form.link_regenerated",
        actorId: membership.user_id,
        metadata: { name: detail.form.name, token_version: detail.form.token_version + 1 },
      });
    }

    const status = nextStatus ?? detail.form.status;
    const tokenVersion = regenerated ? detail.form.token_version + 1 : detail.form.token_version;

    const publicUrl =
      status === "published"
        ? await buildApplyUrl({ formId: id, tokenVersion, origin: request.nextUrl.origin })
        : null;

    return NextResponse.json({ data: { id, status, publicUrl } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/forms/:id — Owner/Admin only.
 *
 * DELETING A FORM DELETES ITS RESPONSES with it (ON DELETE CASCADE), which
 * destroys what applicants submitted. So it takes the same role as archiving a
 * job, it is refused for a job application form that has taken submissions —
 * disable that instead, which stops new ones without erasing the old — and the
 * count goes into the audit entry.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin"]);

    const detail = await getFormDetail({ organizationId: membership.organization.id, formId: id });
    if (!detail) return jsonError("Form not found.", 404);

    if (detail.submissionCount > 0) {
      return jsonError(
        `This form has ${detail.submissionCount} submitted ${
          detail.submissionCount === 1 ? "response" : "responses"
        }. Disable it instead — deleting it would erase what those people sent.`,
        409
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("forms")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    if (error) {
      console.error(`[forms] delete failed: ${formatDbError(error)}`);
      return jsonError("Could not delete the form.", 400);
    }

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "form",
      entityId: id,
      eventType: "form.deleted",
      actorId: membership.user_id,
      metadata: { name: detail.form.name, response_count: detail.submissionCount },
    });

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleRouteError(error);
  }
}
