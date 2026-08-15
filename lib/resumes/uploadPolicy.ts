// =============================================================================
// Which files may be uploaded as a resume.
//
// A SEPARATE MODULE FROM extract.ts, and it has to stay that way.
//
// The file picker and the route handler must agree on this list, so both import
// it — but extract.ts reaches for `unpdf`, `mammoth` and `word-extractor`, all
// of which need Node's `fs`. Importing the policy from there dragged those into
// the client bundle and the build failed with "Can't resolve 'fs'".
//
// So: this file holds the shared decision and imports nothing. extract.ts
// re-exports it for server callers.
// =============================================================================

/**
 * The formats a RESUME may be uploaded in: PDF and Word only.
 *
 * Narrower than what the extractor can read. `extractResumeText()` still
 * handles plain text, because a pasted-text path elsewhere in the product
 * benefits from it, but a recruiter uploading a .txt as a CV is almost always a
 * mistake — and the point of this list is to say so at the file picker rather
 * than four seconds later, after an AI call, in language about text layers.
 */
export const RESUME_UPLOAD_EXTENSIONS = [".pdf", ".doc", ".docx"] as const;

/** The `accept` attribute and the server-side allowlist, from one source. */
export const RESUME_UPLOAD_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The exact message the spec asks for, in one place so both ends agree. */
export const RESUME_UPLOAD_REJECTION =
  "Only PDF and Word documents (.doc, .docx) are supported";

/**
 * Whether a file may be uploaded as a resume.
 *
 * Extension-first, deliberately. Browsers disagree about the MIME type of a
 * .doc — Chrome says application/msword, some Windows setups say
 * application/octet-stream, and a few send nothing at all. The extension is
 * what the recruiter actually chose, and rejecting a real Word document because
 * the browser mislabelled it would be an unexplainable failure.
 */
export function isAllowedResumeUpload(fileName: string, mimeType: string | null): boolean {
  const lower = fileName.toLowerCase();
  if (RESUME_UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;

  // No usable extension: fall back to a MIME type we recognise.
  const type = (mimeType ?? "").toLowerCase();
  return (
    type === "application/pdf" ||
    type === "application/msword" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}
