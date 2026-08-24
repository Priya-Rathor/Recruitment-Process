// =============================================================================
// The public application link.
//
// This token is the WHOLE authorisation for an unauthenticated page that
// accepts a stranger's personal data and creates a candidate record from it. If
// any test in this file can be made to fail, somebody can open or submit to a
// form that was never shared with them — or keep using a link the organization
// believes it revoked.
//
// The revocation half is what this token has and lib/coding/token.ts does not,
// so it gets the most attention here.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildApplyUrl,
  createFormToken,
  isFormTokenSigningConfigured,
  verifyFormToken,
} from "@/lib/forms/token";

const FORM_A = "11111111-2222-4333-8444-555555555555";
const FORM_B = "99999999-8888-4777-8666-555555555555";

const KEY = "a-test-signing-key-that-is-long-enough-32";
const OTHER_KEY = "a-DIFFERENT-signing-key-also-long-enough";

const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;

  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe("createFormToken / verifyFormToken", () => {
  it("round-trips the form and version it was issued for", async () => {
    const token = await createFormToken({ formId: FORM_A, tokenVersion: 1 });
    expect(token).toBeTruthy();

    await expect(verifyFormToken(token as string)).resolves.toEqual({
      formId: FORM_A,
      tokenVersion: 1,
    });
  });

  it("carries the version, so a bump can revoke it", async () => {
    const v1 = await createFormToken({ formId: FORM_A, tokenVersion: 1 });
    const v2 = await createFormToken({ formId: FORM_A, tokenVersion: 2 });

    expect(v1).not.toBe(v2);

    // Both verify — the signature is genuine either way. What makes the old one
    // dead is that its version no longer matches the row, which is checked in
    // lib/forms/public.ts. Pinned here so a future "simplification" that drops
    // the version from the payload fails loudly rather than silently
    // resurrecting every regenerated link.
    await expect(verifyFormToken(v1 as string)).resolves.toEqual({
      formId: FORM_A,
      tokenVersion: 1,
    });
    await expect(verifyFormToken(v2 as string)).resolves.toEqual({
      formId: FORM_A,
      tokenVersion: 2,
    });
  });

  it("cannot be pointed at another form by editing the URL", async () => {
    const token = (await createFormToken({ formId: FORM_A, tokenVersion: 1 })) as string;
    const [payload, signature] = token.split(".");

    // Re-encode the payload naming a different form, keeping the signature.
    const forgedPayload = btoa(`v1:${FORM_B}:1`)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await expect(verifyFormToken(`${forgedPayload}.${signature}`)).resolves.toBeNull();
    // And the original still works, so the test is testing the forgery.
    await expect(verifyFormToken(`${payload}.${signature}`)).resolves.not.toBeNull();
  });

  it("cannot have its version edited upward to survive a regeneration", async () => {
    const token = (await createFormToken({ formId: FORM_A, tokenVersion: 1 })) as string;
    const signature = token.split(".")[1];

    const forged = btoa(`v1:${FORM_A}:2`)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await expect(verifyFormToken(`${forged}.${signature}`)).resolves.toBeNull();
  });

  it("refuses a token signed with a different key", async () => {
    const token = (await createFormToken({ formId: FORM_A, tokenVersion: 1 })) as string;

    process.env.INTEGRATION_ENCRYPTION_KEY = OTHER_KEY;
    await expect(verifyFormToken(token)).resolves.toBeNull();
  });

  it("refuses malformed input instead of throwing", async () => {
    for (const bad of ["", "no-dot", "a.b", "....", "%%%.%%%", "a".repeat(500)]) {
      await expect(verifyFormToken(bad)).resolves.toBeNull();
    }
  });

  it("refuses to issue anything when there is no signing key", async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;

    expect(isFormTokenSigningConfigured()).toBe(false);
    await expect(createFormToken({ formId: FORM_A, tokenVersion: 1 })).resolves.toBeNull();
    await expect(buildApplyUrl({ formId: FORM_A, tokenVersion: 1, origin: "https://x.test" })).resolves.toBeNull();
  });

  it("refuses to issue anything for a key that is too short to be one", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "too-short";
    expect(isFormTokenSigningConfigured()).toBe(false);
    await expect(createFormToken({ formId: FORM_A, tokenVersion: 1 })).resolves.toBeNull();
  });

  it("refuses a form id that is not a uuid, or a nonsense version", async () => {
    await expect(createFormToken({ formId: "not-a-uuid", tokenVersion: 1 })).resolves.toBeNull();
    await expect(createFormToken({ formId: FORM_A, tokenVersion: 0 })).resolves.toBeNull();
    await expect(createFormToken({ formId: FORM_A, tokenVersion: 1.5 })).resolves.toBeNull();
  });
});

describe("buildApplyUrl", () => {
  it("builds an absolute URL from the request origin", async () => {
    const url = await buildApplyUrl({
      formId: FORM_A,
      tokenVersion: 1,
      origin: "https://hire.example.com/",
    });

    expect(url).toMatch(/^https:\/\/hire\.example\.com\/apply\//);
  });

  it("exposes the form id and nothing else", async () => {
    const url = (await buildApplyUrl({
      formId: FORM_A,
      tokenVersion: 3,
      origin: "https://hire.example.com",
    })) as string;

    // The organization, the job and the candidate must never be in a link that
    // gets forwarded through WhatsApp and printed on a poster. The id is
    // base64url-encoded inside the payload, so the plain uuid must not appear.
    expect(url).not.toContain(FORM_A);
    expect(url.split("/apply/")[1]).toBeTruthy();
  });

  it("falls back to APP_URL, and returns null with no origin at all", async () => {
    process.env.APP_URL = "https://fallback.example.com";
    await expect(buildApplyUrl({ formId: FORM_A, tokenVersion: 1 })).resolves.toMatch(
      /^https:\/\/fallback\.example\.com\/apply\//
    );

    delete process.env.APP_URL;
    await expect(buildApplyUrl({ formId: FORM_A, tokenVersion: 1, origin: null })).resolves.toBeNull();
  });
});
