import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { runCronSweep, runManualSweep } from "@/lib/automations/sweep";
import { resolveTimeZone } from "@/lib/time";
import { automationsEnabled } from "@/lib/organizations/automationSwitch";

// Sweeps every organization in the cron case, sequentially. Needs headroom.
export const maxDuration = 300;

/**
 * The scheduler. TWO CALLERS, TWO VERBS, ONE SHARED IMPLEMENTATION.
 *
 *   GET  — the cron. Authenticated by a shared secret; no session exists, so it
 *          sweeps every organization under the service-role client.
 *   POST — an Owner or Admin pressing "Run the scheduler now". Their session,
 *          their organization only, RLS applied normally.
 *
 * WHY THE VERBS ARE SPLIT. The scheduler issues a GET — GitHub Actions here
 * (.github/workflows/automation-sweep.yml), because the Vercel Hobby plan caps
 * crons at one a day; Vercel Cron issues a GET too, so nothing here changes if
 * the project moves to Pro. Accepting either verb on one
 * handler and guessing the caller from a header would mean an unauthenticated POST
 * could be mistaken for a cron, or a signed-in user's request treated as one —
 * and the difference between those two paths is "this organization" versus "every
 * organization". Not a distinction to infer.
 *
 * WHY THE BUTTON EXISTS AT ALL. Until a cron is configured this endpoint is the
 * only thing that runs time-based rules, and the Automations page says so in
 * words. That is the call /api/notifications/reminders already made: pretending
 * rules fire on a schedule when nothing is scheduled would be worse than an
 * honest button. It also lets an admin rehearse the cron's exact behaviour before
 * trusting a schedule with it.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;

    // No secret configured means the cron path is REFUSED, not open. An
    // unauthenticated endpoint that runs every organization's automations is not
    // something to leave enabled by default.
    if (!secret) {
      return jsonError(
        "Scheduled sweeps aren't configured on this deployment (CRON_SECRET is unset).",
        503
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
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
        // Summed here rather than in the caller, so the number in the log and the
        // number on the screen cannot disagree.
        runs_created: result.organizations.reduce((total, org) => total + org.runsCreated, 0),
        failures: result.organizations.filter((org) => org.error !== null).length,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST — the manual button. A person pressed it, on their own organization. */
export async function POST() {
  try {
    const [membership, user] = await Promise.all([
      // A Viewer cannot make the product act on candidates, and neither can a
      // Recruiter: this runs whatever rules an Admin activated, at a moment of the
      // presser's choosing, which is an Owner/Admin decision.
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
