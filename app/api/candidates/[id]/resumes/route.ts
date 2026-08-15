import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { requireCurrentUser, requireRole } from "@/lib/tenant";
import { getCandidate } from "@/lib/candidates/queries";
import { detectFileKind, hashFile } from "@/lib/resumes/extract";
import { listResumes, RESUME_BUCKET } from "@/lib/resumes/queries";
import { logActivity } from "@/lib/activity/log";
import { describeDbError } from "@/lib/supabase/errors";

/** Mirrors the bucket's file_size_limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** GET /api/candidates/:id/resumes — list this candidate's resumes. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireRole(["owner", "admin", "recruiter", "viewer"]);

    const candidate = await getCandidate({
      organizationId: membership.organization.id,
      candidateId: id,
    });
    if (!candidate) return jsonError("Candidate not found.", 404);

    const resumes = await listResumes({
      organizationId: membership.organization.id,
      candidateId: id,
    });

    return NextResponse.json({ data: resumes });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/candidates/:id/resumes — upload a resume file (multipart).
 *
 * Uploads go through this route rather than direct-to-storage so the file is
 * hashed and validated server-side, and so the storage path is constructed by
 * us — the path's first segment is the organization id, which the storage RLS
 * policies authorise on. A client choosing its own path could otherwise write
 * into another tenant's folder.
 *
 * Owner/Admin/Recruiter only ("Upload/parse resume — Viewer: No").
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [membership, user] = await Promise.all([
      requireRole(["owner", "admin", "recruiter"]),
      requireCurrentUser(),
    ]);

    const candidate = await getCandidate({
      organizationId: membership.organization.id,
      candidateId: id,
    });
    if (!candidate) return jsonError("Candidate not found.", 404);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Upload a file.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Choose a resume file to upload.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return jsonError("That file is larger than 10 MB.", 400);
    }

    if (!detectFileKind(file.name, file.type)) {
      return jsonError(
        "Upload a PDF, DOCX, or plain-text file. Older .doc files aren't supported.",
        400
      );
    }

    const buffer = await file.arrayBuffer();
    const fileHash = await hashFile(buffer);

    const supabase = await createClient();

    // Cost-model guard: an identical file already parsed for this candidate is
    // not re-uploaded or re-parsed.
    const { data: existing } = await supabase
      .from("resumes")
      .select("id, parse_status")
      .eq("organization_id", membership.organization.id)
      .eq("candidate_id", id)
      .eq("file_hash", fileHash)
      .in("parse_status", ["parsed", "reviewed"])
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        data: existing,
        duplicate: true,
        message: "This exact file has already been parsed for this candidate.",
      });
    }

    // Path shape is load-bearing: storage RLS authorises on the first segment.
    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(-120);
    const path = `${membership.organization.id}/${id}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(RESUME_BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("[api] resume upload failed:", describeDbError(uploadError));
      return jsonError(
        "Could not store that file. If this keeps happening, check that the resumes storage bucket exists.",
        400
      );
    }

    const { data, error } = await supabase
      .from("resumes")
      .insert({
        organization_id: membership.organization.id,
        candidate_id: id,
        file_url: path,
        file_name: file.name.slice(-200),
        file_type: file.type || null,
        file_size_bytes: file.size,
        file_hash: fileHash,
        parse_status: "pending",
        uploaded_by: user.id,
      })
      .select("id, file_name, parse_status, uploaded_at")
      .single();

    if (error) {
      // Roll the object back so a failed insert doesn't leave an orphan file.
      await supabase.storage.from(RESUME_BUCKET).remove([path]);
      console.error("[api] resume record failed:", describeDbError(error));
      return jsonError("Could not save that resume.", 400);
    }

    // Module 14. Recorded against the RESUME, and the candidate timeline picks
    // it up through candidateTimelineTargets() — so a resume deleted later still
    // leaves "a resume was uploaded on this date" behind.
    const uploaded = data as unknown as { id: string; file_name: string };
    await logActivity({
      organizationId: membership.organization.id,
      entityType: "resume",
      entityId: uploaded.id,
      eventType: "resume.uploaded",
      actorId: user.id,
      actorLabel: user.name ?? user.email,
      metadata: { file_name: uploaded.file_name, candidate_id: id },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
