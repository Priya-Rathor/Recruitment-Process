import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import {
  sendClientFeedbackReminders,
  sendFeedbackReminders,
  sendInterviewReminders,
} from "@/lib/notifications/reminders";
import { sendOnboardingDocumentReminders } from "@/lib/onboarding/reminders";
import { isAgencyMode } from "@/lib/organizations/hiringModel";

// Fans out over every outstanding interview and client.
export const maxDuration = 60;

/**
 * POST /api/notifications/reminders — dispatch overdue reminders.
 *
 * THIS EXISTS BECAUSE THERE IS NO SCHEDULER. The product has no cron, queue, or
 * background worker, so somebody has to ask. A button is honest about that;
 * pretending reminders go out at 9am when nothing runs at 9am would not be.
 *
 * Owner/Admin/Recruiter. A Viewer cannot make the product send messages to
 * colleagues — read-only means read-only.
 *
 * Safe to call repeatedly: every reminder is deduped against the last 24 hours
 * before anything is sent, so a double click sends nothing twice.
 */
export async function POST(request: NextRequest) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    // Sequential. Both walk the same notifications table for their dedupe
    // check, and running them together would let each miss what the other just
    // wrote.
    const feedback = await sendFeedbackReminders(membership.organization.id);

    /**
     * Client chases only apply to an agency. Skipped rather than left to come
     * back empty: an organization that switched to in-house KEEPS its old
     * client rows (nothing is deleted), so the sweep would still find overdue
     * submissions and send an account manager a notification linking to
     * /clients/:id — a page that now redirects them to the dashboard.
     *
     * Reported as `skipped`, not as a plain zero. "We did not run this" and
     * "we ran it and there was nothing" are different answers.
     */
    const agencyMode = isAgencyMode(membership.organization);
    const clients = agencyMode
      ? { ...(await sendClientFeedbackReminders(membership.organization.id)), skipped: false }
      : { sent: 0, suppressed: 0, failed: false, skipped: true };
    // Module 19. Same dispatcher rather than a second button: a user should not
    // have to know which module a reminder belongs to in order to send it.
    const onboarding = await sendOnboardingDocumentReminders(membership.organization.id);

    /**
     * MODULE 15 — the candidate-facing interview reminder. Same dispatcher, for
     * the same reason Module 19's document reminders share it: a user should not
     * have to know which module a reminder belongs to in order to send it.
     *
     * The only candidate-facing reminder in here. It goes through
     * lib/communications/send.ts rather than notify(), so the opt-out, the
     * unsubscribe footer and the message log all apply.
     */
    const interviews = await sendInterviewReminders({
      organizationId: membership.organization.id,
      origin: request.nextUrl.origin,
    });

    const failed = feedback.failed || clients.failed || onboarding.failed || interviews.failed;

    return NextResponse.json({
      data: {
        sent: feedback.sent + clients.sent + onboarding.sent + interviews.sent,
        suppressed:
          feedback.suppressed + clients.suppressed + onboarding.suppressed + interviews.suppressed,
        feedback,
        clients,
        onboarding,
        // Carries its own `skipped` and `reason`, because "reminders are switched
        // off" is a different answer from "nothing was due" and an admin looking
        // for a missing reminder needs to be able to tell them apart.
        interviews,
        // Surfaced rather than swallowed: "0 sent" and "we couldn't check" are
        // very different answers, and the second must not read as the first.
        partialFailure: failed,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
