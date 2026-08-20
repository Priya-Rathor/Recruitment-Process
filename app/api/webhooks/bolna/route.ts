import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity/log";
import { notify } from "@/lib/notifications/notify";
import { isConsentRefusal } from "@/lib/screening/script";
import { formatDbError } from "@/lib/supabase/errors";

/**
 * POST /api/webhooks/bolna — call outcome, transcript and recording.
 *
 * This is the only UNAUTHENTICATED endpoint in the product, so it is the most
 * carefully constrained:
 *
 *   1. Signature. The body must carry a valid HMAC-SHA256 over the raw bytes,
 *      compared in constant time. No secret configured means no webhook is
 *      accepted at all — failing closed, because an open endpoint that writes
 *      transcripts would let anyone forge a candidate's answers.
 *   2. Tenancy comes from OUR record. The screening_call row is looked up by the
 *      id we generated, and organization_id is read from that row — never from
 *      the payload. A forged organization_id in the body is simply ignored.
 *   3. It only ever advances one known call. It cannot create rows, and it
 *      cannot touch anything outside screening_calls.
 *
 * Uses the service-role client because there is no user session here; every
 * write is explicitly scoped to the id and organization resolved above.
 */
export async function POST(request: NextRequest) {
  // Raw bytes: the signature covers exactly what was sent, so the body must not
  // be re-serialised before verification.
  const rawBody = await request.text();

  const secret = process.env.BOLNA_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[bolna webhook] BOLNA_WEBHOOK_SECRET is not set; rejecting.");
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  const signature =
    request.headers.get("x-bolna-signature") ?? request.headers.get("x-webhook-signature");

  if (!signature || !(await isValidSignature(rawBody, signature, secret))) {
    // Deliberately vague: a precise reason would help someone probe the endpoint.
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Our id, echoed back in metadata. Not the provider's, and not a tenant id.
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const screeningCallId = metadata.screening_call_id;

  if (typeof screeningCallId !== "string" || screeningCallId.length === 0) {
    return NextResponse.json({ error: "Missing call reference." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error("[bolna webhook] service-role client unavailable.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  // Tenancy is resolved from OUR row, never from the payload.
  const { data: existing } = await admin
    .from("screening_calls")
    .select("id, organization_id, application_id, status, consent_confirmed")
    .eq("id", screeningCallId)
    .maybeSingle();

  if (!existing) {
    // 200 so the provider stops retrying an event we will never accept.
    return NextResponse.json({ received: true, matched: false });
  }

  const call = existing as unknown as {
    id: string;
    organization_id: string;
    application_id: string;
    status: string;
    consent_confirmed: boolean;
  };

  const transcript = typeof payload.transcript === "string" ? payload.transcript : null;
  const consentAnswer =
    typeof payload.consent_answer === "string" ? payload.consent_answer : null;

  const status = mapProviderStatus(payload.status, consentAnswer);

  const updates: Record<string, unknown> = {
    status,
    ended_at: new Date().toISOString(),
  };

  if (transcript) updates.transcript = transcript;
  if (typeof payload.recording_url === "string") updates.recording_url = payload.recording_url;
  if (typeof payload.duration_seconds === "number" && payload.duration_seconds >= 0) {
    updates.duration_seconds = Math.floor(payload.duration_seconds);
  }
  if (typeof payload.error === "string") updates.failure_reason = payload.error.slice(0, 500);

  // Consent is recorded only when the candidate actually heard the disclosure
  // and did not decline. Module 9 must refuse to use a transcript without it.
  if (!call.consent_confirmed && consentAnswer && !isConsentRefusal(consentAnswer)) {
    updates.consent_confirmed = true;
  }

  const { error } = await admin
    .from("screening_calls")
    .update(updates)
    .eq("id", call.id)
    .eq("organization_id", call.organization_id);

  if (error) {
    console.error(`[bolna webhook] update failed: ${formatDbError(error)}`);
    // 500 so the provider retries — losing a transcript silently is worse.
    return NextResponse.json({ error: "Could not record the outcome." }, { status: 500 });
  }

  // TODO(Module 9): a completed call with consent_confirmed feeds summarisation.

  // Module 14. Two things are unusual here and both are deliberate:
  //   - actorId is NULL. A provider callback is not a person, and naming the
  //     recruiter who started the call as the actor of its outcome would be a
  //     false record.
  //   - useAdminClient, because there is no session. organization_id comes from
  //     OUR screening_calls row, never from the payload — the same rule the rest
  //     of this handler follows.
  await logActivity({
    organizationId: call.organization_id,
    entityType: "screening_call",
    entityId: call.id,
    eventType: "screening_call.completed",
    actorId: null,
    actorLabel: "Bolna (automated call)",
    metadata: {
      status,
      consent_confirmed: updates.consent_confirmed === true || call.consent_confirmed,
      duration_seconds: updates.duration_seconds ?? null,
    },
    useAdminClient: true,
  });

  // MODULE 15 RETROFIT — screening outcome notifications.
  //
  // useAdminClient throughout: a provider callback has no session. The
  // organization and the recipient both come from OUR rows, never the payload.
  //
  // A CANCELLED call means the candidate declined and asked for a person. That
  // is the spec's own worked example, and it is urgent in a way a completed call
  // is not — Module 8's retry policy will never dial them again, so if nobody
  // picks it up the candidate is simply dropped.
  const { data: assignmentRow } = await admin
    .from("applications")
    .select("id, assigned_recruiter_id, candidate:candidates(name), job:jobs(title)")
    .eq("id", call.application_id)
    .eq("organization_id", call.organization_id)
    .maybeSingle();

  const assignment = assignmentRow as unknown as {
    id: string;
    assigned_recruiter_id: string | null;
    candidate: { name: string } | null;
    job: { title: string } | null;
  } | null;

  if (assignment?.assigned_recruiter_id) {
    await notify({
      organizationId: call.organization_id,
      userId: assignment.assigned_recruiter_id,
      type: status === "cancelled" ? "screening_callback_requested" : "screening_completed",
      values: {
        candidate_name: assignment.candidate?.name ?? null,
        job_title: assignment.job?.title ?? null,
      },
      linkPath: `/applications/${assignment.id}/screening-call`,
      useAdminClient: true,
    });
  }

  /**
   * MODULE 13 — the `screening_call_completed` trigger, finally wired.
   *
   * This trigger was refused at activation until now, and the reason was
   * structural rather than a missing line here: the engine used the session-bound
   * client for every query, and this handler has no session, so every rule would
   * have been denied by RLS. A rule would have looked active and quietly never
   * fired, and an admin would have believed their candidates were being followed
   * up.
   *
   * The engine now takes its client as a parameter, so dispatching in 'service'
   * mode works. What it still cannot do here is the Module 7-9 actions — those
   * build their own session clients inside those modules — and `ACTION_MODES`
   * records exactly that, so a rule pairing this trigger with them is refused at
   * activation with the reason stated. Honest at the boundary rather than broken
   * at run time.
   *
   * ONLY on a genuinely completed call. A cancelled one means the candidate
   * declined and asked for a person; running automation over that would be the
   * product ignoring what they said.
   *
   * Wrapped and awaited, like every other dispatch site: awaited because a
   * serverless function can be frozen the moment it responds, which would leave a
   * run claimed and unfinished; caught because a failing rule must not turn a
   * recorded transcript into a 500 that makes Bolna retry the whole callback.
   */
  if (status === "completed" && assignment) {
    try {
      const { dispatch } = await import("@/lib/automations/engine");

      // The organization's name for the engine's own use. From OUR row, like
      // everything else in this handler — never from the payload.
      const { data: organizationRow } = await admin
        .from("organizations")
        .select("name")
        .eq("id", call.organization_id)
        .maybeSingle();

      await dispatch({
        organizationId: call.organization_id,
        organizationName: (organizationRow as { name: string } | null)?.name ?? "",
        applicationId: call.application_id,
        trigger: "screening_call_completed",
        // Null, for the same reason logActivity above passes actorId: null. A
        // provider callback is not a person, and naming the recruiter who started
        // the call as the cause of its automated follow-up is a false record.
        triggeredBy: null,
        webhookUrl: "",
        mode: "service",
      });
    } catch (automationError) {
      console.error("[bolna webhook] automations after call completion failed:", automationError);
    }
  }

  return NextResponse.json({ received: true, matched: true });
}

/**
 * Maps the provider's outcome onto our vocabulary.
 *
 * A refusal at the consent question is NOT a failure — the candidate exercised
 * the choice we offered them. It becomes `cancelled`, which the retry policy
 * treats as terminal, so nobody who declined gets dialled again.
 */
function mapProviderStatus(raw: unknown, consentAnswer: string | null): string {
  if (consentAnswer && isConsentRefusal(consentAnswer)) {
    return consentAnswer.toLowerCase().includes("call back") ||
      consentAnswer.toLowerCase().includes("later")
      ? "callback_requested"
      : "cancelled";
  }

  const value = typeof raw === "string" ? raw.toLowerCase() : "";

  switch (value) {
    case "completed":
    case "success":
      return "completed";
    case "no-answer":
    case "no_answer":
    case "noanswer":
      return "no_answer";
    case "busy":
      return "busy";
    case "callback":
    case "callback_requested":
      return "callback_requested";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      // Unknown outcomes are failures, which the retry policy may retry — safer
      // than assuming success and feeding Module 9 an incomplete transcript.
      return "failed";
  }
}

/** Constant-time HMAC-SHA256 comparison. */
async function isValidSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    // Providers vary on prefixes.
    const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();

    if (provided.length !== expected.length) return false;

    // Constant time: never short-circuit on the first differing character.
    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) {
      mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
    }
    return mismatch === 0;
  } catch (error) {
    console.error(`[bolna webhook] signature check failed: ${formatDbError(error)}`);
    return false;
  }
}
