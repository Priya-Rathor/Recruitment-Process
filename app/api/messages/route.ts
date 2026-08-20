import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { hasRole, requireCurrentUser, requireRole } from "@/lib/tenant";
import { loadMessageContext } from "@/lib/communications/triggers";
import { loadOptOut, optedOutOf, sendOnChannel } from "@/lib/communications/send";
import { isSendChannel, MAX_WHATSAPP_BODY_LENGTH } from "@/lib/communications/templates";
import { renderMessage } from "@/lib/communications/tokens";
import { isCommunicationEvent } from "@/lib/communications/events";
import { logActivity } from "@/lib/activity/log";

// One provider round trip.
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/messages — a person sends a candidate a message.
 *
 * "Manual send: Owner/Admin/Recruiter (assigned) can send; Viewer read-only."
 * The assignment half is enforced here, because RLS cannot express it: the INSERT
 * policy on message_log allows any Recruiter in the organization, which is the
 * right floor for a policy (a Recruiter genuinely may send) but not the right rule
 * for a route (this Recruiter may only send about their own applications).
 *
 * FOUR THINGS THIS ROUTE WILL NOT DO.
 *
 * 1. It will not trust the client's rendering. Whatever text arrives, any
 *    remaining {{tokens}} are resolved server-side from the database. A caller
 *    cannot post a body with a candidate name of their choosing and have the log
 *    record it as this candidate's message.
 *
 * 2. It will not silently send to somebody who opted out. First attempt returns
 *    409 with `code: "opted_out"` and the reason; the UI shows the warning and the
 *    recruiter re-submits with `acknowledge_opt_out: true`. The spec: "never
 *    silently block a human-initiated message, but do warn them first" — the
 *    second field is what makes the warning unskippable rather than decorative.
 *
 * 3. It will not silently send to someone with no address. Same 409 shape, with a
 *    different code, because the remedy is different.
 *
 * 4. It will not attach an unsubscribe footer. A manual message is a
 *    conversation — usually a reply to something the candidate asked — and
 *    stapling "unsubscribe here" to a personal reply is both odd and, when the
 *    recruiter is deliberately overriding an opt-out, contradictory.
 */
export async function POST(request: NextRequest) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const payload = (raw ?? {}) as Record<string, unknown>;

    const applicationId = payload.application_id;
    if (typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId)) {
      return jsonError("Choose an application.", 400);
    }

    if (!isSendChannel(payload.channel)) {
      return jsonError("Choose email or WhatsApp.", 400);
    }
    const channel = payload.channel;

    const bodyText = typeof payload.body === "string" ? payload.body.trim() : "";
    if (bodyText.length === 0) return jsonError("Write a message first.", 422);

    if (channel === "whatsapp" && bodyText.length > MAX_WHATSAPP_BODY_LENGTH) {
      return jsonError(
        `A WhatsApp message has to stay under ${MAX_WHATSAPP_BODY_LENGTH} characters.`,
        422
      );
    }

    const subjectText = typeof payload.subject === "string" ? payload.subject.trim() : "";
    if (channel === "email" && subjectText.length === 0) {
      return jsonError("An email needs a subject line.", 422);
    }

    const templateId =
      typeof payload.template_id === "string" && UUID_PATTERN.test(payload.template_id)
        ? payload.template_id
        : null;

    const supabase = await createClient();

    const { data: application } = await supabase
      .from("applications")
      .select("id, assigned_recruiter_id")
      .eq("id", applicationId)
      .eq("organization_id", membership.organization.id)
      .maybeSingle();

    // Another organization's row resolves to null, so a guessed id is
    // indistinguishable from a missing one.
    if (!application) return jsonError("Application not found.", 404);

    const assignedTo = (application as { assigned_recruiter_id: string | null })
      .assigned_recruiter_id;

    if (
      !hasRole(membership.role, ["owner", "admin"]) &&
      assignedTo !== membership.user_id
    ) {
      return jsonError(
        "You can only message candidates on applications assigned to you.",
        403
      );
    }

    // The SAME context loader the automatic path uses, so a manual message and an
    // automatic one resolve {{job.title}} identically.
    const context = await loadMessageContext({
      client: supabase,
      organizationId: membership.organization.id,
      applicationId,
    });

    if (!context) return jsonError("Could not read that application.", 404);

    const resolvedBody = renderMessage(bodyText, context.values);
    const resolvedSubject =
      channel === "email" ? renderMessage(subjectText, context.values) : null;

    // --- The recipient check, before anything is written --------------------
    const recipient = channel === "email" ? context.candidateEmail : context.candidatePhone;
    if (!recipient || recipient.trim().length === 0) {
      return NextResponse.json(
        {
          error:
            channel === "email"
              ? "This candidate has no email address on file."
              : "This candidate has no phone number on file.",
          code: "no_recipient",
        },
        { status: 409 }
      );
    }

    // --- The opt-out warning ------------------------------------------------
    const optOut = await loadOptOut({
      client: supabase,
      organizationId: membership.organization.id,
      candidateId: context.candidateId,
    });

    const acknowledged = payload.acknowledge_opt_out === true;

    if (optedOutOf(optOut, channel) && !acknowledged) {
      return NextResponse.json(
        {
          error:
            channel === "email"
              ? "This candidate has asked not to receive emails. Send it anyway only if they contacted you and are expecting a reply."
              : "This candidate has asked not to receive WhatsApp messages. Send it anyway only if they contacted you and are expecting a reply.",
          code: "opted_out",
        },
        { status: 409 }
      );
    }

    // A failed opt-out read is surfaced to the human rather than treated as
    // consent. They can decide; an automatic send in the same position stays
    // silent (see loadOptOut).
    if (optOut.unknown && !acknowledged) {
      return NextResponse.json(
        {
          error:
            "We couldn't check whether this candidate has opted out. Send it anyway only if you're sure they want to hear from you.",
          code: "opt_out_unknown",
        },
        { status: 409 }
      );
    }

    const outcome = await sendOnChannel({
      client: supabase,
      target: {
        organizationId: membership.organization.id,
        candidateId: context.candidateId,
        applicationId,
        candidateEmail: context.candidateEmail,
        candidatePhone: context.candidatePhone,
        countryCode: context.countryCode,
      },
      channel,
      subject: resolvedSubject,
      body: resolvedBody,
      templateId,
      // A manual send records WHY only when it came from a template for a known
      // event; a one-off has no event and the log says so.
      eventKey: isCommunicationEvent(payload.event_key) ? payload.event_key : null,
      // A REAL USER ID. This is what makes the log distinguish "Priya sent this"
      // from "Automatic", and it is why sent_by is nullable rather than defaulted.
      sentBy: user.id,
      overrideOptOut: acknowledged,
      optOut,
    });

    await logActivity({
      organizationId: membership.organization.id,
      entityType: "application",
      entityId: applicationId,
      eventType: "message.sent",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: {
        channel,
        status: outcome.status,
        detail: outcome.detail,
        template_id: templateId,
        // Recorded because it is the thing a reviewer would want to find: a human
        // deliberately messaged somebody who had opted out.
        overrode_opt_out: acknowledged && optedOutOf(optOut, channel),
      },
    });

    // A skipped or failed send is a 200 with the reason, not a 4xx. The attempt is
    // recorded in the log either way, and the UI needs to show the same row the
    // log now holds rather than an error that contradicts it.
    return NextResponse.json({
      data: {
        status: outcome.status,
        detail: outcome.detail,
        logId: outcome.logId,
        delivered: outcome.delivered,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
