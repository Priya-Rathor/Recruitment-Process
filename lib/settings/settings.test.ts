import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SCREENING_SETTINGS,
  normalizeRetentionSettings,
  normalizeScreeningSettings,
  parseSettingsPayload,
} from "@/lib/settings/queries";
import { MAX_ALLOWED_ATTEMPTS, MIN_ALLOWED_DELAY_MINUTES } from "@/lib/screening/retry";
import {
  isProvider,
  maskCredential,
  PROVIDERS,
  toPublic,
  type StoredIntegration,
} from "@/lib/integrations/store";
import { isExpired } from "@/lib/integrations/calendar/oauth";
import { signState, verifyState } from "@/lib/integrations/calendar/state";
import {
  isCustomerFacingProvider,
  PROVIDER_DESCRIPTORS,
} from "@/lib/settings/integrations";

// -----------------------------------------------------------------------------
// "Encrypted credentials never appear un-masked in any API response."
// -----------------------------------------------------------------------------
describe("credential exposure", () => {
  const row: StoredIntegration = {
    id: "int-1",
    organization_id: "org-1",
    provider: "bolna",
    status: "connected",
    encrypted_credentials: "SUPER-SECRET-CIPHERTEXT",
    settings: { agentId: "agent-1" },
    credential_hint: "••••4F8A",
    credential_mode: "organization_managed",
    last_tested_at: null,
    last_success_at: null,
    error_code: null,
    error_message: null,
    connected_by: "user-1",
    updated_at: "2026-08-15T00:00:00.000Z",
  };

  it("strips the ciphertext from anything sent to a browser", () => {
    const publicRow = toPublic(row);

    expect(JSON.stringify(publicRow)).not.toContain("SUPER-SECRET-CIPHERTEXT");
    expect("encrypted_credentials" in publicRow).toBe(false);
  });

  it("keeps the masked hint, which is the whole point", () => {
    expect(toPublic(row).credential_hint).toBe("••••4F8A");
  });

  /**
   * The regression this guards: toPublic() was originally a
   * destructure-and-spread, so a NEW secret-bearing column added to
   * StoredIntegration later would have been carried through automatically.
   * Rebuilding field by field means a new column is invisible until somebody
   * names it deliberately.
   */
  it("does not carry through an unexpected field", () => {
    const withExtra = { ...row, some_future_secret: "leak-me" } as unknown as StoredIntegration;
    expect(JSON.stringify(toPublic(withExtra))).not.toContain("leak-me");
  });
});

describe("maskCredential", () => {
  it("shows only the last four characters", () => {
    expect(maskCredential("sk-live-abcdef124F8A")).toBe("••••4F8A");
  });

  it("reveals nothing at all for a short secret", () => {
    // A 4-character key would otherwise be shown in full by a "last four" rule.
    expect(maskCredential("abcd")).toBe("••••");
    expect(maskCredential("ab")).toBe("••••");
  });

  it("ignores surrounding whitespace rather than masking it", () => {
    expect(maskCredential("  sk-live-abcdef124F8A  ")).toBe("••••4F8A");
  });
});

// -----------------------------------------------------------------------------
// Screening bounds. These decide how often a real person is telephoned, so the
// form is not the boundary — this is.
// -----------------------------------------------------------------------------
describe("normalizeScreeningSettings", () => {
  it("clamps attempts to the hard cap", () => {
    const result = normalizeScreeningSettings({ maxAttempts: 99 });
    expect(result.maxAttempts).toBe(MAX_ALLOWED_ATTEMPTS);
  });

  it("refuses fewer than one attempt", () => {
    expect(normalizeScreeningSettings({ maxAttempts: 0 }).maxAttempts).toBe(1);
    expect(normalizeScreeningSettings({ maxAttempts: -5 }).maxAttempts).toBe(1);
  });

  it("enforces the minimum delay, so a missed call isn't followed immediately", () => {
    expect(normalizeScreeningSettings({ retryDelayMinutes: 1 }).retryDelayMinutes).toBe(
      MIN_ALLOWED_DELAY_MINUTES
    );
  });

  it("falls back to defaults on junk rather than throwing", () => {
    const result = normalizeScreeningSettings({ maxAttempts: "lots", retryDelayMinutes: null });

    expect(result.maxAttempts).toBe(DEFAULT_SCREENING_SETTINGS.maxAttempts);
    expect(result.retryDelayMinutes).toBe(DEFAULT_SCREENING_SETTINGS.retryDelayMinutes);
  });

  it("survives null and undefined", () => {
    expect(normalizeScreeningSettings(null).maxAttempts).toBe(
      DEFAULT_SCREENING_SETTINGS.maxAttempts
    );
    expect(normalizeScreeningSettings(undefined).language).toBe("en");
  });

  it("treats recording as on unless explicitly turned off", () => {
    expect(normalizeScreeningSettings({}).recordCalls).toBe(true);
    expect(normalizeScreeningSettings({ recordCalls: false }).recordCalls).toBe(false);
  });
});

describe("normalizeRetentionSettings", () => {
  /**
   * The default is 0 — keep indefinitely. A default that silently deleted
   * transcripts after 90 days would destroy evidence a customer may be required
   * to hold, and they would discover it only when they needed it.
   */
  it("defaults to keeping data indefinitely", () => {
    expect(normalizeRetentionSettings({})).toEqual(DEFAULT_RETENTION_SETTINGS);
    expect(DEFAULT_RETENTION_SETTINGS.transcriptRetentionDays).toBe(0);
  });

  it("treats a negative period as indefinite rather than as instant deletion", () => {
    expect(normalizeRetentionSettings({ transcriptRetentionDays: -30 }).transcriptRetentionDays).toBe(0);
  });

  it("caps at ten years", () => {
    expect(
      normalizeRetentionSettings({ transcriptRetentionDays: 999_999 }).transcriptRetentionDays
    ).toBe(3650);
  });
});

// -----------------------------------------------------------------------------
// Settings payload validation
// -----------------------------------------------------------------------------
describe("parseSettingsPayload", () => {
  it("accepts a valid patch", () => {
    const result = parseSettingsPayload({ currency: "usd", default_interview_duration_minutes: 45 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.currency).toBe("USD");
      expect(result.data.default_interview_duration_minutes).toBe(45);
    }
  });

  it("ignores unknown keys entirely", () => {
    // An allowlist, not a denylist: a client posting organization_id or
    // created_at must not be able to write them.
    const result = parseSettingsPayload({
      currency: "INR",
      organization_id: "someone-elses-org",
      created_at: "2020-01-01",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data)).toEqual(["currency"]);
    }
  });

  it("rejects a bad currency", () => {
    expect(parseSettingsPayload({ currency: "rupees" }).ok).toBe(false);
  });

  it("rejects an interview duration outside sane bounds", () => {
    expect(parseSettingsPayload({ default_interview_duration_minutes: 0 }).ok).toBe(false);
    expect(parseSettingsPayload({ default_interview_duration_minutes: 5000 }).ok).toBe(false);
  });

  it("rejects an http logo URL", () => {
    // Mixed content on an https page, and a plaintext request carrying the
    // referrer.
    expect(parseSettingsPayload({ logo_url: "http://example.com/logo.png" }).ok).toBe(false);
    expect(parseSettingsPayload({ logo_url: "https://example.com/logo.png" }).ok).toBe(true);
  });

  it("rejects a non-hex brand colour", () => {
    expect(parseSettingsPayload({ brand_color: "red" }).ok).toBe(false);
    expect(parseSettingsPayload({ brand_color: "#4F46E5" }).ok).toBe(true);
  });

  it("normalises screening settings on write, not only on read", () => {
    // A value that never passes through the form still gets bounded.
    const result = parseSettingsPayload({ screening_settings: { maxAttempts: 500 } });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const screening = result.data.screening_settings as { maxAttempts: number };
      expect(screening.maxAttempts).toBe(MAX_ALLOWED_ATTEMPTS);
    }
  });

  it("refuses an empty patch rather than writing nothing silently", () => {
    expect(parseSettingsPayload({}).ok).toBe(false);
    expect(parseSettingsPayload(null).ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// OAuth state — CSRF and tenant integrity
// -----------------------------------------------------------------------------
describe("OAuth state signing", () => {
  const ORIGINAL = process.env.INTEGRATION_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "test-secret-for-state-signing";
  });

  it("round-trips a signed payload", () => {
    const signed = signState("org-1:nonce-abc");
    expect(verifyState(signed)).toBe("org-1:nonce-abc");
  });

  /**
   * The attack this prevents: an unsigned state is a value an attacker chooses.
   * Without the signature somebody could complete an OAuth flow with their own
   * Google account while naming a different organization, and their credentials
   * would be written into that organization's row.
   */
  it("rejects a tampered organization id", () => {
    const signed = signState("org-1:nonce-abc");
    const tampered = signed.replace("org-1", "org-2");

    expect(verifyState(tampered)).toBeNull();
  });

  it("rejects a forged signature", () => {
    expect(verifyState("org-1:nonce-abc.deadbeef")).toBeNull();
  });

  it("rejects a state with no signature at all", () => {
    expect(verifyState("org-1:nonce-abc")).toBeNull();
    expect(verifyState("")).toBeNull();
  });

  it("rejects a non-hex signature rather than truncating it", () => {
    // Buffer.from(x, "hex") silently truncates invalid input, which could
    // otherwise produce a short buffer that happens to compare equal.
    expect(verifyState("org-1:nonce.zzzz")).toBeNull();
  });

  it("returns null when no signing secret is configured", () => {
    // Fails closed: without a secret, nothing is signed and nothing verifies —
    // rather than falling back to an empty key that would verify anything.
    process.env.INTEGRATION_ENCRYPTION_KEY = "";

    expect(signState("org-1:nonce")).toBe("");
    expect(verifyState("org-1:nonce.abc")).toBeNull();

    process.env.INTEGRATION_ENCRYPTION_KEY = ORIGINAL ?? "test-secret-for-state-signing";
  });
});

describe("token expiry", () => {
  it("treats a past expiry as expired", () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });

  it("treats a future expiry as valid", () => {
    expect(isExpired(new Date(Date.now() + 600_000).toISOString())).toBe(false);
  });

  it("treats a missing or unparseable expiry as expired", () => {
    // Refreshing unnecessarily is cheap; using a dead token is a failed invite.
    expect(isExpired(null)).toBe(true);
    expect(isExpired("not a date")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Provider catalogue
// -----------------------------------------------------------------------------
describe("provider descriptors", () => {
  it("describes every CUSTOMER-FACING provider the store knows about", () => {
    for (const provider of PROVIDERS.filter(isCustomerFacingProvider)) {
      const descriptor = PROVIDER_DESCRIPTORS[provider];
      expect(descriptor, provider).toBeTruthy();
      expect(descriptor.label.length, provider).toBeGreaterThan(0);
      // The dependency warning is built from this — an empty list would tell an
      // admin that disconnecting is free when it isn't.
      expect(descriptor.featureImpact.length, provider).toBeGreaterThan(0);
    }
  });

  /*
    n8n is platform-managed infrastructure: it stays in the Provider union
    because rows and a CHECK constraint reference it, but it has no descriptor,
    so it can never grow a card, a dependency warning or a connect form.
  */
  it("gives n8n no descriptor, so it cannot reach any customer surface", () => {
    expect(isCustomerFacingProvider("n8n")).toBe(false);
    expect(Object.keys(PROVIDER_DESCRIPTORS)).not.toContain("n8n");
  });

  it("describes exactly the five integrations a customer sees", () => {
    expect(Object.keys(PROVIDER_DESCRIPTORS).sort()).toEqual([
      "bolna",
      "calendar",
      "email",
      "llm",
      "whatsapp",
    ]);
  });

  it("marks only Calendar as OAuth", () => {
    // The connect flows genuinely differ: everything else takes a typed secret,
    // and Calendar must never accept one in a request body.
    expect(PROVIDER_DESCRIPTORS.calendar.connectStyle).toBe("oauth");
    expect(PROVIDER_DESCRIPTORS.bolna.connectStyle).toBe("api_key");
    expect(PROVIDER_DESCRIPTORS.email.connectStyle).toBe("api_key");
  });

  it("validates provider names", () => {
    expect(isProvider("bolna")).toBe(true);
    expect(isProvider("stripe")).toBe(false);
    expect(isProvider(null)).toBe(false);
  });
});
