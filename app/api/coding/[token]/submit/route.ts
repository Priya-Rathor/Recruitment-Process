import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { submitCode } from "@/lib/coding/candidate";
import { recordCodingSubmission } from "@/lib/coding/afterSubmit";
import { isCodingLanguage } from "@/lib/coding/languages";

/**
 * POST /api/coding/:token/submit — the candidate's final answer.
 *
 * THE ORDER HERE IS THE WHOLE DESIGN.
 *
 *   1. submitCode() saves the latest code FIRST, then stamps submitted_at, then
 *      moves the session to `submitted`. A failure between those steps leaves a
 *      saved draft rather than a session marked submitted with nothing in it.
 *   2. A database trigger freezes the row the moment submitted_at is set, so
 *      "this is what they submitted" is a claim the product can stand behind
 *      even against a direct PostgREST write.
 *   3. recordCodingSubmission() then rolls the result up into the candidate's
 *      evaluation history, the audit log and the interviewer's notifications.
 *
 * STEP 3 IS AWAITED BUT CANNOT FAIL THE SUBMISSION.
 *
 * Awaited because a serverless function can be frozen the instant it responds,
 * which would leave the rollup half-written — the same reason the automation
 * dispatch is awaited after a stage change. Unable to fail it because the code
 * is already saved and frozen by the time it runs: telling the candidate their
 * submission failed would send them back to resubmit work the database will not
 * accept a second time. recordCodingSubmission() never throws; this catch is
 * belt and braces.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
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
      return jsonError("There's nothing to submit — write your answer first.", 422);
    }
    if (raw.code.trim().length === 0) {
      return jsonError("There's nothing to submit — write your answer first.", 422);
    }
    if (typeof raw.language !== "string" || !isCodingLanguage(raw.language)) {
      return jsonError("Choose a language before submitting.", 422);
    }

    const result = await submitCode({
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

    try {
      await recordCodingSubmission({
        organizationId: result.organizationId,
        applicationId: result.applicationId,
        sessionId: result.sessionId,
        language: raw.language,
        submittedAt: result.submittedAt,
      });
    } catch (rollupError) {
      // The submission itself stands. Logged loudly because the visible symptom
      // — a coding round missing from the candidate's history — is a long way
      // from this line.
      console.error("[coding] submission rollup failed after a successful submit:", rollupError);
    }

    return NextResponse.json(
      { data: { submitted_at: result.submittedAt, status: "submitted" } },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
