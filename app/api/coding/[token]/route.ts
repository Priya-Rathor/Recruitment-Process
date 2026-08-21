import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api";
import { loadCandidateSession } from "@/lib/coding/candidate";

/**
 * GET /api/coding/:token — the candidate's own view of their session.
 *
 * UNAUTHENTICATED IN THE ORDINARY SENSE. The token IS the authorisation, the
 * same way the unsubscribe link is. See lib/coding/token.ts for why that is the
 * right shape for somebody who has no account here, and lib/coding/candidate.ts
 * for how the query is scoped without a session.
 *
 * The candidate page renders server-side and does not need this. It exists so
 * the workspace can recover its own state after a network drop or a background
 * tab waking up — without a full page reload that would discard whatever the
 * candidate has typed since the last save.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const result = await loadCandidateSession(token);

    if (!result.ok) {
      // One status per outcome so the client can react, but the MESSAGES are
      // already written to be shown verbatim — the client never composes its own.
      const status =
        result.code === "invalid" ? 404 : result.code === "unavailable" ? 503 : 409;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({ data: result.view });
  } catch (error) {
    return handleRouteError(error);
  }
}
