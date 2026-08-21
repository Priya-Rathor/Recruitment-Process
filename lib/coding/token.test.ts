// =============================================================================
// The candidate's access token.
//
// This is the whole authorisation for an unauthenticated page that shows one
// candidate's question and accepts their code. If any of these tests can be
// made to fail, somebody can read or write a session that is not theirs.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCandidateUrl,
  createAccessToken,
  isCodingTokenSigningConfigured,
  verifyAccessToken,
} from "@/lib/coding/token";

const SESSION_A = "11111111-2222-4333-8444-555555555555";
const SESSION_B = "99999999-8888-4777-8666-555555555555";

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

describe("createAccessToken / verifyAccessToken", () => {
  it("round-trips the session id it was issued for", async () => {
    const token = await createAccessToken(SESSION_A);
    expect(token).toBeTruthy();
    expect(await verifyAccessToken(token!)).toBe(SESSION_A);
  });

  it("issues a different token per session", async () => {
    const a = await createAccessToken(SESSION_A);
    const b = await createAccessToken(SESSION_B);
    expect(a).not.toBe(b);
  });

  /**
   * THE ENUMERATION TEST. Swapping the session id in the payload half must not
   * produce a token that opens a different session — otherwise anybody holding
   * one link holds all of them.
   */
  it("refuses a token whose payload was edited to name another session", async () => {
    const token = await createAccessToken(SESSION_A);
    const [, signature] = token!.split(".");

    const forgedPayload = Buffer.from(`v1:${SESSION_B}`)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyAccessToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("refuses a token signed with a different key", async () => {
    const token = await createAccessToken(SESSION_A);

    process.env.INTEGRATION_ENCRYPTION_KEY = OTHER_KEY;
    expect(await verifyAccessToken(token!)).toBeNull();
  });

  it("refuses a tampered signature", async () => {
    const token = await createAccessToken(SESSION_A);
    const [payload, signature] = token!.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(await verifyAccessToken(`${payload}.${flipped}`)).toBeNull();
  });

  it("refuses malformed input without throwing", async () => {
    for (const bad of ["", "nonsense", "a.b.c", ".", "abc.", ".abc", "%%%.%%%"]) {
      expect(await verifyAccessToken(bad), bad).toBeNull();
    }
  });

  /**
   * A payload that is well-formed but does not name a UUID must be refused, so
   * a token can never resolve to something that is not a session id.
   */
  it("refuses a payload whose id is not a uuid", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = KEY;
    const token = await createAccessToken("not-a-uuid");
    // Signing succeeds — the signer does not police shape — but verification
    // must not hand a non-uuid back to a query.
    expect(await verifyAccessToken(token!)).toBeNull();
  });
});

describe("signing configuration", () => {
  /**
   * FAILING CLOSED. With no key there can be no verifiable link, so nothing is
   * issued — rather than an unsigned token, or a link that opens for anyone.
   */
  it("issues nothing when the key is absent", async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(isCodingTokenSigningConfigured()).toBe(false);
    expect(await createAccessToken(SESSION_A)).toBeNull();
    expect(await buildCandidateUrl({ sessionId: SESSION_A, origin: "https://x.test" })).toBeNull();
  });

  it("issues nothing when the key is too short to be a secret", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "short";
    expect(isCodingTokenSigningConfigured()).toBe(false);
    expect(await createAccessToken(SESSION_A)).toBeNull();
  });

  it("cannot verify anything when the key is absent", async () => {
    const token = await createAccessToken(SESSION_A);
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(await verifyAccessToken(token!)).toBeNull();
  });
});

describe("buildCandidateUrl", () => {
  it("builds an absolute link a phone camera can follow", async () => {
    const url = await buildCandidateUrl({ sessionId: SESSION_A, origin: "https://app.test" });
    expect(url).toMatch(/^https:\/\/app\.test\/coding\//);

    const token = url!.slice("https://app.test/coding/".length);
    expect(await verifyAccessToken(token)).toBe(SESSION_A);
  });

  it("trims a trailing slash rather than emitting a double one", async () => {
    const url = await buildCandidateUrl({ sessionId: SESSION_A, origin: "https://app.test/" });
    expect(url).not.toContain("//coding");
  });

  it("falls back to APP_URL when a send has no request behind it", async () => {
    process.env.APP_URL = "https://fallback.test";
    const url = await buildCandidateUrl({ sessionId: SESSION_A });
    expect(url).toMatch(/^https:\/\/fallback\.test\/coding\//);
  });

  /**
   * A relative link is useless here: this URL becomes a QR code somebody points
   * a phone at, and the phone has no idea what host the interviewer was on. No
   * origin means no link, and the route reports that rather than issuing one.
   */
  it("returns null rather than a relative link when there is no origin", async () => {
    delete process.env.APP_URL;
    expect(await buildCandidateUrl({ sessionId: SESSION_A })).toBeNull();
    expect(await buildCandidateUrl({ sessionId: SESSION_A, origin: "  " })).toBeNull();
  });
});

describe("what the URL exposes", () => {
  /**
   * The link carries the coding session's own id and nothing else — no
   * candidate, application, interview or organization id. Somebody reading it
   * over a shoulder learns that a coding session exists, which they are already
   * looking at.
   */
  it("carries only the coding session id", async () => {
    const url = await buildCandidateUrl({ sessionId: SESSION_A, origin: "https://app.test" });
    const decoded = Buffer.from(
      url!.split("/coding/")[1].split(".")[0].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString();

    expect(decoded).toBe(`v1:${SESSION_A}`);
  });
});
