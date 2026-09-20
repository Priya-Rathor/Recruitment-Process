import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { getConversation } from "@/lib/messaging/queries";
import { sendOnChannel } from "@/lib/communications/send";
import { MAX_WHATSAPP_BODY_LENGTH } from "@/lib/communications/templates";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One provider round trip, like the other send routes.
export const maxDuration = 60;

/**
 * POST /api/messages/conversations/:id/reply — a person answers a candidate.
 *
 * THIS ROUTE SENDS NOTHING. It resolves who and where, and hands the message to
 * sendOnChannel() — the one function every outbound message in this product goes
 * through. That is not a stylistic preference: the opt-out gate, the log row,
 * the masked recipient, the thread attachment and the adapter's 24-hour-window
 * handling all live behind that call, and a second send path would have to
 * re-implement five things correctly and keep doing so forever.
 *
 * WHAT IS ENFORCED HERE, AND WHAT DELIBERATELY IS NOT.
 *
 *   - ROLE: Owner/Admin/Recruiter. A Viewer is refused with a 403 rather than
 *     with a disabled button, because a disabled button stops nobody holding
 *     curl.
 *   - SCOPE: getConversation() returns null for another tenant's thread AND for
 *     one this Recruiter is not assigned to, so both are a 404 and a guessed id
 *     cannot confirm that a thread exists.
 *   - OPT-OUT: not re-implemented. sendOnChannel() refuses it and returns a
 *     `skipped` outcome with the reason, and `acknowledge_opt_out` maps to the
 *     same explicit override the compose panel already uses — the API demands
 *     the flag, the UI demands a confirmation before setting it.
 *   - THE 24-HOUR WINDOW: NOT enforced here. It is Meta's rule, and our
 *     `last_inbound_at` is only our bookkeeping of it; a webhook delivery we
 *     dropped would make a repliable thread look closed and turn our bug into
 *     the recruiter's dead end. The attempt goes to the adapter, which surfaces
 *     Meta's own answer — the same wall every other send in this product hits.
 *     replyCapability() greys the composer out beforehand as guidance, not as a
 *     gate.
 *
 * AN UNLINKED THREAD CANNOT BE REPLIED TO, and that is a real restriction rather
 * than an omission. Everything sendOnChannel() does is anchored to a candidate:
 * whose opt-out to check, whose history to file the message under, whose name
 * appears in the log. Messaging a number we cannot attribute would mean sending
 * to somebody whose opt-out we are structurally unable to honour. Linking is one
 * click away in the inbox, and the composer says so.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return jsonError("Conversation not found.", 404);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const payload = (raw ?? {}) as Record<string, unknown>;

    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (body.length === 0) return jsonError("Write a message first.", 422);
    if (body.length > MAX_WHATSAPP_BODY_LENGTH) {
      return jsonError(
        `A WhatsApp message has to stay under ${MAX_WHATSAPP_BODY_LENGTH} characters.`,
        422
      );
    }

    const thread = await getConversation({
      organizationId: membership.organization.id,
      conversationId: id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
    });

    if (!thread) return jsonError("Conversation not found.", 404);

    const candidateId = thread.conversation.candidate_id;
    if (!candidateId) {
      return NextResponse.json(
        {
          error:
            "Link this number to a candidate before replying, so we know whose " +
            "conversation this is and whether they've opted out.",
          code: "unlinked_conversation",
        },
        { status: 409 }
      );
    }

    /*
      The opt-out warning, before anything is sent.

      Same two-step the compose panel uses: the first attempt returns 409 with
      the reason, the UI shows it, and the recruiter re-submits with
      `acknowledge_opt_out`. sendOnChannel() refuses it a second time on its own
      unless the override is set, so this is the friendly half of a rule that is
      enforced further down.
    */
    const acknowledged = payload.acknowledge_opt_out === true;
    if (thread.optedOut && !acknowledged) {
      return NextResponse.json(
        {
          error:
            "This candidate has opted out of WhatsApp. Send anyway only if they've asked you to.",
          code: "opted_out",
        },
        { status: 409 }
      );
    }

    const supabase = await createClient();

    const outcome = await sendOnChannel({
      client: supabase,
      target: {
        organizationId: membership.organization.id,
        candidateId,
        /*
          NULL, like an inbound message.

          A candidate with three live applications sent one message and we are
          answering it; filing that answer under one of the three would be a
          guess recorded as a fact. It appears on the candidate's communication
          history, which is where a cross-application conversation belongs.
        */
        applicationId: null,
        candidateEmail: null,
        /*
          THE THREAD'S OWN NUMBER, not the candidate's stored phone — we are
          replying where they wrote from, and the two can differ (a second
          handset, a number corrected on the candidate record since).

          The '+' is not decoration. The column stores digits only, and
          normalizeWhatsAppNumber() treats a plus-less number as needing a
          country code and returns null without one — so a stored "919876543210"
          handed over bare would be refused as unattributable. The plus states
          what the column already guarantees: this is a full international
          number.
        */
        candidatePhone: `+${thread.conversation.phone_number}`,
        countryCode: null,
      },
      channel: "whatsapp",
      subject: null,
      /*
        Sent EXACTLY as typed. No placeholder resolution, unlike the templated
        compose panel — a chat reply is somebody's own words, and quietly
        rewriting "{{" in a sentence a recruiter typed by hand would be a
        surprise in the one place the product should be transparent.
      */
      body,
      templateId: null,
      eventKey: null,
      // NOT NULL — this is a person, so no unsubscribe footer is appended and
      // the opt-out override is honoured. Both follow from this one field.
      sentBy: user.id,
      overrideOptOut: acknowledged,
      origin: request.nextUrl.origin,
    });

    /*
      200 even for a skipped or failed send, with the outcome in the body.

      The recruiter needs the REASON — "WhatsApp isn't connected", "Meta refused
      it because the candidate hasn't messaged you in 24 hours" — and a bare 500
      throws that away. The message row exists either way, so the thread shows
      what happened; a non-2xx here would also make the composer look broken when
      the product behaved correctly.
    */
    return NextResponse.json({
      status: outcome.status,
      detail: outcome.detail,
      delivered: outcome.delivered,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
