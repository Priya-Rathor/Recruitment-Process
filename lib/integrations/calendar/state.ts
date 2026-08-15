// =============================================================================
// OAuth state signing and the redirect URI.
//
// Lives here rather than in the route file: a Next.js route module is only
// supposed to export handlers and route config, and exporting helpers from one
// works today but is not a contract worth depending on.
// =============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_COOKIE = "calendar_oauth_state";

/** The redirect URI Google must have registered. Derived, never client-supplied. */
export function calendarRedirectUri(origin: string): string {
  return `${origin}/api/settings/integrations/calendar/callback`;
}

/**
 * The secret used to sign OAuth state.
 *
 * Reuses INTEGRATION_ENCRYPTION_KEY — the deployment-level secret that already
 * exists for exactly this class of purpose. An earlier version of this file
 * invented two variable names (WEBHOOK_SECRET, CREDENTIALS_ENCRYPTION_KEY) that
 * appear nowhere else in the project or in .env.local.example, so signing would
 * have silently found nothing and the error message would have told an operator
 * to set a variable that does not exist.
 */
function stateSecret(): string {
  return process.env.INTEGRATION_ENCRYPTION_KEY ?? "";
}

/**
 * Signs the state parameter.
 *
 * The state carries the organization id so the callback knows which tenant to
 * store tokens against — and it MUST be signed, because an unsigned state is a
 * value an attacker chooses. Without the signature, someone could complete an
 * OAuth flow with their own Google account while naming a different
 * organization, and their calendar credentials would be written into that
 * organization's row.
 *
 * The cookie nonce provides the CSRF defence; this signature provides
 * integrity. Both are checked on the way back.
 */
export function signState(payload: string): string {
  const secret = stateSecret();
  if (!secret) return "";

  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/** Returns the payload if the signature verifies, else null. */
export function verifyState(state: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;

  const lastDot = state.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = state.slice(0, lastDot);
  const provided = state.slice(lastDot + 1);

  // Reject anything that isn't a plain hex digest before touching Buffer —
  // Buffer.from(x, "hex") silently truncates on invalid input, which would
  // otherwise let a crafted value produce a short buffer that happens to match.
  if (!/^[0-9a-f]+$/i.test(provided)) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const providedBuffer = Buffer.from(provided, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  return payload;
}

export function isStateSigningConfigured(): boolean {
  return stateSecret().length > 0;
}
