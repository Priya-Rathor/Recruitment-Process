// =============================================================================
// The unsubscribe token.
//
// Its own file because it needs an environment variable set before the module is
// imported, and mixing that into the main suite would make the other tests depend
// on process.env ordering.
//
// WHAT THESE TESTS ARE ACTUALLY PROTECTING.
//
// The link is reachable without a session — a candidate has no login — so the
// signature IS the authorisation. Three properties have to hold, and each one, if
// it broke, would be a security hole rather than a bug:
//
//   1. A tampered id must not verify. Otherwise anybody holding one link can opt
//      out any candidate in the database by editing a UUID.
//   2. A tampered CHANNEL must not verify. Otherwise an email link silences
//      WhatsApp too.
//   3. Without a key, nothing verifies AND nothing is issued. A deployment with no
//      key must degrade to "reply and ask", never to a link that appears to work.
// =============================================================================
import { beforeAll, describe, expect, it, vi } from "vitest";

// Set before the import: the module reads process.env inside its functions, but
// being explicit about the ordering is what keeps this test honest about what it
// is testing.
beforeAll(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(48));
});

const CANDIDATE = "8f14e45f-ceea-467a-9b8c-1d2e3f4a5b6c";

describe("the unsubscribe token", () => {
  it("round-trips a candidate and channel", async () => {
    const { createOptOutToken, verifyOptOutToken } = await import("@/lib/communications/optout");

    const token = await createOptOutToken({ candidateId: CANDIDATE, channel: "email" });
    expect(token).not.toBeNull();

    expect(await verifyOptOutToken(token as string)).toEqual({
      candidateId: CANDIDATE,
      channel: "email",
    });
  });

  it("refuses a token whose candidate id was edited", async () => {
    const { createOptOutToken, verifyOptOutToken } = await import("@/lib/communications/optout");

    const token = (await createOptOutToken({
      candidateId: CANDIDATE,
      channel: "email",
    })) as string;

    // Re-encode the payload with a different id, keeping the original signature —
    // exactly what somebody with one link would try.
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      "v1:00000000-0000-0000-0000-000000000000:email"
    )
      .toString("base64url")
      .replace(/=+$/, "");

    expect(await verifyOptOutToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("refuses a token whose channel was edited", async () => {
    const { createOptOutToken, verifyOptOutToken } = await import("@/lib/communications/optout");

    const emailToken = (await createOptOutToken({
      candidateId: CANDIDATE,
      channel: "email",
    })) as string;
    const [, signature] = emailToken.split(".");

    const forgedPayload = Buffer.from(`v1:${CANDIDATE}:whatsapp`)
      .toString("base64url")
      .replace(/=+$/, "");

    expect(await verifyOptOutToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("issues a different token per channel", async () => {
    const { createOptOutToken } = await import("@/lib/communications/optout");

    const email = await createOptOutToken({ candidateId: CANDIDATE, channel: "email" });
    const whatsapp = await createOptOutToken({ candidateId: CANDIDATE, channel: "whatsapp" });

    expect(email).not.toBe(whatsapp);
  });

  it("refuses malformed input rather than throwing", async () => {
    const { verifyOptOutToken } = await import("@/lib/communications/optout");

    expect(await verifyOptOutToken("")).toBeNull();
    expect(await verifyOptOutToken("nonsense")).toBeNull();
    expect(await verifyOptOutToken("not.base64url!!")).toBeNull();
    expect(await verifyOptOutToken(".")).toBeNull();
  });

  it("builds an absolute URL from the request origin", async () => {
    const { buildUnsubscribeUrl } = await import("@/lib/communications/optout");

    const url = await buildUnsubscribeUrl({
      candidateId: CANDIDATE,
      channel: "email",
      origin: "https://app.example.com/",
    });

    expect(url).toMatch(/^https:\/\/app\.example\.com\/unsubscribe\?token=/);
  });

  it("has no link for WhatsApp — the opt-out lives in the thread", async () => {
    const { buildUnsubscribeUrl } = await import("@/lib/communications/optout");

    expect(
      await buildUnsubscribeUrl({
        candidateId: CANDIDATE,
        channel: "whatsapp",
        origin: "https://app.example.com",
      })
    ).toBeNull();
  });

  it("emits no link at all when there is no origin", async () => {
    const { buildUnsubscribeUrl } = await import("@/lib/communications/optout");

    // A relative link in an email is a link no mail client can follow. The footer
    // degrades to its "reply and ask" wording instead.
    vi.stubEnv("APP_URL", "");
    expect(
      await buildUnsubscribeUrl({ candidateId: CANDIDATE, channel: "email", origin: null })
    ).toBeNull();
  });
});

describe("with no signing key configured", () => {
  it("issues nothing and verifies nothing", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");

    const { createOptOutToken, isOptOutSigningConfigured, verifyOptOutToken } = await import(
      "@/lib/communications/optout"
    );

    expect(isOptOutSigningConfigured()).toBe(false);
    expect(await createOptOutToken({ candidateId: CANDIDATE, channel: "email" })).toBeNull();
    // Fails CLOSED: an unverifiable token is not honoured just because we cannot
    // check it.
    expect(await verifyOptOutToken("anything.atall")).toBeNull();

    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(48));
  });
});
