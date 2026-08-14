// Server-side resume queries. One tenant-scoped place for pages and routes.
import { createClient } from "@/lib/supabase/server";
import type { ParsedResume } from "@/lib/ai/parseResume";

export const RESUME_BUCKET = "resumes";

/** Minutes a download link stays valid. Short: resumes are personal data. */
export const SIGNED_URL_TTL_SECONDS = 300;

export type ResumeParseStatus =
  | "pending"
  | "extracting"
  | "parsing"
  | "parsed"
  | "reviewed"
  | "failed";

export type Resume = {
  id: string;
  organization_id: string;
  candidate_id: string;
  file_url: string;
  file_name: string;
  file_type: string | null;
  file_size_bytes: number | null;
  file_hash: string | null;
  parse_status: ResumeParseStatus;
  parse_error: string | null;
  extracted_characters: number | null;
  uploaded_at: string;
  parsed_at: string | null;
  uploaded_by_name?: string | null;
};

export type ParseResult = {
  id: string;
  resume_id: string;
  raw_json: ParsedResume;
  confidence: number | null;
  applied_fields: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const RESUME_COLUMNS =
  "id, organization_id, candidate_id, file_url, file_name, file_type, file_size_bytes, " +
  "file_hash, parse_status, parse_error, extracted_characters, uploaded_at, parsed_at";

/** All resumes for a candidate, newest first. */
export async function listResumes({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<Resume[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select(`${RESUME_COLUMNS}, uploader:users!resumes_uploaded_by_fkey(name, email)`)
    .eq("organization_id", organizationId)
    .eq("candidate_id", candidateId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("[resumes] list failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as (Resume & {
    uploader: { name: string | null; email: string } | null;
  })[]).map((row) => ({
    ...row,
    uploaded_by_name: row.uploader ? row.uploader.name ?? row.uploader.email : null,
  }));
}

/** One resume, tenant-scoped. Null when not ours. */
export async function getResume({
  organizationId,
  resumeId,
}: {
  organizationId: string;
  resumeId: string;
}): Promise<Resume | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resumes")
    .select(RESUME_COLUMNS)
    .eq("id", resumeId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as Resume;
}

/** The AI's proposal for a resume, if it has been parsed. */
export async function getParseResult({
  organizationId,
  resumeId,
}: {
  organizationId: string;
  resumeId: string;
}): Promise<ParseResult | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resume_parse_results")
    .select("id, resume_id, raw_json, confidence, applied_fields, reviewed_by, reviewed_at, created_at")
    .eq("organization_id", organizationId)
    .eq("resume_id", resumeId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as ParseResult;
}

/** The most recent resume for a candidate that has a reviewable proposal. */
export async function getLatestParsedResume({
  organizationId,
  candidateId,
}: {
  organizationId: string;
  candidateId: string;
}): Promise<{ resume: Resume; parseResult: ParseResult } | null> {
  const resumes = await listResumes({ organizationId, candidateId });
  const candidateResume = resumes.find(
    (resume) => resume.parse_status === "parsed" || resume.parse_status === "reviewed"
  );
  if (!candidateResume) return null;

  const parseResult = await getParseResult({
    organizationId,
    resumeId: candidateResume.id,
  });
  if (!parseResult) return null;

  return { resume: candidateResume, parseResult };
}

/**
 * Short-lived download link. The bucket is private, so this is the only way to
 * read a resume — and it is issued only after the caller's tenancy is checked.
 */
export async function createSignedResumeUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error("[resumes] signing failed:", error);
    return null;
  }
  return data.signedUrl;
}
