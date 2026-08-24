// =============================================================================
// The applicant's link.
//
// SAME CONSTRUCTION AS lib/coding/token.ts AND lib/communications/optout.ts,
// deliberately: an HMAC over the row's own id, nothing stored. A database dump
// contains no working links and there is no token column for a mistaken SELECT
// to leak. Three ways to authorise a candidate-facing page would be two too
// many.
//
// WHAT THIS ONE ADDS: A VERSION, BECAUSE A JOB LINK GETS REGENERATED.
//
// A coding round is used once and cancelled; an application link is printed on
// a poster, forwarded through WhatsApp, and occasionally has to be killed —
// somebody shared it in the wrong group, or a role reopened and the old link
// should stop working. Signing over (form id, token_version) makes
// `update forms set token_version = token_version + 1` a complete revocation of
// every link and QR code ever issued, while still storing no secret.
//
// The verifier returns the version it read from the token; the CALLER compares
// it with the version on the row. Doing that comparison here would need a
// database handle in a module that must stay pure enough to unit test.
//
// WHAT THE URL EXPOSES. Only forms.id. Never an organization id, a job id, a
// candidate id, or the job title.
//
// WHEN THERE IS NO SIGNING KEY. INTEGRATION_ENCRYPTION_KEY is the same secret
// the credential store, the unsubscribe link and the coding link already
// require. Unset, createFormToken() returns null and publishing is REFUSED
// rather than issuing an unverifiable link or falling back to an unsigned one.
// =============================================================================

const TOKEN_VERSION = "v1";

function keyMaterial(): string | null {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  return key && key.length >= 32 ? key : null;
}

export function isFormTokenSigningConfigured(): boolean {
  return keyMaterial() !== null;
}

/** The message shown when signing is unavailable. Actionable, not cryptic. */
export const SIGNING_UNAVAILABLE_MESSAGE =
  "Publishing a form needs INTEGRATION_ENCRYPTION_KEY (32+ characters) set on the server, " +
  "so the public link can be signed. Without it no link can be issued.";

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
 * Builds the public token for one form at one token version.
 *
 * Returns null when signing is unavailable, so a caller cannot accidentally
 * publish an unverifiable link.
 */
export async function createFormToken({
  formId,
  tokenVersion,
}: {
  formId: string;
  tokenVersion: number;
}): Promise<string | null> {
  if (!UUID_PATTERN.test(formId)) return null;
  if (!Number.isInteger(tokenVersion) || tokenVersion < 1) return null;

  const payload = `${TOKEN_VERSION}:${formId}:${tokenVersion}`;
  const signature = await sign(payload);
  if (!signature) return null;

  return `${toBase64Url(new TextEncoder().encode(payload))}.${signature}`;
}

/**
 * Verifies a token and returns the form id and version it names.
 *
 * A bad signature, a missing key, a wrong scheme version and a malformed token
 * all return null, and the public page says the same thing for every one of
 * them: distinguishing them would let somebody probe which forms exist.
 */
export async function verifyFormToken(
  token: string
): Promise<{ formId: string; tokenVersion: number } | null> {
  if (typeof token !== "string" || token.length === 0) return null;

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const payloadBytes = fromBase64Url(encodedPayload);
  if (!payloadBytes) return null;

  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await sign(payload);
  if (!expected) return null;

  if (!constantTimeEquals(expected, providedSignature)) return null;

  const [scheme, formId, rawVersion] = payload.split(":");
  if (scheme !== TOKEN_VERSION) return null;
  if (!formId || !UUID_PATTERN.test(formId)) return null;

  const tokenVersion = Number(rawVersion);
  if (!Number.isInteger(tokenVersion) || tokenVersion < 1) return null;

  return { formId, tokenVersion };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compared without an early return on the first differing byte.
 *
 * Copied in shape from lib/coding/token.ts and lib/communications/optout.ts
 * deliberately: three implementations of "is this signature right?" is two too
 * many, and the day they diverge is the day one stops being constant time.
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
 * The full public URL, or null when it cannot be signed or has no origin.
 *
 * `origin` is threaded from the request, the same way buildCandidateUrl() and
 * buildUnsubscribeUrl() already are. A relative link is useless here: this URL
 * becomes a QR code somebody points a phone camera at, and that phone has never
 * seen this product.
 */
export async function buildApplyUrl({
  formId,
  tokenVersion,
  origin,
}: {
  formId: string;
  tokenVersion: number;
  origin?: string | null;
}): Promise<string | null> {
  const base = (origin ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;

  const token = await createFormToken({ formId, tokenVersion });
  if (!token) return null;

  return `${base}/apply/${token}`;
}
