import { NextResponse, type NextRequest } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireMembership } from "@/lib/tenant";
import { createSignedResumeUrl, getResume } from "@/lib/resumes/queries";

/**
 * GET /api/resumes/:id/download — open the stored file.
 *
 * The bucket is private, so a signed URL is the only way to read a resume, and
 * this route is the only place one is issued. Two properties matter:
 *
 *   - Tenancy is checked BEFORE signing. getResume() filters on the session's
 *     organization, so a resume id from another tenant resolves to null and is
 *     indistinguishable from one that does not exist.
 *   - The signed URL is never returned in a JSON body for a client to hold.
 *     The route redirects, so the link lives for one navigation rather than
 *     sitting in application state where it could be copied out and shared.
 *
 * Readable by EVERY role, Viewer included — the spec is explicit that a Viewer
 * may view and download resumes read-only, matching Module 4's existing view
 * permissions. Uploading and reconnecting are the actions they cannot take.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership();

    const resume = await getResume({
      organizationId: membership.organization.id,
      resumeId: id,
    });
    if (!resume) return jsonError("Resume not found.", 404);

    const url = await createSignedResumeUrl(resume.file_url);
    if (!url) {
      return jsonError(
        "That file could not be opened. It may have been removed from storage.",
        404
      );
    }

    // 302, not 301: the signed URL expires in five minutes, and a permanent
    // redirect would be cached by the browser well past that.
    return NextResponse.redirect(url, 302);
  } catch (error) {
    return handleRouteError(error);
  }
}
