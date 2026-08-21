// =============================================================================
// The candidate's access token.
//
// A CANDIDATE IS NOT A USER OF THIS PRODUCT. They have no login, so the link
// itself has to be the authorisation — exactly the problem Module 15's
// unsubscribe link already solved, and this is deliberately the same
// construction so there is one way to do this in the codebase rather than two.
//
// WHY STATELESS, AND WHAT THAT COSTS.
//
// The token is an HMAC over the session id. Nothing is stored: a database dump
// contains no working links, and there is no token column for a mistaken SELECT
// to leak. The cost is that an individual token cannot be revoked on its own —
// so revocation is expressed on the SESSION instead. Cancelling a round sets
// status='cancelled' and the link stops opening the editor within the same
// request. `expires_at` does the same for time. That is a better boundary
// anyway: an interviewer thinks in terms of "call off this coding round", not
// "invalidate token 7f3a".
//
// WHAT THE URL EXPOSES.
//
// Only coding_sessions.id — this feature's own row. Never a candidate id, an
// application id, an interview id or an organization id. Someone who reads the
// link over a shoulder learns that a coding session exists, which they are
// already looking at.
//
// WHEN THERE IS NO SIGNING KEY.
//
// INTEGRATION_ENCRYPTION_KEY is the same secret the credential store and the
// unsubscribe link already require. Unset, createAccessToken() returns null and
// the API refuses to create a session at all — rather than issuing an
// unverifiable link, or worse, falling back to an unsigned one. Failing closed
// is the same choice lib/integrations/crypto.ts makes.
// =============================================================================

const TOKEN_VERSION = "v1";

function keyMaterial(): string | null {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  return key && key.length >= 32 ? key : null;
}

export function isCodingTokenSigningConfigured(): boolean {
  return keyMaterial() !== null;
}

/** The message shown when signing is unavailable. Actionable, not cryptic. */
export const SIGNING_UNAVAILABLE_MESSAGE =
  "Coding rounds need INTEGRATION_ENCRYPTION_KEY (32+ characters) set on the server, " +
  "so the candidate's link can be signed. Without it no link can be issued.";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(payload: string): Promise<string | null> {
  const material = keyMaterial();
  if (!material) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(material),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return toBase64Url(new Uint8Array(signature));
}

/**
 * Builds the access token for one coding session.
 *
 * Returns null when signing is unavailable, so a caller cannot accidentally
 * publish an unverifiable link — the same contract createOptOutToken() has.
 */
export async function createAccessToken(sessionId: string): Promise<string | null> {
  const payload = `${TOKEN_VERSION}:${sessionId}`;
  const signature = await sign(payload);
  if (!signature) return null;

  return `${toBase64Url(new TextEncoder().encode(payload))}.${signature}`;
}

/**
 * Verifies a token and returns the session id it names.
 *
 * A mismatch, a missing key, a wrong version and a malformed token all return
 * null. The page says only "this link isn't valid" for every one of them:
 * distinguishing them would let somebody probe which session ids exist.
 */
export async function verifyAccessToken(token: string): Promise<string | null> {
  if (typeof token !== "string" || token.length === 0) return null;

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const payloadBytes = fromBase64Url(encodedPayload);
  if (!payloadBytes) return null;

  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await sign(payload);
  if (!expected) return null;

  if (!constantTimeEquals(expected, providedSignature)) return null;

  const [version, sessionId] = payload.split(":");
  if (version !== TOKEN_VERSION) return null;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) return null;

  return sessionId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compared without an early return on the first differing byte.
 *
 * Copied in shape from lib/communications/optout.ts deliberately: two
 * implementations of "is this signature right?" in one codebase is one too
 * many, and the day they diverge is the day one of them stops being constant
 * time.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * The full candidate URL, or null when it cannot be signed or has no origin.
 *
 * `origin` is threaded from the request that created the session, the same way
 * buildUnsubscribeUrl() and the automation engine's webhookUrl already are. A
 * relative link is useless here: this URL becomes a QR code somebody points a
 * phone camera at, and a phone has no idea what host the interviewer was on.
 */
export async function buildCandidateUrl({
  sessionId,
  origin,
}: {
  sessionId: string;
  origin?: string | null;
}): Promise<string | null> {
  const base = (origin ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;

  const token = await createAccessToken(sessionId);
  if (!token) return null;

  return `${base}/coding/${token}`;
}
