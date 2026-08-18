import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import {
  sendClientFeedbackReminders,
  sendFeedbackReminders,
} from "@/lib/notifications/reminders";
import { sendOnboardingDocumentReminders } from "@/lib/onboarding/reminders";

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
export async function POST() {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    // Sequential. Both walk the same notifications table for their dedupe
    // check, and running them together would let each miss what the other just
    // wrote.
    const feedback = await sendFeedbackReminders(membership.organization.id);
    const clients = await sendClientFeedbackReminders(membership.organization.id);
    // Module 19. Same dispatcher rather than a second button: a user should not
    // have to know which module a reminder belongs to in order to send it.
    const onboarding = await sendOnboardingDocumentReminders(membership.organization.id);

    const failed = feedback.failed || clients.failed || onboarding.failed;

    return NextResponse.json({
      data: {
        sent: feedback.sent + clients.sent + onboarding.sent,
        suppressed: feedback.suppressed + clients.suppressed + onboarding.suppressed,
        feedback,
        clients,
        onboarding,
        // Surfaced rather than swallowed: "0 sent" and "we couldn't check" are
        // very different answers, and the second must not read as the first.
        partialFailure: failed,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
