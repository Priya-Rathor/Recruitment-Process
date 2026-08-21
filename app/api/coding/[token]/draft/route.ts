import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { saveDraft } from "@/lib/coding/candidate";

/**
 * PUT /api/coding/:token/draft — save the candidate's work.
 *
 * ONE ROUTE FOR AUTOSAVE AND FOR THE SAVE BUTTON, deliberately. Two would
 * eventually disagree about validation, and the one that got it wrong would be
 * the automatic one nobody is watching.
 *
 * PUT rather than PATCH: the whole buffer is always sent. A diff would be
 * smaller on the wire and far worse to reason about — a dropped patch would
 * leave the stored code in a state the candidate never typed, and they would
 * only find out when the interviewer read it.
 *
 * Access is re-checked on every call inside saveDraft(), never cached from the
 * page load. A round cancelled mid-interview stops accepting code on the
 * candidate's next keystroke, which is the only behaviour an interviewer who
 * just pressed Cancel would consider correct.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const raw = (body ?? {}) as Record<string, unknown>;

    if (typeof raw.code !== "string") {
      return jsonError("Nothing to save.", 400);
    }
    if (typeof raw.language !== "string") {
      return jsonError("Choose a language before saving.", 400);
    }

    const result = await saveDraft({
      token,
      code: raw.code,
      language: raw.language,
    });

    if (!result.ok) {
      const status =
        result.code === "invalid"
          ? 404
          : result.code === "rejected"
            ? 422
            : result.code === "unavailable"
              ? 503
              : 409;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({
      data: { last_saved_at: result.lastSavedAt, save_count: result.saveCount },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
