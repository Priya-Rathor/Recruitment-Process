import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership, requireRole } from "@/lib/tenant";
import { getConversation } from "@/lib/messaging/queries";
import { isOptOutReply } from "@/lib/messaging/conversations";
import { logActivity } from "@/lib/activity/log";
import { formatDbError } from "@/lib/supabase/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/messages/conversations/:id — one thread.
 *
 * Polled by the open thread so a reply arriving while somebody is reading shows
 * up. Returns 404 both for another tenant's id and for a thread this Recruiter
 * is not scoped to, so a guessed id is indistinguishable from a missing one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const membership = await requireMembership();
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) return jsonError("Conversation not found.", 404);

    const thread = await getConversation({
      organizationId: membership.organization.id,
      conversationId: id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
    });

    if (!thread) return jsonError("Conversation not found.", 404);

    return NextResponse.json(thread);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/messages/conversations/:id — mark read, or link to a candidate.
 *
 * Two small edits rather than two routes, because they are the only two things
 * a person can change about a thread and both are a single-column update on the
 * same row.
 *
 * VIEWER IS REFUSED, including for "mark read". That is not an oversight: the
 * unread count is shared across the whole organization (see the column's comment
 * in migration 0041), so a Viewer clearing it would tell three recruiters that a
 * candidate had been dealt with when nobody had answered them. The RLS policy
 * refuses it independently — this is the friendly error.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const membership = await requireRole(["owner", "admin", "recruiter"]);
    const { id } = await params;

    if (!UUID_PATTERN.test(id)) return jsonError("Conversation not found.", 404);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const payload = (raw ?? {}) as Record<string, unknown>;

    // Scope and tenancy in one call: a thread this caller may not see is a 404
    // before anything is written.
    const thread = await getConversation({
      organizationId: membership.organization.id,
      conversationId: id,
      viewerRole: membership.role,
      viewerId: membership.user_id,
    });

    if (!thread) return jsonError("Conversation not found.", 404);

    const supabase = await createClient();

    // --- Link to a candidate ------------------------------------------------
    if (payload.candidate_id !== undefined) {
      const candidateId = payload.candidate_id;
      if (typeof candidateId !== "string" || !UUID_PATTERN.test(candidateId)) {
        return jsonError("Choose a candidate.", 400);
      }

      /*
        Re-linking an already-linked thread is refused.

        Moving a live conversation from one candidate to another would move the
        record of what was said with it, and the previous candidate's history
        would silently lose messages that really were sent to them. Unlinking is
        not offered for the same reason. A thread linked to the wrong person is
        rare and is a support conversation, not a button.
      */
      if (thread.conversation.candidate_id !== null) {
        return jsonError("This conversation is already linked to a candidate.", 409);
      }

      const { data: candidate } = await supabase
        .from("candidates")
        .select("id, name")
        .eq("id", candidateId)
        .eq("organization_id", membership.organization.id)
        .maybeSingle();

      // Another organization's candidate resolves to null, so a guessed id looks
      // exactly like a missing one.
      if (!candidate) return jsonError("Candidate not found.", 404);

      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ candidate_id: candidateId })
        .eq("id", id)
        .eq("organization_id", membership.organization.id);

      if (error) {
        console.error(`[messaging] link failed: ${formatDbError(error)}`);
        return jsonError("Could not link that conversation.", 400);
      }

      /*
        THE DEFERRED OPT-OUT.

        A STOP from an unmatched number could not be recorded when it arrived —
        candidate_communication_preferences is keyed by candidate and there was
        no candidate. Now there is one, so the thread is re-read for a stop
        request and it takes effect from here.

        Without this, linking a thread would quietly resurrect a candidate who
        had already asked us to stop, and the product would start messaging them
        again with a clean conscience.
      */
      await applyDeferredOptOut({
        organizationId: membership.organization.id,
        conversationId: id,
        candidateId,
      });

      await logActivity({
        organizationId: membership.organization.id,
        entityType: "candidate",
        entityId: candidateId,
        eventType: "candidate.whatsapp_linked",
        actorId: membership.user_id,
        metadata: {
          conversation_id: id,
          // The masked form only. An audit row is read by anyone who can see the
          // organization, and the full number is already on the candidate.
          phone_hint: `••••${thread.conversation.phone_number.slice(-4)}`,
        },
      });

      return NextResponse.json({ ok: true, candidate_id: candidateId });
    }

    // --- Mark read ----------------------------------------------------------
    if (payload.mark_read === true) {
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ unread_count: 0 })
        .eq("id", id)
        .eq("organization_id", membership.organization.id);

      if (error) {
        console.error(`[messaging] mark read failed: ${formatDbError(error)}`);
        return jsonError("Could not update that conversation.", 400);
      }

      return NextResponse.json({ ok: true });
    }

    return jsonError("Nothing to change.", 400);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Applies a STOP that arrived before we knew who the sender was.
 *
 * Reads the thread's inbound messages through the caller's own session — no
 * service-role client, because the caller can already read every one of these
 * rows and borrowing RLS-bypassing privileges to do something they are entitled
 * to do is how a least-privilege rule rots.
 *
 * Failure is logged, never surfaced. The link itself succeeded, and telling a
 * recruiter "linked, but check whether they asked us to stop" is an instruction
 * nobody can act on. The opt-out is also re-applied the next time that candidate
 * texts STOP, and the thread shows the word in plain sight.
 */
async function applyDeferredOptOut({
  organizationId,
  conversationId,
  candidateId,
}: {
  organizationId: string;
  conversationId: string;
  candidateId: string;
}): Promise<void> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("message_log")
      .select("body_sent")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return;

    const askedToStop = (data as { body_sent: string }[]).some((row) =>
      isOptOutReply(row.body_sent)
    );
    if (!askedToStop) return;

    await supabase.from("candidate_communication_preferences").upsert(
      {
        organization_id: organizationId,
        candidate_id: candidateId,
        whatsapp_opted_out: true,
        opted_out_at: new Date().toISOString(),
        opted_out_reason: "Replied STOP on WhatsApp before this number was linked.",
      },
      { onConflict: "organization_id,candidate_id" }
    );
  } catch (error) {
    console.error(`[messaging] deferred opt-out failed: ${formatDbError(error)}`);
  }
}
