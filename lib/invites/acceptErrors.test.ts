import { describe, expect, it } from "vitest";
import { acceptInviteFailure, INVITE_IDENTITY_MISMATCH } from "./acceptErrors";

describe("acceptInviteFailure", () => {
  it("tells the user plainly when they are signed in as the wrong account", () => {
    const failure = acceptInviteFailure(INVITE_IDENTITY_MISMATCH);

    expect(failure.status).toBe(403);
    expect(failure.message).toMatch(/different email address/i);
    // The actionable half: what to actually do about it.
    expect(failure.message).toMatch(/sign in with the address/i);
  });

  it("never names the invited address", () => {
    // The whole point of the mismatch branch is that it does not leak a
    // colleague's email to whoever is holding a forwarded link. Nothing in the
    // message may look like an address.
    expect(acceptInviteFailure(INVITE_IDENTITY_MISMATCH).message).not.toMatch(/@/);
  });

  it("stays generic for every other failure", () => {
    // Each of these must be indistinguishable from the others, so the endpoint
    // cannot be used to find out which tokens exist.
    const others: Array<[string | null | undefined, string]> = [
      ["P0001", "an expired, revoked, unknown or already-used token"],
      ["42501", "an RLS denial"],
      ["PGRST202", "the function not existing yet — migration 0040 unapplied"],
      [null, "no code at all"],
      [undefined, "an error object with no code field"],
      ["", "an empty code"],
    ];

    for (const [code, description] of others) {
      const failure = acceptInviteFailure(code);

      expect(failure.status, description).toBe(400);
      expect(failure.message, description).toBe(
        "This invite link is no longer valid. Ask for a new invite."
      );
    }
  });

  it("gives every other failure the SAME message, so none can be told apart", () => {
    // Token unknown, expired, revoked and already-accepted must be
    // indistinguishable — otherwise the endpoint becomes an oracle for which
    // tokens exist.
    const messages = ["P0001", "23505", "42P01", null].map(
      (code) => acceptInviteFailure(code).message
    );

    expect(new Set(messages).size).toBe(1);
  });
});
