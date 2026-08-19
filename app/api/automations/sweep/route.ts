import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { runCronSweep, runManualSweep } from "@/lib/automations/sweep";
import { resolveTimeZone } from "@/lib/time";
import { automationsEnabled } from "@/lib/organizations/automationSwitch";

// Sweeps every organization in the cron case, sequentially. Needs headroom.
export const maxDuration = 300;

/**
 * POST /api/automations/sweep — run the scheduler.
 *
 * TWO CALLERS, ONE SHARED IMPLEMENTATION.
 *
 *   - THE CRON, authenticated by a shared secret in the Authorization header.
 *     No session exists, so it sweeps every organization under the service-role
 *     client.
 *   - AN OWNER OR ADMIN pressing "Run the scheduler now", authenticated by their
 *     session. Sweeps their own organization only, under their own client, so
 *     RLS applies normally.
 *
 * WHY BOTH. Until a cron is configured this endpoint is the only thing that runs
 * time-based rules, and a button is honest about that in a way a rule that
 * silently never fires is not — the same call
 * /api/notifications/reminders already made. The button also lets an admin prove
 * the behaviour before trusting a schedule with it.
 *
 * THE SECRET IS COMPARED, NOT PARSED. A missing CRON_SECRET means the cron path
 * is REFUSED rather than open: an unauthenticated endpoint that runs every
 * organization's automations is not something to leave on by default.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const presented = request.headers.get("authorization");

    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
    const looksLikeCron = presented !== null;

    if (looksLikeCron) {
      if (!secret) {
        return jsonError(
          "Scheduled sweeps aren't configured on this deployment (CRON_SECRET is unset).",
          503
        );
      }
      if (presented !== `Bearer ${secret}`) {
        // Deliberately vague. A precise message here helps whoever is guessing.
        return jsonError("Not authorized.", 401);
      }

      const result = await runCronSweep();

      if (!result.configured) {
        return jsonError(
          "The scheduler can't run: no Supabase service-role key is configured, so it has no way to read data without a signed-in user.",
          503
        );
      }

      return NextResponse.json({
        data: {
          source: "cron",
          organizations: result.organizations,
          organizations_truncated: result.truncated,
          // Summed here rather than in the UI so the number the log shows and the
          // number the screen shows cannot disagree.
          runs_created: result.organizations.reduce((total, org) => total + org.runsCreated, 0),
        },
      });
    }

    // ---- The manual path. A person pressed a button. --------------------------
    const [membership, user] = await Promise.all([
      // A Viewer cannot make the product act on candidates, and a Recruiter
      // cannot either: this runs whatever rules an Admin activated, at a moment
      // of the presser's choosing, which is an Owner/Admin decision.
      requireRole(["owner", "admin"]),
      requireCurrentUser(),
    ]);

    if (!automationsEnabled(membership.organization)) {
      return jsonError(
        "Automations are switched off for this organization, so the scheduler did nothing.",
        409
      );
    }

    // The ORGANIZATION's timezone, which every membership lookup already carries.
    // Not the user's display timezone — a daily cap and a "days in stage"
    // threshold must mean the same thing whoever is looking at them.
    const result = await runManualSweep({
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      timeZone: resolveTimeZone(membership.organization.timezone),
      triggeredBy: user.id,
    });

    return NextResponse.json({ data: { source: "manual", ...result } });
  } catch (error) {
    return handleRouteError(error);
  }
}
