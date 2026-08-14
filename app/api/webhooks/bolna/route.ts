import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConsentRefusal } from "@/lib/screening/script";

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
    .select("id, organization_id, status, consent_confirmed")
    .eq("id", screeningCallId)
    .maybeSingle();

  if (!existing) {
    // 200 so the provider stops retrying an event we will never accept.
    return NextResponse.json({ received: true, matched: false });
  }

  const call = existing as unknown as {
    id: string;
    organization_id: string;
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
    console.error("[bolna webhook] update failed:", error);
    // 500 so the provider retries — losing a transcript silently is worse.
    return NextResponse.json({ error: "Could not record the outcome." }, { status: 500 });
  }

  // TODO(Module 9): a completed call with consent_confirmed feeds summarisation.
  // TODO(Module 14): log the outcome to activity_events.
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
    console.error("[bolna webhook] signature check failed:", error);
    return false;
  }
}
