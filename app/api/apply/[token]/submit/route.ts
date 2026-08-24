import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { submitApplication, MAX_RESUME_BYTES } from "@/lib/forms/submit";

/**
 * POST /api/apply/:token/submit — the applicant's submission.
 *
 * PUBLIC AND UNAUTHENTICATED, by design: the person sending this has no account
 * and never will. The token in the path is the whole authorisation, and it is
 * verified inside submitApplication() before anything is read from the body.
 *
 * MULTIPART, because a resume is a file. Answers arrive as form fields named by
 * field_key, and a checkbox sends the same name more than once — hence getAll()
 * below rather than get().
 *
 * NOTHING IN THE BODY IS TRUSTED TO SAY WHICH FORM THIS IS. No form id, no job
 * id, no organization id is read from the request: all three come from the row
 * the verified token names.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    /*
      A REQUEST TOO LARGE TO PARSE IS REFUSED BEFORE IT IS PARSED.

      formData() buffers the whole body, so checking the size afterwards would
      mean having already held it in memory. Content-Length is advisory — a
      chunked request has none — but when it IS present and absurd, this is the
      cheapest possible refusal. The real per-file cap is enforced on the parsed
      file in submitApplication().
    */
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESUME_BYTES * 1.5) {
      return jsonError("That file is larger than 10 MB. Please attach a smaller file.", 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("That submission couldn't be read. Please try again.", 400);
    }

    const answers: Record<string, unknown> = {};
    let file: { name: string; type: string | null; buffer: ArrayBuffer } | null = null;

    for (const key of new Set(form.keys())) {
      const values = form.getAll(key);

      const fileValue = values.find((value): value is File => value instanceof File);
      if (fileValue) {
        // One file per submission: the resume. See lib/forms/fields.ts for why
        // arbitrary attachments are not accepted anywhere in this module.
        if (!file && fileValue.size > 0) {
          file = {
            name: fileValue.name,
            type: fileValue.type || null,
            buffer: await fileValue.arrayBuffer(),
          };
        }
        continue;
      }

      const strings = values.filter((value): value is string => typeof value === "string");
      // A checkbox posts its name once per box ticked, so more than one value is
      // meaningful rather than a duplicate to discard.
      answers[key] = strings.length > 1 ? strings : (strings[0] ?? "");
    }

    const result = await submitApplication({
      token,
      answers,
      file,
      headers: request.headers,
      origin: request.nextUrl.origin,
    });

    if (result.ok) {
      return NextResponse.json({ data: { message: result.message } });
    }

    /*
      THE STATUS CODE MATTERS TO THE PAGE, so each refusal gets the one that
      describes it:

        closed / invalid -> 404. The page shows its neutral "no longer
                            available" card; nothing about which forms exist.
        rate_limited     -> 429.
        invalid_input    -> 422, with per-field errors the page renders inline.
        unavailable      -> 503. Our fault, and the message says so.
    */
    const status =
      result.code === "invalid" || result.code === "closed"
        ? 404
        : result.code === "rate_limited"
          ? 429
          : result.code === "invalid_input"
            ? 422
            : 503;

    return NextResponse.json(
      { error: result.message, field_errors: result.fieldErrors ?? null, code: result.code },
      { status }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
