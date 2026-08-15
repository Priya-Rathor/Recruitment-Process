import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { getSlaConfig } from "@/lib/pipeline/queries";
import { editableSlaRows, parseSlaPayload } from "@/lib/pipeline/sla";
import { describeDbError } from "@/lib/supabase/errors";

/**
 * GET /api/pipeline/sla — current targets, with defaults filled in.
 *
 * Readable by every member: the board shows aging to everyone who can see it,
 * so everyone should be able to see what the yardstick is.
 */
export async function GET() {
  try {
    const membership = await requireMembership();
    const config = await getSlaConfig(membership.organization.id);

    return NextResponse.json({
      data: editableSlaRows(config),
      caller_role: membership.role,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT /api/pipeline/sla — update targets.
 *
 * Owner/Admin only. Moving an application through the pipeline is doing the
 * work; changing the yardstick everyone is measured against is a different act,
 * so Recruiters are excluded here even though they can move cards.
 *
 * NOTE FOR MODULE 17: this is the forward-stub editor. When /settings/pipeline
 * ships it must write to this same table — do not create a second one.
 */
export async function PUT(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const parsed = parseSlaPayload(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const supabase = await createClient();
    const rows = Object.entries(parsed.config).map(([stage, targetDays]) => ({
      organization_id: membership.organization.id,
      stage,
      target_days: targetDays,
    }));

    const { error } = await supabase
      .from("pipeline_sla_config")
      .upsert(rows, { onConflict: "organization_id,stage" });

    if (error) {
      console.error("[api] SLA update failed:", describeDbError(error));
      return jsonError("Could not save those targets.", 400);
    }

    const config = await getSlaConfig(membership.organization.id);
    return NextResponse.json({ data: editableSlaRows(config) });
  } catch (error) {
    return handleRouteError(error);
  }
}
