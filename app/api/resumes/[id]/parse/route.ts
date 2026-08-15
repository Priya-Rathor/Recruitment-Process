import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireRole } from "@/lib/tenant";
import { extractResumeText } from "@/lib/resumes/extract";
import { getResume, RESUME_BUCKET } from "@/lib/resumes/queries";
import { parseResume } from "@/lib/ai/parseResume";
import { logActivity, logAiCall } from "@/lib/activity/log";
import { requireCurrentUser } from "@/lib/tenant";
import { describeDbError } from "@/lib/supabase/errors";

// Extraction plus a large AI call; the default serverless budget is too short.
export const maxDuration = 120;

/**
 * POST /api/resumes/:id/parse — run the full pipeline for one resume:
 *
 *   download -> extract text -> AI parses -> schema validation -> store proposal
 *
 * The proposal lands in `resume_parse_results`, NOT in `candidates`. Nothing
 * here can write to the candidate profile — that only happens in /review, after
 * a recruiter chooses. This is the structural version of the spec's rule.
 *
 * Owner/Admin/Recruiter only.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter"]);

    const resume = await getResume({
      organizationId: membership.organization.id,
      resumeId: id,
    });
    if (!resume) return jsonError("Resume not found.", 404);

    const supabase = await createClient();

    /** Records a terminal failure so the UI can explain it rather than spin. */
    const fail = async (message: string, status: number) => {
      await supabase
        .from("resumes")
        .update({ parse_status: "failed", parse_error: message })
        .eq("id", id)
        .eq("organization_id", membership.organization.id);
      return jsonError(message, status);
    };

    await supabase
      .from("resumes")
      .update({ parse_status: "extracting", parse_error: null })
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    const { data: file, error: downloadError } = await supabase.storage
      .from(RESUME_BUCKET)
      .download(resume.file_url);

    if (downloadError || !file) {
      console.error("[api] resume download failed:", describeDbError(downloadError));
      return fail("Could not read the stored file.", 400);
    }

    const extraction = await extractResumeText({
      buffer: await file.arrayBuffer(),
      fileName: resume.file_name,
      mimeType: resume.file_type,
    });

    if (!extraction.ok) {
      // A scan with no text layer is a normal outcome, not a crash — the
      // message names the fix (upload a text version, or type it in).
      await supabase
        .from("resumes")
        .update({
          parse_status: "failed",
          parse_error: extraction.message,
          extracted_characters: 0,
        })
        .eq("id", id)
        .eq("organization_id", membership.organization.id);

      return NextResponse.json(
        { error: extraction.message, code: extraction.reason },
        { status: 422 }
      );
    }

    await supabase
      .from("resumes")
      .update({ parse_status: "parsing", extracted_characters: extraction.characters })
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    const result = await parseResume(extraction.text);

    if (!result.ok) {
      await supabase
        .from("resumes")
        .update({ parse_status: "failed", parse_error: result.message })
        .eq("id", id)
        .eq("organization_id", membership.organization.id);

      // 503 for provider trouble, 422 for output that failed schema validation.
      const status = result.code === "invalid_output" ? 422 : 503;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    // Upsert: re-parsing replaces the previous proposal rather than stacking.
    const { error: resultError } = await supabase.from("resume_parse_results").upsert(
      {
        organization_id: membership.organization.id,
        resume_id: id,
        raw_json: result.data,
        confidence: result.data.confidence,
        applied_fields: [],
        reviewed_by: null,
        reviewed_at: null,
      },
      { onConflict: "resume_id" }
    );

    if (resultError) {
      console.error("[api] storing parse result failed:", describeDbError(resultError));
      return fail("Could not save the parsed result.", 400);
    }

    await supabase
      .from("resumes")
      .update({ parse_status: "parsed", parsed_at: new Date().toISOString(), parse_error: null })
      .eq("id", id)
      .eq("organization_id", membership.organization.id);

    // Module 14. Two events: the domain fact (a resume was parsed) and the
    // section-10 AI-call record. Summary level only — the extracted text and the
    // model's output are the candidate's personal data and are already stored
    // once, in resume_parse_results.
    const actor = await requireCurrentUser();
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "resume",
      entityId: id,
      eventType: "resume.parsed",
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      metadata: { confidence: result.data.confidence },
    });
    await logAiCall({
      organizationId: membership.organization.id,
      actorId: actor.id,
      actorLabel: actor.name ?? actor.email,
      feature: "parseResume",
      entityType: "resume",
      entityId: id,
      ok: true,
    });

    return NextResponse.json({
      data: result.data,
      // Explicit: this is a proposal awaiting review, not saved candidate data.
      saved: false,
      extractedCharacters: extraction.characters,
      truncated: extraction.truncated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
