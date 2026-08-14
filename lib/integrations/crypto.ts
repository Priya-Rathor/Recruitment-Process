// =============================================================================
// Credential encryption at rest.
//
// Integration credentials (a Bolna API key, later a Google refresh token) are
// stored as AES-GCM ciphertext, never plaintext. Combined with the column-level
// REVOKE in migration 0007, that means the browser cannot read them even with a
// valid Owner session, and a database dump does not hand over live keys.
//
// The key comes from INTEGRATION_ENCRYPTION_KEY. If it is unset, encryption is
// unavailable and the adapters refuse to connect — failing closed rather than
// silently storing secrets in the clear.
// =============================================================================

const ALGORITHM = "AES-GCM";
const IV_BYTES = 12;

export type CryptoResult<T> = { ok: true; value: T } | { ok: false; error: string };

function getKeyMaterial(): string | null {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  return key && key.length >= 32 ? key : null;
}

export function isEncryptionConfigured(): boolean {
  return getKeyMaterial() !== null;
}

async function importKey(): Promise<CryptoKey | null> {
  const material = getKeyMaterial();
  if (!material) return null;

  // Derive a stable 256-bit key from the configured secret.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, ALGORITHM, false, ["encrypt", "decrypt"]);
}

/** Encrypts to "<base64 iv>.<base64 ciphertext>". */
export async function encryptSecret(plaintext: string): Promise<CryptoResult<string>> {
  const key = await importKey();
  if (!key) {
    return {
      ok: false,
      error:
        "Credential encryption isn't configured. Set INTEGRATION_ENCRYPTION_KEY (32+ characters) before connecting an integration.",
    };
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  return { ok: true, value: `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}` };
}

export async function decryptSecret(payload: string): Promise<CryptoResult<string>> {
  const key = await importKey();
  if (!key) {
    return { ok: false, error: "Credential encryption isn't configured." };
  }

  const [ivPart, cipherPart] = payload.split(".");
  if (!ivPart || !cipherPart) {
    return { ok: false, error: "Stored credentials are malformed." };
  }

  try {
    const plain = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64(ivPart) },
      key,
      fromBase64(cipherPart)
    );
    return { ok: true, value: new TextDecoder().decode(plain) };
  } catch {
    // Usually a rotated key. Say that rather than leaking crypto detail.
    return {
      ok: false,
      error: "Stored credentials could not be read. Reconnect the integration.",
    };
  }
}

/**
 * What the UI shows instead of the secret: "••••••4F8A".
 * The spec's credential-security pattern requires the backend to return only
 * masked metadata, never the key itself.
 */
export function maskSecret(secret: string): string {
  const tail = secret.trim().slice(-4);
  return `••••••${tail}`;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Returns an ArrayBuffer rather than a view: WebCrypto's BufferSource type
 *  rejects a Uint8Array whose backing buffer might be shared. */
function fromBase64(value: string): ArrayBuffer {
  const bytes = Buffer.from(value, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
