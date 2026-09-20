import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { validateAutoReplyConfig } from "@/lib/autoReply/config";
import {
  deleteJobOverride,
  getAutoReplySettings,
  saveAutoReplyConfig,
  setMasterEnabled,
} from "@/lib/autoReply/queries";
import { logActivity } from "@/lib/activity/log";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The auto-reply agent's configuration API.
 *
 * OWNER/ADMIN ONLY on every method, including the master switch — the spec's
 * §7, and enforced here as well as in the RLS policies on auto_reply_config and
 * organization_settings. A Recruiter can see the configuration (so the agent's
 * behaviour is explainable to the people living with it) and cannot change it.
 *
 * EVERY CHANGE THAT COULD START THE AGENT IS AUDITED. Switching it on is the act
 * that begins sending unattended messages to real people, and "who turned this
 * on, and when?" has to have an answer that is not somebody's memory. Turning it
 * OFF is audited too: it is the fact that explains a gap in the replies.
 */
export async function GET() {
  try {
    // Read is Owner/Admin here even though RLS allows a member to SELECT the
    // rows: this endpoint returns the whole settings view including the job
    // list, and the page behind it is an Owner/Admin page.
    const membership = await requireRole(["owner", "admin"]);
    const settings = await getAutoReplySettings(membership.organization.id);
    return NextResponse.json(settings);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT — save the organization default, or one job's override.
 *
 * One endpoint for both scopes, because they are one form with one field
 * different. `job_id: null` is the organization default; a uuid is that job's
 * override.
 */
export async function PUT(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const validated = validateAutoReplyConfig(raw);
    if (!validated.ok) return jsonError(validated.error, 422);

    const saved = await saveAutoReplyConfig({
      organizationId: membership.organization.id,
      userId: membership.user_id,
      input: validated.data,
    });

    if (!saved.ok) return jsonError(saved.error, 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "auto_reply.configured",
      actorId: user.id,
      metadata: {
        scope: validated.data.job_id === null ? "organization" : "job",
        job_id: validated.data.job_id,
        enabled: validated.data.enabled,
        response_timing: validated.data.response_timing,
        delay_minutes: validated.data.delay_minutes,
      },
    });

    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH — the master switch.
 *
 * Its own method rather than part of PUT, because it is reached from the inbox
 * rather than from the settings form and it is the one control that has to work
 * in one click when the agent has just said something wrong.
 */
export async function PATCH(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const payload = (raw ?? {}) as Record<string, unknown>;

    if (typeof payload.master_enabled !== "boolean") {
      return jsonError("master_enabled must be true or false.", 400);
    }

    const result = await setMasterEnabled({
      organizationId: membership.organization.id,
      enabled: payload.master_enabled,
    });

    if (!result.ok) return jsonError(result.error, 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "auto_reply.master_switched",
      actorId: user.id,
      metadata: { enabled: payload.master_enabled },
    });

    return NextResponse.json({ ok: true, master_enabled: payload.master_enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE — remove one job's override, so that job falls back to the default.
 *
 * The organization-wide row cannot be deleted: there is nothing beneath it, and
 * the switch plus the `enabled` toggle already express "off everywhere". The
 * query enforces that by refusing to match a row with a null job_id, so a
 * request naming it changes nothing rather than needing a prior read to reject.
 */
export async function DELETE(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    const configId = request.nextUrl.searchParams.get("id");
    if (!configId || !UUID_PATTERN.test(configId)) {
      return jsonError("Which override should be removed?", 400);
    }

    const result = await deleteJobOverride({
      organizationId: membership.organization.id,
      configId,
    });

    if (!result.ok) return jsonError(result.error, 400);

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "organization",
      entityId: membership.organization.id,
      eventType: "auto_reply.configured",
      actorId: user.id,
      metadata: { scope: "job", removed: true, config_id: configId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
