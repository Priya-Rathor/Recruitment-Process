// =============================================================================
// What to tell somebody whose invite did not work.
//
// Pure, and separate from the route, for the reason the architecture rules give
// for keeping an irreversible decision out of its executor: this is the one
// place that decides how much a failed acceptance is allowed to reveal, and it
// is worth being able to test that decision without a database.
//
// MATCHED ON SQLSTATE, NEVER ON MESSAGE TEXT. Migration 0040 raises a custom
// 'INV01' for an identity mismatch precisely so this mapping does not have to
// pattern-match English that a future edit would silently break — the same
// reasoning as isSchemaOutOfDate() in lib/supabase/errors.ts.
// =============================================================================

/** Raised by public.accept_invite() when the caller is not the invited address. */
export const INVITE_IDENTITY_MISMATCH = "INV01";

export type AcceptFailure = { status: number; message: string };

/**
 * The response for a failed `accept_invite` RPC.
 *
 * TWO OUTCOMES, DELIBERATELY DIFFERENT — and the difference is the opposite of
 * the usual rule about not confirming what exists.
 *
 * Everything else stays generic: a token that is unknown, expired, revoked or
 * already used all produce one sentence, so nobody can use the error to learn
 * which tokens are real.
 *
 * The identity mismatch is told plainly instead, because the person reading it
 * ALREADY HOLDS A VALID TOKEN — genericising it teaches them nothing they could
 * not already infer, and costs them the one thing they need to know: they are
 * signed in as the wrong account. The generic message sends them to ask for
 * another invite, which arrives at the same address and fails the same way.
 *
 * What it still does NOT say is which address the invite was for. Whoever is
 * holding a forwarded link must not learn a colleague's email from an error
 * message; the page already shows the account they are signed in as, which is
 * the half of the comparison they are entitled to.
 */
export function acceptInviteFailure(code: string | null | undefined): AcceptFailure {
  if (code === INVITE_IDENTITY_MISMATCH) {
    return {
      // Authenticated, but not as the person this invite names.
      status: 403,
      message:
        "This invite was sent to a different email address. Sign out, sign in with the " +
        "address the invite was sent to, then open the link again.",
    };
  }

  return {
    status: 400,
    message: "This invite link is no longer valid. Ask for a new invite.",
  };
}
