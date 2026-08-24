import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { logActivity } from "@/lib/activity/log";
import { getFormDetail } from "@/lib/forms/queries";
import { parseFieldDefinitions } from "@/lib/forms/validation";
import { replaceFormFields } from "@/lib/forms/write";

/**
 * PUT /api/forms/:id/fields — save the whole question list.
 *
 * WHOLE-LIST, because order is part of the configuration and the recruiter edits
 * the form as one thing with one Save. Per-field PATCHes would make reordering
 * a sequence of writes that can half-apply.
 *
 * The SAVE ITSELF IS A DIFF (see replaceFormFields): answers are keyed on
 * field_key, so re-inserting the same questions would be a good way to orphan
 * every answer already collected.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Validated against the form's PURPOSE, which is read from our own row —
    // a job application form has rules a general one does not.
    const parsed = parseFieldDefinitions(raw.fields, { purpose: detail.form.purpose });
    if (!parsed.ok) return jsonError(parsed.error, 422);

    const supabase = await createClient();
    const result = await replaceFormFields({
      client: supabase,
      organizationId: membership.organization.id,
      formId: id,
      fields: parsed.fields,
    });

    if (!result.ok) return jsonError(result.error, 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "form",
      entityId: id,
      eventType: "form.fields_updated",
      actorId: membership.user_id,
      metadata: { name: detail.form.name, field_count: parsed.fields.length },
    });

    return NextResponse.json({ data: { id, field_count: parsed.fields.length } });
  } catch (error) {
    return handleRouteError(error);
  }
}
